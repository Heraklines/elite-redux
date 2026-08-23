/*
 * M3A-05 semantic oracle exporter.
 *
 * This file is intentionally an exporter test rather than a mechanics helper:
 * every value written below is read from a fresh, real GameManager run or from
 * the pinned slice manifests.  The only state added by this file is
 * observation state used to correlate the existing phase seams.
 */

import { Battle } from "#app/battle";
import { BattleScene } from "#app/battle-scene";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { DynamicQueueManager } from "#app/dynamic-queue-manager";
import { getGameMode } from "#app/game-mode";
import Overrides from "#app/overrides";
import { PhaseManager } from "#app/phase-manager";
import { MovePhasePriorityQueue } from "#app/queues/move-phase-priority-queue";
import { PokemonPhasePriorityQueue } from "#app/queues/pokemon-phase-priority-queue";
import { allAbilities } from "#data/data-lists";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { CommandPhase } from "#phases/command-phase";
import { FaintPhase } from "#phases/faint-phase";
import { MoveEffectPhase } from "#phases/move-effect-phase";
import { MovePhase } from "#phases/move-phase";
import { PostTurnStatusEffectPhase } from "#phases/post-turn-status-effect-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { SwitchSummonPhase } from "#phases/switch-summon-phase";
import { TurnStartPhase } from "#phases/turn-start-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { launchDetachedStarters } from "../m4/export/starter-launch";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const OUTPUT_ROOT = process.env.M3_ORACLE_OUTPUT_ROOT;
const ORACLE_SHA = process.env.M5_ORACLE_REFRESH_SHA ?? "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
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
  actionByPhase?: WeakMap<object, AnyRecord>;
  tieOrderByPhase?: WeakMap<object, number>;
  identity?: WeakMap<object, number>;
  abilityOverrides?: WeakMap<object, number>;
  faintByPhase?: WeakMap<object, AnyRecord>;
  faintBySwitchPhase?: WeakMap<object, AnyRecord>;
  faintBranchByPhase?: WeakMap<object, AnyRecord>;
  faintCompletionByPokemon?: WeakMap<object, () => void>;
}

let activeTrace: ObservationTrace | null = null;
let phaserGame: Phaser.Game;
let currentScenarioGame: GameManager | null = null;
let restoreScenarioFaintCry: (() => void) | null = null;
const restoreHooks: (() => void)[] = [];
let productionSceneRandBattleSeedInt: BattleScene["randBattleSeedInt"] | undefined;

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
    // The mutation trace intentionally retains raw command arrays.  Phaser's
    // optional TurnMove argument is present as an explicit `undefined` in an
    // array (for example, `args[1]` on an ordinary fight command).  Canonical
    // JSON has a deterministic representation for that value: null in an
    // array, while a property-valued undefined is omitted below.  Use
    // Array.from so sparse arrays receive the same null treatment instead of
    // preserving a hole that JSON.stringify would later erase implicitly.
    return Array.from(value, (child, index) =>
      child === undefined
        ? content
          ? fail("CONTENT_CANONICAL_VALUE", `${path}[${index}] is undefined`)
          : null
        : sortedValue(child, `${path}[${index}]`, content),
    );
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      if (content && [...key].some(character => (character.codePointAt(0) ?? 0x80) > 0x7f)) {
        fail("CONTENT_CANONICAL_KEY", `${path}.${key}`);
      }
      const child = (value as AnyRecord)[key];
      if (child === undefined) {
        if (content) {
          fail("CONTENT_CANONICAL_VALUE", `${path}.${key} is undefined`);
        }
        continue;
      }
      out[key] = sortedValue(child, `${path}.${key}`, content);
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
  const exporterCommitSha = git(
    "log",
    "-1",
    "--format=%H",
    "--",
    "scripts/export-kernel-m3-oracle.mjs",
    "test/kernel-fixtures/m3/export-battle-oracle.test.ts",
  );
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("ORACLE_RUNTIME", `expected hosted linux/x64, got ${process.platform}/${process.arch}`);
  }
  if (process.env.LC_ALL !== "C" || process.env.LANG !== "C" || process.env.TZ !== "UTC") {
    fail("ORACLE_RUNTIME", "exporter must run with C locale and UTC timezone");
  }
  return {
    oracle_game_sha: ORACLE_SHA,
    oracle_tree_sha: git("rev-parse", `${ORACLE_SHA}^{tree}`),
    exporter_commit_sha: exporterCommitSha,
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

function abilityEffect(effect: unknown): AnyRecord {
  switch (effect) {
    case "NONE":
      return { kind: "NONE" };
    case "POST_SUMMON_ADJACENT_OPPONENT_ATTACK_MINUS_ONE":
      return { kind: "POST_SUMMON_ADJACENT_OPPONENT_ATTACK_MINUS_ONE" };
    case "NON_SUPER_EFFECTIVE_ATTACK_IMMUNITY":
      return { kind: "NON_SUPER_EFFECTIVE_ATTACK_IMMUNITY" };
    default:
      fail("CONTENT_CANONICAL_VALUE", `unmapped ability effect ${String(effect)}`);
  }
}

function capabilitySubjectValue(entry: AnyRecord): number | string {
  const kind = entry.subject_kind;
  const id = entry.subject_id;
  if (kind === "STATUS") {
    const status = ({ 1: "POISON", 3: "PARALYSIS", 6: "BURN" } as Record<number, string>)[id];
    if (status == null) {
      fail("CONTENT_CANONICAL_VALUE", `unmapped capability status ${String(id)}`);
    }
    return status;
  }
  if (kind === "WEATHER" || kind === "TERRAIN") {
    if (id !== 0) {
      fail("CONTENT_CANONICAL_VALUE", `unmapped capability ${kind} ${String(id)}`);
    }
    return "NONE";
  }
  if (kind === "MOVE" || kind === "ABILITY") {
    if (!Number.isSafeInteger(id) || id < 0) {
      fail("CONTENT_CANONICAL_VALUE", `invalid capability ${kind} ${String(id)}`);
    }
    return id;
  }
  fail("CONTENT_CANONICAL_VALUE", `unmapped capability subject ${String(kind)}`);
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
    effect_chance: entry.effect_chance < 0 ? { kind: "NONE" } : { kind: "PERCENT", value: entry.effect_chance },
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
    effect: abilityEffect(entry.effect),
    capability: capabilityStatus(),
  }));
  const multiplier = (value: string): string => {
    if (value === "0") {
      return "ZERO";
    }
    if (value === "1/2") {
      return "HALF";
    }
    if (value === "2") {
      return "TWO";
    }
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
        value: capabilitySubjectValue(entry),
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
  if (
    !Number.isInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
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
    const fallbackMoves = [MoveId.POUND, MoveId.EMBER, MoveId.SHOCK_WAVE, MoveId.PLAY_NICE].filter(
      candidate => candidate !== move,
    );
    lead.moves = [move, ...fallbackMoves].slice(0, 4);
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
  if (productionSceneRandBattleSeedInt == null) {
    fail("OBSERVATION_SEAM_MISSING", "BattleScene.randBattleSeedInt was not captured before test setup");
  }
  (BattleScene.prototype as AnyRecord).randBattleSeedInt = productionSceneRandBattleSeedInt;
}

function coopLaunchOwners(spec: ScenarioSpec, starters: readonly unknown[]): ("host" | "guest")[] | undefined {
  if (spec.run?.triple) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "the selected M3 oracle does not admit a co-op triple launch");
  }
  if (!spec.run?.double) {
    return;
  }
  if (starters.length < 2 || starters.length > 6) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "a selected co-op launch must contain two to six interleaved starters");
  }
  // The scenario party is already in the production launch order
  // host0, guest0, host1, guest1, ... . Pass that semantic launch input
  // through SelectStarterPhase.initBattle so production creates and persists
  // each PlayerPokemon.coopOwner tag; the exporter never writes ownership.
  return starters.map((_, index) => (index % 2 === 0 ? "host" : "guest"));
}

function scenarioBattleStyle(spec: ScenarioSpec): "single" | "double" | "triple" {
  if (spec.run?.triple) {
    return "triple";
  }
  return spec.run?.double ? "double" : "single";
}

