/*
 * M4A test-only migration companion capture.
 *
 * This helper deliberately owns a small copy of the M3 scenario construction
 * and replay boundary.  The values in the returned catalog are read from the
 * live Pokemon instances made by that boundary; the source battle ID is read
 * from the already-captured canonical M3 fixture state.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BattleScene } from "#app/battle-scene";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { getGameMode } from "#app/game-mode";
import Overrides from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { StatusEffect } from "#enums/status-effect";
import { PokemonData } from "#system/pokemon-data";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { CommandPhase } from "#phases/command-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { launchDetachedStarters } from "./starter-launch";
import { vi } from "vitest";
import Phaser from "phaser";

export class M4CaptureGap extends Error {
  public readonly code: string;
  public readonly sourceSeam: string;

  public constructor(code: string, sourceSeam: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "M4CaptureGap";
    this.code = code;
    this.sourceSeam = sourceSeam;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type AnyRecord = Record<string, any>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type CompanionRecord = JsonObject & {
  fixture_id: string;
  state_side: "INITIAL" | "FINAL";
  party_side: "PLAYER" | "ENEMY";
  pokemon_id: number;
  source_party_index: number;
  stable_roster_index: number;
  owner_seat: number | null;
  experience: number;
  growth_rate: number;
  ivs: number[];
  nature: number;
  effective_nature: number;
  friendship: number;
  permanent_bonuses: JsonObject;
  pause_evolutions: boolean;
};
type CompanionCaseRecord = JsonObject & {
  fixture_id: string;
  initial_companion_count: number;
  final_companion_count: number;
  player_stable_order: number[];
  enemy_stable_order: number[];
};
type DefeatedEnemyRecord = {
  pokemon: number;
  owner_seat: null;
};
type BattleCompanionRecord = JsonObject & {
  fixture_id: string;
  state_side: "INITIAL" | "FINAL";
  participation: {
    player_participants: number[];
    defeated_enemies: DefeatedEnemyRecord[];
  };
  settlement: {
    source_battle_id: number;
    settled: false;
    scattered_money: number;
    wave_reward_evidence: [];
  };
};
type CanonicalFixtureEvidence = {
  sourceBattleId: number;
  initial: AnyRecord;
  final: AnyRecord;
};

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
] as const;

const M3_CASE_SEAM = "test/kernel-fixtures/m3/export-battle-oracle.test.ts:scenarioFor/launchScenario/exportCase";
const M3_CANONICAL_FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../rust/fixtures/m3/oracle/battle-cases",
);
const REORDERED_CASES: Record<string, true> = {
  "voluntary-switch": true,
  "forced-replacement": true,
  "mixed-side-simultaneous-faint": true,
};
const originalBattleSeedInt = BattleScene.prototype.randBattleSeedInt;

function gap(code: string, seam: string, detail: string): never {
  throw new M4CaptureGap(code, seam, detail);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `${path} is not finite`);
  }
  return value;
}

function safeInteger(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (!Number.isSafeInteger(result)) {
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `${path} is not a safe integer`);
  }
  return result;
}

function jsonReady(value: unknown, path = "$", seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return finiteNumber(value, path);
  }
  if (typeof value !== "object") {
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `${path} contains ${typeof value}`);
  }
  if (seen.has(value)) {
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `${path} is cyclic`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry, index) => jsonReady(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return result;
  }
  const result: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = jsonReady((value as AnyRecord)[key], `${path}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function canonicalFixtureEvidence(fixtureId: string): CanonicalFixtureEvidence {
  const fixturePath = resolve(M3_CANONICAL_FIXTURE_ROOT, `${fixtureId}.json`);
  let fixture: AnyRecord;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as AnyRecord;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    gap("CANONICAL_STATE_UNOBSERVABLE", fixturePath, `M3 fixture read failed: ${detail}`);
  }
  const readCanonical = (stateSide: "INITIAL" | "FINAL"): AnyRecord => {
    const stateKey = stateSide === "INITIAL" ? "initial_state" : "expected_final_state";
    const state = fixture[stateKey];
    const canonical = state != null && typeof state === "object" && !Array.isArray(state)
      ? (state as AnyRecord).canonical
      : undefined;
    if (canonical == null || typeof canonical !== "object" || Array.isArray(canonical)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", fixturePath, `${stateKey}.canonical is not an object`);
    }
    const battle = (canonical as AnyRecord).battle;
    if (battle == null || typeof battle !== "object" || Array.isArray(battle)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", fixturePath, `${stateKey}.canonical.battle is not an object`);
    }
    if (Object.prototype.hasOwnProperty.call(battle, "settlement")
      || Object.prototype.hasOwnProperty.call(battle, "wave_reward_evidence")) {
      gap(
        "CANONICAL_STATE_UNOBSERVABLE",
        fixturePath,
        `${stateKey}.canonical.battle unexpectedly contains wave-reward settlement evidence`,
      );
    }
    return canonical as AnyRecord;
  };
  const initial = readCanonical("INITIAL");
  const final = readCanonical("FINAL");
  const initialBattle = initial.battle as AnyRecord;
  const finalBattle = final.battle as AnyRecord;
  const sourceBattleId = safeInteger(initialBattle.battle_id, `${fixtureId}.initial_state.canonical.battle.battle_id`);
  const finalBattleId = safeInteger(finalBattle.battle_id, `${fixtureId}.expected_final_state.canonical.battle.battle_id`);
  if (sourceBattleId <= 0 || finalBattleId <= 0 || sourceBattleId !== finalBattleId) {
    gap(
      "CANONICAL_STATE_UNOBSERVABLE",
      fixturePath,
      `${fixtureId} initial/final canonical battle IDs disagree`,
    );
  }
  return { sourceBattleId, initial, final };
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
    gap("SCENARIO_SETUP", M3_CASE_SEAM, id);
  }
  const use = (move: number): void => {
    const lead = base.party[0];
    if (lead == null) {
      gap("SCENARIO_SETUP", M3_CASE_SEAM, `${id} has no lead party member`);
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

function scenarioBattleStyle(spec: ScenarioSpec): "single" | "double" | "triple" {
  if (spec.run?.triple) return "triple";
  return spec.run?.double ? "double" : "single";
}

function coopOwners(spec: ScenarioSpec, starters: readonly unknown[]): ("host" | "guest")[] | undefined {
  if (spec.run?.triple) {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, "M3 companion catalog has no co-op triple launch");
  }
  if (!spec.run?.double) return undefined;
  if (starters.length < 2 || starters.length > 6) {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, "co-op launch starter cardinality is outside 2..6");
  }
  return starters.map((_, index) => (index % 2 === 0 ? "host" : "guest"));
}

async function launchScenario(spec: ScenarioSpec, phaserGame: Phaser.Game): Promise<GameManager> {
  let game: GameManager;
  try {
    game = new GameManager(phaserGame);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", "test/framework/game-manager.ts:GameManager", `live M3 GameManager construction failed: ${detail}`);
  }
  const battleStyle = scenarioBattleStyle(spec);
  const { scenario, postLaunch } = buildDevScenario(spec);
  await game.runToTitle();
  const starters = scenario.setup();
  const owners = coopOwners(spec, starters);
  (Overrides as unknown as { BATTLE_STYLE_OVERRIDE: typeof battleStyle }).BATTLE_STYLE_OVERRIDE = battleStyle;
  if (owners != null) {
    const saveAll = game.scene.gameData.saveAll as AnyRecord;
    if (typeof saveAll?.mockResolvedValue !== "function") {
      gap("OBSERVATION_SEAM_MISSING", "test/framework/game-manager.ts:ReloadHelper.saveAll", "co-op save seam is not mocked");
    }
    saveAll.mockResolvedValue(true);
    const commandPrototype = CommandPhase.prototype as AnyRecord;
    if (typeof commandPrototype.tryCoopCheckpointSync !== "function") {
      gap("OBSERVATION_SEAM_MISSING", "src/phases/command-phase.ts:tryCoopCheckpointSync", "co-op checkpoint seam is absent");
    }
    if (commandPrototype.tryCoopCheckpointSync.mock == null) {
      vi.spyOn(commandPrototype, "tryCoopCheckpointSync").mockReturnValue(true);
    }
  }
  if (!(game.scene.ui.shouldSkipDialogue as AnyRecord).mock) {
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  }
  // GameManager installs its deterministic test seam in the constructor.  The
  // M3 launch restores the production boundary immediately before title setup.
  BattleScene.prototype.randBattleSeedInt = originalBattleSeedInt;
  game.override.criticalHits(null);
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(owners == null ? GameModes.CLASSIC : GameModes.COOP);
    const starterPhase = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    const scenarioSeed = spec.run?.seed?.trim();
    if (!scenarioSeed) {
      gap("EXPORT_CONFIGURATION", M3_CASE_SEAM, "M3 scenario has no pinned seed");
    }
    game.scene.setSeed(scenarioSeed);
    game.scene.resetSeed();
    launchDetachedStarters(starterPhase, starters, owners);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  const expectedCapacity = battleStyle === "single" ? 1 : battleStyle === "double" ? 2 : 3;
  if (
    game.scene.currentBattle.arrangement.playerCapacity !== expectedCapacity
    || game.scene.currentBattle.arrangement.enemyCapacity !== expectedCapacity
  ) {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${battleStyle} topology was not launched`);
  }
  scenario.onBattleStart?.();
  return game;
}

function applyScenarioInitialState(game: GameManager, id: string): void {
  if (id === "existing-status-rejected") {
    const enemy = game.scene.getEnemyParty()[0];
    if (enemy == null) {
      gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, "status scenario has no enemy");
    }
    enemy.doSetStatus(StatusEffect.BURN);
  }
  if (id !== "pp-unusable-rejected") return;
  const lead = game.scene.getPlayerField(false)[0];
  const move = lead?.getMoveset()[0];
  if (lead == null || move == null) {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, "PP scenario has no observed lead move");
  }
  move.ppUsed = move.getMovePp();
}

/**
 * The M4 migration catalog observes permanent Pokémon fields that the live
 * scenario constructor may source from process-global generation seams before
 * the battle seed is installed. Normalize those fields at the test-only
 * capture boundary so two fresh exporter processes replay the same mechanics.
 */
