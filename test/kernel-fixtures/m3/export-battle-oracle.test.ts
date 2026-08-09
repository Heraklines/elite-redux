/*
 * M3A-05 semantic oracle exporter.
 *
 * This file is intentionally an exporter test rather than a mechanics helper:
 * every value written below is read from a fresh, real GameManager run or from
 * the pinned slice manifests.  The only state added by this file is
 * observation state used to correlate the existing phase seams.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { Battle } from "#app/battle";
import { FaintPhase } from "#phases/faint-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { TurnStartPhase } from "#phases/turn-start-phase";
import { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const OUTPUT_ROOT = process.env.M3_ORACLE_OUTPUT_ROOT;
const ORACLE_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const CASE_IDS = [
  "physical-hit",
  "critical-hit",
  "special-hit-priority",
  "always-hit",
  "miss",
  "poison-type-immunity",
  "grass-powder-immunity",
  "existing-status-rejected",
  "speed-tie",
  "pp-consumption",
  "pp-unusable-rejected",
  "poison-application",
  "poison-residual",
  "paralysis-application",
  "paralysis-full-stop",
  "paralysis-speed-order",
  "burn-application",
  "burn-residual",
  "burn-physical-penalty",
  "spread-stage-down",
  "stage-floor-cap",
  "none-ability-no-trigger",
  "intimidate-switch-in",
  "intimidate-stage-floor",
  "wonder-guard-block",
  "wonder-guard-super-effective-pass",
  "wonder-guard-status-pass",
  "type-weakness",
  "type-resistance",
  "type-native-immunity",
  "voluntary-switch",
  "doubles-single-target",
  "same-side-simultaneous-faint",
  "mixed-side-simultaneous-faint",
  "forced-replacement",
  "no-legal-replacement",
  "victory",
  "defeat",
];

const SAFE_U53_MAX = 9_007_199_254_740_991;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AnyRecord = Record<string, any>;

interface ObservationTrace {
  scenarioId: string;
  game?: GameManager;
  collectRng?: boolean;
  collectMutations?: boolean;
  actionOrder: AnyRecord[];
  mutations: AnyRecord[];
  rngDraws: AnyRecord[];
  faints: AnyRecord[];
  nextGlobalFaintId: number;
  nextRngSequence: number;
  activeAction: AnyRecord | null;
  identity?: WeakMap<object, number>;
  abilityOverrides?: WeakMap<object, number>;
}

let activeTrace: ObservationTrace | null = null;
let phaserGame: Phaser.Game;
const restoreHooks: (() => void)[] = [];

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("NONFINITE_ORACLE_VALUE", path);
  }
}

function sortedValue(value: unknown, path = "$", content = false): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    assertFinite(value, path);
    // CR-0015: the strict content preimage admits the full signed
    // JavaScript-safe integer interval. In particular, PLAY NICE's stage
    // delta remains the numeric token -1 rather than a string or magnitude.
    if (content && (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_U53_MAX)) {
      fail("CONTENT_CANONICAL_VALUE", `${path} is not a safe integer`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => sortedValue(child, `${path}[${index}]`, content));
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      if (content && !/^[\x00-\x7F]*$/u.test(key)) {
        fail("CONTENT_CANONICAL_KEY", `${path}.${key}`);
      }
      out[key] = sortedValue((value as AnyRecord)[key], `${path}.${key}`, content);
    }
    return out;
  }
  fail("UNSUPPORTED_CANONICAL_VALUE", path);
}

function canonicalBytes(value: unknown, content = false, trailingNewline = true): Buffer {
  const text = JSON.stringify(sortedValue(value, "$", content));
  return Buffer.from(trailingNewline ? `${text}\n` : text, "utf8");
}

function writeCanonical(path: string, value: unknown): void {
  writeFileSync(path, canonicalBytes(value));
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function readJson(relativePath: string): AnyRecord {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8")) as AnyRecord;
}

function b3(bytes: Buffer): string {
  const result = spawnSync("b3sum", ["-"], { input: bytes, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail("CONTENT_HASH_UNAVAILABLE", result.error?.message ?? result.stderr ?? "b3sum failed");
  }
  const digest = result.stdout.trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    fail("CONTENT_HASH_UNAVAILABLE", "b3sum did not return a lowercase 64-hex digest");
  }
  return digest;
}

function provenance(contentPackHash: string): AnyRecord {
  const nodeVersion = process.version;
  const phaserVersion = readJson("node_modules/phaser/package.json").version;
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("ORACLE_RUNTIME", `expected hosted linux/x64, got ${process.platform}/${process.arch}`);
  }
  if (process.env.LC_ALL !== "C" || process.env.LANG !== "C" || process.env.TZ !== "UTC") {
    fail("ORACLE_RUNTIME", "exporter must run with C locale and UTC timezone");
  }
  return {
    oracle_game_sha: ORACLE_SHA,
    oracle_tree_sha: git("rev-parse", `${ORACLE_SHA}^{tree}`),
    exporter_commit_sha: git("rev-parse", "HEAD"),
    content_pack_hash: contentPackHash,
    node_version: nodeVersion,
    phaser_version: phaserVersion,
    runner_class: "GITHUB_HOSTED_UBUNTU",
    platform: "linux",
    architecture: "x64",
    locale: "C",
    timezone: "UTC",
  };
}

function statusKind(effect: number | undefined): AnyRecord {
  switch (effect ?? StatusEffect.NONE) {
    case StatusEffect.NONE:
    case StatusEffect.FAINT:
      return { kind: "NONE" };
    case StatusEffect.BURN:
      return { kind: "BURN" };
    case StatusEffect.POISON:
      return { kind: "POISON" };
    case StatusEffect.PARALYSIS:
      return { kind: "PARALYSIS" };
    default:
      fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported status ${String(effect)}`);
  }
}

function capabilityStatus(): AnyRecord {
  return { kind: "SUPPORTED" };
}

function typeName(type: number): string {
  const name = (PokemonType as unknown as Record<number, string>)[type];
  if (!name || name === "UNKNOWN" || name === "STELLAR") {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported selected type ${String(type)}`);
  }
  return name;
}

function contentPack(): { pack: AnyRecord; hash: string } {
  const slice = readJson("rust/fixtures/m3/m3-slice-manifest.json");
  const capability = readJson("rust/fixtures/m3/m3-capability-manifest.json");
  const species = slice.species_definitions.map((entry: AnyRecord) => ({
    id: entry.id,
    base_types: {
      primary: entry.runtime_types[0],
      secondary: entry.runtime_types[1] ?? null,
    },
    base_stats: {
      hp: entry.base_stats.hp,
      attack: entry.base_stats.attack,
      defense: entry.base_stats.defense,
      special_attack: entry.base_stats.special_attack,
      special_defense: entry.base_stats.special_defense,
      speed: entry.base_stats.speed,
    },
    capability: capabilityStatus(),
  }));
  const moves = slice.move_definitions.map((entry: AnyRecord) => ({
    id: entry.id,
    category: entry.category,
    move_type: entry.runtime_type,
    power: entry.power < 0 ? { kind: "NONE" } : { kind: "VALUE", value: entry.power },
    accuracy: entry.accuracy < 0 ? { kind: "ALWAYS_HITS" } : { kind: "PERCENT", value: entry.accuracy },
    base_pp: entry.pp,
    effect_chance: entry.effect_chance < 0
      ? { kind: "NONE" }
      : { kind: "PERCENT", value: entry.effect_chance },
    priority: entry.priority,
    target: entry.target,
    flags: entry.flags,
    effects: entry.effects.map((effect: string) => {
      if (effect === "DAMAGE") {
        return { kind: "DAMAGE" };
      }
      if (effect === "APPLY_BURN") {
        return { kind: "APPLY_STATUS", value: "BURN" };
      }
      if (effect === "APPLY_POISON") {
        return { kind: "APPLY_STATUS", value: "POISON" };
      }
      if (effect === "APPLY_PARALYSIS") {
        return { kind: "APPLY_STATUS", value: "PARALYSIS" };
      }
      if (effect === "LOWER_ATTACK_ONE_STAGE") {
        return { kind: "CHANGE_STAT_STAGE", value: { stat: "ATTACK", delta: -1 } };
      }
      fail("CONTENT_CANONICAL_VALUE", `unmapped move effect ${effect}`);
    }),
    capability: capabilityStatus(),
  }));
  const abilities = slice.ability_definitions.map((entry: AnyRecord) => ({
    id: entry.id,
    effect: entry.effect === "NONE"
      ? { kind: "NONE" }
      : entry.effect === "POST_SUMMON_ADJACENT_OPPONENT_ATTACK_MINUS_ONE"
        ? { kind: "POST_SUMMON_ADJACENT_OPPONENT_ATTACK_MINUS_ONE" }
        : { kind: "NON_SUPER_EFFECTIVE_ATTACK_IMMUNITY" },
    capability: capabilityStatus(),
  }));
  const multiplier = (value: string): string => {
    if (value === "0") return "ZERO";
    if (value === "1/2") return "HALF";
    if (value === "2") return "TWO";
    fail("CONTENT_CANONICAL_VALUE", `unmapped type multiplier ${value}`);
  };
  const typeChart = {
    entries: slice.type_chart.non_neutral_entries.map((entry: AnyRecord) => ({
      attack: entry.attack_type,
      defense: entry.defense_type,
      multiplier: multiplier(entry.multiplier),
    })),
  };
  const capabilityManifest = {
    schema_version: capability.schema_version,
    oracle_game_sha: ORACLE_SHA,
    entries: capability.entries.map((entry: AnyRecord) => ({
      subject: {
        kind: entry.subject_kind,
        value: entry.subject_kind === "STATUS"
          ? ({ 1: "POISON", 3: "PARALYSIS", 6: "BURN" } as Record<number, string>)[entry.subject_id]
          : entry.subject_id === 0 && (entry.subject_kind === "WEATHER" || entry.subject_kind === "TERRAIN")
            ? "NONE"
            : entry.subject_id,
      },
      status: { kind: entry.status },
      required_positive_cases: entry.positive_cases,
      required_edge_cases: entry.edge_cases,
    })),
  };
  const withoutHash = {
    schema_version: 1,
    oracle_game_sha: ORACLE_SHA,
    species,
    moves,
    abilities,
    type_chart: typeChart,
    capability_manifest: capabilityManifest,
  };
  const hash = b3(canonicalBytes(withoutHash, true, false));
  return {
    hash,
    pack: { ...withoutHash, hash: `blake3-v1:${hash}` },
  };
}

function f64Bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function rdgState(rng: Phaser.Math.RandomDataGenerator): AnyRecord {
  const state = rng.state();
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    fail("RNG_STATE_UNOBSERVABLE", `invalid Phaser state ${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (!Number.isInteger(carry) || carry < 0 || carry > 0xffffffff || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) {
    fail("RNG_STATE_UNOBSERVABLE", `invalid Phaser state fields ${state}`);
  }
  return {
    state_string: state,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function rngVectorState(rng: Phaser.Math.RandomDataGenerator): AnyRecord {
  return rdgState(rng);
}

function generateRngVectors(): AnyRecord[] {
  const seeds = ["m3-rng-seed-a", "m3-rng-seed-b", "m3-rng-seed-c", "m3-rng-seed-d"];
  const vectors: AnyRecord[] = [];
  for (const seed of seeds) {
    const rng = new Phaser.Math.RandomDataGenerator([seed]);
    for (let index = 0; index < 250; index++) {
      const before = rngVectorState(rng);
      const operation = index % 5;
      let api: string;
      let result: unknown;
      let minimum = 0;
      let cardinality = 1;
      if (operation === 0) {
        api = "INTEGER";
        result = rng.integer();
        cardinality = 0x100000000;
      } else if (operation === 1) {
        api = "FRAC";
        result = rng.frac();
      } else if (operation === 2) {
        api = "REAL_IN_RANGE";
        minimum = -3;
        cardinality = 17;
        result = rng.realInRange(-3, 14);
      } else if (operation === 3) {
        api = "INTEGER_IN_RANGE";
        minimum = index % 7;
        cardinality = 1 + (index % 13);
        result = rng.integerInRange(minimum, minimum + cardinality - 1);
      } else {
        api = "PICK";
        const values = ["zero", "one", "two", "three", "four"];
        result = rng.pick(values);
        cardinality = values.length;
      }
      if (typeof result === "number") {
        assertFinite(result, `${seed}/${index}/${api}`);
      } else if (typeof result !== "string") {
        fail("RNG_VECTOR_UNOBSERVABLE", `${seed}/${index}/${api} returned a non-canonical value`);
      }
      const after = rngVectorState(rng);
      vectors.push({
        sequence: vectors.length,
        seed,
        operation: api,
        minimum,
        cardinality,
        result,
        before,
        after,
        semantics: {
          integer: "rnd()*0x100000000",
          frac_multiplier: "0x200000",
          frac_coercion: "TO_INT32_OR",
          n: "SOW_HASH_ACCUMULATOR_EXCLUDED",
        },
      });
    }
  }
  return vectors;
}

function effectiveBattleStyle(spec: ScenarioSpec): "single" | "double" | "triple" {
  if (spec.run?.triple) {
    return "triple";
  }
  if (spec.run?.double || (spec.enemy?.kind === "party" && (spec.enemy.party?.length ?? 0) >= 2)) {
    return "double";
  }
  return "single";
}

function scenarioFor(id: string): ScenarioSpec {
  const base: ScenarioSpec = {
    v: 1,
    name: `M3 oracle ${id}`,
    run: { wave: 1, level: 100, difficulty: "ace", seed: `m3-${id}` },
    party: [{ species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE }],
    enemy: { kind: "wild", wild: { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE } },
  };
  const player = base.party[0];
  const enemy = base.enemy?.kind === "wild" ? base.enemy.wild : undefined;
  if (!player || !enemy) {
    fail("SCENARIO_SETUP", id);
  }
  const use = (move: number): void => {
    // Some cases replace the complete party after the base lead reference is
    // created. Resolve the lead at admission-spec construction time so the
    // semantic intent always describes the actual scenario party.
    const lead = base.party[0];
    if (lead == null) {
      fail("SCENARIO_SETUP", `${id} has no lead party member`);
    }
    lead.moves = [move, 1, 52, 589];
  };
  switch (id) {
    case "special-hit-priority":
    case "always-hit":
    case "type-weakness":
      use(MoveId.SHOCK_WAVE);
      enemy.species = 7;
      break;
    case "miss":
      use(MoveId.POISON_POWDER);
      break;
    case "poison-type-immunity":
      use(MoveId.POISON_POWDER);
      enemy.species = 23;
      break;
    case "grass-powder-immunity":
      use(MoveId.POISON_POWDER);
      enemy.species = 1;
      break;
    case "existing-status-rejected":
      use(MoveId.POISON_POWDER);
      enemy.status = StatusEffect.BURN;
      break;
    case "speed-tie":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 19, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 19, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      use(MoveId.POUND);
      break;
    case "pp-consumption":
      use(MoveId.POUND);
      break;
    case "pp-unusable-rejected":
      use(MoveId.POUND);
      break;
    case "poison-application":
    case "poison-residual":
      use(MoveId.POISON_POWDER);
      break;
    case "paralysis-application":
      use(MoveId.STUN_SPORE);
      break;
    case "paralysis-full-stop":
      use(MoveId.POUND);
      player.moves = [MoveId.POUND, MoveId.STUN_SPORE, MoveId.POISON_POWDER, MoveId.PLAY_NICE];
      base.start = { playerStatus: StatusEffect.PARALYSIS };
      break;
    case "paralysis-speed-order":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 19, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 19, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      base.start = { playerStatus: StatusEffect.PARALYSIS };
      use(MoveId.POUND);
      break;
    case "burn-application":
    case "burn-residual":
    case "burn-physical-penalty":
      use(MoveId.EMBER);
      break;
    case "spread-stage-down":
    case "stage-floor-cap":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      use(MoveId.PLAY_NICE);
      if (id === "stage-floor-cap") {
        base.start = {
          enemyStages: [-6, 0, 0, 0, 0, 0, 0],
          enemy2Stages: [-6, 0, 0, 0, 0, 0, 0],
        };
      }
      break;
    case "none-ability-no-trigger":
      player.ability = AbilityId.NONE;
      use(MoveId.POUND);
      break;
    case "intimidate-switch-in":
    case "intimidate-stage-floor":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.INTIMIDATE },
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      use(MoveId.PLAY_NICE);
      if (id === "intimidate-stage-floor") {
        base.start = {
          enemyStages: [-6, 0, 0, 0, 0, 0, 0],
          enemy2Stages: [-6, 0, 0, 0, 0, 0, 0],
        };
      }
      break;
    case "wonder-guard-block":
      enemy.species = 52;
      enemy.ability = AbilityId.WONDER_GUARD;
      use(MoveId.POUND);
      break;
    case "wonder-guard-super-effective-pass":
      enemy.species = 7;
      enemy.ability = AbilityId.WONDER_GUARD;
      use(MoveId.SHOCK_WAVE);
      break;
    case "wonder-guard-status-pass":
      enemy.species = 52;
      enemy.ability = AbilityId.WONDER_GUARD;
      use(MoveId.POISON_POWDER);
      break;
    case "type-resistance":
      enemy.species = 1;
      use(MoveId.SHOCK_WAVE);
      break;
    case "type-native-immunity":
      enemy.species = 50;
      use(MoveId.SHOCK_WAVE);
      break;
    case "voluntary-switch":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        { species: 23, moves: [1, 77, 78, 589], ability: AbilityId.INTIMIDATE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      use(MoveId.PLAY_NICE);
      break;
    case "doubles-single-target":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        { species: 7, moves: [351, 52, 1, 589], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 1, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      use(MoveId.POUND);
      break;
    case "same-side-simultaneous-faint":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 7, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      base.start = { playerHpPct: 1, player2HpPct: 1 };
      use(MoveId.PLAY_NICE);
      break;
    case "mixed-side-simultaneous-faint":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 7, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      base.start = { playerHpPct: 1, player2HpPct: 1, enemyHpPct: 1, enemy2HpPct: 1 };
      use(MoveId.POUND);
      break;
    case "forced-replacement":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 23, moves: [1, 77, 78, 589], ability: AbilityId.INTIMIDATE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      base.start = { playerHpPct: 1 };
      use(MoveId.PLAY_NICE);
      (base.party[1] as AnyRecord).moves = [MoveId.PLAY_NICE, 1, 52, 351];
      break;
    case "no-legal-replacement":
      base.run = { ...base.run, double: true };
      base.party = [
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
        { species: 19, moves: [589, 1, 52, 351], ability: AbilityId.NONE },
      ];
      base.enemy = {
        kind: "party",
        party: [
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
          { species: 52, level: 100, moves: [1, 52, 351, 589], ability: AbilityId.NONE },
        ],
      };
      base.start = { playerHpPct: 1, player2HpPct: 1 };
      use(MoveId.PLAY_NICE);
      break;
    case "victory":
      base.start = { enemyHpPct: 1 };
      use(MoveId.SHOCK_WAVE);
      break;
    case "defeat":
      base.start = { playerHpPct: 1 };
      use(MoveId.PLAY_NICE);
      break;
    case "physical-hit":
    case "critical-hit":
    default:
      use(MoveId.POUND);
      break;
  }
  return base;
}

function restoreRealBattleRng(): void {
  BattleScene.prototype.randBattleSeedInt = function (this: BattleScene, range: number, min = 0): number {
    return this.currentBattle?.randSeedInt(range, min) ?? min;
  };
}

async function launchScenario(spec: ScenarioSpec): Promise<GameManager> {
  const game = new GameManager(phaserGame);
  restoreRealBattleRng();
  game.override.criticalHits(null);
  if (!(game.scene.ui.shouldSkipDialogue as AnyRecord).mock) {
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  }
  const { scenario, postLaunch } = buildDevScenario(spec);
  await game.runToTitle();
  const starters = scenario.setup();
  game.override.battleStyle(effectiveBattleStyle(spec));
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const starterPhase = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    starterPhase.initBattle(starters, true);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  scenario.onBattleStart?.();
  return game;
}

function battleRngState(game: GameManager): AnyRecord {
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  const saved = battle?.battleSeedState as string | null | undefined;
  return {
    run: { rdg: rdgState(Phaser.Math.RND) },
    battle: battle == null
      ? null
      : {
          battle_seed: String(battle.battleSeed),
          turn: battle.turn,
          saved_substream: saved == null ? null : rdgStateFromString(saved),
        },
    seed_offset: game.scene.rngOffset === 0 && game.scene.rngSeedOverride === ""
      ? null
      : {
          wave_seed: String(game.scene.rngSeedOverride || game.scene.waveSeed || game.scene.seed),
          offset: game.scene.rngOffset,
        },
    next_sequence: activeTrace?.nextRngSequence ?? 0,
  };
}

function rdgStateFromString(state: string): AnyRecord {
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    fail("RNG_STATE_UNOBSERVABLE", `invalid saved Phaser state ${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (!Number.isInteger(carry) || carry < 0 || carry > 0xffffffff || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) {
    fail("RNG_STATE_UNOBSERVABLE", `invalid saved Phaser state ${state}`);
  }
  return {
    state_string: state,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function simplePokemon(mon: Pokemon): AnyRecord {
  return {
    id: mon.id,
    hp: mon.hp,
    fainted: mon.isFainted(),
    status: mon.status == null
      ? { effect: StatusEffect.NONE, toxic_turn_count: 0, sleep_turns_remaining: null }
      : {
          effect: mon.status.effect,
          toxic_turn_count: mon.status.toxicTurnCount,
          sleep_turns_remaining: mon.status.sleepTurnsRemaining ?? null,
        },
    stages: mon.getStatStages().slice(),
    moves: mon.getMoveset().map(move => ({ move_id: move.moveId, pp_used: move.ppUsed })),
  };
}

function liveFingerprint(game: GameManager): string {
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  const value = {
    rng: battleRngState(game),
    battle: battle == null
      ? null
      : {
          turn: battle.turn,
          commands: battle.turnCommands,
          pre_commands: battle.preTurnCommands,
          player: game.scene.getPlayerParty().map(simplePokemon),
          enemy: game.scene.getEnemyParty().map(simplePokemon),
          weather: game.scene.arena.weatherType,
          terrain: game.scene.arena.terrainType,
          tags: game.scene.arena.tags.map((tag: AnyRecord) => tag.tagType ?? tag.constructor?.name),
        },
  };
  return createHash("sha256").update(canonicalBytes(value, false, false)).digest("hex");
}

function installObservationHooks(): void {
  const originalBattleRand = Battle.prototype.randSeedInt;
  let battleDrawInProgress = false;
  (Battle.prototype as AnyRecord).randSeedInt = function (this: Battle, range: number, min = 0): number {
    if (!activeTrace?.collectRng) {
      return originalBattleRand.call(this, range, min);
    }
    const game = activeTrace.game as GameManager;
    const before = battleRngState(game);
    const stack = new Error().stack ?? "";
    battleDrawInProgress = true;
    let result: number;
    try {
      result = originalBattleRand.call(this, range, min);
    } finally {
      battleDrawInProgress = false;
    }
    const after = battleRngState(game);
    const consuming = range > 1;
    assertFinite(result, `battle-rng/${activeTrace.scenarioId}/${activeTrace.nextRngSequence}`);
    if (!Number.isInteger(result) || !Number.isSafeInteger(range) || !Number.isSafeInteger(min)) {
      fail("RNG_DRAW_UNOBSERVABLE", `non-integral battle draw at ${activeTrace.scenarioId}`);
    }
    activeTrace.rngDraws.push({
      sequence: activeTrace.nextRngSequence++,
      stream: "BATTLE",
      reason: rngReason(stack),
      public_api: "RAND_SEED_INT",
      callsite_id: callsiteId(stack),
      minimum: min,
      cardinality: range,
      result,
      consumed: consuming,
      primitive_draw_count: consuming ? 2 : 0,
      before_state: before,
      after_state: after,
      before_fingerprint: fingerprint(before),
      after_fingerprint: fingerprint(after),
    });
    return result;
  };
  restoreHooks.push(() => {
    Battle.prototype.randSeedInt = originalBattleRand;
  });

  const originalGetAbility = Pokemon.prototype.getAbility;
  (Pokemon.prototype as AnyRecord).getAbility = function (this: Pokemon, ignoreOverride = false): AnyRecord {
    const forced = activeTrace?.abilityOverrides?.get(this);
    if (!ignoreOverride && forced !== undefined) {
      const ability = allAbilities[forced];
      if (ability == null || ability.id !== forced) {
        fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported explicit ability ${String(forced)}`);
      }
      return ability;
    }
    return originalGetAbility.call(this, ignoreOverride);
  };
  restoreHooks.push(() => {
    Pokemon.prototype.getAbility = originalGetAbility;
  });

  let directRangeInProgress = false;
  let directPickInProgress = false;
  const originalIntegerInRange = Phaser.Math.RND.integerInRange;
  (Phaser.Math.RND as AnyRecord).integerInRange = function (min: number, max: number): number {
    if (!activeTrace?.collectRng || battleDrawInProgress || directRangeInProgress || directPickInProgress) {
      return originalIntegerInRange.call(this, min, max);
    }
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      fail("RNG_DRAW_UNOBSERVABLE", `invalid direct Phaser integerInRange ${String(min)}..${String(max)}`);
    }
    const game = activeTrace.game as GameManager;
    const before = battleRngState(game);
    let result: number;
    directRangeInProgress = true;
    try {
      result = originalIntegerInRange.call(this, min, max);
    } finally {
      directRangeInProgress = false;
    }
    const after = battleRngState(game);
    const stack = new Error().stack ?? "";
    const offset = game.scene.rngOffset;
    const seedOffset = offset !== 0 || game.scene.rngSeedOverride !== "";
    const cardinality = max - min + 1;
    assertFinite(result, `direct-rng/${activeTrace.scenarioId}/${activeTrace.nextRngSequence}`);
    if (!Number.isSafeInteger(result) || result < min || result > max) {
      fail("RNG_DRAW_UNOBSERVABLE", `direct Phaser integerInRange returned ${String(result)}`);
    }
    const publicApi = seedOffset && /speed|shuffle|order/iu.test(stack) ? "FISHER_YATES_SWAP" : "INTEGER_IN_RANGE";
    const reason = seedOffset && publicApi === "FISHER_YATES_SWAP" ? "SpeedTie" : rngReason(stack);
    activeTrace.rngDraws.push({
      sequence: activeTrace.nextRngSequence++,
      stream: seedOffset ? "SEED_OFFSET" : "RUN",
      reason,
      public_api: publicApi,
      callsite_id: callsiteId(stack),
      minimum: min,
      cardinality,
      result,
      consumed: cardinality > 1,
      primitive_draw_count: cardinality > 1 ? 2 : 0,
      before_state: before,
      after_state: after,
      before_fingerprint: fingerprint(before),
      after_fingerprint: fingerprint(after),
      ...(seedOffset
        ? { seed_offset_context: { wave_seed: String(game.scene.rngSeedOverride || game.scene.waveSeed), offset } }
        : {}),
    });
    return result;
  };
  restoreHooks.push(() => {
    Phaser.Math.RND.integerInRange = originalIntegerInRange;
  });

  for (const methodName of ["integer", "frac", "realInRange", "pick", "shuffle"] as const) {
    const original = (Phaser.Math.RND as AnyRecord)[methodName];
    if (typeof original !== "function") {
      fail("OBSERVATION_SEAM_MISSING", `Phaser RND.${methodName} is not callable`);
    }
    (Phaser.Math.RND as AnyRecord)[methodName] = function (this: AnyRecord, ...args: any[]): any {
      if (!activeTrace?.collectRng || battleDrawInProgress || directRangeInProgress || directPickInProgress) {
        return original.apply(this, args);
      }
      const game = activeTrace.game as GameManager;
      const before = battleRngState(game);
      const auditCount = activeTrace.rngDraws.length;
      if (methodName === "pick") {
        const values = args[0];
        if (values == null || typeof values.length !== "number" || values.length < 1 || !Number.isSafeInteger(values.length)) {
          fail("RNG_DRAW_UNOBSERVABLE", "Phaser pick received a non-empty array-like value");
        }
        directPickInProgress = true;
        let result: any;
        try {
          result = original.apply(this, args);
        } finally {
          directPickInProgress = false;
        }
        const after = battleRngState(game);
        const resultIndex = Array.from(values as ArrayLike<unknown>).indexOf(result);
        if (resultIndex < 0) {
          fail("RNG_DRAW_UNOBSERVABLE", "Phaser pick returned a value absent from its input");
        }
        const stack = new Error().stack ?? "";
        const offset = game.scene.rngOffset;
        const seedOffset = offset !== 0 || game.scene.rngSeedOverride !== "";
        activeTrace.rngDraws.push({
          sequence: activeTrace.nextRngSequence++,
          stream: seedOffset ? "SEED_OFFSET" : "RUN",
          reason: seedOffset && /speed|shuffle|order/iu.test(stack) ? "SpeedTie" : rngReason(stack),
          public_api: "PICK",
          callsite_id: callsiteId(stack),
          minimum: 0,
          cardinality: values.length,
          result: resultIndex,
          consumed: values.length > 1,
          primitive_draw_count: values.length > 1 ? 2 : 0,
          before_state: before,
          after_state: after,
          before_fingerprint: fingerprint(before),
          after_fingerprint: fingerprint(after),
          ...(seedOffset
            ? { seed_offset_context: { wave_seed: String(game.scene.rngSeedOverride || game.scene.waveSeed), offset } }
            : {}),
        });
        return result;
      }
      const result = original.apply(this, args);
      const after = battleRngState(game);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        if (methodName !== "shuffle" || activeTrace.rngDraws.length === auditCount) {
          fail("UNRECORDED_RNG_STATE_CHANGE", `direct Phaser ${methodName} changed the run stream`);
        }
      }
      return result;
    };
    restoreHooks.push(() => {
      (Phaser.Math.RND as AnyRecord)[methodName] = original;
    });
  }

  const originalHandle = (TurnStartPhase.prototype as AnyRecord).handleTurnCommand;
  (TurnStartPhase.prototype as AnyRecord).handleTurnCommand = function (turnCommand: AnyRecord, pokemon: Pokemon): void {
    if (activeTrace != null) {
      const fieldIndex = pokemon.getFieldIndex();
      const moveId = turnCommand?.move?.move;
      const move = moveId == null ? null : pokemon.getMoveset().find(candidate => candidate.moveId === moveId)?.getMove();
      const action = {
        sequence: activeTrace.actionOrder.length,
        actor_legacy_pid: pokemon.id,
        source_slot: fieldSlot(activeTrace.game as GameManager, fieldIndex),
        command: commandKind(turnCommand?.command),
        target_slots: (turnCommand?.targets ?? []).map((target: number) => fieldSlot(activeTrace.game as GameManager, target)),
        priority: move?.priority ?? 0,
        effective_speed: pokemon.getStats(false)[Stat.SPD] ?? 0,
        move_priority: move?.priority ?? 0,
        tie_order: activeTrace.actionOrder.length,
        skipped: !!turnCommand?.skip,
        phase: "TurnStartPhase",
      };
      activeTrace.actionOrder.push(action);
      activeTrace.activeAction = action;
    }
    return originalHandle.call(this, turnCommand, pokemon);
  };
  restoreHooks.push(() => {
    (TurnStartPhase.prototype as AnyRecord).handleTurnCommand = originalHandle;
  });

  wrapMutation(Pokemon.prototype, "damage", "HP_DAMAGE");
  wrapMutation(Pokemon.prototype, "trySetStatus", "STATUS_ATTEMPT");
  wrapMutation(Pokemon.prototype, "doSetStatus", "STATUS_SET");
  wrapMutation(Pokemon.prototype, "setStatStage", "STAT_STAGE");
  wrapMutation(PokemonMove.prototype, "usePp", "PP_CONSUMPTION");
  wrapMutation(Battle.prototype, "incrementTurn", "TURN_ADVANCE");

  const originalFaintStart = FaintPhase.prototype.start;
  FaintPhase.prototype.start = function (this: FaintPhase): void {
    originalFaintStart.call(this);
    if (activeTrace == null) {
      return;
    }
    const address = (this as AnyRecord).faintSourceAddress as AnyRecord | undefined;
    const pokemon = (this as AnyRecord).getPokemon?.() as Pokemon | undefined;
    if (!address || !pokemon) {
      fail("CANONICAL_STATE_UNOBSERVABLE", "FaintPhase did not expose its source address");
    }
    const id = activeTrace.nextGlobalFaintId++;
    const slot = fieldSlot(activeTrace.game as GameManager, this.battlerIndex);
    const occurrence = {
      id,
      source: {
        epoch: 1,
        wave: address.wave,
        resolved_turn: address.turn,
        turn_occurrence: address.occurrence,
      },
      slot,
      pokemon: pokemonId(activeTrace, pokemon),
      owner_seat: slot.side === "PLAYER" ? slot.position + 1 : null,
      replacement: { kind: "PENDING" },
      resolved: false,
    };
    activeTrace.faints.push(occurrence);
    activeTrace.mutations.push({
      sequence: activeTrace.mutations.length,
      kind: "FAINT_QUEUED",
      phase: "FaintPhase",
      cause: activeTrace.activeAction == null ? "TURN_RESOLUTION" : activeTrace.activeAction.sequence,
      path: `battle.faint_queue[${activeTrace.faints.length - 1}]`,
      before: null,
      after: faintProjection(occurrence),
    });
  };
  restoreHooks.push(() => {
    FaintPhase.prototype.start = originalFaintStart;
  });
}

function wrapMutation(proto: AnyRecord, methodName: string, kind: string): void {
  const original = proto[methodName];
  if (typeof original !== "function") {
    fail("OBSERVATION_SEAM_MISSING", `${methodName} is not callable`);
  }
  proto[methodName] = function (this: AnyRecord, ...args: any[]): any {
    const trace = activeTrace;
    const before = trace == null ? null : mutationSnapshot(this);
    const result = original.apply(this, args);
    if (trace != null && trace.collectMutations) {
      const after = mutationSnapshot(this);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const phase = trace.game.scene.phaseManager.getCurrentPhase();
        if (phase == null || typeof phase.phaseName !== "string" || phase.phaseName.length === 0) {
          fail("UNRECORDED_STATE_CHANGE", `${kind} mutation has no observed phase`);
        }
        trace.mutations.push({
          sequence: trace.mutations.length,
          kind,
          phase: phase.phaseName,
          cause: trace.activeAction == null ? "TURN_RESOLUTION" : trace.activeAction.sequence,
          path: mutationPath(trace, this, kind),
          before,
          after,
        });
      }
    }
    return result;
  };
  restoreHooks.push(() => {
    proto[methodName] = original;
  });
}

function mutationSnapshot(value: AnyRecord): AnyRecord {
  if (value instanceof Pokemon) {
    return simplePokemon(value);
  }
  if (value instanceof PokemonMove) {
    return { pp_used: value.ppUsed, move_id: value.moveId };
  }
  if (value instanceof Battle) {
    return { turn: value.turn, commands: value.turnCommands, pre_commands: value.preTurnCommands };
  }
  return { value: String(value) };
}

function mutationPath(trace: ObservationTrace, value: AnyRecord, kind: string): string {
  if (value instanceof Pokemon) {
    return `pokemon/${pokemonId(trace, value)}/${kind.toLowerCase()}`;
  }
  if (value instanceof PokemonMove) {
    return `move/${value.moveId}/pp_used`;
  }
  return `battle/${kind.toLowerCase()}`;
}

function rngReason(stack: string): string {
  if (/hitCheck/iu.test(stack)) return "Accuracy";
  if (/getCriticalHitResult/iu.test(stack)) return "CriticalHit";
  if (/getAttackDamage/iu.test(stack)) return "DamageVariance";
  if (/paraly|confusion/iu.test(stack)) return "ParalysisActivation";
  if (/applyMoveEffects|triggerMoveEffects|secondary|effect.?chance/iu.test(stack)) return "SecondaryEffect";
  if (/speed|shuffle|order/iu.test(stack)) return "SpeedTie";
  fail("UNMAPPED_RNG_REASON", stack.split("\n")[2] ?? stack);
}

function callsiteId(stack: string): string {
  const lines = stack.split("\n").map(line => line.trim()).filter(Boolean);
  const sourceLine = lines.find(line => /src[\\/].+\.ts:\d+/u.test(line));
  const match = sourceLine?.match(/(?:^|[\\/])((?:src|test|scripts)[\\/].+?\.ts:\d+(?::\d+)?)/u);
  if (match == null) {
    fail("UNMAPPED_RNG_REASON", sourceLine ?? lines[2] ?? "unknown-callsite");
  }
  return match[1].replaceAll("\\", "/");
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalBytes(value, false, false)).digest("hex");
}

function pokemonId(trace: ObservationTrace, mon: Pokemon): number {
  const id = trace.identity?.get(mon);
  if (id == null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unmapped live Pokemon ${String(mon.id)}`);
  }
  return id;
}

function faintProjection(occurrence: AnyRecord): AnyRecord {
  const { resolved: _resolved, ...canonical } = occurrence;
  return canonical;
}

function fieldSlot(game: GameManager, battlerIndex: number): AnyRecord {
  const location = game.scene.currentBattle.arrangement.locate(battlerIndex);
  if (location.side < 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unmapped battler index ${String(battlerIndex)}`);
  }
  return {
    side: location.side === 0 ? "PLAYER" : "ENEMY",
    position: location.position,
  };
}

function commandKind(command: number | undefined): string {
  switch (command) {
    case Command.FIGHT:
      return "FIGHT";
    case Command.POKEMON:
      return "SWITCH";
    case Command.BALL:
      return "BALL";
    case Command.RUN:
      return "RUN";
    case Command.SHIFT:
      return "SHIFT";
    default:
      fail("COMMAND_UNOBSERVABLE", `unknown command ${String(command)}`);
  }
}

function buildIdentity(game: GameManager, trace: ObservationTrace): AnyRecord[] {
  const mapping: AnyRecord[] = [];
  trace.identity = new WeakMap<object, number>();
  let next = 1;
  const add = (side: "PLAYER" | "ENEMY", party: Pokemon[]): void => {
    party.forEach((mon, partyIndex) => {
      trace.identity?.set(mon, next);
      mapping.push({
        side,
        party_index: partyIndex,
        legacy_pid: mon.id,
        pokemon_id: next,
      });
      next++;
    });
  };
  add("PLAYER", game.scene.getPlayerParty());
  add("ENEMY", game.scene.getEnemyParty());
  return mapping;
}

function applyTestOnlyContentProjection(game: GameManager, spec: ScenarioSpec, trace: ObservationTrace): void {
  // The existing scenario builder's override seam treats ability id zero as
  // absent. Project the declared loadout through this test-only observation
  // seam so NONE is an observed active ability, never a natural-ability guess.
  trace.abilityOverrides = new WeakMap<object, number>();
  const project = (mon: Pokemon, requested: number | undefined, passive: number | undefined): void => {
    if (requested === undefined) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `scenario omitted an explicit active ability for Pokemon ${String(mon.id)}`);
    }
    if (!Number.isSafeInteger(requested) || requested < 0 || allAbilities[requested]?.id !== requested) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported explicit ability ${String(requested)} for Pokemon ${String(mon.id)}`);
    }
    trace.abilityOverrides?.set(mon, requested);
    if (passive !== undefined) {
      if (!Number.isSafeInteger(passive) || passive < 0 || allAbilities[passive]?.id !== passive) {
        fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported explicit passive ability ${String(passive)} for Pokemon ${String(mon.id)}`);
      }
      mon.setTempPassives([allAbilities[passive], null, null]);
    } else {
      mon.setTempPassives([null, null, null]);
    }
  };

  game.scene.getPlayerParty().forEach((mon, index) => {
    project(mon, spec.party[index]?.ability, spec.party[index]?.passiveAbility);
  });
  const enemySpecs = spec.enemy?.kind === "wild"
    ? [spec.enemy.wild]
    : spec.enemy?.kind === "party"
      ? spec.enemy.party ?? []
      : [];
  game.scene.getEnemyParty().forEach((mon, index) => {
    const enemySpec = enemySpecs[index];
    project(mon, enemySpec?.ability, enemySpec?.passiveAbility);
  });
}

function canonicalPokemon(trace: ObservationTrace, mon: Pokemon, side: "PLAYER" | "ENEMY", partyIndex: number): AnyRecord {
  if (mon.isFusion() || mon.isTerastallized) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `fusion/Tera state on ${side}[${partyIndex}]`);
  }
  const types = mon.getTypes(false, false, false, false).filter(type => type !== PokemonType.UNKNOWN);
  if (types.length < 1 || types.length > 2) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `effective typing on ${side}[${partyIndex}] has ${types.length} entries`);
  }
  const stats = mon.getStats(false);
  if (stats.length < 6 || stats.some(value => !Number.isSafeInteger(value) || value < 0)) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `effective stats on ${side}[${partyIndex}]`);
  }
  const stages = mon.getStatStages();
  if (stages.length < 7 || stages.some(value => !Number.isInteger(value) || value < -6 || value > 6)) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `stat stages on ${side}[${partyIndex}]`);
  }
  const status = mon.status;
  const passives = mon.getPassiveAbilities().slice(0, 3).map(ability => ability == null ? null : ability.id);
  while (passives.length < 3) {
    passives.push(null);
  }
  const suppressedSlots = (mon.summonData as AnyRecord).erSuppressedInnateSlots;
  const passiveSuppressed = [0, 1, 2].map(index => {
    if (suppressedSlots instanceof Set) {
      return suppressedSlots.has(index);
    }
    if (Array.isArray(suppressedSlots)) {
      return suppressedSlots[index] === true;
    }
    if (suppressedSlots == null) {
      return false;
    }
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported passive suppression shape on ${side}[${partyIndex}]`);
  });
  const moveSlots = mon.getMoveset().slice(0, 4).map(move => ({
    move_id: move.moveId,
    pp_used: move.ppUsed,
    pp_ups: move.ppUp ?? 0,
    max_pp_override: move.maxPpOverride ?? null,
  }));
  while (moveSlots.length < 4) {
    moveSlots.push(null as never);
  }
  const maxHp = mon.getMaxHp();
  const activeAbility = mon.getAbility();
  if (!activeAbility || activeAbility.id == null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `active ability on ${side}[${partyIndex}]`);
  }
  return {
    id: pokemonId(trace, mon),
    owner_seat: side === "PLAYER" ? 1 : null,
    species_id: mon.species.speciesId,
    form_index: mon.formIndex,
    level: mon.level,
    types: { primary: typeName(types[0]), secondary: types.length === 2 ? typeName(types[1]) : null },
    stats: {
      hp: maxHp,
      attack: stats[Stat.ATK],
      defense: stats[Stat.DEF],
      special_attack: stats[Stat.SPATK],
      special_defense: stats[Stat.SPDEF],
      speed: stats[Stat.SPD],
    },
    hp: mon.hp,
    max_hp: maxHp,
    status: {
      kind: statusKind(status?.effect),
      toxic_turn_count: status?.toxicTurnCount ?? 0,
      sleep_turns_remaining: status?.sleepTurnsRemaining ?? null,
    },
    stat_stages: {
      attack: stages[0],
      defense: stages[1],
      special_attack: stages[2],
      special_defense: stages[3],
      speed: stages[4],
      accuracy: stages[5],
      evasion: stages[6],
    },
    moves: moveSlots,
    abilities: {
      active: activeAbility.id,
      passives,
      active_suppressed: !!(mon.summonData as AnyRecord).abilitySuppressed,
      passive_suppressed: passiveSuppressed,
    },
    fainted: mon.isFainted(),
  };
}

function formatState(game: GameManager): AnyRecord {
  const battle = game.scene.currentBattle;
  const arrangement = battle.arrangement;
  const slots: AnyRecord[] = [];
  for (const index of arrangement.activeIndices()) {
    const location = arrangement.locate(index);
    const field = location.side === 0 ? game.scene.getPlayerField(false) : game.scene.getEnemyField(false);
    const mon = field[location.position];
    slots.push({
      slot: {
        side: location.side === 0 ? "PLAYER" : "ENEMY",
        position: location.position,
      },
      occupant: mon == null ? null : pokemonId(activeTrace!, mon),
    });
  }
  const adjacency: AnyRecord[] = [];
  const locations = arrangement.activeIndices().map(index => arrangement.locate(index));
  for (let first = 0; first < locations.length; first++) {
    for (let second = first + 1; second < locations.length; second++) {
      if (arrangement.isAdjacent(locations[first], locations[second])) {
        adjacency.push({
          first: {
            side: locations[first].side === 0 ? "PLAYER" : "ENEMY",
            position: locations[first].position,
          },
          second: {
            side: locations[second].side === 0 ? "PLAYER" : "ENEMY",
            position: locations[second].position,
          },
        });
      }
    }
  }
  return {
    player_capacity: arrangement.playerCapacity,
    enemy_capacity: arrangement.enemyCapacity,
    adjacency,
    slots,
  };
}

function commandOffer(game: GameManager, mon: Pokemon, fieldIndex: number): AnyRecord {
  const battle = game.scene.currentBattle;
  const moves = mon.getMoveset().map((move, moveSlot) => ({
      move_slot: moveSlot,
    legal_targets: game.scene.getEnemyField(false)
      .map((target, position) => ({ target, position }))
      .filter(({ target }) => target != null && !target.isFainted() && battle.arrangement.isAdjacent(
        battle.arrangement.locate(fieldIndex),
        battle.arrangement.locate(target.getBattlerIndex()),
      ))
      .map(({ position }) => ({ kind: "SELECTED", value: [fieldSlot(game, battle.arrangement.enemyOffset + position)] })),
  }));
  const switches = game.scene.getPlayerParty().map((candidate, partySlot) => ({ candidate, partySlot }))
    .filter(({ candidate, partySlot }) => partySlot >= battle.getBattlerCount() && candidate.isAllowedInBattle())
    .map(({ candidate, partySlot }) => ({ party_slot: partySlot, pokemon: pokemonId(activeTrace!, candidate) }));
  return { fight: moves, switches };
}

function commandFrontier(game: GameManager): AnyRecord[] {
  const battle = game.scene.currentBattle;
  if (game.isVictory() || game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    return [];
  }
  return game.scene.getPlayerField(false).map((mon, position) => {
    if (mon == null || mon.isFainted()) {
      return null;
    }
    const flat = battle.arrangement.indexOf({ side: 0, position });
    const turn = battle.turn;
    const ownerSeat = position + 1;
    return {
      operation_id: `battle/1/wave/${battle.waveIndex}/turn/${turn}/command/player/${position}/seat/${ownerSeat}`,
      owner_seat: ownerSeat,
      actor: pokemonId(activeTrace!, mon),
      field_slot: fieldSlot(game, flat),
      offer: commandOffer(game, mon, flat),
      status: { kind: "PENDING" },
    };
  }).filter(Boolean);
}

function outcome(game: GameManager): string {
  if (game.isVictory()) {
    return "VICTORY";
  }
  if (game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    return "DEFEAT";
  }
  return "ONGOING";
}

function updateFaintProgress(game: GameManager, trace: ObservationTrace): void {
  for (const occurrence of trace.faints) {
    const slot = occurrence.slot;
    if (slot.side !== "PLAYER") {
      occurrence.replacement = { kind: "NOT_REQUIRED" };
      continue;
    }
    const field = game.scene.getPlayerField(false);
    const current = field[slot.position];
    const currentId = current == null ? null : pokemonId(trace, current);
    const original = trace.identity == null ? null : [...game.scene.getPlayerParty()].find(mon => pokemonId(trace, mon) === occurrence.pokemon);
    if (currentId != null && currentId !== occurrence.pokemon && !current?.isFainted()) {
      const partySlot = game.scene.getPlayerParty().indexOf(current);
      occurrence.replacement = { kind: "SELECTED", party_slot: partySlot, pokemon: currentId };
    } else if (original?.isFainted()) {
      occurrence.replacement = { kind: "NO_LEGAL_REPLACEMENT" };
    } else {
      occurrence.replacement = { kind: "PENDING" };
    }
  }
}

function settleFaintOccurrences(game: GameManager, trace: ObservationTrace): void {
  updateFaintProgress(game, trace);
  const playerField = game.scene.getPlayerField(false);
  for (const occurrence of trace.faints) {
    if (occurrence.slot.side === "ENEMY") {
      occurrence.resolved = true;
      continue;
    }
    const current = playerField[occurrence.slot.position];
    const currentId = current == null ? null : pokemonId(trace, current);
    if (occurrence.replacement.kind === "NO_LEGAL_REPLACEMENT") {
      occurrence.resolved = true;
    } else if (currentId != null && currentId !== occurrence.pokemon && !current.isFainted()) {
      occurrence.resolved = true;
    } else if (game.scene.getPlayerParty().every(mon => mon.isFainted())) {
      occurrence.resolved = true;
    }
  }
}

function captureState(game: GameManager, trace: ObservationTrace, contentHash: string): AnyRecord {
  const before = liveFingerprint(game);
  const battle = game.scene.currentBattle;
  const state = {
    schema_version: 1,
    content_hash: `blake3-v1:${contentHash}`,
    mode: GameModes.CLASSIC,
    wave: battle.waveIndex,
    next_battle_id: 2,
    run_rng: battleRngState(game).run,
    battle: {
      battle_id: 1,
      wave: battle.waveIndex,
      turn: battle.turn,
      format: formatState(game),
      authority_seat: 1,
      player_party: game.scene.getPlayerParty().map((mon, index) => canonicalPokemon(trace, mon, "PLAYER", index)),
      enemy_party: game.scene.getEnemyParty().map((mon, index) => canonicalPokemon(trace, mon, "ENEMY", index)),
      field: { slots: formatState(game).slots },
      weather: {
        kind: { kind: "NONE" },
        remaining_turns: game.scene.arena.weather?.turnsLeft ?? 0,
      },
      terrain: {
        kind: { kind: "NONE" },
        remaining_turns: game.scene.arena.terrain?.turnsLeft ?? 0,
      },
      arena_conditions: [],
      global_ability_suppression: {
        ignore_abilities: !!game.scene.arena.ignoreAbilities,
        source: null,
      },
      battle_rng: battleRngState(game).battle,
      command_state: {
        frontier: commandFrontier(game),
        tombstones: [],
      },
      faint_queue: trace.faints.filter(occurrence => !occurrence.resolved).map(faintProjection),
      next_faint_occurrence: trace.nextGlobalFaintId,
      outcome: outcome(game),
    },
  };
  if (game.scene.arena.weatherType !== 0 || game.scene.arena.terrainType !== 0 || game.scene.arena.tags.length > 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "selected M3 state contains non-neutral field conditions");
  }
  const after = liveFingerprint(game);
  if (before !== after) {
    fail("CAPTURE_MUTATED_STATE", `${trace.scenarioId} canonical capture changed live state`);
  }
  return state;
}

function committedCommands(game: GameManager, rawCommands: AnyRecord, trace: ObservationTrace): AnyRecord[] {
  const battle = game.scene.currentBattle;
  const commands: AnyRecord[] = [];
  for (const key of Object.keys(rawCommands).sort((first, second) => Number(first) - Number(second))) {
    const turnCommand = rawCommands[key];
    if (turnCommand == null) {
      continue;
    }
    const flatIndex = Number(key);
    const location = battle.arrangement.locate(flatIndex);
    const field = location.side === 0 ? game.scene.getPlayerField(false) : game.scene.getEnemyField(false);
    const actor = field[location.position];
    if (actor == null) {
      fail("COMMAND_UNOBSERVABLE", `command actor missing at ${String(key)}`);
    }
    const kind = commandKind(turnCommand.command);
    const moveId = turnCommand.move?.move;
    const moveSlot = moveId == null ? null : actor.getMoveset().findIndex(move => move.moveId === moveId);
    const targets = (turnCommand.targets ?? turnCommand.move?.targets ?? []).map((target: number) => fieldSlot(game, target));
    const player = location.side === 0;
    const position = location.position;
    const ownerSeat = player ? position + 1 : null;
    const operationId = player
      ? `battle/1/wave/${battle.waveIndex}/turn/${battle.turn}/command/player/${position}/seat/${ownerSeat}`
      : `battle/1/wave/${battle.waveIndex}/turn/${battle.turn}/command/enemy/${position}/script/${turnCommand.cursor ?? 0}`;
    let command: AnyRecord;
    if (kind === "FIGHT") {
      if (moveSlot == null || moveSlot < 0) {
        fail("COMMAND_UNOBSERVABLE", `move ${String(moveId)} is not in the actor's observed moveset`);
      }
      command = {
        kind: "FIGHT",
        actor: pokemonId(trace, actor),
        move_slot: moveSlot,
        targets: targets.length === 0 ? { kind: "IMPLICIT" } : { kind: "SELECTED", value: targets },
      };
    } else if (kind === "SWITCH") {
      const partySlot = turnCommand.cursor;
      const selected = partySlot == null ? null : game.scene.getPlayerParty()[partySlot];
      command = {
        kind: "SWITCH",
        actor: pokemonId(trace, actor),
        party_slot: partySlot ?? null,
        pokemon: selected == null ? null : pokemonId(trace, selected),
      };
    } else {
      command = { kind, actor: pokemonId(trace, actor) };
    }
    commands.push({
      operation_id: operationId,
      owner_seat: ownerSeat,
      actor: pokemonId(trace, actor),
      field_slot: fieldSlot(game, flatIndex),
      command,
      source: player ? "AUTHORITY_LOCAL_INTERNAL" : "SCRIPTED_ENEMY",
    });
  }
  return commands;
}

function semanticIntent(id: string, spec: ScenarioSpec, game: GameManager): AnyRecord[] {
  const move = spec.party[0]?.moves?.[0];
  if (id === "voluntary-switch") {
    const replacement = game.scene.getPlayerParty()[2];
    if (replacement == null) {
      fail("COMMAND_UNOBSERVABLE", "voluntary-switch semantic intent has no observed bench replacement");
    }
    return [{
      sequence: 0,
      scenario_id: id,
      action: {
        kind: "SWITCH",
        party_slot: 2,
        pokemon: pokemonId(activeTrace!, replacement),
        source: "SCENARIO_SEMANTIC_INTENT",
      },
    }];
  }
  return [{
    sequence: 0,
    scenario_id: id,
    action: {
      kind: "FIGHT",
      move_id: move ?? null,
      target: move === MoveId.PLAY_NICE ? null : fieldSlot(game, BattlerIndex.ENEMY),
      source: "SCENARIO_SEMANTIC_INTENT",
    },
  }];
}

function replacementProposals(game: GameManager, trace: ObservationTrace): AnyRecord[] {
  updateFaintProgress(game, trace);
  return trace.faints
    .filter(occurrence => occurrence.slot.side === "PLAYER" && occurrence.replacement.kind !== "PENDING")
    .map(occurrence => {
      const source = occurrence.source;
      const operationId = `RC/e${source.epoch}/w${source.wave}/t${source.resolved_turn}/o${source.turn_occurrence}/f${occurrence.slot.position}/s${occurrence.owner_seat}`;
      const progress = occurrence.replacement;
      const selection = progress.kind === "SELECTED"
        ? { kind: "SELECTED", party_slot: progress.party_slot, pokemon: progress.pokemon }
        : { kind: "NO_LEGAL_REPLACEMENT" };
      return {
        schema_version: 1,
        operation_id: operationId,
        battle_id: 1,
        wave: source.wave,
        resolved_turn: source.resolved_turn,
        owner_seat: occurrence.owner_seat,
        occurrence: occurrence.id,
        turn_occurrence: source.turn_occurrence,
        field_slot: occurrence.slot,
        selection,
      };
    });
}

function presentationPlan(events: AnyRecord[], wave: number, resolvedTurn: number): AnyRecord[] {
  if (events.length === 0) {
    fail("PRESENTATION_UNOBSERVABLE", "the authority recorder returned no semantic event plan");
  }
  const operationId = `battle/1/wave/${wave}/turn/${resolvedTurn}/result`;
  return events.map((event, sequence) => ({
    event_id: { operation_id: operationId, sequence },
    authority_recorded: true,
    event,
  }));
}

function nextControl(game: GameManager): AnyRecord {
  const phase = game.scene.phaseManager.getCurrentPhase();
  if (phase == null || typeof phase.phaseName !== "string" || phase.phaseName.length === 0) {
    fail("NEXT_CONTROL_UNOBSERVABLE", "phase manager did not expose a current phase name");
  }
  const phaseName = phase.phaseName;
  const getQueuedPhaseNames = (game.scene.phaseManager as AnyRecord).getQueuedPhaseNames;
  if (typeof getQueuedPhaseNames !== "function") {
    fail("NEXT_CONTROL_UNOBSERVABLE", "phase manager did not expose queued phase names");
  }
  const queued = getQueuedPhaseNames.call(game.scene.phaseManager);
  if (!Array.isArray(queued) || queued.some(name => typeof name !== "string" || name.length === 0)) {
    fail("NEXT_CONTROL_UNOBSERVABLE", "phase manager queued phase names were not a string array");
  }
  let controlKind: string;
  if (game.isVictory() || game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    controlKind = "Terminal";
  } else if (/Switch|Faint|Replacement/u.test(phaseName)) {
    controlKind = "PartyReplacement";
  } else if (phaseName === "SelectTargetPhase" || game.scene.ui.getMode() === UiMode.TARGET_SELECT) {
    controlKind = "TargetSelect";
  } else if (game.scene.ui.getMode() === UiMode.FIGHT) {
    controlKind = "MoveSelect";
  } else if (phaseName === "CommandPhase") {
    controlKind = "Command";
  } else {
    fail("NEXT_CONTROL_UNOBSERVABLE", `unmapped settled control phase ${phaseName}`);
  }
  const pending: number[] = [];
  if (controlKind === "Command") {
    const commands = game.scene.currentBattle.turnCommands;
    for (const mon of game.scene.getPlayerField(false)) {
      if (mon == null || mon.isFainted()) continue;
      const fieldIndex = mon.getBattlerIndex();
      if (commands[fieldIndex] == null) {
        pending.push(mon.getFieldIndex() + 1);
      }
    }
  }
  const mode = game.scene.ui.getMode();
  const handler = game.scene.ui.getHandler() as AnyRecord | undefined;
  const observed: AnyRecord = {
    control_kind: controlKind,
    wave: game.scene.currentBattle.waveIndex,
    turn: game.scene.currentBattle.turn,
    phase_name: phaseName,
    queued_phases: queued,
    pending_command_owners: pending,
  };
  if (typeof mode === "number" && UiMode[mode] != null) {
    observed.ui_mode = UiMode[mode];
  }
  if (handler != null) {
    const handlerName = handler.constructor?.name;
    if (typeof handlerName === "string" && handlerName.length > 0) {
      observed.handler = handlerName;
    }
    if (typeof handler.cursor === "number") {
      observed.cursor = handler.cursor;
    }
  }
  return observed;
}

function registerReplacementPrompt(game: GameManager): void {
  game.onNextPrompt("SwitchPhase", UiMode.PARTY, () => {
    const handler = game.scene.ui.getHandler() as AnyRecord;
    const battlerCount = game.scene.currentBattle.getBattlerCount();
    const slot = game.scene.getPlayerParty().findIndex((mon, index) => index >= battlerCount && mon.isAllowedInBattle());
    if (slot < 0) {
      return;
    }
    if (typeof handler.setCursor !== "function" || typeof handler.processInput !== "function") {
      fail("NEXT_CONTROL_UNOBSERVABLE", "replacement prompt did not expose its observed party handler");
    }
    handler.setCursor(slot);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
  });
}

function admitPlayerCommands(game: GameManager, id: string): void {
  const field = game.scene.getPlayerField(false);
  const select = (mon: Pokemon, battlerIndex: number): void => {
    const move = mon.getMoveset()[0];
    if (move == null) {
      fail("COMMAND_UNOBSERVABLE", `no selected move in player field ${String(battlerIndex)}`);
    }
    if (id === "pp-unusable-rejected") {
      move.ppUsed = move.getMovePp();
    }
    const target = move.moveId === MoveId.PLAY_NICE ? undefined : BattlerIndex.ENEMY;
    game.move.select(move.moveId, battlerIndex as BattlerIndex, target);
  };
  if (id === "voluntary-switch") {
    // In a double battle party slots 0 and 1 are active; slot 2 is the
    // observed bench choice. Commit the partner's real command as well so the
    // switch is admitted through the same complete command frontier.
    if (field[1] != null && !field[1].isFainted()) {
      select(field[1], BattlerIndex.PLAYER_2);
    }
    game.doSwitchPokemon(2);
  } else {
    if (field[0] != null && !field[0].isFainted()) select(field[0], BattlerIndex.PLAYER);
    if (field[1] != null && !field[1].isFainted()) select(field[1], BattlerIndex.PLAYER_2);
  }
}

async function admitEnemyCommands(game: GameManager, id: string): Promise<void> {
  if (id === "victory") {
    return;
  }
  const enemy = game.scene.getEnemyField(false);
  const targets = game.scene.getPlayerField(false);
  for (let index = 0; index < enemy.length; index++) {
    const mon = enemy[index];
    if (mon == null || mon.isFainted()) continue;
    const target = targets[index] && !targets[index].isFainted()
      ? targets[index].getBattlerIndex()
      : BattlerIndex.PLAYER;
    await game.move.forceEnemyMove(MoveId.POUND, target);
  }
}

function normalizeActionOrder(game: GameManager, trace: ObservationTrace): AnyRecord[] {
  const playerParty = game.scene.getPlayerParty();
  const enemyParty = game.scene.getEnemyParty();
  const findByLegacyPid = (legacyPid: number): Pokemon => {
    const mon = [...playerParty, ...enemyParty].find(candidate => candidate.id === legacyPid);
    if (mon == null) {
      fail("ACTION_ORDER_UNOBSERVABLE", `unknown action actor ${String(legacyPid)}`);
    }
    return mon;
  };
  return trace.actionOrder.map(action => {
    const mon = findByLegacyPid(action.actor_legacy_pid);
    const side = action.source_slot.side === "PLAYER" ? "player" : "enemy";
    const position = action.source_slot.position;
    const operationId = action.source_slot.side === "PLAYER"
      ? `battle/1/wave/${game.scene.currentBattle.waveIndex}/turn/${game.scene.currentBattle.turn}/command/player/${position}/seat/${position + 1}`
      : `battle/1/wave/${game.scene.currentBattle.waveIndex}/turn/${game.scene.currentBattle.turn}/command/enemy/${position}/script/0`;
    return {
      sequence: action.sequence,
      kind: action.command === "FIGHT" ? "MOVE" : action.command === "SWITCH" ? "SWITCH" : "MOVE",
      actor: pokemonId(trace, mon),
      source_slot: action.source_slot,
      command_operation_id: operationId,
      effective_speed: action.effective_speed,
      timing_modifier: 0,
      move_priority: action.move_priority,
      bracket_modifier: 0,
      tie_order: action.tie_order,
      disposition: action.skipped ? "SKIPPED_ACTOR_INACTIVE" : "EXECUTED",
      source: side,
      phase: action.phase,
      target_slots: action.target_slots,
    };
  });
}

async function exportCase(id: string, contentHash: string, sharedProvenance: AnyRecord): Promise<AnyRecord> {
  const spec = scenarioFor(id);
  activeTrace = null;
  const game = await launchScenario(spec);
  const trace: ObservationTrace = {
    scenarioId: id,
    game,
    actionOrder: [],
    mutations: [],
    rngDraws: [],
    faints: [],
    nextGlobalFaintId: 1,
    nextRngSequence: 0,
    activeAction: null,
    collectRng: false,
    collectMutations: false,
  };
  activeTrace = trace;
  applyTestOnlyContentProjection(game, spec, trace);
  const legacyIdentityMap = buildIdentity(game, trace);
  const initialState = captureState(game, trace, contentHash);
  const initialRng = battleRngState(game);
  const resolvedTurn = game.scene.currentBattle.turn;
  trace.collectRng = true;
  trace.collectMutations = true;
  beginCoopRecording(resolvedTurn);
  if (id === "forced-replacement" || id === "same-side-simultaneous-faint" || id === "mixed-side-simultaneous-faint") {
    registerReplacementPrompt(game);
  }
  admitPlayerCommands(game, id);
  await admitEnemyCommands(game, id);
  const rawCommitted = JSON.parse(JSON.stringify(game.scene.currentBattle.turnCommands)) as AnyRecord;
  const admitted = committedCommands(game, rawCommitted, trace);
  await game.toEndOfTurn();
  const recording = endCoopRecording();
  const presentation = presentationPlan(recording.events as AnyRecord[], game.scene.currentBattle.waveIndex, resolvedTurn);

  if (!game.isVictory() && !game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    await game.toNextTurn();
  }
  settleFaintOccurrences(game, trace);
  const finalState = captureState(game, trace, contentHash);
  const finalRng = battleRngState(game);
  const replacement = replacementProposals(game, trace);
  const committed = [...admitted];
  const semantic = semanticIntent(id, spec, game);
  const actionOrder = normalizeActionOrder(game, trace);
  const envelope = {
    schema_version: 1,
    scenario_id: id,
    provenance: sharedProvenance,
    initial_state: {
      canonical: initialState,
      legacy_identity_map: legacyIdentityMap,
    },
    initial_rng: initialRng,
    commands: {
      input_events: [],
      semantic_intent: semantic,
      committed,
      replacement_proposals: replacement,
      replacement_identity_observations: trace.faints.map(occurrence => ({
        global_faint_occurrence_id: occurrence.id,
        turn_occurrence: occurrence.source.turn_occurrence,
        operation_id_turn_occurrence_component: occurrence.source.turn_occurrence,
        source: "TEST_ONLY_FAINT_PHASE_ORDER_PROJECTION; PRODUCTION_FaintSource_HAS_TURN_OCCURRENCE_ONLY",
      })),
    },
    expected_rng_draws: trace.rngDraws,
    expected_action_order: actionOrder,
    expected_mutations: trace.mutations,
    expected_presentation: presentation,
    expected_final_state: {
      canonical: finalState,
      legacy_identity_map: legacyIdentityMap,
    },
    final_rng: finalRng,
    expected_next_control: nextControl(game),
    gaps: [],
  };
  activeTrace = null;
  return envelope;
}

function outputRootPath(): string {
  if (typeof OUTPUT_ROOT !== "string" || OUTPUT_ROOT.length === 0) {
    fail("EXPORT_CONFIGURATION", "M3_ORACLE_OUTPUT_ROOT is required");
  }
  return OUTPUT_ROOT;
}

describe("M3A-05 fresh semantic oracle export", () => {
  beforeAll(() => {
    if (process.env.M3_ORACLE_SHA !== ORACLE_SHA) {
      fail("EXPORT_CONFIGURATION", "the exporter did not pin the corrected oracle source SHA");
    }
    if (process.platform !== "linux" || process.arch !== "x64") {
      fail("ORACLE_RUNTIME", "M3 oracle publication requires the hosted linux/x64 runner");
    }
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    installObservationHooks();
  });

  afterAll(() => {
    activeTrace = null;
    for (const restore of restoreHooks.splice(0).reverse()) {
      restore();
    }
    phaserGame?.destroy(true);
  });

  it("writes the complete 38-case semantic tree and both support artifacts", async () => {
    const root = outputRootPath();
    const { pack, hash } = contentPack();
    const sharedProvenance = provenance(hash);
    mkdirSync(resolve(root, "battle-cases"), { recursive: true });
    for (const id of CASE_IDS) {
      const envelope = await exportCase(id, hash, sharedProvenance);
      writeCanonical(resolve(root, "battle-cases", `${id}.json`), envelope);
    }
    writeCanonical(resolve(root, "content-pack-v1.json"), {
      artifact_id: "content-pack-v1",
      schema_version: 1,
      provenance: sharedProvenance,
      content_pack: pack,
    });
    writeCanonical(resolve(root, "rng-vectors-v1.json"), {
      artifact_id: "rng-vectors-v1",
      schema_version: 1,
      provenance: sharedProvenance,
      vectors: generateRngVectors(),
    });
    expect(CASE_IDS).toHaveLength(38);
  }, 2_700_000);
});