async function launchScenario(spec: ScenarioSpec): Promise<GameManager> {
  restoreScenarioFaintCry?.();
  restoreScenarioFaintCry = null;
  const game = new GameManager(phaserGame);
  currentScenarioGame = game;
  const harnessFaintCry = Pokemon.prototype.faintCry;
  const gatedFaintCry = function (this: Pokemon, callback: () => any): void {
    const trace = activeTrace;
    if (trace == null || !trace.collectMutations) {
      harnessFaintCry.call(this, callback);
      return;
    }
    const completions = trace.faintCompletionByPokemon;
    if (completions == null || completions.has(this)) {
      fail("OBSERVATION_SEAM_MISSING", "scenario faint completion gate is absent or already occupied");
    }
    // GameWrapper intentionally collapses cry/tween presentation to this
    // callback.  Hold that existing harness callback until FaintPhase.start has
    // registered the matching occurrence, then release it unchanged there.
    completions.set(this, () => harnessFaintCry.call(this, callback));
  };
  Pokemon.prototype.faintCry = gatedFaintCry;
  restoreScenarioFaintCry = () => {
    if (Pokemon.prototype.faintCry === gatedFaintCry) {
      Pokemon.prototype.faintCry = harnessFaintCry;
    }
    restoreScenarioFaintCry = null;
  };
  restoreRealBattleRng();
  game.override.criticalHits(null);
  if (!(game.scene.ui.shouldSkipDialogue as AnyRecord).mock) {
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  }
  const { scenario, postLaunch } = buildDevScenario(spec);
  await game.runToTitle();
  const starters = scenario.setup();
  const battleStyle = scenarioBattleStyle(spec);
  // buildDevScenario resets this mutable dev input before every launch, but only
  // writes the double/triple cases. Pin singles through that same production
  // input directly: OverridesHelper.battleStyle installs a Vitest getter spy,
  // which cannot be reset by the next scenario's Object.assign.
  (Overrides as unknown as { BATTLE_STYLE_OVERRIDE: typeof battleStyle }).BATTLE_STYLE_OVERRIDE = battleStyle;
  const coopOwners = coopLaunchOwners(spec, starters);
  if (coopOwners != null) {
    // GameManager's ReloadHelper already replaces saveAll for tests, but its
    // replacement still serializes a checkpoint.  A single-engine semantic
    // oracle intentionally has no transport/session identity, so that co-op
    // checkpoint guard would abort the otherwise valid production battle
    // launch.  Disable only the mocked persistence callback; game mode,
    // initBattle, owner tagging, topology, and battle execution remain real.
    const saveAll = game.scene.gameData.saveAll as AnyRecord;
    if (typeof saveAll.mockResolvedValue !== "function") {
      fail("OBSERVATION_SEAM_MISSING", "GameManager saveAll persistence seam is not mocked");
    }
    saveAll.mockResolvedValue(true);

    // The semantic exporter observes the authority engine only; transport,
    // recovery, and checkpoint delivery are independently covered by the co-op
    // gates.  Let CommandPhase cross the same successful host checkpoint seam
    // without constructing a second engine/runtime.  All command UI, owner
    // attribution, queueing, and resolution code after this seam stays real.
    const commandPrototype = CommandPhase.prototype as AnyRecord;
    const checkpointSync = commandPrototype.tryCoopCheckpointSync;
    if (typeof checkpointSync !== "function") {
      fail("OBSERVATION_SEAM_MISSING", "CommandPhase checkpoint seam is not callable");
    }
    if (checkpointSync.mock == null) {
      vi.spyOn(commandPrototype, "tryCoopCheckpointSync").mockReturnValue(true);
    }
  }
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(coopOwners == null ? GameModes.CLASSIC : GameModes.COOP);
    const starterPhase = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    const scenarioSeed = spec.run?.seed?.trim();
    if (!scenarioSeed) {
      fail("EXPORT_CONFIGURATION", "every M3 oracle scenario must pin a non-empty run seed");
    }
    // Match the production co-op launch boundary: seed immediately before
    // party construction so legacy PIDs are deterministic, then let the
    // ordinary encounter reset derive the wave stream from the same run seed.
    game.scene.setSeed(scenarioSeed);
    game.scene.resetSeed();
    launchDetachedStarters(starterPhase, starters, coopOwners);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  const expectedCapacity = battleStyle === "single" ? 1 : battleStyle === "double" ? 2 : 3;
  if (
    game.scene.currentBattle.arrangement.playerCapacity !== expectedCapacity
    || game.scene.currentBattle.arrangement.enemyCapacity !== expectedCapacity
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `scenario launched with the wrong ${battleStyle} topology`);
  }
  scenario.onBattleStart?.();
  return game;
}

function battleRngState(game: GameManager): AnyRecord {
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  const saved = battle?.battleSeedState as string | null | undefined;
  return {
    run: { rdg: rdgState(Phaser.Math.RND) },
    battle:
      battle == null
        ? null
        : {
            battle_seed: String(battle.battleSeed),
            turn: battle.turn,
            saved_substream: saved == null ? null : rdgStateFromString(saved),
          },
    seed_offset:
      game.scene.rngOffset === 0 && game.scene.rngSeedOverride === ""
        ? null
        : {
            wave_seed: String(game.scene.rngSeedOverride || game.scene.waveSeed || game.scene.seed),
            offset: game.scene.rngOffset,
          },
    next_sequence: activeTrace?.nextRngSequence ?? 0,
  };
}

function authoritativeWaveSeed(game: GameManager): string {
  const waveSeed = game.scene.waveSeed;
  if (typeof waveSeed !== "string" || waveSeed.length === 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "game.scene.waveSeed is absent or not a non-empty string");
  }
  return waveSeed;
}

function assertCanonicalWaveSeed(game: GameManager, value: unknown): void {
  const authoritative = authoritativeWaveSeed(game);
  if (value !== authoritative) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "canonical BattleState.wave_seed is not the authoritative waveSeed");
  }
  const transientOverride = (game.scene as AnyRecord).rngSeedOverride;
  if (
    typeof transientOverride === "string"
    && transientOverride.length > 0
    && transientOverride !== authoritative
    && value === transientOverride
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "canonical BattleState.wave_seed followed a transient rngSeedOverride");
  }
}