function stabilizeMigrationRosters(game: GameManager): void {
  const rosters = [game.scene.getPlayerParty(), game.scene.getEnemyParty()];
  for (const roster of rosters) {
    for (const mon of roster) {
      const previousMaxHp = mon.getMaxHp();
      const previousHp = mon.hp;
      const hpRatio = previousMaxHp > 0 ? previousHp / previousMaxHp : 0;
      mon.ivs = [31, 31, 31, 31, 31, 31];
      mon.customPokemonData.nature = -1;
      mon.setNature(Nature.HARDY);
      mon.hp = previousHp === 0
        ? 0
        : Math.max(1, Math.min(mon.getMaxHp(), Math.round(mon.getMaxHp() * hpRatio)));
    }
  }
}

function ownerSeat(game: GameManager, mon: Pokemon, partyIndex: number, side: "PLAYER" | "ENEMY"): number | null {
  if (side === "ENEMY") return null;
  const capacity = game.scene.currentBattle.arrangement.playerCapacity;
  if (capacity === 1) return 1;
  if (capacity !== 2) {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `unsupported player capacity ${String(capacity)}`);
  }
  const role = (mon as AnyRecord).coopOwner;
  if (role !== "host" && role !== "guest") {
    gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `player party ${partyIndex} has no live coop owner`);
  }
  return role === "host" ? 1 : 2;
}
function permanentBonuses(game: GameManager, mon: Pokemon, side: "PLAYER" | "ENEMY"): { [key: string]: JsonValue } {
  const permanentClassNames = new Set([
    "BaseStatModifier",
    "PokemonBaseStatTotalModifier",
    "PokemonBaseStatFlatModifier",
    "PokemonIncrementingStatModifier",
  ]);
  const liveModifiers = game.scene.findModifiers(
    modifier =>
      (modifier as AnyRecord).pokemonId === mon.id
      && permanentClassNames.has((modifier as AnyRecord).constructor?.name),
    side === "PLAYER",
  );
  if (liveModifiers.length !== 0) {
    gap(
      "LIVE_M3_COMPANIONS_UNOBSERVABLE",
      "src/battle-scene.ts:findModifiers",
      "non-empty permanent stat bonus set lacks an exact M3 projection",
    );
  }
  return { hp: 0, attack: 0, defense: 0, special_attack: 0, special_defense: 0, speed: 0 };
}