function rdgStateFromString(state: string): AnyRecord {
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    fail("RNG_STATE_UNOBSERVABLE", `invalid saved Phaser state ${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (
    !Number.isInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
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
    status:
      mon.status == null
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
    battle:
      battle == null
        ? null
        : {
            turn: battle.turn,
            wave_seed: authoritativeWaveSeed(game),
            commands: battle.turnCommands,
            pre_commands: battle.preTurnCommands,
            player: game.scene
              .getPlayerParty()
              .map((mon, index) => canonicalPokemon(activeTrace!, mon, "PLAYER", index)),
            enemy: game.scene.getEnemyParty().map((mon, index) => canonicalPokemon(activeTrace!, mon, "ENEMY", index)),
            field: formatState(game),
            weather: {
              type: game.scene.arena.weatherType,
              remaining_turns: game.scene.arena.weather?.turnsLeft ?? 0,
            },
            terrain: {
              type: game.scene.arena.terrainType,
              remaining_turns: game.scene.arena.terrain?.turnsLeft ?? 0,
            },
            tags: game.scene.arena.tags.map((tag: AnyRecord) => ({
              type: tag.tagType,
              side: tag.side,
              turn_count: tag.turnCount,
              layers: tag.layers,
            })),
            ignore_abilities: game.scene.arena.ignoreAbilities === true,
            ignoring_effect_source: game.scene.arena.ignoringEffectSource,
          },
  };
  return createHash("sha256")
    .update(canonicalBytes(value, false, false))
    .digest("hex");
}

function installObservationHooks(): void {
  productionSceneRandBattleSeedInt = BattleScene.prototype.randBattleSeedInt;
  restoreHooks.push(() => {
    if (productionSceneRandBattleSeedInt != null) {
      (BattleScene.prototype as AnyRecord).randBattleSeedInt = productionSceneRandBattleSeedInt;
    }
    productionSceneRandBattleSeedInt = undefined;
  });

  const recordFaintBranch = (manager: PhaseManager, phaseName: string, args: any[]): void => {
    const trace = activeTrace;
    const current = manager.getCurrentPhase();
    if (trace == null || !(current instanceof FaintPhase) || (current as AnyRecord).player !== true) {
      return;
    }
    let branch: AnyRecord | null = null;
    if (phaseName === "SwitchPhase") {
      branch = {
        kind: "SWITCH_QUEUED",
        field_index: args[1],
        player: args[2],
        source: args[4],
      };
    } else if (phaseName === "GameOverPhase" || phaseName === "ToggleDoublePositionPhase") {
      branch = { kind: "NO_REPLACEMENT_QUEUED", phase_name: phaseName };
    }
    if (branch == null) {
      return;
    }
    if (trace.faintBranchByPhase?.has(current)) {
      fail("UNRECORDED_STATE_CHANGE", "FaintPhase queued more than one replacement terminal branch");
    }
    trace.faintBranchByPhase?.set(current, branch);
  };

  const originalPhasePushNew = PhaseManager.prototype.pushNew;
  (PhaseManager.prototype as AnyRecord).pushNew = function (
    this: PhaseManager,
    phaseName: string,
    ...args: any[]
  ): void {
    (originalPhasePushNew as AnyRecord).call(this, phaseName, ...args);
    recordFaintBranch(this, phaseName, args);
  };
  restoreHooks.push(() => {
    PhaseManager.prototype.pushNew = originalPhasePushNew;
  });

  const originalPhaseUnshiftNew = PhaseManager.prototype.unshiftNew;
  (PhaseManager.prototype as AnyRecord).unshiftNew = function (
    this: PhaseManager,
    phaseName: string,
    ...args: any[]
  ): void {
    (originalPhaseUnshiftNew as AnyRecord).call(this, phaseName, ...args);
    recordFaintBranch(this, phaseName, args);
  };
  restoreHooks.push(() => {
    PhaseManager.prototype.unshiftNew = originalPhaseUnshiftNew;
  });

  const originalBattleRand = Battle.prototype.randSeedInt;
  let battleDrawInProgress = false;
  (Battle.prototype as AnyRecord).randSeedInt = function (this: Battle, range: number, min = 0): number {
    if (!activeTrace?.collectRng) {
      return originalBattleRand.call(this, range, min);
    }
    const game = activeTrace.game as GameManager;
    const before = battleRngState(game);
    const stack = new Error("M3 battle RNG callsite").stack ?? "";
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
    if (
      !Number.isSafeInteger(range)
      || range < 0
      || !Number.isSafeInteger(min)
      || (consuming && !Number.isSafeInteger(min + range - 1))
      || !Number.isSafeInteger(result)
      || (consuming ? result < min || result > min + range - 1 : result !== min)
    ) {
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
    if (activeTrace.collectMutations && JSON.stringify(before.battle) !== JSON.stringify(after.battle)) {
      const phase = game.scene.phaseManager.getCurrentPhase();
      if (phase == null || typeof phase.phaseName !== "string" || phase.phaseName.length === 0) {
        fail("UNRECORDED_RNG_STATE_CHANGE", `battle RNG draw has no observed phase at ${activeTrace.scenarioId}`);
      }
      activeTrace.mutations.push({
        sequence: activeTrace.mutations.length,
        kind: "BATTLE_RNG_CHANGED",
        phase: phase.phaseName,
        cause: activeTrace.activeAction == null ? "TURN_RESOLUTION" : activeTrace.activeAction.sequence,
        path: "battle/rng",
        before: before.battle,
        after: after.battle,
      });
    }
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
    const stack = new Error("M3 Phaser range RNG callsite").stack ?? "";
    const offset = game.scene.rngOffset;
    const seedOffset = offset !== 0 || game.scene.rngSeedOverride !== "";
    const cardinality = max - min + 1;
    assertFinite(result, `direct-rng/${activeTrace.scenarioId}/${activeTrace.nextRngSequence}`);
    if (!Number.isSafeInteger(result) || result < min || result > max) {
      fail("RNG_DRAW_UNOBSERVABLE", `direct Phaser integerInRange returned ${String(result)}`);
    }
    const reason = rngReason(stack);
    const callsite = callsiteId(stack);
    const publicApi = seedOffset && reason === "SpeedTie" ? "FISHER_YATES_SWAP" : "INTEGER_IN_RANGE";
    activeTrace.rngDraws.push({
      sequence: activeTrace.nextRngSequence++,
      stream: seedOffset ? "SEED_OFFSET" : "RUN",
      reason,
      public_api: publicApi,
      callsite_id: callsite,
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
        if (
          values == null
          || typeof values.length !== "number"
          || values.length === 0
          || !Number.isSafeInteger(values.length)
        ) {
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
        const stack = new Error("M3 direct Phaser RNG callsite").stack ?? "";
        const offset = game.scene.rngOffset;
        const seedOffset = offset !== 0 || game.scene.rngSeedOverride !== "";
        const callsite = callsiteId(stack);
        activeTrace.rngDraws.push({
          sequence: activeTrace.nextRngSequence++,
          stream: seedOffset ? "SEED_OFFSET" : "RUN",
          reason: rngReason(stack),
          public_api: "PICK",
          callsite_id: callsite,
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
      if (
        JSON.stringify(before) !== JSON.stringify(after)
        && (methodName !== "shuffle" || activeTrace.rngDraws.length === auditCount)
      ) {
        fail("UNRECORDED_RNG_STATE_CHANGE", `direct Phaser ${methodName} changed the run stream`);
      }
      return result;
    };
    restoreHooks.push(() => {
      (Phaser.Math.RND as AnyRecord)[methodName] = original;
    });
  }

  const originalPriorityReorder = (PokemonPhasePriorityQueue.prototype as AnyRecord).reorder;
  if (typeof originalPriorityReorder !== "function") {
    fail("OBSERVATION_SEAM_MISSING", "PokemonPhasePriorityQueue.reorder is not callable");
  }
  (PokemonPhasePriorityQueue.prototype as AnyRecord).reorder = function (this: AnyRecord): void {
    originalPriorityReorder.call(this);
    const trace = activeTrace;
    if (trace == null || !(this instanceof MovePhasePriorityQueue)) {
      return;
    }
    const queue = this.queue;
    if (!Array.isArray(queue)) {
      fail("OBSERVATION_SEAM_MISSING", "MovePhasePriorityQueue did not expose its ordered queue");
    }
    let previousSpeed: number | undefined;
    let previousPokemon: Pokemon | undefined;
    let groupPosition = -1;
    for (const phase of queue) {
      if (!(phase instanceof MovePhase)) {
        fail("ACTION_ORDER_UNOBSERVABLE", "MovePhase queue contained a non-move phase");
      }
      const pokemon = phase.pokemon;
      const speed = pokemon.getEffectiveStat(Stat.SPD);
      if (!Number.isSafeInteger(speed) || speed < 0 || speed > 0xffffffff) {
        fail("ACTION_ORDER_UNOBSERVABLE", `invalid tie-group speed for Pokemon ${String(pokemon.id)}`);
      }
      if (previousSpeed !== speed) {
        groupPosition = 0;
      } else if (previousPokemon !== pokemon) {
        groupPosition++;
      }
      trace.tieOrderByPhase?.set(phase, groupPosition);
      previousSpeed = speed;
      previousPokemon = pokemon;
    }
  };
  restoreHooks.push(() => {
    (PokemonPhasePriorityQueue.prototype as AnyRecord).reorder = originalPriorityReorder;
  });

  const originalHandle = (TurnStartPhase.prototype as AnyRecord).handleTurnCommand;
  (TurnStartPhase.prototype as AnyRecord).handleTurnCommand = function (
    turnCommand: AnyRecord,
    pokemon: Pokemon,
  ): void {
    if (activeTrace != null && turnCommand?.skip) {
      const command = commandKind(turnCommand.command);
      if (command !== "FIGHT" && command !== "SWITCH") {
        fail("ACTION_ORDER_UNOBSERVABLE", `unsupported skipped command ${command}`);
      }
      recordResolvedAction(
        activeTrace.game as GameManager,
        null,
        pokemon,
        command === "SWITCH" ? "SWITCH" : "MOVE",
        "SKIPPED_ACTOR_INACTIVE",
      );
    }
    originalHandle.call(this, turnCommand, pokemon);
  };
  restoreHooks.push(() => {
    (TurnStartPhase.prototype as AnyRecord).handleTurnCommand = originalHandle;
  });

  const originalPopNextPhase = DynamicQueueManager.prototype.popNextPhase;
  (DynamicQueueManager.prototype as AnyRecord).popNextPhase = function (
    this: DynamicQueueManager,
    name: string,
  ): AnyRecord | undefined {
    const phase = originalPopNextPhase.call(this, name as never) as AnyRecord | undefined;
    if (activeTrace != null && name === "MovePhase" && phase != null) {
      if (!(phase instanceof MovePhase)) {
        fail("ACTION_ORDER_UNOBSERVABLE", "MovePhase queue returned a different phase type");
      }
      const pokemon = phase.pokemon;
      const disposition = pokemon.isActive(true) ? "EXECUTED" : "SKIPPED_ACTOR_INACTIVE";
      recordResolvedAction(activeTrace.game as GameManager, phase, pokemon, "MOVE", disposition);
    }
    return phase;
  };
  restoreHooks.push(() => {
    (DynamicQueueManager.prototype as AnyRecord).popNextPhase = originalPopNextPhase;
  });

  const originalMoveStart = MovePhase.prototype.start;
  MovePhase.prototype.start = function (this: MovePhase): void {
    originalMoveStart.call(this);
    const trace = activeTrace;
    const action = trace?.actionByPhase?.get(this);
    if (action == null) {
      return;
    }
    const raw = this as AnyRecord;
    if (raw.cancelled === true || raw.failed === true) {
      action.disposition =
        raw.cancelled === true && this.pokemon.status?.effect === StatusEffect.PARALYSIS
          ? "CANCELLED_BY_PARALYSIS"
          : "NO_EFFECT";
    }
  };
  restoreHooks.push(() => {
    MovePhase.prototype.start = originalMoveStart;
  });

  const originalMoveEffectStart = MoveEffectPhase.prototype.start;
  MoveEffectPhase.prototype.start = function (this: MoveEffectPhase): void {
    originalMoveEffectStart.call(this);
    const trace = activeTrace;
    const user = this.getUserPokemon();
    const action = trace?.activeAction;
    const result = (this as AnyRecord).moveHistoryEntry?.result;
    if (trace != null && action != null && user != null && action.actor_legacy_pid === user.id) {
      if (result === MoveResult.MISS) {
        action.disposition = "MISSED";
      } else if (result === MoveResult.FAIL && action.disposition === "EXECUTED") {
        action.disposition = "NO_EFFECT";
      }
    }
  };
  restoreHooks.push(() => {
    MoveEffectPhase.prototype.start = originalMoveEffectStart;
  });

  const originalSwitchStart = SwitchSummonPhase.prototype.start;
  SwitchSummonPhase.prototype.start = function (this: SwitchSummonPhase): void {
    const trace = activeTrace;
    if (trace != null) {
      const pokemon = this.getPokemon();
      const forcedReplacement = pokemon.isFainted();
      let selectedOccurrence: AnyRecord | null = null;
      let selectedProgress: AnyRecord | null = null;
      if (forcedReplacement) {
        const raw = this as AnyRecord;
        if (
          raw.player !== true
          || !Number.isSafeInteger(raw.fieldIndex)
          || raw.fieldIndex < 0
          || !Number.isSafeInteger(raw.slotIndex)
          || raw.slotIndex < 0
        ) {
          fail("UNRECORDED_STATE_CHANGE", "selected player replacement lacks a stable switch address");
        }
        const game = trace.game as GameManager;
        const party = game.scene.getPlayerParty();
        const incoming = party[raw.slotIndex];
        if (incoming == null || !incoming.isAllowedInBattle()) {
          fail("UNRECORDED_STATE_CHANGE", "selected player replacement is not an observed legal party member");
        }
        selectedOccurrence = pendingFaintForPlayerSlot(trace, raw.fieldIndex);
        if (resolvePlayerOwnerSeat(game, incoming, raw.slotIndex) !== selectedOccurrence.owner_seat) {
          fail(
            "CANONICAL_STATE_UNOBSERVABLE",
            `selected replacement for faint ${String(selectedOccurrence.id)} changed owner`,
          );
        }
        selectedProgress = {
          kind: "SELECTED",
          party_slot: raw.slotIndex,
          pokemon: pokemonId(trace, incoming),
        };
      }
      recordResolvedAction(
        trace.game as GameManager,
        this,
        pokemon,
        forcedReplacement ? "REPLACEMENT" : "SWITCH",
        "EXECUTED",
        forcedReplacement ? null : undefined,
      );
      if (selectedOccurrence != null && selectedProgress != null) {
        appendFaintProgress(trace, selectedOccurrence, selectedProgress, "SwitchSummonPhase");
        trace.faintBySwitchPhase?.set(this, selectedOccurrence);
      }
    }
    originalSwitchStart.call(this);
  };
  restoreHooks.push(() => {
    SwitchSummonPhase.prototype.start = originalSwitchStart;
  });

  const originalSwitchAndSummon = SwitchSummonPhase.prototype.switchAndSummon;
  SwitchSummonPhase.prototype.switchAndSummon = function (this: SwitchSummonPhase): void {
    const trace = activeTrace;
    if (trace == null || !trace.collectMutations) {
      originalSwitchAndSummon.call(this);
      return;
    }
    const raw = this as AnyRecord;
    const player = raw.player;
    const fieldIndex = raw.fieldIndex;
    const slotIndex = raw.slotIndex;
    if (
      typeof player !== "boolean"
      || !Number.isSafeInteger(fieldIndex)
      || fieldIndex < 0
      || !Number.isSafeInteger(slotIndex)
    ) {
      fail("UNRECORDED_STATE_CHANGE", "SwitchSummonPhase did not expose a valid side/slot address");
    }
    const game = trace.game as GameManager;
    const party = player ? game.scene.getPlayerParty() : game.scene.getEnemyParty();
    const outgoing = party[fieldIndex];
    const incoming = slotIndex < 0 ? undefined : party[slotIndex];
    if (incoming == null) {
      originalSwitchAndSummon.call(this);
      return;
    }
    if (outgoing == null || outgoing === incoming) {
      fail("UNRECORDED_STATE_CHANGE", "SwitchSummonPhase field swap lacks distinct observed occupants");
    }
    const descriptor = Object.getOwnPropertyDescriptor(party, String(fieldIndex));
    if (descriptor == null || !descriptor.configurable || !("value" in descriptor)) {
      fail("OBSERVATION_SEAM_MISSING", "party field slot is not an interceptable data property");
    }
    let current = outgoing;
    let writeCount = 0;
    Object.defineProperty(party, String(fieldIndex), {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: () => current,
      set: (value: Pokemon) => {
        writeCount++;
        if (writeCount !== 1 || value !== incoming) {
          fail("UNRECORDED_STATE_CHANGE", "SwitchSummonPhase wrote an unexpected field occupant");
        }
        current = value;
        const flatIndex = player ? fieldIndex : game.scene.currentBattle.arrangement.enemyOffset + fieldIndex;
        const slot = fieldSlot(game, flatIndex);
        const phase = game.scene.phaseManager.getCurrentPhase();
        if (phase == null || typeof phase.phaseName !== "string" || phase.phaseName.length === 0) {
          fail("UNRECORDED_STATE_CHANGE", "field mutation has no observed phase");
        }
        trace.mutations.push({
          sequence: trace.mutations.length,
          kind: "FIELD_CHANGED",
          phase: phase.phaseName,
          cause: trace.activeAction == null ? "TURN_RESOLUTION" : trace.activeAction.sequence,
          path: `battle/field/slots/${slot.side.toLowerCase()}/${slot.position}/occupant`,
          slot,
          before: pokemonId(trace, outgoing),
          after: pokemonId(trace, incoming),
        });
        const occurrence = trace.faintBySwitchPhase?.get(this);
        if (occurrence != null) {
          if (
            !player
            || occurrence.replacement?.kind !== "SELECTED"
            || occurrence.replacement.pokemon !== pokemonId(trace, incoming)
          ) {
            fail("UNRECORDED_STATE_CHANGE", "field replacement write diverged from its selected faint progress");
          }
          appendFaintResolved(trace, occurrence, phase.phaseName);
        }
      },
    });
    try {
      originalSwitchAndSummon.call(this);
    } finally {
      Object.defineProperty(party, String(fieldIndex), {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        value: current,
      });
    }
    if (writeCount !== 1) {
      fail("UNRECORDED_STATE_CHANGE", "SwitchSummonPhase did not expose its field occupant write");
    }
  };
  restoreHooks.push(() => {
    SwitchSummonPhase.prototype.switchAndSummon = originalSwitchAndSummon;
  });

  const originalResidualStart = PostTurnStatusEffectPhase.prototype.start;
  PostTurnStatusEffectPhase.prototype.start = function (this: PostTurnStatusEffectPhase): void {
    if (activeTrace != null) {
      recordResolvedAction(
        activeTrace.game as GameManager,
        this,
        this.getPokemon(),
        "RESIDUAL_STATUS",
        "EXECUTED",
        null,
      );
    }
    originalResidualStart.call(this);
  };
  restoreHooks.push(() => {
    PostTurnStatusEffectPhase.prototype.start = originalResidualStart;
  });

  wrapMutation(Pokemon.prototype, "damage", "HP_DAMAGE");
  wrapMutation(Pokemon.prototype, "trySetStatus", "STATUS_ATTEMPT");
  wrapMutation(Pokemon.prototype, "doSetStatus", "STATUS_SET");
  wrapMutation(Pokemon.prototype, "setStatStage", "STAT_STAGE");
  wrapMutation(PokemonMove.prototype, "usePp", "PP_CONSUMPTION");
  wrapMutation(Battle.prototype, "incrementTurn", "TURN_ADVANCE");

  const originalFaintStart = FaintPhase.prototype.start;
  FaintPhase.prototype.start = function (this: FaintPhase): void {
    if (activeTrace != null) {
      const pokemon = this.getPokemon();
      recordResolvedAction(activeTrace.game as GameManager, this, pokemon, "FAINT", "EXECUTED", null);
    }
    originalFaintStart.call(this);
    if (activeTrace == null) {
      return;
    }
    const address = (this as AnyRecord).faintSourceAddress as AnyRecord | undefined;
    const pokemon = (this as AnyRecord).getPokemon?.() as Pokemon | undefined;
    if (!address || !pokemon) {
      fail("CANONICAL_STATE_UNOBSERVABLE", "FaintPhase did not expose its source address");
    }
    assertFaintSourceAddress(address);
    const id = activeTrace.nextGlobalFaintId++;
    const slot = fieldSlot(activeTrace.game as GameManager, this.battlerIndex);
    let ownerSeat: number | null = null;
    if (slot.side === "PLAYER") {
      const game = activeTrace.game as GameManager;
      const partyIndex = game.scene.getPlayerParty().indexOf(pokemon);
      ownerSeat = resolvePlayerOwnerSeat(game, pokemon, partyIndex);
      const branch = activeTrace.faintBranchByPhase?.get(this);
      if (branch?.kind === "SWITCH_QUEUED") {
        const source = branch.source as AnyRecord | undefined;
        if (
          branch.field_index !== slot.position
          || branch.player !== true
          || source?.wave !== address.wave
          || source?.turn !== address.turn
          || source?.occurrence !== address.occurrence
        ) {
          fail("UNRECORDED_STATE_CHANGE", `faint ${String(id)} queued a mismatched replacement branch`);
        }
      } else if (branch?.kind !== "NO_REPLACEMENT_QUEUED") {
        fail("UNRECORDED_STATE_CHANGE", `faint ${String(id)} exposed no production replacement branch`);
      }
    }
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
      owner_seat: ownerSeat,
      replacement: { kind: slot.side === "PLAYER" ? "PENDING" : "NOT_REQUIRED" },
      resolved: false,
    };
    activeTrace.faints.push(occurrence);
    activeTrace.faintByPhase?.set(this, occurrence);
    activeTrace.mutations.push({
      sequence: activeTrace.mutations.length,
      kind: "FAINT_QUEUED",
      phase: "FaintPhase",
      cause: activeTrace.activeAction == null ? "TURN_RESOLUTION" : activeTrace.activeAction.sequence,
      path: `battle.faint_queue[${activeTrace.faints.length - 1}]`,
      before: null,
      after: faintProjection(occurrence),
    });
    const completion = activeTrace.faintCompletionByPokemon?.get(pokemon);
    if (completion == null) {
      fail("OBSERVATION_SEAM_MISSING", `faint ${String(id)} lost its disabled-animation completion callback`);
    }
    activeTrace.faintCompletionByPokemon?.delete(pokemon);
    completion();
  };
  restoreHooks.push(() => {
    FaintPhase.prototype.start = originalFaintStart;
  });

  const originalFaintEnd = FaintPhase.prototype.end;
  FaintPhase.prototype.end = function (this: FaintPhase): void {
    const trace = activeTrace;
    const occurrence = trace?.faintByPhase?.get(this);
    if (trace != null && occurrence != null && !occurrence.resolved) {
      if (occurrence.slot?.side === "ENEMY") {
        if (occurrence.replacement?.kind !== "NOT_REQUIRED") {
          fail("UNRECORDED_STATE_CHANGE", `enemy faint ${String(occurrence.id)} has replacement progress`);
        }
        appendFaintResolved(trace, occurrence, "FaintPhase");
      } else if (occurrence.slot?.side === "PLAYER") {
        if (occurrence.replacement?.kind !== "PENDING") {
          fail("UNRECORDED_STATE_CHANGE", `player faint ${String(occurrence.id)} completed with invalid progress`);
        }
        const branch = trace.faintBranchByPhase?.get(this);
        if (branch?.kind === "NO_REPLACEMENT_QUEUED") {
          appendFaintProgress(trace, occurrence, { kind: "NO_LEGAL_REPLACEMENT" }, "FaintPhase");
          appendFaintResolved(trace, occurrence, "FaintPhase");
        } else if (branch?.kind !== "SWITCH_QUEUED") {
          fail("UNRECORDED_STATE_CHANGE", `player faint ${String(occurrence.id)} lost its production branch`);
        }
      } else {
        fail("UNRECORDED_STATE_CHANGE", `faint ${String(occurrence.id)} has an invalid side`);
      }
    }
    originalFaintEnd.call(this);
  };
  restoreHooks.push(() => {
    FaintPhase.prototype.end = originalFaintEnd;
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
  fail("UNRECORDED_STATE_CHANGE", `unsupported mutation target ${String(value?.constructor?.name ?? typeof value)}`);
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

/**
 * Reason resolution is keyed on the first non-RNG-plumbing source FRAME of the
 * capture stack, by function name, so the overlay survives line drift between
 * oracle cuts. Full `Class.method` keys win over bare method keys; a bare
 * `apply` frame is a secondary-effect chance roll.
 */
const RNG_REASON_BY_FRAME: Readonly<Record<string, string>> = Object.freeze({
  "Pokemon.getAttackDamage": "DamageVariance",
  "Pokemon.getCriticalHitResult": "CriticalHit",
  "MoveEffectPhase.hitCheck": "Accuracy",
  "MovePhase.checkPara": "ParalysisActivation",
  randSeedShuffle: "SpeedTie",
  doublePowerChanceMessageFunc: "SecondaryEffect",
});

const RNG_REASON_BY_METHOD: Readonly<Record<string, string>> = Object.freeze({
  apply: "SecondaryEffect",
});

const RNG_HELPER_FRAME = /(?:randSeedInt|randSeedIntRange|randBattleSeedInt|integerInRange|randSeedItem|randSeedFloat|pick)\b/u;

type StackFrame = { full: string; method: string; source: string; line: number };

function stackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = /\bat\s+(?:(.+?)\s+\()?(?:((?:src|test|scripts)[\\/][^()\s]+?):(\d+):\d+\))?/u.exec(line);
    if (match == null) {
      continue;
    }
    const full = match[1] ?? "<anonymous>";
    const source = match[2]?.replaceAll("\\", "/");
    if (source == null || (!source.startsWith("src/") && !source.startsWith("test/") && !source.startsWith("scripts/"))) {
      continue;
    }
    const method = full.includes(".") ? full.slice(full.lastIndexOf(".") + 1) : full;
    frames.push({ full, method, source, line: Number(match[3]) });
  }
  return frames;
}

function callsiteId(stack: string): string {
  const frame = stackFrames(stack).find(
    candidate => candidate.source.startsWith("src/") && !RNG_HELPER_FRAME.test(candidate.full),
  );
  if (frame == null) {
    return fail("UNMAPPED_RNG_REASON", stack.split("\n")[0] ?? "empty-stack");
  }
  return `${frame.source}:${frame.line}`;
}

function rngReason(stack: string): string {
  for (const frame of stackFrames(stack)) {
    if (frame.source.startsWith("test/") || frame.source.startsWith("scripts/")) {
      continue;
    }
    if (RNG_HELPER_FRAME.test(frame.full) || RNG_HELPER_FRAME.test(frame.source)) {
      continue;
    }
    const reason =
      RNG_REASON_BY_FRAME[frame.full] ?? RNG_REASON_BY_FRAME[frame.method] ?? RNG_REASON_BY_METHOD[frame.method];
    if (reason != null) {
      return reason;
    }
    return fail(
      "UNMAPPED_RNG_REASON",
      `${frame.full} @ ${frame.source}:${frame.line} (head: ${stack.split("\n").slice(0, 4).join(" | ")})`,
    );
  }
  return fail("UNMAPPED_RNG_REASON", stack.split("\n")[0] ?? "empty-stack");
}


function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(canonicalBytes(value, false, false))
    .digest("hex");
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

function assertFaintSourceAddress(address: AnyRecord): void {
  if (
    !Number.isSafeInteger(address.wave)
    || address.wave < 1
    || address.wave > SAFE_U53_MAX
    || !Number.isSafeInteger(address.turn)
    || address.turn < 1
    || address.turn > SAFE_U53_MAX
    || !Number.isSafeInteger(address.occurrence)
    || address.occurrence < 0
    || address.occurrence > 0xffffffff
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "FaintPhase exposed an invalid wave/turn occurrence address");
  }
}

function faintQueueIndex(trace: ObservationTrace, occurrence: AnyRecord): number {
  const index = trace.faints.indexOf(occurrence);
  if (index < 0) {
    fail("UNRECORDED_STATE_CHANGE", "faint occurrence is absent from the observed causal queue");
  }
  return index;
}

function appendFaintProgress(trace: ObservationTrace, occurrence: AnyRecord, after: AnyRecord, phase: string): void {
  if (occurrence.resolved || occurrence.replacement?.kind !== "PENDING") {
    fail("UNRECORDED_STATE_CHANGE", `faint ${String(occurrence.id)} cannot change replacement progress`);
  }
  const before = occurrence.replacement;
  occurrence.replacement = after;
  const index = faintQueueIndex(trace, occurrence);
  trace.mutations.push({
    sequence: trace.mutations.length,
    kind: "FAINT_PROGRESS_CHANGED",
    phase,
    cause: trace.activeAction == null ? "TURN_RESOLUTION" : trace.activeAction.sequence,
    path: `battle.faint_queue[${index}].replacement`,
    occurrence: occurrence.id,
    before,
    after,
  });
}

function appendFaintResolved(trace: ObservationTrace, occurrence: AnyRecord, phase: string): void {
  if (occurrence.resolved) {
    fail("UNRECORDED_STATE_CHANGE", `faint ${String(occurrence.id)} resolved more than once`);
  }
  const index = faintQueueIndex(trace, occurrence);
  occurrence.resolved = true;
  trace.mutations.push({
    sequence: trace.mutations.length,
    kind: "FAINT_RESOLVED",
    phase,
    cause: trace.activeAction == null ? "TURN_RESOLUTION" : trace.activeAction.sequence,
    path: `battle.faint_queue[${index}]`,
    occurrence: occurrence.id,
  });
}

function pendingFaintForPlayerSlot(trace: ObservationTrace, position: number): AnyRecord {
  const matches = trace.faints.filter(
    occurrence =>
      occurrence.slot?.side === "PLAYER"
      && occurrence.slot.position === position
      && occurrence.replacement?.kind === "PENDING"
      && occurrence.resolved !== true,
  );
  if (matches.length !== 1) {
    fail(
      "UNRECORDED_STATE_CHANGE",
      `player field ${String(position)} has ${String(matches.length)} pending faint occurrences`,
    );
  }
  return matches[0];
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

function actionOperationId(game: GameManager, pokemon: Pokemon): string | null {
  const battle = game.scene.currentBattle;
  const flatIndex = pokemon.getBattlerIndex();
  const location = battle.arrangement.locate(flatIndex);
  if (location.side < 0) {
    fail("ACTION_ORDER_UNOBSERVABLE", `unmapped action battler index ${String(flatIndex)}`);
  }
  const turnCommand = battle.turnCommands[flatIndex] as AnyRecord | undefined;
  if (turnCommand == null) {
    return null;
  }
  const kind = commandKind(turnCommand.command);
  if (kind !== "FIGHT" && kind !== "SWITCH") {
    fail("ACTION_ORDER_UNOBSERVABLE", `unsupported resolved command ${kind}`);
  }
  const turn = battle.turn;
  if (location.side === 0) {
    const partyIndex = game.scene.getPlayerParty().indexOf(pokemon);
    const ownerSeat = resolvePlayerOwnerSeat(game, pokemon, partyIndex);
    return `battle/1/wave/${battle.waveIndex}/turn/${turn}/command/player/${location.position}/seat/${ownerSeat}`;
  }
  const scriptCursor = turnCommand.cursor ?? 0;
  if (!Number.isSafeInteger(scriptCursor) || scriptCursor < 0) {
    fail("ACTION_ORDER_UNOBSERVABLE", `enemy command has invalid script cursor for ${String(pokemon.id)}`);
  }
  // Enemy FIGHT commands in the pinned production phase carry no cursor;
  // script zero is the engine's explicit default for that command form.
  return `battle/1/wave/${battle.waveIndex}/turn/${turn}/command/enemy/${location.position}/script/${scriptCursor}`;
}

function recordResolvedAction(
  game: GameManager,
  phase: AnyRecord | null,
  pokemon: Pokemon,
  kind: "MOVE" | "SWITCH" | "RESIDUAL_STATUS" | "FAINT" | "REPLACEMENT",
  disposition: string,
  operationId?: string | null,
): AnyRecord {
  const trace = activeTrace;
  if (trace == null) {
    fail("ACTION_ORDER_UNOBSERVABLE", "resolved action observed without an active trace");
  }
  const battle = game.scene.currentBattle;
  const speed = pokemon.getEffectiveStat(Stat.SPD);
  if (!Number.isSafeInteger(speed) || speed < 0 || speed > 0xffffffff) {
    fail("ACTION_ORDER_UNOBSERVABLE", `invalid effective speed for Pokemon ${String(pokemon.id)}`);
  }
  let timingModifier = 0;
  let movePriority = 0;
  let bracketModifier = 0;
  if (kind === "MOVE") {
    if (!(phase instanceof MovePhase)) {
      fail("ACTION_ORDER_UNOBSERVABLE", "move action did not expose its MovePhase");
    }
    const move = phase.move.getMove();
    timingModifier = phase.timingModifier;
    movePriority = move.getPriority(pokemon, true);
    bracketModifier = move.getPriorityModifier(pokemon, true);
  }
  if (
    !Number.isSafeInteger(timingModifier)
    || timingModifier < -128
    || timingModifier > 127
    || !Number.isSafeInteger(movePriority)
    || movePriority < -128
    || movePriority > 127
    || !Number.isSafeInteger(bracketModifier)
    || bracketModifier < -128
    || bracketModifier > 127
  ) {
    fail("ACTION_ORDER_UNOBSERVABLE", `invalid move ordering tuple for Pokemon ${String(pokemon.id)}`);
  }
  const tieOrder = kind === "MOVE" ? (phase == null ? undefined : trace.tieOrderByPhase?.get(phase)) : 0;
  if (!Number.isSafeInteger(tieOrder) || (tieOrder as number) < 0) {
    fail("ACTION_ORDER_UNOBSERVABLE", `missing seeded tie position for Pokemon ${String(pokemon.id)}`);
  }
  const action = {
    sequence: trace.actionOrder.length,
    actor_legacy_pid: pokemon.id,
    resolved_turn: battle.turn,
    source_slot: fieldSlot(game, pokemon.getBattlerIndex()),
    operation_id: operationId === undefined ? actionOperationId(game, pokemon) : operationId,
    kind,
    effective_speed: speed,
    timing_modifier: timingModifier,
    move_priority: movePriority,
    bracket_modifier: bracketModifier,
    tie_order: tieOrder,
    disposition,
  };
  trace.actionOrder.push(action);
  trace.activeAction = action;
  if (phase != null) {
    trace.actionByPhase?.set(phase, action);
  }
  return action;
}

function buildIdentity(game: GameManager, trace: ObservationTrace): AnyRecord[] {
  const mapping: AnyRecord[] = [];
  const legacyPids = new Set<number>();
  trace.identity = new WeakMap<object, number>();
  let next = 1;
  const add = (side: "PLAYER" | "ENEMY", party: Pokemon[]): void => {
    party.forEach((mon, partyIndex) => {
      if (!Number.isSafeInteger(mon.id) || mon.id < 0 || mon.id > 0xffffffff || legacyPids.has(mon.id)) {
        fail("CANONICAL_STATE_UNOBSERVABLE", `invalid or duplicate legacy PID ${String(mon.id)}`);
      }
      legacyPids.add(mon.id);
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
      fail(
        "CANONICAL_STATE_UNOBSERVABLE",
        `unsupported explicit ability ${String(requested)} for Pokemon ${String(mon.id)}`,
      );
    }
    trace.abilityOverrides?.set(mon, requested);
    if (passive === undefined) {
      mon.setTempPassives([null, null, null]);
    } else {
      if (!Number.isSafeInteger(passive) || passive < 0 || allAbilities[passive]?.id !== passive) {
        fail(
          "CANONICAL_STATE_UNOBSERVABLE",
          `unsupported explicit passive ability ${String(passive)} for Pokemon ${String(mon.id)}`,
        );
      }
      mon.setTempPassives([allAbilities[passive], null, null]);
    }
  };

  game.scene.getPlayerParty().forEach((mon, index) => {
    project(mon, spec.party[index]?.ability, spec.party[index]?.passiveAbility);
  });
  const enemySpecs =
    spec.enemy?.kind === "wild" ? [spec.enemy.wild] : spec.enemy?.kind === "party" ? (spec.enemy.party ?? []) : [];
  game.scene.getEnemyParty().forEach((mon, index) => {
    const enemySpec = enemySpecs[index];
    project(mon, enemySpec?.ability, enemySpec?.passiveAbility);
  });
}

function applyScenarioInitialState(game: GameManager, id: string): void {
  if (id === "existing-status-rejected") {
    const enemy = game.scene.getEnemyParty()[0];
    if (enemy == null) {
      fail("CANONICAL_STATE_UNOBSERVABLE", "existing-status rejection scenario has no enemy");
    }
    // The scenario builder's uniform ENEMY_STATUS_OVERRIDE constructs every
    // status with a four-turn sleep companion.  That is valid for its sleep
    // testing shortcut but is not the production Burn state this oracle case
    // needs.  Seed the pre-turn state through Pokemon's production mutator so
    // the non-sleep companion remains at its neutral zero sentinel.
    enemy.doSetStatus(StatusEffect.BURN);
  }
  if (id !== "pp-unusable-rejected") {
    return;
  }
  const lead = game.scene.getPlayerField(false)[0];
  const move = lead?.getMoveset()[0];
  if (lead == null || move == null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "PP rejection scenario has no observed lead move");
  }
  // This is fixture setup, not a turn mutation: the rejected command must
  // start from the observed zero-PP frontier so it consumes neither PP nor
  // RNG during admission.  Keep it before initial capture/trace collection.
  move.ppUsed = move.getMovePp();
}

function explicitPlayerOwnerSeat(mon: Pokemon, path: string): number | null {
  const role = (mon as AnyRecord).coopOwner;
  if (role == null) {
    return null;
  }
  if (role !== "host" && role !== "guest") {
    fail("CANONICAL_STATE_UNOBSERVABLE", `invalid persistent coopOwner at ${path}`);
  }
  return role === "host" ? 1 : 2;
}

function resolvePlayerOwnerSeat(game: GameManager, mon: Pokemon, partyIndex: number): number {
  const party = game.scene.getPlayerParty();
  if (!Number.isSafeInteger(partyIndex) || partyIndex < 0 || party[partyIndex] !== mon) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `player party identity mismatch at index ${String(partyIndex)}`);
  }
  const capacity = game.scene.currentBattle.arrangement.playerCapacity;
  const explicit = explicitPlayerOwnerSeat(mon, `player_party[${partyIndex}]`);
  if (capacity === 1) {
    if (explicit != null && explicit !== 1) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `single-battle player_party[${partyIndex}] is not owned by seat 1`);
    }
    return 1;
  }
  if (capacity !== 2) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported player capacity ${String(capacity)}`);
  }
  if (explicit == null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `double-battle player_party[${partyIndex}] has no explicit owner`);
  }
  return explicit;
}

function canonicalPokemon(
  trace: ObservationTrace,
  mon: Pokemon,
  side: "PLAYER" | "ENEMY",
  partyIndex: number,
): AnyRecord {
  if (mon.isFusion() || mon.isTerastallized) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `fusion/Tera state on ${side}[${partyIndex}]`);
  }
  const rawTypes = mon.getTypes(false, false, false, false);
  if (rawTypes.length === 0 || rawTypes.length > 2) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `effective typing on ${side}[${partyIndex}] has ${rawTypes.length} entries`);
  }
  // getTypes() represents the absence of a secondary type with a trailing
  // UNKNOWN sentinel.  Remove only that documented slot sentinel; an
  // UNKNOWN primary, UNKNOWN in any other position, STELLAR, or a third type
  // remains an unsupported effective typing rather than being truncated.
  const types = rawTypes.length === 2 && rawTypes[1] === PokemonType.UNKNOWN ? rawTypes.slice(0, 1) : rawTypes;
  if (types.some(type => type === PokemonType.UNKNOWN || type === PokemonType.STELLAR)) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported effective typing on ${side}[${partyIndex}]`);
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
  const passiveAbilities = mon.getPassiveAbilities();
  if (passiveAbilities.length !== 3) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `passive slot count on ${side}[${partyIndex}]`);
  }
  const passives = passiveAbilities.map(ability => {
    if (ability == null) {
      return null;
    }
    if (!Number.isSafeInteger(ability.id) || ability.id < 0 || allAbilities[ability.id]?.id !== ability.id) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported passive ability on ${side}[${partyIndex}]`);
    }
    return ability.id;
  });
  const suppressedSlots = (mon.summonData as AnyRecord).erSuppressedInnateSlots;
  if (
    !Array.isArray(suppressedSlots)
    || suppressedSlots.length !== 3
    || suppressedSlots.some(value => typeof value !== "boolean")
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported passive suppression shape on ${side}[${partyIndex}]`);
  }
  const passiveSuppressed = suppressedSlots.slice();
  const observedMoves = mon.getMoveset();
  if (observedMoves.length > 4) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `move slot count on ${side}[${partyIndex}]`);
  }
  const moveSlots = observedMoves.map((move, moveSlot) => {
    if (!Number.isSafeInteger(move.ppUsed) || move.ppUsed < 0) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `invalid PP used on ${side}[${partyIndex}][${moveSlot}]`);
    }
    if (!Number.isSafeInteger(move.ppUp) || move.ppUp < 0 || move.ppUp > 3) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `invalid PP Ups on ${side}[${partyIndex}][${moveSlot}]`);
    }
    if (move.maxPpOverride != null && (!Number.isSafeInteger(move.maxPpOverride) || move.maxPpOverride < 0)) {
      fail("CANONICAL_STATE_UNOBSERVABLE", `invalid PP override on ${side}[${partyIndex}][${moveSlot}]`);
    }
    return {
      move_id: move.moveId,
      pp_used: move.ppUsed,
      pp_ups: move.ppUp,
      max_pp_override: move.maxPpOverride ?? null,
    };
  });
  while (moveSlots.length < 4) {
    moveSlots.push(null as never);
  }
  const maxHp = mon.getMaxHp();
  if (!Number.isSafeInteger(maxHp) || maxHp < 1 || !Number.isSafeInteger(mon.hp) || mon.hp < 0 || mon.hp > maxHp) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `invalid HP state on ${side}[${partyIndex}]`);
  }
  const activeAbility = mon.getAbility();
  if (!activeAbility || activeAbility.id == null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `active ability on ${side}[${partyIndex}]`);
  }
  if (
    !Number.isSafeInteger(activeAbility.id)
    || activeAbility.id < 0
    || allAbilities[activeAbility.id]?.id !== activeAbility.id
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported active ability on ${side}[${partyIndex}]`);
  }
  const abilitySuppressed = (mon.summonData as AnyRecord).abilitySuppressed;
  if (typeof abilitySuppressed !== "boolean") {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported active suppression shape on ${side}[${partyIndex}]`);
  }
  const statusKindValue = statusKind(status?.effect);
  const toxicTurnCount = status == null ? 0 : status.toxicTurnCount;
  if (!Number.isSafeInteger(toxicTurnCount) || toxicTurnCount < 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `invalid toxic turn count on ${side}[${partyIndex}]`);
  }
  if ((statusKindValue.kind === "NONE" || statusKindValue.kind === "PARALYSIS") && toxicTurnCount !== 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `nonzero toxic turn count on ${side}[${partyIndex}]`);
  }
  // Status always stores the optional sleep companion.  The production
  // Status constructor uses zero for every non-sleep effect, so that neutral
  // sentinel is projected to the contract's null rather than leaked as a
  // fabricated sleep countdown.  Any non-zero companion is unsupported.
  const rawSleepTurnsRemaining = status?.sleepTurnsRemaining ?? 0;
  if (!Number.isSafeInteger(rawSleepTurnsRemaining) || rawSleepTurnsRemaining < 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `invalid sleep companion on ${side}[${partyIndex}]`);
  }
  const sleepTurnsRemaining = rawSleepTurnsRemaining === 0 ? null : rawSleepTurnsRemaining;
  if (sleepTurnsRemaining !== null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", `unsupported sleep companion on ${side}[${partyIndex}]`);
  }
  return {
    id: pokemonId(trace, mon),
    owner_seat: side === "PLAYER" ? resolvePlayerOwnerSeat(trace.game as GameManager, mon, partyIndex) : null,
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
      kind: statusKindValue,
      toxic_turn_count: toxicTurnCount,
      sleep_turns_remaining: sleepTurnsRemaining,
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
      active_suppressed: abilitySuppressed,
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
  const actorPartyIndex = game.scene.getPlayerParty().indexOf(mon);
  const actorOwnerSeat = resolvePlayerOwnerSeat(game, mon, actorPartyIndex);
  const moves = mon.getMoveset().flatMap((move, moveSlot) => {
    const maxPp = move.getMovePp();
    if (
      !Number.isSafeInteger(move.ppUsed)
      || move.ppUsed < 0
      || !Number.isSafeInteger(maxPp)
      || maxPp < 0
      || move.ppUsed > maxPp
    ) {
      fail("COMMAND_UNOBSERVABLE", `invalid PP frontier for move slot ${String(moveSlot)}`);
    }
    if (move.ppUsed === maxPp) {
      return [];
    }
    return [
      {
        move_slot: moveSlot,
        legal_targets: game.scene
          .getEnemyField(false)
          .map((target, position) => ({ target, position }))
          .filter(
            ({ target }) =>
              target != null
              && !target.isFainted()
              && battle.arrangement.isAdjacent(
                battle.arrangement.locate(fieldIndex),
                battle.arrangement.locate(target.getBattlerIndex()),
              ),
          )
          .map(({ position }) => ({
            kind: "SELECTED",
            value: [fieldSlot(game, battle.arrangement.enemyOffset + position)],
          })),
      },
    ];
  });
  const switches = game.scene
    .getPlayerParty()
    .map((candidate, partySlot) => ({ candidate, partySlot }))
    .filter(
      ({ candidate, partySlot }) =>
        partySlot >= battle.getBattlerCount()
        && candidate.isAllowedInBattle()
        && resolvePlayerOwnerSeat(game, candidate, partySlot) === actorOwnerSeat,
    )
    .map(({ candidate, partySlot }) => ({ party_slot: partySlot, pokemon: pokemonId(activeTrace!, candidate) }));
  return { fight: moves, switches };
}

function commandFrontier(game: GameManager): AnyRecord[] {
  const battle = game.scene.currentBattle;
  if (game.isVictory() || game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    return [];
  }
  return game.scene
    .getPlayerField(false)
    .map((mon, position) => {
      if (mon == null || mon.isFainted()) {
        return null;
      }
      const flat = battle.arrangement.indexOf({ side: 0, position });
      const turn = battle.turn;
      const partyIndex = game.scene.getPlayerParty().indexOf(mon);
      const ownerSeat = resolvePlayerOwnerSeat(game, mon, partyIndex);
      return {
        operation_id: `battle/1/wave/${battle.waveIndex}/turn/${turn}/command/player/${position}/seat/${ownerSeat}`,
        owner_seat: ownerSeat,
        actor: pokemonId(activeTrace!, mon),
        field_slot: fieldSlot(game, flat),
        offer: commandOffer(game, mon, flat),
        status: { kind: "PENDING" },
      };
    })
    .filter(Boolean);
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

function assertFaintObservationComplete(trace: ObservationTrace): void {
  for (const occurrence of trace.faints) {
    if (!occurrence.resolved || occurrence.replacement?.kind === "PENDING") {
      fail("UNRECORDED_STATE_CHANGE", `faint ${String(occurrence.id)} never reached a causal resolution boundary`);
    }
  }
}

function captureState(game: GameManager, trace: ObservationTrace, contentHash: string): AnyRecord {
  const before = liveFingerprint(game);
  const battle = game.scene.currentBattle;
  const arena = game.scene.arena;
  const waveSeed = authoritativeWaveSeed(game);
  if (arena.weatherType !== 0 || arena.terrainType !== 0 || !Array.isArray(arena.tags) || arena.tags.length > 0) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "selected M3 state contains non-neutral field conditions");
  }
  if (arena.ignoreAbilities === true || arena.ignoringEffectSource != null) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "selected M3 state suppresses abilities");
  }
  const weatherTurns = arena.weather?.turnsLeft ?? 0;
  const terrainTurns = arena.terrain?.turnsLeft ?? 0;
  if (
    !Number.isSafeInteger(weatherTurns)
    || weatherTurns < 0
    || !Number.isSafeInteger(terrainTurns)
    || terrainTurns < 0
  ) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "invalid neutral field-condition duration");
  }
  const state = {
    schema_version: 1,
    content_hash: `blake3-v1:${contentHash}`,
    mode: game.scene.gameMode.modeId,
    wave: battle.waveIndex,
    next_battle_id: 2,
    run_rng: battleRngState(game).run,
    battle: {
      battle_id: 1,
      wave: battle.waveIndex,
      turn: battle.turn,
      wave_seed: waveSeed,
      format: formatState(game),
      authority_seat: 1,
      player_party: game.scene.getPlayerParty().map((mon, index) => canonicalPokemon(trace, mon, "PLAYER", index)),
      enemy_party: game.scene.getEnemyParty().map((mon, index) => canonicalPokemon(trace, mon, "ENEMY", index)),
      field: { slots: formatState(game).slots },
      weather: {
        kind: { kind: "NONE" },
        remaining_turns: weatherTurns,
      },
      terrain: {
        kind: { kind: "NONE" },
        remaining_turns: terrainTurns,
      },
      arena_conditions: [],
      global_ability_suppression: {
        ignore_abilities: arena.ignoreAbilities === true,
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
  assertCanonicalWaveSeed(game, state.battle.wave_seed);
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
    let moveSlot: number | null = null;
    if (moveId != null) {
      const cursor = turnCommand.cursor;
      if (Number.isSafeInteger(cursor) && cursor >= 0 && actor.getMoveset()[cursor]?.moveId === moveId) {
        moveSlot = cursor;
      } else {
        const matchingSlots = actor
          .getMoveset()
          .map((move, index) => ({ move, index }))
          .filter(({ move }) => move.moveId === moveId)
          .map(({ index }) => index);
        if (matchingSlots.length !== 1) {
          fail(
            "COMMAND_UNOBSERVABLE",
            `move ${String(moveId)} has no unique observed slot for actor ${String(actor.id)}`,
          );
        }
        moveSlot = matchingSlots[0]!;
      }
    }
    const targets = (turnCommand.targets ?? turnCommand.move?.targets ?? []).map((target: number) =>
      fieldSlot(game, target),
    );
    const player = location.side === 0;
    const position = location.position;
    const ownerSeat = player
      ? resolvePlayerOwnerSeat(game, actor, game.scene.getPlayerParty().indexOf(actor))
      : null;
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
      if (
        !player
        || selected == null
        || ownerSeat == null
        || resolvePlayerOwnerSeat(game, selected, partySlot) !== ownerSeat
      ) {
        fail("COMMAND_UNOBSERVABLE", "switch command lacks a same-owner observed replacement");
      }
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
      source: player ? (ownerSeat === 1 ? "AUTHORITY_LOCAL_INTERNAL" : "AUTHORITY_REMOTE_PROPOSAL") : "SCRIPTED_ENEMY",
    });
  }
  return commands;
}

function semanticIntent(id: string, spec: ScenarioSpec, game: GameManager): AnyRecord[] {
  const move = spec.party[0]?.moves?.[0];
  if (id === "pp-unusable-rejected") {
    const fallback = spec.party[0]?.moves?.[1];
    return [
      {
        sequence: 0,
        scenario_id: id,
        action: {
          kind: "FIGHT",
          move_id: move ?? null,
          move_slot: 0,
          target: fieldSlot(game, BattlerIndex.ENEMY),
          expected_admission: "REJECTED_EXHAUSTED_PP",
          source: "SCENARIO_SEMANTIC_INTENT",
        },
      },
      {
        sequence: 1,
        scenario_id: id,
        action: {
          kind: "FIGHT",
          move_id: fallback ?? null,
          move_slot: 1,
          target: fieldSlot(game, BattlerIndex.ENEMY),
          expected_admission: "COMMITTED_AFTER_REJECTION",
          source: "SCENARIO_FALLBACK_INTENT",
        },
      },
    ];
  }
  if (id === "voluntary-switch") {
    const replacement = game.scene.getPlayerParty()[2];
    if (replacement == null) {
      fail("COMMAND_UNOBSERVABLE", "voluntary-switch semantic intent has no observed bench replacement");
    }
    return [
      {
        sequence: 0,
        scenario_id: id,
        action: {
          kind: "SWITCH",
          party_slot: 2,
          pokemon: pokemonId(activeTrace!, replacement),
          source: "SCENARIO_SEMANTIC_INTENT",
        },
      },
    ];
  }
  return [
    {
      sequence: 0,
      scenario_id: id,
      action: {
        kind: "FIGHT",
        move_id: move ?? null,
        target: move === MoveId.PLAY_NICE ? null : fieldSlot(game, BattlerIndex.ENEMY),
        source: "SCENARIO_SEMANTIC_INTENT",
      },
    },
  ];
}

function replacementProposals(trace: ObservationTrace): AnyRecord[] {
  return trace.faints
    .filter(occurrence => occurrence.slot.side === "PLAYER" && occurrence.replacement.kind !== "PENDING")
    .map(occurrence => {
      const source = occurrence.source;
      const operationId = `RC/e${source.epoch}/w${source.wave}/t${source.resolved_turn}/o${source.turn_occurrence}/f${occurrence.slot.position}/s${occurrence.owner_seat}`;
      const progress = occurrence.replacement;
      const selection =
        progress.kind === "SELECTED"
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
      if (mon == null || mon.isFainted()) {
        continue;
      }
      const fieldIndex = mon.getBattlerIndex();
      if (commands[fieldIndex] == null) {
        const partyIndex = game.scene.getPlayerParty().indexOf(mon);
        pending.push(resolvePlayerOwnerSeat(game, mon, partyIndex));
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
    const trace = activeTrace;
    const phase = game.scene.phaseManager.getCurrentPhase() as AnyRecord | undefined;
    const fieldIndex = phase?.fieldIndex;
    if (
      trace == null
      || phase?.phaseName !== "SwitchPhase"
      || !Number.isSafeInteger(fieldIndex)
      || fieldIndex < 0
      || fieldIndex >= game.scene.currentBattle.arrangement.playerCapacity
    ) {
      fail("NEXT_CONTROL_UNOBSERVABLE", "replacement prompt lacks its observed player field address");
    }
    const occurrence = pendingFaintForPlayerSlot(trace, fieldIndex);
    const ownerSeat = occurrence.owner_seat;
    const handler = game.scene.ui.getHandler() as AnyRecord;
    const battlerCount = game.scene.currentBattle.getBattlerCount();
    const slot = game.scene
      .getPlayerParty()
      .findIndex(
        (mon, index) =>
          index >= battlerCount
          && index < 6
          && mon.isAllowedInBattle()
          && resolvePlayerOwnerSeat(game, mon, index) === ownerSeat,
      );
    if (slot < 0) {
      fail(
        "CANONICAL_STATE_UNOBSERVABLE",
        `replacement prompt for faint ${String(occurrence.id)} has no observed same-owner candidate`,
      );
    }
    if (typeof handler.setCursor !== "function" || typeof handler.processInput !== "function") {
      fail("NEXT_CONTROL_UNOBSERVABLE", "replacement prompt did not expose its observed party handler");
    }
    handler.setCursor(slot);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
  });
}

async function waitForUiMode(game: GameManager, mode: UiMode, context: string): Promise<void> {
  try {
    await vi.waitUntil(() => game.scene.ui.getMode() === mode, { interval: 5, timeout: 5_000 });
  } catch {
    fail("COMMAND_UNOBSERVABLE", `${context} did not reach ${UiMode[mode]}`);
  }
}

async function admitPlayerCommands(game: GameManager, id: string): Promise<void> {
  const field = game.scene.getPlayerField(false);
  const select = (mon: Pokemon, battlerIndex: number): void => {
    const move = mon.getMoveset()[0];
    if (move == null) {
      fail("COMMAND_UNOBSERVABLE", `no selected move in player field ${String(battlerIndex)}`);
    }
    // Leave the helper target optional. Its SelectTargetPhase callback then
    // confirms spread targets without a cursor and defaults a single target to
    // ENEMY based on the phase that actually opened, so doubles callbacks
    // cannot carry one battler's target shape into its partner's phase.
    game.move.select(move.moveId, battlerIndex as BattlerIndex);
  };
  if (id === "pp-unusable-rejected") {
    const lead = field[0];
    const exhausted = lead?.getMoveset()[0];
    const fallback = lead?.getMoveset()[1];
    if (
      lead == null
      || exhausted == null
      || fallback == null
      || exhausted.ppUsed !== exhausted.getMovePp()
      || fallback.ppUsed >= fallback.getMovePp()
    ) {
      fail("COMMAND_UNOBSERVABLE", "PP rejection scenario lacks one exhausted and one usable observed move");
    }
    if (game.scene.ui.getMode() !== UiMode.COMMAND) {
      fail("COMMAND_UNOBSERVABLE", "PP rejection did not begin at the production command menu");
    }
    const battle = game.scene.currentBattle;
    const rngBefore = battleRngState(game);
    const commandsBefore = JSON.parse(
      JSON.stringify({
        turn: battle.turn,
        turn_commands: battle.turnCommands,
        pre_turn_commands: battle.preTurnCommands,
      }),
    ) as AnyRecord;
    const ppBefore = exhausted.ppUsed;
    const rngDrawCountBefore = activeTrace?.rngDraws.length ?? 0;
    const rejectionMessage = lead.trySelectMove(0)[1];
    if (rejectionMessage.length === 0) {
      fail("COMMAND_UNOBSERVABLE", "production exhausted-move admission exposed no rejection message");
    }

    game.scene.ui.setCursor(Command.FIGHT);
    const openedFight = game.scene.ui.processInput(Button.ACTION);
    if (!openedFight) {
      fail("COMMAND_UNOBSERVABLE", "production command menu rejected the Fight selection");
    }
    await waitForUiMode(game, UiMode.FIGHT, "opening the Fight menu");
    game.scene.ui.setCursor(0);
    const fightHandler = game.scene.ui.getHandler() as AnyRecord;
    if (typeof fightHandler.getCursor !== "function" || fightHandler.getCursor() !== 0) {
      fail("COMMAND_UNOBSERVABLE", "production Fight menu did not expose exhausted slot 0");
    }

    const showTextSpy = vi.spyOn(game.scene.ui as AnyRecord, "showText");
    let acceptedExhaustedMove = false;
    let publishedRejectionMessage = false;
    try {
      acceptedExhaustedMove = game.scene.ui.processInput(Button.ACTION);
      publishedRejectionMessage = showTextSpy.mock.calls.some(call => call[0] === rejectionMessage);
    } finally {
      showTextSpy.mockRestore();
    }
    if (acceptedExhaustedMove) {
      fail("COMMAND_UNOBSERVABLE", "production Fight menu accepted an exhausted move");
    }
    if (!publishedRejectionMessage) {
      fail("COMMAND_UNOBSERVABLE", "exhausted-move rejection did not publish its production error text");
    }
    if (game.scene.ui.getMode() !== UiMode.MESSAGE && game.scene.ui.getMode() !== UiMode.FIGHT) {
      fail("COMMAND_UNOBSERVABLE", "exhausted-move rejection left the production Fight/message surface");
    }
    const rngAfterRejection = battleRngState(game);
    const commandsAfterRejection = JSON.parse(
      JSON.stringify({
        turn: battle.turn,
        turn_commands: battle.turnCommands,
        pre_turn_commands: battle.preTurnCommands,
      }),
    ) as AnyRecord;
    const rngDrawCountAfter = activeTrace?.rngDraws.length ?? 0;
    if (!canonicalBytes(rngBefore, false, false).equals(canonicalBytes(rngAfterRejection, false, false))) {
      fail("COMMAND_UNOBSERVABLE", "exhausted-move rejection consumed battle RNG");
    }
    if (!canonicalBytes(commandsBefore, false, false).equals(canonicalBytes(commandsAfterRejection, false, false))) {
      fail("COMMAND_UNOBSERVABLE", "exhausted-move rejection mutated the command frontier");
    }
    if (exhausted.ppUsed !== ppBefore || rngDrawCountAfter !== rngDrawCountBefore) {
      fail("COMMAND_UNOBSERVABLE", "exhausted-move rejection changed PP or emitted an RNG draw");
    }

    // The headless timer can finish and consume this short prompt before a
    // polling turn observes MESSAGE.  The synchronous production showText call
    // above proves the same surface opened; drive it only if it remains open.
    if (game.scene.ui.getMode() === UiMode.MESSAGE) {
      const messageHandler = game.scene.ui.getMessageHandler() as AnyRecord;
      if (typeof messageHandler.isAwaitingPromptAction !== "function") {
        fail("OBSERVATION_SEAM_MISSING", "PP rejection message handler lacks its public action state");
      }
      try {
        await vi.waitUntil(
          () => game.scene.ui.getMode() === UiMode.FIGHT || messageHandler.isAwaitingPromptAction() === true,
          { interval: 5, timeout: 5_000 },
        );
      } catch {
        fail("COMMAND_UNOBSERVABLE", "PP rejection message never became actionable");
      }
      if (game.scene.ui.getMode() === UiMode.MESSAGE && !game.scene.ui.processInput(Button.ACTION)) {
        fail("COMMAND_UNOBSERVABLE", "PP rejection message could not be dismissed");
      }
    }
    await waitForUiMode(game, UiMode.FIGHT, "returning from the PP rejection message");
    if (!game.scene.ui.processInput(Button.RIGHT)) {
      fail("COMMAND_UNOBSERVABLE", "production Fight menu could not move to the usable fallback slot");
    }
    const fallbackHandler = game.scene.ui.getHandler() as AnyRecord;
    if (typeof fallbackHandler.getCursor !== "function" || fallbackHandler.getCursor() !== 1) {
      fail("COMMAND_UNOBSERVABLE", "production Fight menu did not select fallback slot 1");
    }
    if (!game.scene.ui.processInput(Button.ACTION)) {
      fail("COMMAND_UNOBSERVABLE", "production Fight menu rejected the usable fallback move");
    }
    const committed = battle.turnCommands[BattlerIndex.PLAYER];
    if (committed?.cursor !== 1 || committed?.move?.move !== fallback.moveId) {
      fail("COMMAND_UNOBSERVABLE", "usable fallback command lost its observed move-slot identity");
    }
    return;
  }
  if (id === "voluntary-switch") {
    // In a double battle party slots 0 and 1 are active; slot 2 is the
    // observed bench choice. Queue the lead's switch before the partner's real
    // command so each prompt group binds to production field order.
    game.doSwitchPokemon(2);
    if (field[1] != null && !field[1].isFainted()) {
      select(field[1], BattlerIndex.PLAYER_2);
    }
  } else {
    if (field[0] != null && !field[0].isFainted()) {
      select(field[0], BattlerIndex.PLAYER);
    }
    if (field[1] != null && !field[1].isFainted()) {
      select(field[1], BattlerIndex.PLAYER_2);
    }
  }
}

async function admitEnemyCommands(game: GameManager): Promise<void> {
  const enemy = game.scene.getEnemyField(false);
  const targets = game.scene.getPlayerField(false);
  for (let index = 0; index < enemy.length; index++) {
    const mon = enemy[index];
    if (mon == null || mon.isFainted()) {
      continue;
    }
    const target =
      targets[index] && !targets[index].isFainted() ? targets[index].getBattlerIndex() : BattlerIndex.PLAYER;
    await game.move.selectEnemyMove(MoveId.POUND, target);
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
    return {
      sequence: action.sequence,
      kind: action.kind,
      actor: pokemonId(trace, mon),
      source_slot: action.source_slot,
      command_operation_id: action.operation_id ?? null,
      effective_speed: action.effective_speed,
      timing_modifier: action.timing_modifier,
      move_priority: action.move_priority,
      bracket_modifier: action.bracket_modifier,
      tie_order: action.tie_order,
      disposition: action.disposition,
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
    actionByPhase: new WeakMap<object, AnyRecord>(),
    tieOrderByPhase: new WeakMap<object, number>(),
    faintByPhase: new WeakMap<object, AnyRecord>(),
    faintBySwitchPhase: new WeakMap<object, AnyRecord>(),
    faintBranchByPhase: new WeakMap<object, AnyRecord>(),
    faintCompletionByPokemon: new WeakMap<object, () => void>(),
    collectRng: false,
    collectMutations: false,
  };
  activeTrace = trace;
  applyTestOnlyContentProjection(game, spec, trace);
  applyScenarioInitialState(game, id);
  const legacyIdentityMap = buildIdentity(game, trace);
  const initialState = captureState(game, trace, contentHash);
  const initialRng = battleRngState(game);
  const resolvedTurn = game.scene.currentBattle.turn;
  trace.collectRng = true;
  trace.collectMutations = true;
  beginCoopRecording(resolvedTurn);
  await admitPlayerCommands(game, id);
  if (id === "forced-replacement" || id === "same-side-simultaneous-faint" || id === "mixed-side-simultaneous-faint") {
    registerReplacementPrompt(game);
  }
  await admitEnemyCommands(game);
  const rawCommitted = JSON.parse(JSON.stringify(game.scene.currentBattle.turnCommands)) as AnyRecord;
  const admitted = committedCommands(game, rawCommitted, trace);
  const settledBoundary = await game.phaseInterceptor.toFirst([
    "TurnEndPhase",
    "VictoryPhase",
    "GameOverPhase",
  ]);
  if (settledBoundary === "TurnEndPhase") {
    await game.toEndOfTurn();
  }
  const recording = endCoopRecording();
  const presentation = presentationPlan(
    recording.events as AnyRecord[],
    game.scene.currentBattle.waveIndex,
    resolvedTurn,
  );

  if (!game.isVictory() && !game.scene.getPlayerParty().every(mon => mon.isFainted())) {
    await game.toNextTurn();
  }
  assertFaintObservationComplete(trace);
  const finalState = captureState(game, trace, contentHash);
  const finalRng = battleRngState(game);
  const replacement = replacementProposals(trace);
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

function releaseScenarioHarness(): void {
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  currentScenarioGame?.promptHandler.clearPrompts();
  const setModeInternal =
    currentScenarioGame == null ? null : (currentScenarioGame.scene.ui as AnyRecord).setModeInternal;
  if (typeof setModeInternal?.mockRestore === "function") {
    setModeInternal.mockRestore();
  }
  restoreScenarioFaintCry?.();
  restoreScenarioFaintCry = null;
  currentScenarioGame = null;
  activeTrace = null;
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
    releaseScenarioHarness();
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
      try {
        const envelope = await exportCase(id, hash, sharedProvenance);
        writeCanonical(resolve(root, "battle-cases", `${id}.json`), envelope);
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        fail("ORACLE_CASE_FAILED", `${id}: ${detail}`);
      } finally {
        releaseScenarioHarness();
      }
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