interface StableIdentity {
  readonly pokemonId: number;
  readonly stableIndex: number;
}

function identities(party: readonly Pokemon[], nextId: { value: number }): { byPokemon: WeakMap<object, StableIdentity>; order: number[] } {
  const byPokemon = new WeakMap<object, StableIdentity>();
  const order: number[] = [];
  party.forEach((mon, stableIndex) => {
    const pokemonId = nextId.value++;
    byPokemon.set(mon, { pokemonId, stableIndex });
    order.push(pokemonId);
  });
  return { byPokemon, order };
}

function captureCompanions(
  game: GameManager,
  stateSide: "INITIAL" | "FINAL",
  player: readonly Pokemon[],
  enemy: readonly Pokemon[],
  playerIds: WeakMap<object, StableIdentity>,
  enemyIds: WeakMap<object, StableIdentity>,
): CompanionRecord[] {
  const capture = (
    party: readonly Pokemon[],
    side: "PLAYER" | "ENEMY",
    ids: WeakMap<object, StableIdentity>,
  ): CompanionRecord[] =>
    party.map((mon, sourcePartyIndex) => {
      const identity = ids.get(mon);
      if (identity == null) {
        gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${stateSide} ${side} roster contains an unknown live Pokemon`);
      }
      if (!Array.isArray(mon.ivs) || mon.ivs.length !== 6) {
        gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${stateSide} ${side} Pokemon ${identity.pokemonId} lacks six IVs`);
      }
      const ivs = mon.ivs.map((iv, index) => safeInteger(iv, `${stateSide}.${side}[${sourcePartyIndex}].ivs[${index}]`));
      if (ivs.some(iv => iv < 0 || iv > 31)) {
        gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${stateSide} ${side} Pokemon ${identity.pokemonId} has an invalid IV`);
      }
      const livePauseEvolutions = (mon as AnyRecord).pauseEvolutions;
      const serializedPauseEvolutions = new PokemonData(mon).pauseEvolutions;
      const pauseEvolutions = typeof livePauseEvolutions === "boolean"
        ? livePauseEvolutions
        : serializedPauseEvolutions;
      if (typeof pauseEvolutions !== "boolean") {
        gap(
          "CANONICAL_STATE_UNOBSERVABLE",
          "src/system/pokemon-data.ts:PokemonData.pauseEvolutions",
          `${stateSide} ${side} Pokemon ${identity.pokemonId} lacks canonical pauseEvolutions`,
        );
      }
      const nature = safeInteger(mon.nature, `${stateSide}.${side}[${sourcePartyIndex}].nature`);
      const effectiveNature = safeInteger(mon.getNature(), `${stateSide}.${side}[${sourcePartyIndex}].effective_nature`);
      return {
        fixture_id: "",
        state_side: stateSide,
        party_side: side,
        pokemon_id: identity.pokemonId,
        source_party_index: sourcePartyIndex,
        stable_roster_index: identity.stableIndex,
        owner_seat: ownerSeat(game, mon, sourcePartyIndex, side),
        experience: finiteNumber(mon.exp, `${stateSide}.${side}[${sourcePartyIndex}].experience`),
        growth_rate: safeInteger((mon.species as AnyRecord).growthRate, `${stateSide}.${side}[${sourcePartyIndex}].growth_rate`),
        ivs,
        nature,
        effective_nature: effectiveNature,
        friendship: finiteNumber(mon.friendship, `${stateSide}.${side}[${sourcePartyIndex}].friendship`),
        permanent_bonuses: permanentBonuses(game, mon, side),
        pause_evolutions: pauseEvolutions,
      };
    });
  return [...capture(player, "PLAYER", playerIds), ...capture(enemy, "ENEMY", enemyIds)];
}

function captureBattleCompanion(
  game: GameManager,
  fixtureId: string,
  stateSide: "INITIAL" | "FINAL",
  player: readonly Pokemon[],
  enemy: readonly Pokemon[],
  playerIds: WeakMap<object, StableIdentity>,
  enemyIds: WeakMap<object, StableIdentity>,
  sourceBattleId: number,
): BattleCompanionRecord {
  const battle = game.scene.currentBattle as AnyRecord;
  const playerByLiveId = new Map<number, Pokemon>();
  for (const mon of player) {
    const liveId = safeInteger(mon.id, `${fixtureId}.${stateSide}.PLAYER.id`);
    if (playerByLiveId.has(liveId)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${fixtureId} has duplicate live player id ${String(liveId)}`);
    }
    playerByLiveId.set(liveId, mon);
  }
  const participantSource = battle.playerParticipantIds;
  if (!(participantSource instanceof Set)) {
    gap("CANONICAL_STATE_UNOBSERVABLE", "src/battle.ts:Battle.playerParticipantIds", `${fixtureId} ${stateSide} participants are not a live Set`);
  }
  const playerParticipants: number[] = [];
  const participantIds = new Set<number>();
  for (const rawLiveId of participantSource as Set<unknown>) {
    const liveId = safeInteger(rawLiveId, `${fixtureId}.${stateSide}.participation.player_participants`);
    const mon = playerByLiveId.get(liveId);
    if (mon == null) {
      gap(
        "CANONICAL_STATE_UNOBSERVABLE",
        "src/battle.ts:Battle.playerParticipantIds",
        `${fixtureId} ${stateSide} participant ${String(liveId)} is not in the live player roster`,
      );
    }
    const identity = playerIds.get(mon);
    if (identity == null) {
      gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${fixtureId} ${stateSide} participant has no stable identity`);
    }
    if (participantIds.has(identity.pokemonId)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", "src/battle.ts:Battle.playerParticipantIds", `${fixtureId} has duplicate participant identity`);
    }
    participantIds.add(identity.pokemonId);
    playerParticipants.push(identity.pokemonId);
  }
  const faintSource = battle.enemyFaintsHistory;
  if (!Array.isArray(faintSource)) {
    gap("CANONICAL_STATE_UNOBSERVABLE", "src/battle.ts:Battle.enemyFaintsHistory", `${fixtureId} ${stateSide} enemy faint history is not an array`);
  }
  const defeatedEnemies: DefeatedEnemyRecord[] = [];
  const defeatedIds = new Set<number>();
  for (const [index, entry] of (faintSource as unknown[]).entries()) {
    const fainted = entry != null && typeof entry === "object" ? (entry as AnyRecord).pokemon : undefined;
    if (fainted == null || typeof fainted !== "object") {
      gap(
        "CANONICAL_STATE_UNOBSERVABLE",
        "src/battle.ts:Battle.enemyFaintsHistory",
        `${fixtureId} ${stateSide} enemy faint ${String(index)} has no live Pokemon`,
      );
    }
    const identity = enemyIds.get(fainted);
    if (identity == null) {
      gap(
        "CANONICAL_STATE_UNOBSERVABLE",
        "src/battle.ts:Battle.enemyFaintsHistory",
        `${fixtureId} ${stateSide} enemy faint ${String(index)} has no stable identity`,
      );
    }
    if (defeatedIds.has(identity.pokemonId)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", "src/battle.ts:Battle.enemyFaintsHistory", `${fixtureId} repeats defeated enemy identity`);
    }
    defeatedIds.add(identity.pokemonId);
    defeatedEnemies.push({ pokemon: identity.pokemonId, owner_seat: null });
  }
  const scatteredMoney = safeInteger(battle.moneyScattered, `${fixtureId}.${stateSide}.settlement.scattered_money`);
  if (scatteredMoney < 0) {
    gap("CANONICAL_STATE_UNOBSERVABLE", "src/battle.ts:Battle.moneyScattered", `${fixtureId} has negative scattered money`);
  }
  return {
    fixture_id: fixtureId,
    state_side: stateSide,
    participation: {
      player_participants: playerParticipants,
      defeated_enemies: defeatedEnemies,
    },
    settlement: {
      source_battle_id: sourceBattleId,
      settled: false,
      scattered_money: scatteredMoney,
      wave_reward_evidence: [],
    },
  };
}

function fillFixtureIds(companions: CompanionRecord[], fixtureId: string): void {
  for (const companion of companions) companion.fixture_id = fixtureId;
}

async function waitForUiMode(game: GameManager, mode: UiMode, context: string): Promise<void> {
  try {
    await vi.waitUntil(() => game.scene.ui.getMode() === mode, { interval: 5, timeout: 5_000 });
  } catch {
    gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, `${context} did not reach ${UiMode[mode]}`);
  }
}

function registerReplacementPrompt(game: GameManager): void {
  game.onNextPrompt("SwitchPhase", UiMode.PARTY, () => {
    const phase = game.scene.phaseManager.getCurrentPhase() as AnyRecord;
    const fieldIndex = phase.fieldIndex;
    const field = game.scene.getPlayerField(false)[fieldIndex];
    const owner = field == null || game.scene.currentBattle.arrangement.playerCapacity === 1
      ? 1
      : (field as AnyRecord).coopOwner === "guest" ? 2 : 1;
    const battlerCount = game.scene.currentBattle.getBattlerCount();
    const slot = game.scene.getPlayerParty().findIndex(
      (mon, index) => index >= battlerCount && index < 6 && mon.isAllowedInBattle()
        && (game.scene.currentBattle.arrangement.playerCapacity === 1
          || ((mon as AnyRecord).coopOwner === (owner === 1 ? "host" : "guest"))),
    );
    if (slot < 0) {
      gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `replacement field ${String(fieldIndex)} has no live candidate`);
    }
    const handler = game.scene.ui.getHandler() as AnyRecord;
    if (typeof handler.setCursor !== "function" || typeof handler.processInput !== "function") {
      gap("OBSERVATION_SEAM_MISSING", "src/ui/handlers/party-ui-handler.ts", "replacement party handler is not actionable");
    }
    handler.setCursor(slot);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
  });
}

async function admitPlayerCommands(game: GameManager, id: string): Promise<void> {
  const field = game.scene.getPlayerField(false);
  const select = (mon: Pokemon, battlerIndex: number): void => {
    const move = mon.getMoveset()[0];
    if (move == null) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, `player field ${String(battlerIndex)} has no move`);
    }
    // Queue the production command and target prompts exactly as the M3
    // exporter does.  The subsequent EnemyCommandPhase request then runs this
    // live CommandPhase through its ordinary UI boundary.
    game.move.select(move.moveId, battlerIndex as BattlerIndex);
  };
  if (id === "pp-unusable-rejected") {
    const lead = field[0];
    const exhausted = lead?.getMoveset()[0];
    const fallback = lead?.getMoveset()[1];
    if (lead == null || exhausted == null || fallback == null || exhausted.ppUsed !== exhausted.getMovePp()) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, "PP rejection fixture lacks an exhausted live move");
    }
    if (game.scene.ui.getMode() !== UiMode.COMMAND) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, "PP rejection did not begin at COMMAND");
    }
    lead.trySelectMove(0);
    game.scene.ui.setCursor(Command.FIGHT);
    if (!game.scene.ui.processInput(Button.ACTION)) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, "PP rejection Fight menu did not open");
    }
    await waitForUiMode(game, UiMode.FIGHT, "opening PP rejection Fight menu");
    game.scene.ui.setCursor(0);
    if (game.scene.ui.processInput(Button.ACTION)) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, "PP rejection accepted an exhausted move");
    }
    if (game.scene.ui.getMode() === UiMode.MESSAGE) {
      const message = game.scene.ui.getMessageHandler() as AnyRecord;
      if (typeof message.isAwaitingPromptAction === "function") {
        await vi.waitUntil(() => message.isAwaitingPromptAction() || game.scene.ui.getMode() === UiMode.FIGHT, { interval: 5, timeout: 5_000 });
        if (game.scene.ui.getMode() === UiMode.MESSAGE) game.scene.ui.processInput(Button.ACTION);
      }
    }
    await waitForUiMode(game, UiMode.FIGHT, "returning from PP rejection message");
    if (!game.scene.ui.processInput(Button.RIGHT) || !game.scene.ui.processInput(Button.ACTION)) {
      gap("COMMAND_UNOBSERVABLE", M3_CASE_SEAM, "PP fallback move was not admitted");
    }
    return;
  }
  if (id === "voluntary-switch") {
    // In a double battle party slots 0 and 1 are active; queue the observed
    // bench switch before the partner's production move command.
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
    if (mon == null || mon.isFainted()) continue;
    const target = targets[index] != null && !targets[index].isFainted() ? targets[index].getBattlerIndex() : BattlerIndex.PLAYER;
    await game.move.selectEnemyMove(MoveId.POUND, target);
  }
}

function releaseGame(game: GameManager): void {
  clearInterval(PromptHandler.runInterval);
  PromptHandler.runInterval = undefined;
  game.promptHandler.clearPrompts();
  const ui = game.scene.ui as AnyRecord;
  if (typeof ui.setModeInternal?.mockRestore === "function") ui.setModeInternal.mockRestore();
  if (typeof ui.shouldSkipDialogue?.mockRestore === "function") ui.shouldSkipDialogue.mockRestore();
  BattleScene.prototype.randBattleSeedInt = originalBattleSeedInt;
}

async function captureCase(
  id: string,
  phaserGame: Phaser.Game,
): Promise<{
  initial: CompanionRecord[];
  final: CompanionRecord[];
  initialBattle: BattleCompanionRecord;
  finalBattle: BattleCompanionRecord;
  playerOrder: number[];
  enemyOrder: number[];
}> {
  const canonical = canonicalFixtureEvidence(id);
  const spec = scenarioFor(id);
  const game = await launchScenario(spec, phaserGame);
  try {
    stabilizeMigrationRosters(game);
    applyScenarioInitialState(game, id);
    const playerInitial = game.scene.getPlayerParty().slice();
    const enemyInitial = game.scene.getEnemyParty().slice();
    const nextId = { value: 1 };
    const playerIdentity = identities(playerInitial, nextId);
    const enemyIdentity = identities(enemyInitial, nextId);
    const initial = captureCompanions(game, "INITIAL", playerInitial, enemyInitial, playerIdentity.byPokemon, enemyIdentity.byPokemon);
    fillFixtureIds(initial, id);
    const initialBattle = captureBattleCompanion(
      game,
      id,
      "INITIAL",
      playerInitial,
      enemyInitial,
      playerIdentity.byPokemon,
      enemyIdentity.byPokemon,
      canonical.sourceBattleId,
    );
    await admitPlayerCommands(game, id);
    if (id === "forced-replacement" || id === "same-side-simultaneous-faint" || id === "mixed-side-simultaneous-faint") {
      registerReplacementPrompt(game);
    }
    await admitEnemyCommands(game);
    const settledBoundary = await game.phaseInterceptor.toFirst(["TurnEndPhase", "VictoryPhase", "GameOverPhase"]);
    if (settledBoundary === "TurnEndPhase") await game.toEndOfTurn();
    if (!game.isVictory() && !game.scene.getPlayerParty().every(mon => mon.isFainted())) await game.toNextTurn();
    const playerFinal = game.scene.getPlayerParty().slice();
    const enemyFinal = game.scene.getEnemyParty().slice();
    const final = captureCompanions(game, "FINAL", playerFinal, enemyFinal, playerIdentity.byPokemon, enemyIdentity.byPokemon);
    fillFixtureIds(final, id);
    const finalBattle = captureBattleCompanion(
      game,
      id,
      "FINAL",
      playerFinal,
      enemyFinal,
      playerIdentity.byPokemon,
      enemyIdentity.byPokemon,
      canonical.sourceBattleId,
    );
    const playerOrder = playerInitial.map(mon => playerIdentity.byPokemon.get(mon)!.pokemonId);
    const enemyOrder = enemyInitial.map(mon => enemyIdentity.byPokemon.get(mon)!.pokemonId);
    const expectedFinal = id === "mixed-side-simultaneous-faint" ? [2, 1] : id === "voluntary-switch" || id === "forced-replacement" ? [3, 2, 1] : playerOrder;
    const observedFinal = playerFinal.map(mon => playerIdentity.byPokemon.get(mon)?.pokemonId ?? -1);
    if (REORDERED_CASES[id] === true && JSON.stringify(observedFinal) !== JSON.stringify(expectedFinal)) {
      gap("CANONICAL_STATE_UNOBSERVABLE", M3_CASE_SEAM, `${id} did not expose the expected live reordered roster`);
    }
    return { initial, final, initialBattle, finalBattle, playerOrder, enemyOrder };
  } finally {
    releaseGame(game);
  }
}

export async function captureMigrationCompanions(): Promise<Record<string, JsonValue>> {
  if (CASE_IDS.length !== 38) {
    gap("EXPORT_CONFIGURATION", M3_CASE_SEAM, `expected 38 M3 cases, found ${CASE_IDS.length}`);
  }
  let phaserGame: Phaser.Game;
  try {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
    const boot = Promise.withResolvers<void>();
    setTimeout(boot.resolve, 0);
    await boot.promise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", "phaser:Phaser.Game", `live M3 Phaser construction failed: ${detail}`);
  }
  const companions: CompanionRecord[] = [];
  const battleCompanions: BattleCompanionRecord[] = [];
  const cases: CompanionCaseRecord[] = [];
  try {
    for (const fixtureId of CASE_IDS) {
      const captured = await captureCase(fixtureId, phaserGame);
      companions.push(...captured.initial, ...captured.final);
      battleCompanions.push(captured.initialBattle, captured.finalBattle);
      cases.push({
        fixture_id: fixtureId,
        initial_companion_count: captured.initial.length,
        final_companion_count: captured.final.length,
        player_stable_order: captured.playerOrder,
        enemy_stable_order: captured.enemyOrder,
      });
    }
  } finally {
    phaserGame.destroy(true);
    BattleScene.prototype.randBattleSeedInt = originalBattleSeedInt;
  }
  companions.sort((left, right) => {
    const fixtureOrder = CASE_IDS.findIndex(id => id === left.fixture_id)
      - CASE_IDS.findIndex(id => id === right.fixture_id);
    if (fixtureOrder !== 0) return fixtureOrder;
    const stateOrder = (left.state_side === "INITIAL" ? 0 : 1) - (right.state_side === "INITIAL" ? 0 : 1);
    if (stateOrder !== 0) return stateOrder;
    const partyOrder = (left.party_side === "PLAYER" ? 0 : 1) - (right.party_side === "PLAYER" ? 0 : 1);
    if (partyOrder !== 0) return partyOrder;
    return left.stable_roster_index - right.stable_roster_index;
  });
  battleCompanions.sort((left, right) => {
    const fixtureOrder = CASE_IDS.findIndex(id => id === left.fixture_id)
      - CASE_IDS.findIndex(id => id === right.fixture_id);
    if (fixtureOrder !== 0) return fixtureOrder;
    return (left.state_side === "INITIAL" ? 0 : 1) - (right.state_side === "INITIAL" ? 0 : 1);
  });
  if (cases.length !== 38) {
    gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `expected 38 live cases, captured ${cases.length}`);
  }
  for (const [index, entry] of cases.entries()) {
    if (
      entry.fixture_id !== CASE_IDS[index]
      || entry.initial_companion_count <= 0
      || entry.final_companion_count <= 0
    ) {
      gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `case ${String(index)} lacks complete initial/final coverage`);
    }
  }
  const expectedCompanions = cases.reduce(
    (count, companionCase) =>
      count + companionCase.initial_companion_count + companionCase.final_companion_count,
    0,
  );
  if (companions.length !== expectedCompanions) {
    gap(
      "LIVE_M3_COMPANIONS_UNOBSERVABLE",
      M3_CASE_SEAM,
      `companion cardinality ${companions.length} does not equal live state cardinality ${expectedCompanions}`,
    );
  }
  const companionKeys = new Set<string>();
  for (const companion of companions) {
    const key = `${companion.fixture_id}:${companion.state_side}:${companion.party_side}:${companion.pokemon_id}`;
    if (companionKeys.has(key)) {
      gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `duplicate companion key ${key}`);
    }
    companionKeys.add(key);
  }
  if (battleCompanions.length !== cases.length * 2) {
    gap(
      "LIVE_M3_COMPANIONS_UNOBSERVABLE",
      M3_CASE_SEAM,
      `battle companion cardinality ${battleCompanions.length} does not equal initial/final case cardinality ${cases.length * 2}`,
    );
  }
  const battleCompanionKeys = new Set<string>();
  for (const battleCompanion of battleCompanions) {
    const key = `${battleCompanion.fixture_id}:${battleCompanion.state_side}`;
    if (battleCompanionKeys.has(key)) {
      gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `duplicate battle companion key ${key}`);
    }
    battleCompanionKeys.add(key);
    if (
      battleCompanion.settlement.settled !== false
      || !Array.isArray(battleCompanion.settlement.wave_reward_evidence)
      || battleCompanion.settlement.wave_reward_evidence.length !== 0
    ) {
      gap("LIVE_M3_COMPANIONS_UNOBSERVABLE", M3_CASE_SEAM, `battle companion ${key} has invalid settlement evidence`);
    }
  }
  return jsonReady({
    artifact_id: "m3-to-m4-companions-v1",
    schema_version: 1,
    case_count: cases.length,
    companions,
    battle_companions: battleCompanions,
    cases,
  }) as Record<string, JsonValue>;
}
