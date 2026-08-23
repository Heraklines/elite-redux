/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// HEADLESS SCENARIO RUNNER (NOT a real test — a CLI-driven harness).
//
// Plays a dev `ScenarioSpec` through the REAL game logic (GameManager, all
// battle phases, ER abilities/moves/AI/RNG) with NO browser — fast, headless,
// and the game's own console output is captured to stdout. This is the same
// scenario format the in-game builder produces (`ERS1.` share codes), so a code
// pasted from a bug report reproduces the exact situation here.
//
// Drive it via the wrapper (preferred):
//   node scripts/run-scenario.mjs <ERS1-code | @path/to/spec.json | demo> [--turns N] [--move MOVE] [--waves N] [--real-rng]
// or directly:
//   ER_SCENARIO=1 ER_RUN_SCENARIO='ERS1....' npx vitest run test/tools/run-scenario.test.ts
//
// Env:
//   ER_RUN_SCENARIO   ERS1 share code, raw JSON, '@file.json', or 'demo'   (required)
//   ER_RUN_TURNS      max player turns to play per battle (default 5)
//   ER_RUN_MOVE       force the player to use this MoveId (number) or MoveId
//                     name every turn; omitted = the active mon's first usable move
//   ER_RUN_WAVES      play this many consecutive waves (drive the reward shop between)
//   ER_RUN_NO_MISS    force every move to hit
//   ER_RUN_NO_CRIT    force no crits (deterministic stat stages)
//   ER_RUN_REAL_RNG   restore the REAL seeded randBattleSeedInt (probabilistic procs)
//                     instead of the deterministic max-roll clamp GameManager installs
//
// SCRIPTING the player, per turn, per field slot (slot 1 = `*2`, slot 2 = `*3`):
//   move/target        a MoveId (number or enum name) + BattlerIndex target (2/3 = enemy)
//   tera:true          the acting slot Terastallizes on this turn's move
//   switch:<partyIdx>  voluntary switch to a bench mon (real Command path)
//   ball:"<POKEBALL>"  throw a poke ball (capture attempt)
//   run:true           flee attempt
//   enemyMove/enemyTarget (+ *2/*3)   force the enemy slot(s) to use a move this turn
//   Scripted moves ALREADY in the mon's real moveset route through the non-destructive
//   `select` path so PP depletes naturally; a move NOT in the moveset falls back to `use`
//   (which splices it in, replacing that mon's moveset — noted in the turn log).
//
// MULTI-WAVE (`run.waves` / --waves): after a wave is won the runner drives the
// reward shop headlessly (picks `rewards[wave]` — a `modifierTypes` key, "FIRST",
// or "SKIP" — else the FIRST option), declines any level-up move-learn (unless
// `learnMove:{slot}`), lets evolutions run, then continues into the next wave.
//
// A note on CUSTOM ENEMY PARTIES (`enemy.kind:"party"`): per-mon `status` /
// `bossSegments` / `heldItems` are applied on the spawned mons; ability / passive
// are SIDE-WIDE overrides (they read off the first custom mon and hit every foe).
//
// Output: a `=== TURN n ===` block per turn with a `STATE { ... }` snapshot
// (each side's hp / status / stat stages / ability + the weather), the game's
// own log lines interleaved, then a final `RESULT { ... }`. Any thrown error or
// phase-advance timeout (a soft-lock / freeze) fails the run with a nonzero exit
// and the full console, so a hang is caught immediately, not stared at.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { setPendingDevPartySetup, setPendingDevShop } from "#app/dev-tools/registry";
import {
  type BiomeShopVisit,
  buildDevScenario,
  decodeScenarioSpec,
  describeScenarioSpec,
  type OnCatchFull,
  type ScenarioSpec,
  type SpecMon,
} from "#app/dev-tools/test-suite/scenario-spec";
import { getGameMode } from "#app/game-mode";
import Overrides from "#app/overrides";
import { allMoves } from "#data/data-lists";
import { Egg } from "#data/egg";
import {
  ER_ANNEAL_ABILITY_ID,
  ER_BOOT_HILL_ABILITY_ID,
  ER_CENTER_OF_ATTENTION_ABILITY_ID,
  ER_CRACKED_VESSEL_ABILITY_ID,
  ER_DEADEYE_DRAW_ABILITY_ID,
  ER_ECLIPSE_WING_ABILITY_ID,
  ER_ENCORE_SET_ABILITY_ID,
  ER_FAN_FAVORITE_ABILITY_ID,
  ER_FINAL_SEASON_ABILITY_ID,
  ER_FOUL_HARVEST_ABILITY_ID,
  ER_GILLIE_SUIT_ABILITY_ID,
  ER_GLAM_ROCK_ABILITY_ID,
  ER_HEAVYWEIGHT_ABILITY_ID,
  ER_LIVING_CHROME_ABILITY_ID,
  ER_POROUS_ABILITY_ID,
  ER_REDUCTION_ABILITY_ID,
  ER_RING_GENERAL_ABILITY_ID,
  ER_SEDIMENT_BLOOM_ABILITY_ID,
  ER_SETLIST_ABILITY_ID,
  ER_SKYHOOK_ABILITY_ID,
  ER_SPIRIT_PUNCH_ABILITY_ID,
  ER_SUPEREGO_ABILITY_ID,
  ER_TWO_FACED_UNLEASHED_ABILITY_ID,
  ER_VAPOR_BODY_ABILITY_ID,
} from "#data/elite-redux/abilities/newcomer-signature-abilities";
import {
  applyGraveMarkerOnEntry,
  foulHarvestCharges,
  hasEffectiveMoveTrap,
  porousCharges,
  recordLivingChromeTransformation,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { isInnateSlotSuppressed } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import {
  captureCommittedCombatDecision,
  findCommittedCombatCandidate,
  perspectiveTargetRef,
  sameTargetSet,
} from "#data/elite-redux/ai/combat-committed-action";
import {
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatCandidate,
  type ErCombatDatasetRecord,
  type ErCombatDecisionRecord,
  type ErCombatMoveCandidate,
  type ErCombatPolicySource,
  type ErCombatTargetRef,
} from "#data/elite-redux/ai/combat-contract";
import {
  type ErCombatEarlierChoice,
  enumerateErCombatCandidates,
  snapshotErCombatObservation,
} from "#data/elite-redux/ai/combat-engine-adapter";
import {
  ER_COMBAT_FEATURE_NAMES,
  extractErCombatCandidateFeatures,
  extractErCombatCandidateTokenGroups,
} from "#data/elite-redux/ai/combat-features";
import {
  type ErTreeModelArtifact,
  scoreErTreeModel,
  validateErTreeModel,
} from "#data/elite-redux/ai/combat-tree-model";
import { getErPendingNodes, resetErRouting, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { ER_DOOMED_SWITCH_THRESHOLD_MULT, erAssessThreat, getErAiProfile } from "#data/elite-redux/er-enemy-ai";
import { getFunModeConfig, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import { resetMoodyEnemyBoonLoadout, setMoodyEnemyBoonLoadout } from "#data/elite-redux/moody/moody-enemy";
import { queryMoodySceneEffects } from "#data/elite-redux/moody/moody-scene-adapter";
import {
  createMoodyModeState,
  getMoodyModeSaveData,
  resetMoodyModeState,
  restoreMoodyModeState,
} from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import {
  clearTournamentMatchContext,
  isTournamentMatch,
  setTournamentMatchContext,
} from "#data/elite-redux/showdown/tournament-match-context";
import { isCurrentPlayerTelemetryBattleEligible } from "#data/elite-redux/telemetry/telemetry-hooks";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { EggSourceType } from "#enums/egg-source-types";
import { ErAbilityId } from "#enums/er-ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type EffectiveStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { EnemyPokemon, type Pokemon } from "#field/pokemon";
import { Move } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import type { CommandPhase } from "#phases/command-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { SelectTargetPhase } from "#phases/select-target-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { AiNeuralPolicyClient } from "#test/tools/ai-neural-policy-client";
import type { TurnMove } from "#types/turn-move";
import type { AbstractOptionSelectUiHandler } from "#ui/handlers/abstract-option-select-ui-handler";
import type { BiomeShopUiHandler } from "#ui/handlers/biome-shop-ui-handler";
import type { ErMapUiHandler } from "#ui/handlers/er-map-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyOption, type PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A turn action for the optional `script`: which move each active player mon uses
// this turn (slot 0 = `move`, slot 1 = `move2`, slot 2 = `move3`), an optional
// target BattlerIndex (0/1 player, 2/3 enemy), and per-slot alternatives to a
// move (switch / ball / run / tera). Also per-turn enemy move forcing.
interface TurnAction {
  move?: number | string;
  target?: number;
  /** The acting slot-0 mon Terastallizes on this move. */
  tera?: boolean;
  /** Voluntary switch this turn: the 0-indexed party slot to send in (real Command path). */
  switch?: number;
  /** Internal policy adapter detail: use the held Baton transfer instead of a normal switch. */
  switchTransfer?: "normal" | "baton";
  /** Throw a poke ball this turn (PokeballType number or enum name). */
  ball?: number | string;
  /** Flee attempt this turn. */
  run?: boolean;
  /** Double: the 2nd (RIGHT) player mon's action. */
  move2?: number | string;
  target2?: number;
  tera2?: boolean;
  switch2?: number;
  switch2Transfer?: "normal" | "baton";
  ball2?: number | string;
  run2?: boolean;
  /** Triple: the 3rd player mon's action. */
  move3?: number | string;
  target3?: number;
  tera3?: boolean;
  switch3?: number;
  switch3Transfer?: "normal" | "baton";
  ball3?: number | string;
  run3?: boolean;
  /** Force the enemy slot(s) to use this move (+ target) this turn (2/3 = player targets). */
  enemyMove?: number | string;
  enemyTarget?: number;
  enemyMove2?: number | string;
  enemyTarget2?: number;
  enemyMove3?: number | string;
  enemyTarget3?: number;
}

// A declarative self-check block. Every field is optional; each that's set is
// asserted against the final state / accumulated events. HP checks take a number
// (exact) or {min?,max?,equals?}. `logIncludes`/`logExcludes` match the battle
// message log (case-insensitive substring) — the swiss-army assertion.
type HpCheck = number | { min?: number; max?: number; equals?: number };
interface PartyProgressCheck {
  slot: number;
  species?: string;
  level?: HpCheck;
  exp?: HpCheck;
  heldItems?: string[];
  heldItemsAbsent?: string[];
}
interface ExpectSpec {
  outcome?: string;
  playerFainted?: boolean;
  enemyFainted?: boolean;
  playerStatus?: string;
  enemyStatus?: string;
  /** Active ability display-name (case-insensitive substring) — verifies an ability override. */
  playerAbility?: string;
  enemyAbility?: string;
  playerAbilitySuppressed?: boolean;
  enemyAbilitySuppressed?: boolean;
  playerHp?: HpCheck;
  enemyHp?: HpCheck;
  playerDamaged?: boolean;
  enemyDamaged?: boolean;
  playerStage?: { stat: string; value: number };
  enemyStage?: { stat: string; value: number };
  playerEffectiveStat?: { stat: string; value: HpCheck };
  enemyEffectiveStat?: { stat: string; value: HpCheck };
  playerTransformed?: boolean;
  enemyTransformed?: boolean;
  /** Battle/entry lifecycle tokens used by once-per-battle ability windows. */
  playerEntryEffectsFired?: string[];
  playerAbilityEntryWindows?: string[];
  playerAbilityEntryWindowsAbsent?: string[];
  /** Per-slot state for the 2nd / 3rd mon on each side, by field slot (LEFT/CENTRE/RIGHT). */
  player2Hp?: HpCheck;
  player2Status?: string;
  player2Fainted?: boolean;
  player3Hp?: HpCheck;
  player3Status?: string;
  player3Fainted?: boolean;
  enemy2Hp?: HpCheck;
  enemy2Status?: string;
  enemy2Fainted?: boolean;
  enemy3Hp?: HpCheck;
  enemy3Status?: string;
  enemy3Fainted?: boolean;
  /** Triple: stat-stage checks on the 2nd/3rd mon of each side, by field slot (LEFT/CENTRE/RIGHT). */
  player2Stage?: { stat: string; value: number };
  player3Stage?: { stat: string; value: number };
  enemy2Stage?: { stat: string; value: number };
  enemy3Stage?: { stat: string; value: number };
  weather?: string;
  terrain?: string;
  terrainTurnsLeft?: HpCheck;
  /** Side-specific arena tags that MUST be present or absent (ArenaTagType enum names). */
  playerArenaTags?: string[];
  playerArenaTagsAbsent?: string[];
  enemyArenaTags?: string[];
  enemyArenaTagsAbsent?: string[];
  /** ER innate slots (zero-based) that must be disabled until switch. */
  playerInnateSlotsSuppressed?: number[];
  enemyInnateSlotsSuppressed?: number[];
  maxHits?: HpCheck;
  logIncludes?: string[];
  logExcludes?: string[];
  /** Moves (enum names) the enemy is expected to have used, in order (ordered-subsequence match). */
  enemyUsedMoves?: string[];
  /** Battler/ER-status tags that MUST be present on the lead mon (enum names, e.g. "ER_FROSTBITE"). */
  playerTags?: string[];
  enemyTags?: string[];
  /** Battler/ER-status tags that MUST be absent on the lead mon. */
  playerTagsAbsent?: string[];
  enemyTagsAbsent?: string[];
  /** Nature display names on the active lead Pokémon. */
  playerNature?: string;
  enemyNature?: string;
  /** Required / forbidden held-item display-name substrings on the active leads. */
  playerHeldItems?: string[];
  playerHeldItemsAbsent?: string[];
  enemyHeldItems?: string[];
  enemyHeldItemsAbsent?: string[];
  /** Current run money and per-party-slot progression. */
  money?: HpCheck;
  partyProgress?: PartyProgressCheck[];
  /** Current Poké Ball inventory by PokeballType enum name. */
  pokeballs?: Record<string, HpCheck>;
  /** Last generated revealed ER map destinations, in display enum-name order. */
  biomeOptions?: string[];
  biomeOptionCount?: HpCheck;
}

// The runner accepts a superset of ScenarioSpec: the extra `script` / `expect` /
// `learnMove` are runner-only (the in-game launch + `ERS1.` codes ignore them).
type RunnerInput = ScenarioSpec & {
  script?: TurnAction[];
  expect?: ExpectSpec;
  /** Multi-wave: on a level-up move-learn, forget this moveset slot (else decline). */
  learnMove?: { slot: number };
};

interface CombatBatchEpisode {
  id: string;
  splitGroupId?: string;
  sourcePartitionId?: string;
  scenario: RunnerInput;
}

interface CombatBatchInput {
  version: 1;
  episodes: CombatBatchEpisode[];
}

/** Per-launch determinism / RNG knobs. */
interface LaunchOpts {
  noMiss?: boolean;
  noCrit?: boolean;
  realRng?: boolean;
  minRng?: boolean;
  /** Drive mandatory replacement menus opened by battle-entry effects before the first command. */
  driveEntryMenus?: boolean;
}

/** Per-run scripting knobs (parameterized so both the env path and the self-checks reuse the pipeline). */
interface PlayOpts {
  script?: TurnAction[] | undefined;
  forcedMove?: MoveId | null;
  maxTurns: number;
  waves: number;
  rewards?: string[] | undefined;
  learnMove?: { slot: number } | undefined;
}

// A ready-made smoke scenario so `... demo` runs out of the box: a real headless
// battle (Snorlax vs a wild Snorlax, both lv100) playing Tackle for a couple of
// turns. Proves the pipeline (start -> turns -> state + console), not any
// specific mechanic — point it at a real `ERS1.` code for that.
// (Declared BEFORE the module-scope resolveSpec(RAW) call below - a `const` after
// it is in temporal-dead-zone when ER_RUN_SCENARIO=demo resolves at load.)
const DEMO_SPEC: ScenarioSpec = {
  v: 1,
  name: "harness smoke test",
  notes: "Snorlax vs wild Snorlax, lv100, trading Tackle. Proves the harness plays a real battle headlessly.",
  run: { level: 100, difficulty: "ace" },
  party: [{ species: 143 /* SNORLAX */, moves: [MoveId.TACKLE] }],
  enemy: { kind: "wild", wild: { species: 143 /* SNORLAX */, level: 100, moves: [MoveId.TACKLE] } },
};

const RAW = (process.env.ER_RUN_SCENARIO ?? "").trim();
const COMBAT_BATCH = resolveCombatBatch((process.env.ER_RUN_COMBAT_BATCH ?? "").trim());
const INPUT = COMBAT_BATCH?.episodes[0]?.scenario ?? resolveSpec(RAW);
mergePolicyOverride(INPUT); // shallow-merge a `--policy @file.json` blob over the spec
normalizeSpec(INPUT); // resolve any enum NAMES (species/ability/move/…) to ids
for (const episode of COMBAT_BATCH?.episodes ?? []) {
  normalizeSpec(episode.scenario);
}
const SPEC: ScenarioSpec | null = INPUT;
const SCRIPT = INPUT?.script;
const EXPECT = INPUT?.expect;
const LEARN_MOVE = INPUT?.learnMove;
const FORCED_MOVE = parseForcedMove(process.env.ER_RUN_MOVE);
const NO_MISS = process.env.ER_RUN_NO_MISS === "1"; // force every move to hit
const NO_CRIT = process.env.ER_RUN_NO_CRIT === "1"; // force no crits (deterministic stages)
const REAL_RNG = process.env.ER_RUN_REAL_RNG === "1"; // restore the real seeded battle RNG
const TO_END = process.env.ER_RUN_TO_END === "1"; // play until victory / game-over
const QUIET = process.env.ER_RUN_QUIET === "1"; // suppress per-turn STATE spam
const AUTO_FIRST = process.env.ER_RUN_AUTO_FIRST === "1"; // press through unknown menus (option 0 / cancel)
const JSON_OUT = (process.env.ER_RUN_JSON_OUT ?? "").trim(); // machine-readable result path
const AI_DATA_OUT = (process.env.ER_RUN_AI_DATA_OUT ?? "").trim();
const RESUME_COMBAT_BATCH = process.env.ER_RUN_RESUME_COMBAT_BATCH === "1";
const AI_RECORD_ENGINE_BASELINE =
  process.env.ER_AI_RECORD_ENGINE_BASELINE === "1" || process.env.ER_AI_RECORD_ENGINE_TEACHER === "1";
const AI_BUILD_SHA = (process.env.ER_AI_BUILD_SHA ?? process.env.GITHUB_SHA ?? "local").trim();
const AI_DEX_HASH = (process.env.ER_AI_DEX_HASH ?? "unknown").trim();
const AI_DICTIONARY_HASH = (process.env.ER_AI_DICTIONARY_HASH ?? "unknown").trim();
let activeAiEpisodeId = (process.env.ER_AI_EPISODE_ID ?? INPUT?.run?.seed ?? "local-episode").trim();
let activeAiSplitGroupId = activeAiEpisodeId;
let activeAiSourcePartitionId = activeAiSplitGroupId;
let enginePlayerSwitchCounter = 0;
const AI_DATASET_RECORDS: ErCombatDatasetRecord[] = [];
const AI_ENGINE_BASELINE_KNOWN_OPPONENT_IDS = new Set<number>();
const AI_CUSTOM_OPPONENT_KNOWN_PLAYER_IDS = new Set<number>();
const AI_MODEL_PATH = (process.env.ER_AI_POLICY_MODEL ?? "").trim();
const AI_NEURAL_MODEL_DIR = (process.env.ER_AI_NEURAL_POLICY_MODEL ?? "").trim();
const AI_POLICY_MODE = (process.env.ER_AI_POLICY_MODE ?? "first-usable").trim();
const AI_POLICY_EPSILON = Number(process.env.ER_AI_POLICY_EPSILON ?? "0");
const AI_POLICY_SOURCE_OVERRIDE = (process.env.ER_AI_POLICY_SOURCE ?? "").trim();
const AI_POLICY_TARGET_OVERRIDE = (process.env.ER_AI_POLICY_TARGET ?? "").trim();
const AI_OPPONENT_MODEL_PATH = (process.env.ER_AI_OPPONENT_POLICY_MODEL ?? "").trim();
const AI_OPPONENT_NEURAL_MODEL_DIR = (process.env.ER_AI_OPPONENT_NEURAL_POLICY_MODEL ?? "").trim();
const AI_OPPONENT_POLICY_MODE = (process.env.ER_AI_OPPONENT_POLICY_MODE ?? "engine-hardest").trim();
const AI_OPPONENT_POLICY_EPSILON = Number(process.env.ER_AI_OPPONENT_POLICY_EPSILON ?? "0");
const AI_OPPONENT_POLICY_SOURCE_OVERRIDE = (process.env.ER_AI_OPPONENT_POLICY_SOURCE ?? "").trim();
const AI_OPPONENT_POLICY_TARGET_OVERRIDE = (process.env.ER_AI_OPPONENT_POLICY_TARGET ?? "").trim();
const RUN_TEST_TIMEOUT_MS = Number(process.env.ER_RUN_TEST_TIMEOUT_MS ?? "1200000");
if (AI_MODEL_PATH && AI_NEURAL_MODEL_DIR) {
  throw new Error("ER_AI_POLICY_MODEL and ER_AI_NEURAL_POLICY_MODEL are mutually exclusive");
}
if (AI_OPPONENT_MODEL_PATH && AI_OPPONENT_NEURAL_MODEL_DIR) {
  throw new Error("ER_AI_OPPONENT_POLICY_MODEL and ER_AI_OPPONENT_NEURAL_POLICY_MODEL are mutually exclusive");
}
if (AI_RECORD_ENGINE_BASELINE && (!COMBAT_BATCH || !AI_DATA_OUT)) {
  throw new Error("ER_AI_RECORD_ENGINE_BASELINE requires ER_RUN_COMBAT_BATCH and ER_RUN_AI_DATA_OUT");
}
if (AI_RECORD_ENGINE_BASELINE && (AI_OPPONENT_MODEL_PATH || AI_OPPONENT_NEURAL_MODEL_DIR)) {
  throw new Error("engine baseline capture and a learned opponent policy are mutually exclusive");
}
if (!["first-usable", "smart-default", "engine-hardest", "random"].includes(AI_POLICY_MODE)) {
  throw new Error(`unsupported ER_AI_POLICY_MODE: ${AI_POLICY_MODE}`);
}
if (!["engine-hardest", "first-usable", "random"].includes(AI_OPPONENT_POLICY_MODE)) {
  throw new Error(`unsupported ER_AI_OPPONENT_POLICY_MODE: ${AI_OPPONENT_POLICY_MODE}`);
}
if (!Number.isFinite(AI_POLICY_EPSILON) || AI_POLICY_EPSILON < 0 || AI_POLICY_EPSILON > 1) {
  throw new Error(`ER_AI_POLICY_EPSILON must be between 0 and 1: ${AI_POLICY_EPSILON}`);
}
if (!Number.isFinite(AI_OPPONENT_POLICY_EPSILON) || AI_OPPONENT_POLICY_EPSILON < 0 || AI_OPPONENT_POLICY_EPSILON > 1) {
  throw new Error(`ER_AI_OPPONENT_POLICY_EPSILON must be between 0 and 1: ${AI_OPPONENT_POLICY_EPSILON}`);
}
for (const [name, value] of [
  ["ER_AI_POLICY_TARGET", AI_POLICY_TARGET_OVERRIDE],
  ["ER_AI_OPPONENT_POLICY_TARGET", AI_OPPONENT_POLICY_TARGET_OVERRIDE],
] as const) {
  if (value && value !== "0" && value !== "1") {
    throw new Error(`${name} must be 0 or 1: ${value}`);
  }
}
if (!Number.isInteger(RUN_TEST_TIMEOUT_MS) || RUN_TEST_TIMEOUT_MS < 1) {
  throw new Error(`ER_RUN_TEST_TIMEOUT_MS must be a positive integer: ${RUN_TEST_TIMEOUT_MS}`);
}

function loadAiTreeModel(path: string): ErTreeModelArtifact | null {
  if (!path) {
    return null;
  }
  const model = JSON.parse(readFileSync(path.startsWith("@") ? path.slice(1) : path, "utf8")) as ErTreeModelArtifact;
  const errors = validateErTreeModel(model);
  if (errors.length > 0) {
    throw new Error(`invalid ER tree model ${path}: ${errors.join("; ")}`);
  }
  return model;
}

const AI_TREE_MODEL = loadAiTreeModel(AI_MODEL_PATH);
const AI_NEURAL_CLIENT = AI_NEURAL_MODEL_DIR
  ? new AiNeuralPolicyClient(AI_NEURAL_MODEL_DIR, ER_COMBAT_FEATURE_NAMES.length)
  : null;
const AI_OPPONENT_TREE_MODEL = loadAiTreeModel(AI_OPPONENT_MODEL_PATH);
const AI_OPPONENT_NEURAL_CLIENT = AI_OPPONENT_NEURAL_MODEL_DIR
  ? AI_NEURAL_CLIENT && AI_OPPONENT_NEURAL_MODEL_DIR === AI_NEURAL_MODEL_DIR
    ? AI_NEURAL_CLIENT
    : new AiNeuralPolicyClient(AI_OPPONENT_NEURAL_MODEL_DIR, ER_COMBAT_FEATURE_NAMES.length)
  : null;
const AI_NEURAL_CLIENTS = [AI_NEURAL_CLIENT, AI_OPPONENT_NEURAL_CLIENT]
  .filter((client): client is AiNeuralPolicyClient => client != null)
  .filter((client, index, clients) => clients.indexOf(client) === index);
const AI_HAS_CUSTOM_OPPONENT = !!(
  AI_OPPONENT_TREE_MODEL
  || AI_OPPONENT_NEURAL_CLIENT
  || AI_OPPONENT_POLICY_MODE !== "engine-hardest"
);
const AI_HAS_DUAL_SEAT_CAPTURE = AI_HAS_CUSTOM_OPPONENT || AI_RECORD_ENGINE_BASELINE;

const POLICY_SOURCES: ReadonlySet<string> = new Set<ErCombatPolicySource>([
  "human-v1",
  "smart-default-v1",
  "scripted",
  "forced-move",
  "first-usable",
  "random-v1",
  "tree-model-v1",
  "epsilon-tree-v1",
  "diagnostic-tree-v1",
  "checkpoint-tree-v1",
  "engine-hardest-v1",
  "neural-model-v2",
  "epsilon-neural-v2",
  "trajectory-neural-v3",
  "epsilon-trajectory-neural-v3",
  "checkpoint-neural-v4",
  "search-relabel-v1",
  "advantage-relabel-v1",
]);

function policySourceOverride(name: string, value: string): ErCombatPolicySource | null {
  if (!value) {
    return null;
  }
  if (!POLICY_SOURCES.has(value)) {
    throw new Error(`${name} is not a recognized combat policy source: ${value}`);
  }
  return value as ErCombatPolicySource;
}

const AI_POLICY_SOURCE = policySourceOverride("ER_AI_POLICY_SOURCE", AI_POLICY_SOURCE_OVERRIDE);
const AI_OPPONENT_POLICY_SOURCE = policySourceOverride(
  "ER_AI_OPPONENT_POLICY_SOURCE",
  AI_OPPONENT_POLICY_SOURCE_OVERRIDE,
);

function computeWaves(): number {
  const env = Number(process.env.ER_RUN_WAVES);
  if (Number.isFinite(env) && env > 0) {
    return Math.floor(env);
  }
  const w = INPUT?.run?.waves;
  return typeof w === "number" && w > 0 ? Math.floor(w) : 1;
}
const WAVES = computeWaves();

function computeMaxTurns(): number {
  const env = Number(process.env.ER_RUN_TURNS);
  if (Number.isFinite(env) && env > 0) {
    return env;
  }
  if (SCRIPT && SCRIPT.length > 0) {
    return SCRIPT.length;
  }
  // Full-run mode: the budget is PER WAVE and a multi-mon trainer fight regularly
  // needs >5 turns - 5 made wave-12-style trainer waves report "stuck". 30 still
  // catches a genuinely frozen wave without capping real fights.
  return TO_END || WAVES > 1 ? 30 : 5;
}
const MAX_TURNS = Math.max(1, computeMaxTurns());

// The stat-stage subset `getStatStage` accepts (excludes HP).
type StageStat = Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF | Stat.SPD | Stat.ACC | Stat.EVA;
const STAGE_STATS: StageStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA];
const STAT_BY_NAME: Record<string, StageStat> = {
  ATK: Stat.ATK,
  DEF: Stat.DEF,
  SPATK: Stat.SPATK,
  SPDEF: Stat.SPDEF,
  SPD: Stat.SPD,
  ACC: Stat.ACC,
  EVA: Stat.EVA,
};
const EFFECTIVE_STAT_BY_NAME: Record<string, EffectiveStat> = {
  ATK: Stat.ATK,
  DEF: Stat.DEF,
  SPATK: Stat.SPATK,
  SPDEF: Stat.SPDEF,
  SPD: Stat.SPD,
};

function parseForcedMove(v: string | undefined): MoveId | null {
  if (!v) {
    return null;
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    return n as MoveId;
  }
  const byName = (MoveId as unknown as Record<string, number>)[v.toUpperCase()];
  return typeof byName === "number" ? (byName as MoveId) : null;
}

/**
 * Merge a `--policy @file.json` blob (`ER_RUN_POLICY`, raw JSON) over the resolved
 * spec — a shallow merge of the full-run knobs (rewards / biomePicks / biomeShops /
 * meOptions / eggs / onCatchFull / crossroads / forceMysteryEncounters / betweenWaves),
 * so one policy file can drive any demo / ERS1 / @file scenario. `run.*` sub-keys merge too.
 */
function mergePolicyOverride(spec: RunnerInput | null): void {
  const raw = (process.env.ER_RUN_POLICY ?? "").trim();
  if (!spec || !raw) {
    return;
  }
  const policy = JSON.parse(raw) as Partial<RunnerInput> & { run?: Record<string, unknown> };
  const { run, ...rest } = policy;
  Object.assign(spec, rest);
  if (run) {
    spec.run = { ...(spec.run ?? {}), ...run };
  }
}

/** Resolve ER_RUN_SCENARIO (ERS1 code / raw JSON / '@file' / 'demo') to a spec. */
function resolveSpec(raw: string): RunnerInput | null {
  if (!raw) {
    return null;
  }
  if (raw === "demo") {
    return DEMO_SPEC;
  }
  if (raw.startsWith("ERS1.")) {
    const decoded = decodeScenarioSpec(raw);
    if ("error" in decoded) {
      throw new Error(`bad scenario code: ${decoded.error}`);
    }
    return decoded;
  }
  const json = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  return JSON.parse(json) as RunnerInput;
}

function resolveCombatBatch(raw: string): CombatBatchInput | null {
  if (!raw) {
    return null;
  }
  const json = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  const batch = JSON.parse(json) as CombatBatchInput;
  if (batch.version !== 1 || !Array.isArray(batch.episodes) || batch.episodes.length === 0) {
    throw new Error("combat batch must be version 1 with at least one episode");
  }
  const ids = new Set<string>();
  for (const [index, episode] of batch.episodes.entries()) {
    if (!episode || typeof episode.id !== "string" || episode.id.trim() === "" || !episode.scenario) {
      throw new Error(`combat batch episode ${index} needs a non-empty id and scenario`);
    }
    episode.id = episode.id.trim();
    if (ids.has(episode.id)) {
      throw new Error(`duplicate combat batch episode id: ${episode.id}`);
    }
    ids.add(episode.id);
  }
  return batch;
}

/** A move id or enum-name -> MoveId (null if unresolvable). */
function resolveMove(v: number | string | undefined): MoveId | null {
  if (v === undefined) {
    return null;
  }
  return parseForcedMove(String(v));
}

/** A PokeballType number or enum name -> PokeballType (defaults to POKEBALL). */
function resolveBall(v: number | string | undefined): PokeballType {
  if (typeof v === "number") {
    return v as PokeballType;
  }
  if (typeof v === "string") {
    const key = v.toUpperCase().replace(/[\s-]/g, "_");
    const found = (PokeballType as unknown as Record<string, number>)[key];
    if (typeof found === "number") {
      return found as PokeballType;
    }
  }
  return PokeballType.POKEBALL;
}

/** Resolve a numeric id OR an enum NAME (e.g. "ANGER_POINT", "Sky Attack") to its number. */
function enumVal(e: Record<string, unknown>, v: unknown, label: string): number {
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string") {
    const key = v.toUpperCase().replace(/[\s-]/g, "_");
    const found = e[key];
    if (typeof found === "number") {
      return found;
    }
    throw new Error(`unknown ${label}: "${v}"`);
  }
  return v as number;
}

/**
 * Let runner-authored JSON specs use readable enum NAMES anywhere a numeric id is
 * expected (species / ability / passiveAbility / moves / weather / biome). ERS1
 * share codes are already numeric, so this is a no-op for them. Mutates in place.
 */
function normalizeSpec(spec: RunnerInput | null): void {
  if (!spec) {
    return;
  }
  const fixMon = (m: SpecMon | undefined) => {
    if (!m) {
      return;
    }
    m.species = enumVal(SpeciesId as never, m.species, "species");
    if (m.ability != null) {
      m.ability = enumVal(AbilityId as never, m.ability, "ability");
    }
    if (m.passiveAbility != null) {
      m.passiveAbility = enumVal(AbilityId as never, m.passiveAbility, "passiveAbility");
    }
    if (m.nature != null) {
      m.nature = enumVal(Nature as never, m.nature, "nature");
    }
    if (m.moves) {
      m.moves = m.moves.map(mv => enumVal(MoveId as never, mv, "move"));
    }
  };
  for (const m of spec.party ?? []) {
    fixMon(m);
  }
  fixMon(spec.enemy?.wild);
  for (const m of spec.enemy?.party ?? []) {
    fixMon(m);
  }
  if (spec.run?.weather != null) {
    spec.run.weather = enumVal(WeatherType as never, spec.run.weather, "weather");
  }
  if (spec.run?.terrain != null) {
    spec.run.terrain = enumVal(TerrainType as never, spec.run.terrain, "terrain");
  }
  if (spec.run?.biome != null) {
    spec.run.biome = enumVal(BiomeId as never, spec.run.biome, "biome");
  }
  if (spec.enemy?.trainerType != null) {
    spec.enemy.trainerType = enumVal(TrainerType as never, spec.enemy.trainerType, "trainerType");
  }
}

/** Compact one-side snapshot for the per-turn transcript. */
function snapMon(mon: Pokemon | undefined) {
  if (!mon) {
    return null;
  }
  const stages = STAGE_STATS.map(s => mon.getStatStage(s));
  const lm = mon.getLastXMoves(1)[0];
  return {
    name: mon.species.name,
    hp: `${mon.hp}/${mon.getMaxHp()}`,
    fainted: mon.isFainted(),
    status: mon.status?.effect ? StatusEffect[mon.status.effect] : null,
    ability: mon.getAbility()?.name ?? null,
    stages: stages.some(s => s !== 0) ? stages : undefined, // [atk,def,spa,spd,spe,acc,eva]
    // Last move this mon used: id, #targets, use mode, hit result + multi-hit count.
    lastMove: lm
      ? {
          move: MoveId[lm.move],
          targets: lm.targets?.length ?? 0,
          useMode: MoveUseMode[lm.useMode] ?? lm.useMode,
          result: lm.result == null ? null : MoveResult[lm.result],
          hits: mon.turnData?.hitCount ?? undefined,
        }
      : undefined,
  };
}

function snapshot(game: GameManager) {
  const weather = game.scene.arena?.weather?.weatherType;
  const terrain = game.scene.arena?.terrain?.terrainType;
  return {
    weather: weather ? WeatherType[weather] : null,
    terrain: terrain ? TerrainType[terrain] : null,
    terrainTurnsLeft: game.scene.arena?.terrain?.turnsLeft ?? null,
    player: game.scene.getPlayerField().map(snapMon),
    enemy: game.scene.getEnemyField().map(snapMon),
  };
}

/** The per-slot subset of a TurnAction (slot 0/1/2). */
interface SlotAction {
  move?: number | string | undefined;
  target?: number | undefined;
  tera?: boolean | undefined;
  switch?: number | undefined;
  switchTransfer?: "normal" | "baton" | undefined;
  ball?: number | string | undefined;
  run?: boolean | undefined;
}

/** Extract slot `slot`'s action fields from a TurnAction (slot 1 = `*2`, slot 2 = `*3`). */
function slotAction(a: TurnAction | undefined, slot: 0 | 1 | 2): SlotAction {
  if (!a) {
    return {};
  }
  if (slot === 0) {
    return {
      move: a.move,
      target: a.target,
      tera: a.tera,
      switch: a.switch,
      switchTransfer: a.switchTransfer,
      ball: a.ball,
      run: a.run,
    };
  }
  if (slot === 1) {
    return {
      move: a.move2,
      target: a.target2,
      tera: a.tera2,
      switch: a.switch2,
      switchTransfer: a.switch2Transfer,
      ball: a.ball2,
      run: a.run2,
    };
  }
  return {
    move: a.move3,
    target: a.target3,
    tera: a.tera3,
    switch: a.switch3,
    switchTransfer: a.switch3Transfer,
    ball: a.ball3,
    run: a.run3,
  };
}

/**
 * Whether this slot already has its command, or CommandPhase will consume a queued
 * continuation without opening player input (charge, recharge, rampage, etc.).
 * Keep this aligned with CommandPhase.clearUnusableMoves/tryExecuteQueuedMove so
 * unattended policies neither queue stale prompts nor record decisions never made.
 */
function hasAutomaticQueuedCommand(mon: Pokemon): boolean {
  const moveset = mon.getMoveset();
  const queuedMove = mon.getMoveQueue().find(move => {
    const movesetMove = moveset.find(candidate => candidate.moveId === move.move);
    return (
      move.move === MoveId.NONE
      || isVirtual(move.useMode)
      || (movesetMove?.isUsable(mon, isIgnorePP(move.useMode), true)[0] ?? false)
    );
  });
  if (queuedMove == null) {
    return false;
  }
  return !(mon.getTag(BattlerTagType.FRENZY) && mon.hasAbilityWithAttr("SwitchWhileRampagingAbAttr"));
}

function slotCommandIsAutomatic(game: GameManager, mon: Pokemon): boolean {
  return game.scene.currentBattle.turnCommands[mon.getBattlerIndex()] != null || hasAutomaticQueuedCommand(mon);
}

/** The exact automatic move CommandPhase will consume, if it can still require target confirmation. */
function automaticTurnMove(game: GameManager, mon: Pokemon): TurnMove | null {
  const commandMove = game.scene.currentBattle.turnCommands[mon.getBattlerIndex()]?.move;
  if (commandMove?.move) {
    return commandMove;
  }
  const moveset = mon.getMoveset();
  return (
    mon.getMoveQueue().find(move => {
      const movesetMove = moveset.find(candidate => candidate.moveId === move.move);
      return (
        move.move !== MoveId.NONE
        && (isVirtual(move.useMode) || (movesetMove?.isUsable(mon, isIgnorePP(move.useMode), true)[0] ?? false))
      );
    }) ?? null
  );
}

/**
 * Automatic charge/rampage commands do not open COMMAND input, but the engine may
 * still open SelectTargetPhase (notably for queued spread moves). Mirror that
 * human-visible confirmation without inventing a new model decision.
 */
function registerAutomaticTarget(game: GameManager, mon: Pokemon, log: string[]): void {
  const queued = automaticTurnMove(game, mon);
  if (!queued) {
    return;
  }
  const movePosition = mon.getMoveset().findIndex(move => move.moveId === queued.move);
  if (movePosition < 0) {
    return;
  }
  const target = allMoves[queued.move].isMultiTarget() ? undefined : queued.targets[0];
  game.selectTarget(movePosition, target, mon.getBattlerIndex());
  log.push(`slot${mon.getBattlerIndex()}: ${MoveId[queued.move]} [automatic target]`);
}

/** Whether `moveId` is in this mon's real moveset with PP left (mirrors MoveHelper.getMovePosition). */
function moveInMovesetWithPp(mon: Pokemon, moveId: MoveId): boolean {
  return mon.getMoveset().some(m => m.moveId === moveId && m.ppUsed < m.getMovePp());
}

/** Commit the engine-synthesized Struggle command without replacing the real moveset. */
function selectSyntheticStruggle(
  game: GameManager,
  mon: Pokemon,
  target: BattlerIndex | null | undefined,
  log: string[],
  idx: BattlerIndex,
): void {
  const turnMove: TurnMove = {
    move: MoveId.STRUGGLE,
    targets: target == null ? getMoveTargets(mon, MoveId.STRUGGLE).targets : [target],
    useMode: MoveUseMode.NORMAL,
  };
  const battle = game.scene.currentBattle;
  const turn = battle.turn;
  const commandCommitted = () =>
    game.scene.currentBattle !== battle || battle.turn !== turn || battle.turnCommands[idx] != null;
  const matchesActor = () =>
    game.scene.phaseManager.getCurrentPhase().phaseName === "CommandPhase"
    && (game.scene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex() === idx;
  game.onNextPrompt(
    "CommandPhase",
    UiMode.COMMAND,
    () => {
      void game.scene.ui.setMode(
        UiMode.FIGHT,
        (game.scene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex(),
      );
    },
    commandCommitted,
    false,
    {
      allowOutOfOrder: true,
      debugLabel: `synthetic command actor=${idx}`,
      matchFn: matchesActor,
    },
  );
  game.onNextPrompt(
    "CommandPhase",
    UiMode.FIGHT,
    () =>
      (game.scene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(
        Command.FIGHT,
        -1,
        MoveUseMode.NORMAL,
        turnMove,
      ),
    commandCommitted,
    false,
    {
      allowOutOfOrder: true,
      debugLabel: `synthetic fight actor=${idx}`,
      matchFn: matchesActor,
    },
  );
  log.push(`slot${idx}: STRUGGLE [synthetic command; moveset preserved]`);
}

/** Route a voluntary switch through the exact actor's public COMMAND and PARTY prompts. */
function selectVoluntarySwitch(
  game: GameManager,
  partyIndex: number,
  transfer: "normal" | "baton",
  idx: BattlerIndex,
  log: string[],
): void {
  const battle = game.scene.currentBattle;
  const turn = battle.turn;
  const commandCommitted = () =>
    game.scene.currentBattle !== battle || battle.turn !== turn || battle.turnCommands[idx] != null;
  const matchesActor = () =>
    game.scene.phaseManager.getCurrentPhase().phaseName === "CommandPhase"
    && (game.scene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex() === idx;
  game.onNextPrompt(
    "CommandPhase",
    UiMode.COMMAND,
    () => {
      const handler = game.scene.ui.getHandler() as CommandUiHandler;
      handler.setCursor(2);
      return handler.processInput(Button.ACTION);
    },
    commandCommitted,
    false,
    {
      allowOutOfOrder: true,
      debugLabel: `switch command actor=${idx} party=${partyIndex}`,
      matchFn: matchesActor,
    },
  );
  game.onNextPrompt(
    "CommandPhase",
    UiMode.PARTY,
    () => drivePartySelection(game, partyIndex, [transfer === "baton" ? PartyOption.PASS_BATON : PartyOption.SEND_OUT]),
    commandCommitted,
    false,
    {
      allowOutOfOrder: true,
      debugLabel: `switch party actor=${idx} party=${partyIndex}`,
      matchFn: matchesActor,
    },
  );
  log.push(`slot${idx}: ${transfer === "baton" ? "baton " : ""}switch -> party[${partyIndex}]`);
}

/**
 * Command one player mon for the turn: switch / ball / run / move (+ optional
 * tera). A scripted MOVE already in the mon's real moveset routes through the
 * NON-DESTRUCTIVE `select` path (PP depletes naturally, the other 3 moves stay,
 * a MOVESET_OVERRIDE is respected). A move NOT in the moveset falls back to `use`
 * (which splices it in, wiping that mon's moveset) — noted in the turn log.
 */
function applyAction(
  game: GameManager,
  mon: Pokemon,
  idx: BattlerIndex,
  action: SlotAction,
  forcedMove: MoveId | null,
  log: string[],
): void {
  if (slotCommandIsAutomatic(game, mon)) {
    registerAutomaticTarget(game, mon, log);
    return;
  }
  if (mon.isFainted()) {
    return;
  }
  if (action.switch != null) {
    selectVoluntarySwitch(game, action.switch, action.switchTransfer ?? "normal", idx, log);
    return;
  }
  if (action.ball != null) {
    const ball = resolveBall(action.ball);
    game.doThrowPokeball(ball);
    log.push(`slot${idx}: throw ${PokeballType[ball]}`);
    return;
  }
  if (action.run) {
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const phase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      phase.handleCommand(Command.RUN, phase.getFieldIndex());
    });
    log.push(`slot${idx}: run`);
    return;
  }

  const forced = resolveMove(action.move) ?? forcedMove;
  let moveId = forced;
  if (moveId == null) {
    const usable = mon.getMoveset().find(m => m.isUsable(mon, false, true)[0]);
    moveId = usable ? usable.moveId : MoveId.STRUGGLE;
  }
  // Singles never open SelectTargetPhase, so do not leave a target prompt queued
  // behind moves such as Revival Blessing. Multi-format actions still carry the
  // explicit target selected by the policy/candidate extractor.
  const target =
    action.target == null && game.scene.currentBattle.getBattlerCount() === 1
      ? null
      : action.target == null
        ? undefined
        : (action.target as BattlerIndex);
  const tera = !!action.tera;
  const inMoveset = moveInMovesetWithPp(mon, moveId);
  const syntheticStruggle = moveId === MoveId.STRUGGLE && !mon.getMoveset().some(move => move.moveId === moveId);

  if (syntheticStruggle) {
    selectSyntheticStruggle(game, mon, target, log, idx);
  } else if (inMoveset) {
    if (tera && (idx === BattlerIndex.PLAYER || idx === BattlerIndex.PLAYER_2)) {
      game.move.selectWithTera(moveId, idx, target);
    } else {
      game.move.select(moveId, idx, target);
    }
    log.push(`slot${idx}: ${MoveId[moveId]}${tera ? " (tera)" : ""} [select]`);
  } else {
    // Fallback only: the scripted move isn't in the real moveset, so splice it in.
    game.move.use(moveId, idx, target ?? undefined, tera);
    log.push(`slot${idx}: ${MoveId[moveId]}${tera ? " (tera)" : ""} [use — not in moveset, moveset replaced]`);
  }
}

/** Command every active player mon for the turn (lead + 2nd in doubles + 3rd in triples). */
function doPlayerActions(
  game: GameManager,
  action: TurnAction | undefined,
  forcedMove: MoveId | null,
  log: string[],
): void {
  const field = game.scene.getPlayerField();
  applyAction(game, field[0], BattlerIndex.PLAYER, slotAction(action, 0), forcedMove, log);
  if (field.length > 1 && field[1]) {
    applyAction(game, field[1], BattlerIndex.PLAYER_2, slotAction(action, 1), forcedMove, log);
  }
  // Triple: the 3rd (RIGHT) player mon commands from field slot 2 (no BattlerIndex.PLAYER_3 enum).
  if (field.length > 2 && field[2]) {
    applyAction(game, field[2], 2 as BattlerIndex, slotAction(action, 2), forcedMove, log);
  }
}

type CombatCapturePerspective = "player" | "enemy";

interface PolicyCaptureMetadata {
  policySource: ErCombatDecisionRecord["policySource"];
  policyTarget: boolean;
}

interface AppendCommittedDecisionOptions extends PolicyCaptureMetadata {
  game: GameManager;
  perspective: CombatCapturePerspective;
  episodeId?: string;
  actorSlot: number;
  jointActionId: string;
  earlier: readonly ErCombatEarlierChoice[];
  observation: ErCombatDecisionRecord["observation"];
  candidates: ErCombatCandidate[];
}

function appendCommittedDecision(options: AppendCommittedDecisionOptions): ErCombatCandidate | null {
  const { game, perspective, episodeId, actorSlot, jointActionId, earlier, observation, candidates, ...metadata } =
    options;
  const battle = game.scene.currentBattle;
  const flatSlot = perspective === "enemy" ? battle.arrangement.enemyOffset + actorSlot : actorSlot;
  const command = battle.turnCommands[flatSlot];
  if (command == null || command.skip || command.command === Command.BALL || command.command === Command.RUN) {
    return null;
  }
  const captured = captureCommittedCombatDecision({
    scene: game.scene,
    perspective,
    actorSlot,
    jointActionId,
    earlier,
    observation,
    candidates,
    ...metadata,
    buildSha: AI_BUILD_SHA,
    dexHash: AI_DEX_HASH,
    dictionaryHash: AI_DICTIONARY_HASH,
    episodeId: episodeId ?? activeAiEpisodeId,
    splitGroupId: activeAiSplitGroupId,
    sourcePartitionId: activeAiSourcePartitionId,
  });
  if (captured == null) {
    throw new Error(
      `committed ${perspective} command did not map to one legal candidate: episode=${activeAiEpisodeId} `
        + `decision=${jointActionId}:${actorSlot} command=${JSON.stringify(command)} `
        + `candidates=${JSON.stringify(candidates)}`,
    );
  }
  AI_DATASET_RECORDS.push(captured.record);
  return captured.chosen;
}

function preparePlayerDecisionObservations(game: GameManager): Map<number, ErCombatDecisionRecord["observation"]> {
  if (!AI_DATA_OUT) {
    return new Map();
  }
  return new Map(
    game.scene
      .getPlayerField()
      .map((actor, actorSlot) =>
        actor?.isActive(true) && !actor.isFainted() && !slotCommandIsAutomatic(game, actor)
          ? ([actorSlot, snapshotErCombatObservation(game.scene)] as const)
          : null,
      )
      .filter((entry): entry is readonly [number, ErCombatDecisionRecord["observation"]] => entry != null),
  );
}

/** Record only commands accepted by the real player CommandPhase. */
async function recordCommittedPlayerTurn(
  game: GameManager,
  metadata: PolicyCaptureMetadata,
  observations: ReadonlyMap<number, ErCombatDecisionRecord["observation"]>,
): Promise<void> {
  if (!AI_DATA_OUT) {
    return;
  }
  await game.phaseInterceptor.to("EnemyCommandPhase", false);
  const scene = game.scene;
  const jointActionId = `${activeAiEpisodeId}:${scene.currentBattle.waveIndex}:${scene.currentBattle.turn}`;
  const earlier: ErCombatEarlierChoice[] = [];
  for (let actorSlot = 0; actorSlot < scene.getPlayerField().length; actorSlot++) {
    const actor = scene.getPlayerField()[actorSlot];
    if (!actor?.isActive(true) || actor.isFainted()) {
      continue;
    }
    const observation = observations.get(actorSlot);
    if (observation == null) {
      continue;
    }
    const candidates = enumerateErCombatCandidates(scene, actorSlot, earlier);
    const chosen = appendCommittedDecision({
      game,
      perspective: "player",
      ...(AI_HAS_DUAL_SEAT_CAPTURE ? { episodeId: `${activeAiEpisodeId}:seat-player` } : {}),
      actorSlot,
      jointActionId,
      earlier,
      observation,
      candidates,
      ...metadata,
    });
    if (chosen) {
      earlier.push({
        kind: chosen.kind,
        id: chosen.id,
        ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
        ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
      });
    }
  }
}

/**
 * Record the hardest engine AI from its own perspective without invoking its chooser twice.
 * These rows are baseline/value data only and are never policy targets.
 */
async function recordEngineBaselineTurn(game: GameManager): Promise<void> {
  if (!AI_DATA_OUT || !AI_RECORD_ENGINE_BASELINE) {
    return;
  }
  game.scene.getPlayerField().forEach(mon => AI_ENGINE_BASELINE_KNOWN_OPPONENT_IDS.add(mon.id));
  // TurnInitPhase queues one EnemyCommandPhase per currently active enemy.
  // Fainted field occupants do not receive a command phase.
  const phaseCount = game.scene.getEnemyField().filter(mon => mon.isActive()).length;
  const earlier: ErCombatEarlierChoice[] = [];
  const wave = game.scene.currentBattle.waveIndex;
  const turn = game.scene.currentBattle.turn;
  const jointActionId = `${activeAiEpisodeId}:${wave}:${turn}:enemy`;
  for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex++) {
    await game.phaseInterceptor.to("EnemyCommandPhase", false);
    const phase = game.scene.phaseManager.getCurrentPhase() as { getFieldIndex(): number };
    const actorSlot = phase.getFieldIndex();
    const actor = game.scene.getEnemyField()[actorSlot];
    const automatic = actor == null || !actor.isActive(true) || actor.isFainted() || hasAutomaticQueuedCommand(actor);
    const observation = automatic
      ? null
      : snapshotErCombatObservation(game.scene, {
          perspective: "enemy",
          knownOpponentEntityIds: AI_ENGINE_BASELINE_KNOWN_OPPONENT_IDS,
        });
    // Native AI seats choose independently and may commit the same switch target.
    // Preserve earlier choices as observation context, but map the committed
    // command against the unconstrained legal surface the engine actually saw.
    const candidates = automatic ? [] : enumerateErCombatCandidates(game.scene, actorSlot, [], "enemy");

    await game.phaseInterceptor.to("EnemyCommandPhase");
    if (automatic) {
      continue;
    }
    const chosen = appendCommittedDecision({
      game,
      perspective: "enemy",
      episodeId: `${activeAiEpisodeId}:seat-enemy`,
      actorSlot,
      jointActionId,
      earlier,
      observation: observation!,
      candidates,
      policySource: "engine-hardest-v1",
      policyTarget: false,
    });
    if (chosen) {
      earlier.push({
        kind: chosen.kind,
        id: chosen.id,
        ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
        ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
      });
    }
  }
}

/** Whether the turn forces at least one enemy move. */
function hasEnemyForce(a: TurnAction | undefined): boolean {
  return !!a && (a.enemyMove != null || a.enemyMove2 != null || a.enemyMove3 != null);
}

/**
 * Force the enemy slot(s) to use scripted moves this turn (via MoveHelper.forceEnemyMove,
 * which advances one EnemyCommandPhase per call). Forced slots must fill from slot 0 up.
 */
async function forceEnemyActions(game: GameManager, action: TurnAction, log: string[]): Promise<void> {
  const enemyField = game.scene.getEnemyField();
  const forces: { move: MoveId | null; target: number | undefined }[] = [];
  if (action.enemyMove != null) {
    forces.push({ move: resolveMove(action.enemyMove), target: action.enemyTarget });
  }
  if (action.enemyMove2 != null) {
    forces.push({ move: resolveMove(action.enemyMove2), target: action.enemyTarget2 });
  }
  if (action.enemyMove3 != null) {
    forces.push({ move: resolveMove(action.enemyMove3), target: action.enemyTarget3 });
  }
  for (let i = 0; i < forces.length; i++) {
    const f = forces[i];
    if (!enemyField[i] || enemyField[i].isFainted() || f.move == null) {
      continue;
    }
    await game.move.forceEnemyMove(f.move, f.target == null ? undefined : (f.target as BattlerIndex));
    log.push(`enemy${i}: force ${MoveId[f.move]}`);
  }
}

/**
 * Register a one-shot faint-switch handler: when a player mon faints mid-turn and
 * has a living bench, `SwitchPhase` opens the PARTY UI — send out the FIRST legal
 * bench mon (or `overrideSlot` if the script gave one). Expires once the turn's
 * combat is over so it never blocks the next turn's / wave's prompts.
 */
function registerFaintSwitch(game: GameManager, overrideSlot: number | undefined, log: string[]): void {
  game.onNextPrompt(
    "SwitchPhase",
    UiMode.PARTY,
    () => {
      const party = game.scene.getPlayerParty();
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      const overridePokemon = overrideSlot == null ? undefined : party[overrideSlot];
      const slot =
        overrideSlot != null
        && overridePokemon != null
        && partySlotCanReplace(game, handler, overridePokemon, overrideSlot)
          ? overrideSlot
          : party.findIndex((pokemon, index) => partySlotCanReplace(game, handler, pokemon, index));
      if (slot < 0) {
        return;
      }
      const handled = drivePartySelection(game, slot);
      if (handled) {
        log.push(`faint-switch -> party[${slot}]`);
      }
      return handled;
    },
    // Registered post-hoc (only when a send-out is pending), so it fires at the imminent SwitchPhase.
    // Safety net: expire once we've reached the next turn / a post-battle phase without it firing, so
    // it can never linger at the queue head and block a later prompt.
    () =>
      game.isCurrentPhase(
        "CommandPhase",
        "TurnInitPhase",
        "VictoryPhase",
        "BattleEndPhase",
        "NewBattlePhase",
        "SelectModifierPhase",
      ),
  );
}

/**
 * Register the reward-shop handler for the next `SelectModifierPhase`. `choice` is
 * a `modifierTypes` key (pick that option), "FIRST" (the first option), or "SKIP".
 * A PokemonModifierType reward opens the PARTY menu — apply it to the lead.
 */
function registerRewardPrompt(game: GameManager, choice: string, log: string[]): void {
  if (choice === "SKIP") {
    game.doSelectModifier();
    log.push("reward: SKIP");
    return;
  }
  game.onNextPrompt(
    "SelectModifierPhase",
    UiMode.MODIFIER_SELECT,
    () => {
      const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
      const options = handler.options ?? [];
      let idx = 0;
      if (choice !== "FIRST") {
        const found = options.findIndex(o => o.modifierTypeOption?.type?.id === choice);
        idx = found >= 0 ? found : 0;
      }
      handler.setRowCursor(1); // the rewards row
      handler.setCursor(idx);
      handler.processInput(Button.ACTION);
      log.push(`reward: picked ${options[idx]?.modifierTypeOption?.type?.id ?? "?"}`);
    },
    () => game.isCurrentPhase("CommandPhase", "NewBattlePhase", "CheckSwitchPhase"),
    true,
  );
  // A party-target reward opens PARTY within the same SelectModifierPhase; apply to the lead.
  // Expires the moment we leave the reward phase (so a non-party reward doesn't block later prompts).
  game.onNextPrompt(
    "SelectModifierPhase",
    UiMode.PARTY,
    () => {
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(0);
      handler.processInput(Button.ACTION);
      handler.processInput(Button.ACTION);
    },
    () => !game.isCurrentPhase("SelectModifierPhase"),
  );
}

/**
 * Register the level-up move-learn handler for the next `LearnMovePhase` (full
 * moveset case). Default DECLINES (keeps the current moves); a scripted
 * `learnMove:{slot}` forgets that moveset slot to learn the new move. Mirrors the
 * canonical CONFIRM -> SUMMARY -> CONFIRM input chain (see learn-move-phase.test.ts).
 */
function registerLearnMovePrompt(game: GameManager, learnMove: { slot: number } | undefined, log: string[]): void {
  const expire = () => game.isCurrentPhase("CommandPhase", "TurnInitPhase", "NewBattlePhase");
  // "Should a move be forgotten?" -> Yes (open the move-forget menu).
  game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => game.scene.ui.processInput(Button.ACTION), expire);
  // The move-forget SUMMARY: pick the scripted slot, else the "new move" row (= reject/decline).
  game.onNextPrompt(
    "LearnMovePhase",
    UiMode.SUMMARY,
    () => {
      const slot = learnMove?.slot ?? game.scene.getPlayerParty()[0].getMaxMoveCount();
      game.scene.ui.setCursor(slot);
      game.scene.ui.processInput(Button.ACTION);
      log.push(learnMove ? `learnMove: forget slot ${slot}` : "learnMove: declined");
    },
    expire,
  );
  // Only reached on decline ("Stop trying to teach?" -> Yes).
  game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => game.scene.ui.processInput(Button.ACTION), expire);
}

/** After a wave is won, drive the reward shop + move-learn, then advance to the next wave's CommandPhase. */
async function advanceToNextWave(
  game: GameManager,
  rewardChoice: string,
  learnMove: { slot: number } | undefined,
  log: string[],
): Promise<void> {
  registerRewardPrompt(game, rewardChoice, log);
  registerLearnMovePrompt(game, learnMove, log);
  await game.phaseInterceptor.to("TurnInitPhase");
  await game.phaseInterceptor.to("CommandPhase");
  console.log("==================[New Wave]==================");
}

function checkNum(label: string, v: number, c: HpCheck, fails: string[]): void {
  if (typeof c === "number") {
    if (v !== c) {
      fails.push(`${label} ${v} != ${c}`);
    }
    return;
  }
  if (c.equals != null && v !== c.equals) {
    fails.push(`${label} ${v} != ${c.equals}`);
  }
  if (c.min != null && v < c.min) {
    fails.push(`${label} ${v} < min ${c.min}`);
  }
  if (c.max != null && v > c.max) {
    fails.push(`${label} ${v} > max ${c.max}`);
  }
}

interface SideCheck {
  fainted?: boolean | undefined;
  status?: string | undefined;
  ability?: string | undefined;
  hp?: HpCheck | undefined;
  damaged?: boolean | undefined;
  stage?: { stat: string; value: number } | undefined;
  effectiveStat?: { stat: string; value: HpCheck } | undefined;
  transformed?: boolean | undefined;
}

/** One side's fainted / status / ability checks. */
function expectSideStatus(label: string, mon: Pokemon | undefined, c: SideCheck, fails: string[]): void {
  if (c.fainted != null && !!mon?.isFainted() !== c.fainted) {
    fails.push(`${label}Fainted ${!!mon?.isFainted()} != ${c.fainted}`);
  }
  if (c.status != null) {
    const s = mon?.status?.effect ? StatusEffect[mon.status.effect] : "NONE";
    if (s.toUpperCase() !== c.status.toUpperCase()) {
      fails.push(`${label}Status ${s} != ${c.status}`);
    }
  }
  if (c.ability != null) {
    const a = mon?.getAbility()?.name ?? "";
    if (!a.toLowerCase().includes(c.ability.toLowerCase())) {
      fails.push(`${label}Ability "${a}" !~ "${c.ability}"`);
    }
  }
}

/** One side's hp / stat-stage checks. */
function expectSideStats(label: string, mon: Pokemon | undefined, c: SideCheck, fails: string[]): void {
  if (c.hp != null) {
    checkNum(`${label} hp`, mon?.hp ?? 0, c.hp, fails);
  }
  if (c.damaged != null && (!!mon && mon.hp < mon.getMaxHp()) !== c.damaged) {
    fails.push(`${label}Damaged ${!!mon && mon.hp < mon.getMaxHp()} != ${c.damaged}`);
  }
  if (c.stage) {
    const st = STAT_BY_NAME[c.stage.stat.toUpperCase()];
    const v = st == null ? Number.NaN : (mon?.getStatStage(st) ?? 0);
    if (v !== c.stage.value) {
      fails.push(`${label} ${c.stage.stat} stage ${v} != ${c.stage.value}`);
    }
  }
  if (c.effectiveStat) {
    const stat = EFFECTIVE_STAT_BY_NAME[c.effectiveStat.stat.toUpperCase()];
    const value = stat == null || !mon ? Number.NaN : mon.getEffectiveStat(stat);
    checkNum(`${label} ${c.effectiveStat.stat} effective stat`, value, c.effectiveStat.value, fails);
  }
  if (c.transformed != null && !!mon?.isTransformed() !== c.transformed) {
    fails.push(`${label}Transformed ${!!mon?.isTransformed()} != ${c.transformed}`);
  }
}

/** One side's checks: fainted / status / ability / hp / stat-stage. */
function expectSide(label: string, mon: Pokemon | undefined, c: SideCheck, fails: string[]): void {
  expectSideStatus(label, mon, c, fails);
  expectSideStats(label, mon, c, fails);
}

/** A single mon's stat-stage check by field slot (used for the triple 2nd/3rd position asserts). */
function checkMonStage(
  label: string,
  mon: Pokemon | undefined,
  spec: { stat: string; value: number } | undefined,
  fails: string[],
): void {
  if (!spec) {
    return;
  }
  const st = STAT_BY_NAME[spec.stat.toUpperCase()];
  const v = st == null ? Number.NaN : (mon?.getStatStage(st) ?? 0);
  if (v !== spec.value) {
    fails.push(`${label} ${spec.stat} stage ${v} != ${spec.value}`);
  }
}

/** Whether `needles` appear (in order) as a subsequence of `haystack` (case-insensitive). */
function isOrderedSubsequence(needles: string[], haystack: string[]): boolean {
  let i = 0;
  for (const h of haystack) {
    if (i < needles.length && h.toUpperCase() === needles[i].toUpperCase()) {
      i++;
    }
  }
  return i === needles.length;
}

/** Evaluate the optional `expect` block; returns a list of human-readable mismatches. */
function evaluateExpect(
  exp: ExpectSpec,
  ctx: {
    game: GameManager;
    player?: Pokemon;
    enemy?: Pokemon;
    outcome: string;
    maxHits: number;
    log: string;
    enemyMovesUsed: string[];
    biomeOptions?: string[];
  },
): string[] {
  const fails: string[] = [];
  if (exp.outcome != null && ctx.outcome !== exp.outcome) {
    fails.push(`outcome "${ctx.outcome}" != "${exp.outcome}"`);
  }
  expectSide(
    "player",
    ctx.player,
    {
      fainted: exp.playerFainted,
      status: exp.playerStatus,
      ability: exp.playerAbility,
      hp: exp.playerHp,
      damaged: exp.playerDamaged,
      stage: exp.playerStage,
      effectiveStat: exp.playerEffectiveStat,
      transformed: exp.playerTransformed,
    },
    fails,
  );
  if (
    exp.playerAbilitySuppressed !== undefined
    && !!ctx.player?.summonData.abilitySuppressed !== exp.playerAbilitySuppressed
  ) {
    fails.push(
      `player ability-suppressed ${!!ctx.player?.summonData.abilitySuppressed} != ${exp.playerAbilitySuppressed}`,
    );
  }
  if (
    exp.enemyAbilitySuppressed !== undefined
    && !!ctx.enemy?.summonData.abilitySuppressed !== exp.enemyAbilitySuppressed
  ) {
    fails.push(
      `enemy ability-suppressed ${!!ctx.enemy?.summonData.abilitySuppressed} != ${exp.enemyAbilitySuppressed}`,
    );
  }
  expectSide(
    "enemy",
    ctx.enemy,
    {
      fainted: exp.enemyFainted,
      status: exp.enemyStatus,
      ability: exp.enemyAbility,
      hp: exp.enemyHp,
      damaged: exp.enemyDamaged,
      stage: exp.enemyStage,
      effectiveStat: exp.enemyEffectiveStat,
      transformed: exp.enemyTransformed,
    },
    fails,
  );
  // Per-slot state on the 2nd/3rd mon of each side (by field slot).
  const pf = ctx.game.scene.getPlayerField();
  const ef = ctx.game.scene.getEnemyField();
  expectSide("player2", pf[1], { fainted: exp.player2Fainted, status: exp.player2Status, hp: exp.player2Hp }, fails);
  expectSide("player3", pf[2], { fainted: exp.player3Fainted, status: exp.player3Status, hp: exp.player3Hp }, fails);
  expectSide("enemy2", ef[1], { fainted: exp.enemy2Fainted, status: exp.enemy2Status, hp: exp.enemy2Hp }, fails);
  expectSide("enemy3", ef[2], { fainted: exp.enemy3Fainted, status: exp.enemy3Status, hp: exp.enemy3Hp }, fails);
  checkMonStage("player2", pf[1], exp.player2Stage, fails);
  checkMonStage("player3", pf[2], exp.player3Stage, fails);
  checkMonStage("enemy2", ef[1], exp.enemy2Stage, fails);
  checkMonStage("enemy3", ef[2], exp.enemy3Stage, fails);
  for (const slot of exp.playerInnateSlotsSuppressed ?? []) {
    if (slot < 0 || slot > 2 || !Number.isInteger(slot)) {
      fails.push(`invalid player innate slot ${slot}`);
    } else if (!ctx.player || !isInnateSlotSuppressed(ctx.player, slot as 0 | 1 | 2)) {
      fails.push(`player innate slot ${slot} is not suppressed`);
    }
  }
  for (const slot of exp.enemyInnateSlotsSuppressed ?? []) {
    if (slot < 0 || slot > 2 || !Number.isInteger(slot)) {
      fails.push(`invalid enemy innate slot ${slot}`);
    } else if (!ctx.enemy || !isInnateSlotSuppressed(ctx.enemy, slot as 0 | 1 | 2)) {
      fails.push(`enemy innate slot ${slot} is not suppressed`);
    }
  }
  for (const key of exp.playerEntryEffectsFired ?? []) {
    if (!ctx.player?.waveData.entryEffectsFired.has(key)) {
      fails.push(`player entry effect "${key}" was not spent`);
    }
  }
  for (const key of exp.playerAbilityEntryWindows ?? []) {
    if (!ctx.player?.tempSummonData.abilityEntryWindows.has(key)) {
      fails.push(`player ability entry window "${key}" is not active`);
    }
  }
  for (const key of exp.playerAbilityEntryWindowsAbsent ?? []) {
    if (ctx.player?.tempSummonData.abilityEntryWindows.has(key)) {
      fails.push(`player ability entry window "${key}" unexpectedly re-armed`);
    }
  }
  expectArena(exp, ctx.game, fails);
  if (exp.maxHits != null) {
    checkNum("maxHits", ctx.maxHits, exp.maxHits, fails);
  }
  if (exp.enemyUsedMoves && !isOrderedSubsequence(exp.enemyUsedMoves, ctx.enemyMovesUsed)) {
    fails.push(
      `enemyUsedMoves [${exp.enemyUsedMoves.join(", ")}] not an ordered subsequence of [${ctx.enemyMovesUsed.join(", ")}]`,
    );
  }
  expectTags("player", ctx.player, exp.playerTags, exp.playerTagsAbsent, fails);
  expectTags("enemy", ctx.enemy, exp.enemyTags, exp.enemyTagsAbsent, fails);
  expectExtendedState(exp, ctx, fails);
  expectLog(exp, ctx.log.toLowerCase(), fails);
  return fails;
}

/** Battler/ER-status tag presence/absence checks (by BattlerTagType enum name). */
function expectTags(
  label: string,
  mon: Pokemon | undefined,
  present: string[] | undefined,
  absent: string[] | undefined,
  fails: string[],
): void {
  for (const name of present ?? []) {
    const tag = (BattlerTagType as Record<string, BattlerTagType>)[name.toUpperCase()];
    if (tag == null || mon?.getTag(tag) == null) {
      fails.push(`${label} missing tag ${name}`);
    }
  }
  for (const name of absent ?? []) {
    const tag = (BattlerTagType as Record<string, BattlerTagType>)[name.toUpperCase()];
    if (tag != null && mon?.getTag(tag) != null) {
      fails.push(`${label} unexpectedly has tag ${name}`);
    }
  }
}

function heldItemNames(mon: Pokemon | undefined): string[] {
  return (mon?.getHeldItems() ?? []).map(item => item.type.name);
}

function expectNamedItems(
  label: string,
  mon: Pokemon | undefined,
  required: string[] | undefined,
  forbidden: string[] | undefined,
  fails: string[],
): void {
  const names = heldItemNames(mon);
  for (const expected of required ?? []) {
    if (!names.some(name => name.toLowerCase().includes(expected.toLowerCase()))) {
      fails.push(`${label} held item missing "${expected}" (has ${names.join(", ") || "none"})`);
    }
  }
  for (const expected of forbidden ?? []) {
    if (names.some(name => name.toLowerCase().includes(expected.toLowerCase()))) {
      fails.push(`${label} held item unexpectedly includes "${expected}"`);
    }
  }
}

function expectExtendedState(
  exp: ExpectSpec,
  ctx: {
    game: GameManager;
    player?: Pokemon;
    enemy?: Pokemon;
    biomeOptions?: string[];
  },
  fails: string[],
): void {
  if (exp.playerNature != null) {
    const nature = ctx.player ? Nature[ctx.player.nature] : "NONE";
    if (nature.toUpperCase() !== exp.playerNature.toUpperCase()) {
      fails.push(`player nature ${nature} != ${exp.playerNature}`);
    }
  }
  if (exp.enemyNature != null) {
    const nature = ctx.enemy ? Nature[ctx.enemy.nature] : "NONE";
    if (nature.toUpperCase() !== exp.enemyNature.toUpperCase()) {
      fails.push(`enemy nature ${nature} != ${exp.enemyNature}`);
    }
  }
  expectNamedItems("player", ctx.player, exp.playerHeldItems, exp.playerHeldItemsAbsent, fails);
  expectNamedItems("enemy", ctx.enemy, exp.enemyHeldItems, exp.enemyHeldItemsAbsent, fails);
  if (exp.money != null) {
    checkNum("money", ctx.game.scene.money, exp.money, fails);
  }
  for (const progress of exp.partyProgress ?? []) {
    const mon = ctx.game.scene.getPlayerParty()[progress.slot];
    if (!mon) {
      fails.push(`party slot ${progress.slot} is empty`);
      continue;
    }
    if (progress.species != null && !mon.species.name.toLowerCase().includes(progress.species.toLowerCase())) {
      fails.push(`party slot ${progress.slot} species "${mon.species.name}" !~ "${progress.species}"`);
    }
    if (progress.level != null) {
      checkNum(`party slot ${progress.slot} level`, mon.level, progress.level, fails);
    }
    if (progress.exp != null) {
      checkNum(`party slot ${progress.slot} exp`, mon.exp, progress.exp, fails);
    }
    expectNamedItems(`party slot ${progress.slot}`, mon, progress.heldItems, progress.heldItemsAbsent, fails);
  }
  for (const [name, check] of Object.entries(exp.pokeballs ?? {})) {
    const key = (PokeballType as unknown as Record<string, number>)[name.toUpperCase()];
    if (typeof key !== "number") {
      fails.push(`pokeball ${name.toUpperCase()} is unknown`);
      continue;
    }
    checkNum(`pokeball ${name.toUpperCase()}`, ctx.game.scene.pokeballCounts[key] ?? 0, check, fails);
  }
  const biomeOptions =
    ctx.biomeOptions
    ?? getErPendingNodes()
      .filter(node => node.revealed)
      .map(node => biomeName(node.biome));
  if (exp.biomeOptionCount != null) {
    checkNum("biome option count", biomeOptions.length, exp.biomeOptionCount, fails);
  }
  if (exp.biomeOptions != null) {
    const actual = biomeOptions.map(name => name.toUpperCase());
    const expected = exp.biomeOptions.map(name => name.toUpperCase());
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      fails.push(`biome options [${biomeOptions.join(", ")}] != [${exp.biomeOptions.join(", ")}]`);
    }
  }
}

/** Field-wide weather / terrain checks. */
function expectArena(exp: ExpectSpec, game: GameManager, fails: string[]): void {
  if (exp.weather != null) {
    const w = game.scene.arena?.weather?.weatherType;
    const wn = w ? WeatherType[w] : "NONE";
    if (wn.toUpperCase() !== exp.weather.toUpperCase()) {
      fails.push(`weather ${wn} != ${exp.weather}`);
    }
  }
  if (exp.terrain != null) {
    const t = game.scene.arena?.terrain?.terrainType;
    const tn = t ? TerrainType[t] : "NONE";
    if (tn.toUpperCase() !== exp.terrain.toUpperCase()) {
      fails.push(`terrain ${tn} != ${exp.terrain}`);
    }
  }
  if (exp.terrainTurnsLeft != null) {
    checkNum("terrain turns left", game.scene.arena?.terrain?.turnsLeft ?? 0, exp.terrainTurnsLeft, fails);
  }

  const arena = game.scene.arena;
  const checkArenaTags = (names: string[] | undefined, side: ArenaTagSide, expected: boolean, label: string): void => {
    for (const name of names ?? []) {
      const type = (ArenaTagType as unknown as Record<string, ArenaTagType>)[name.toUpperCase()];
      if (type == null) {
        fails.push(`unknown arena tag "${name}"`);
        continue;
      }
      const present = !!arena?.getTagOnSide(type, side);
      if (present !== expected) {
        fails.push(`${label} arena tag ${name} ${expected ? "missing" : "unexpectedly present"}`);
      }
    }
  };

  checkArenaTags(exp.playerArenaTags, ArenaTagSide.PLAYER, true, "player");
  checkArenaTags(exp.playerArenaTagsAbsent, ArenaTagSide.PLAYER, false, "player");
  checkArenaTags(exp.enemyArenaTags, ArenaTagSide.ENEMY, true, "enemy");
  checkArenaTags(exp.enemyArenaTagsAbsent, ArenaTagSide.ENEMY, false, "enemy");
}

/** Message-log substring checks (case-insensitive). */
function expectLog(exp: ExpectSpec, logLc: string, fails: string[]): void {
  for (const s of exp.logIncludes ?? []) {
    if (!logLc.includes(s.toLowerCase())) {
      fails.push(`log missing "${s}"`);
    }
  }
  for (const s of exp.logExcludes ?? []) {
    if (logLc.includes(s.toLowerCase())) {
      fails.push(`log unexpectedly contains "${s}"`);
    }
  }
}

/**
 * The GameManager ctor clamps `randBattleSeedInt` to the MAX roll (deterministic
 * damage / always-hit-or-always-miss). Restore the REAL seeded implementation
 * (verbatim from battle-scene.ts) so probabilistic proc bugs reproduce. Scoped to
 * ONE GameManager — the next `new GameManager` re-installs the clamp in its ctor.
 */
function restoreRealBattleRng(): void {
  BattleScene.prototype.randBattleSeedInt = function (this: BattleScene, range: number, min = 0): number {
    return this.currentBattle?.randSeedInt(range, min);
  };
}

/** Boot a fresh game and launch the scenario on the in-game dev rails; returns the GameManager at the first CommandPhase. */
async function launchScenario(
  phaserGame: Phaser.Game,
  spec: ScenarioSpec,
  opts: LaunchOpts = {},
): Promise<GameManager> {
  // Resolve any enum NAMES (species/ability/move/…) to ids — idempotent, so it's a
  // no-op for ERS1 codes / already-normalized specs, but makes inline JSON that uses
  // readable names ("SNORLAX") work whether or not the caller pre-normalized.
  normalizeSpec(spec);
  const game = new GameManager(phaserGame);
  if (opts.realRng) {
    restoreRealBattleRng();
  } else if (opts.minRng) {
    BattleScene.prototype.randBattleSeedInt = (_range: number, min = 0): number => min;
  }
  // Determinism knobs: force every move to hit / never crit (reset the crit override
  // each launch so it doesn't bleed across the self-check scenarios).
  if (opts.noMiss) {
    vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
  }
  game.override.criticalHits(opts.noCrit ? false : null);
  // Trainer / boss intro dialogue would open a MESSAGE prompt and hang the runner;
  // treat all battle-entry dialogue as seen (mirrors runToFinalBossEncounter).
  vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);

  const { scenario, postLaunch } = buildDevScenario(spec);
  await game.runToTitle();
  const starters = scenario.setup();
  // Stage guaranteed reward options for the first shop (the in-game launch does this
  // too) so `items.shop` isn't dead headlessly — consumed by the first SelectModifierPhase.
  if (scenario.shopItems && scenario.shopItems.length > 0) {
    setPendingDevShop(scenario.shopItems);
  }
  // Respect the spec's EFFECTIVE battle style: a 2+ mon custom enemy party
  // auto-doubles in buildDevScenario, so don't shadow that back to single here.
  game.override.battleStyle(effectiveBattleStyle(spec));
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const ssp = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    // Dev scenarios use INTENTIONAL movesets (often not in the species' learnset);
    // skip legality validation so the exact scripted moves are applied verbatim,
    // instead of being rejected and replaced by rolled level-up moves.
    if (scenario.onPartyReady) {
      setPendingDevPartySetup(scenario.onPartyReady);
    }
    ssp.initBattleFromCurrentPhase(starters, true);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  const entryState = opts.driveEntryMenus ? newRunState(buildPolicy(spec as RunnerInput, true)) : null;
  const stopEntryAutopilot = entryState ? installMenuAutopilot(game, entryState) : null;
  try {
    await game.phaseInterceptor.to("CommandPhase");
    if (entryState?.driveError) {
      throw entryState.driveError;
    }
  } finally {
    stopEntryAutopilot?.();
  }
  scenario.onBattleStart?.();
  // Seed the pokéball inventory from `items.pokeballs`, or auto-stock when any script
  // throws a ball (an unowned-ball throw otherwise hangs the BALL submenu).
  seedPokeballs(game, spec as RunnerInput);
  return game;
}

/** The battle style the spec actually resolves to (mirrors buildDevScenario's auto-double). */
function effectiveBattleStyle(spec: ScenarioSpec): "single" | "double" | "triple" {
  if (spec.run?.triple) {
    return "triple";
  }
  if (spec.run?.double) {
    return "double";
  }
  if (spec.run?.double === false) {
    return "single";
  }
  if (spec.enemy?.kind === "party" && (spec.enemy.party?.length ?? 0) >= 2) {
    return "double";
  }
  return "single";
}

/** Play up to `maxTurns` per wave over `waves` waves; returns the run summary + the enemy's move order. */
async function playBattle(
  game: GameManager,
  opts: PlayOpts,
): Promise<{
  outcome: string;
  turnsPlayed: number;
  wavesPlayed: number;
  maxHits: number;
  log: string;
  enemyMovesUsed: string[];
  startWave: number;
  endWave: number;
}> {
  // The full battle message log (the game's own event stream) incl. on-entry text.
  const fullLog: string[] = [...game.textInterceptor.logs];
  game.textInterceptor.clearLogs();
  const actionLog: string[] = [];
  const enemyMovesUsed: string[] = [];
  const startWave = game.scene.currentBattle?.waveIndex ?? 0;

  console.log("=== TURN 0 (battle start) ===");
  console.log("STATE", JSON.stringify(snapshot(game)));

  let outcome = "max-turns-reached";
  let turnsPlayed = 0;
  let wavesPlayed = 0;
  let maxHits = 0;
  let wiped = false;

  for (let wave = 1; wave <= opts.waves; wave++) {
    wavesPlayed = wave;
    let won = false;
    for (let turn = 1; turn <= opts.maxTurns; turn++) {
      turnsPlayed++;
      console.log(`\n=== WAVE ${wave} TURN ${turn} (wave ${game.scene.currentBattle?.waveIndex}) ===`);
      const playerDecisionObservations = preparePlayerDecisionObservations(game);
      const scriptedAction = opts.script?.[turn - 1];
      const action =
        scriptedAction
        ?? (opts.forcedMove == null
        && (AI_TREE_MODEL
          || AI_NEURAL_CLIENT
          || AI_POLICY_MODE === "smart-default"
          || AI_POLICY_MODE === "engine-hardest")
          ? await unattendedPolicyAction(game)
          : undefined);
      const captureMetadata: PolicyCaptureMetadata = scriptedAction
        ? { policySource: "scripted", policyTarget: false }
        : (AI_TREE_MODEL || AI_NEURAL_CLIENT || AI_POLICY_MODE === "engine-hardest") && opts.forcedMove == null
          ? unattendedPolicyMetadata()
          : AI_POLICY_MODE === "smart-default" && opts.forcedMove == null
            ? { policySource: "smart-default-v1", policyTarget: false }
            : opts.forcedMove == null
              ? { policySource: "first-usable", policyTarget: false }
              : { policySource: "forced-move", policyTarget: false };
      doPlayerActions(game, action, opts.forcedMove ?? null, actionLog);
      await recordCommittedPlayerTurn(game, captureMetadata, playerDecisionObservations);
      if (action && hasEnemyForce(action)) {
        await forceEnemyActions(game, action, actionLog);
      }

      try {
        await game.toEndOfTurn();
      } catch (error) {
        const phaseName = game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "";
        if (phaseName === "TitlePhase" || phaseName === "GameOverPhase" || phaseName === "EndCardPhase") {
          wiped = game.scene.getPlayerParty().every(pokemon => pokemon.isFainted());
          break;
        }
        throw error;
      }
      fullLog.push(...game.textInterceptor.logs); // this turn's messages
      game.textInterceptor.clearLogs();
      for (const m of [...game.scene.getPlayerField(), ...game.scene.getEnemyField()]) {
        maxHits = Math.max(maxHits, m.turnData?.hitCount ?? 0);
      }
      for (const e of game.scene.getEnemyField()) {
        const lm = e.getLastXMoves(1)[0];
        if (lm?.move != null) {
          enemyMovesUsed.push(MoveId[lm.move]);
        }
      }
      console.log("STATE", JSON.stringify(snapshot(game)));

      if (game.isVictory()) {
        won = true;
        break;
      }
      if (game.scene.getPlayerParty().every(p => p.isFainted())) {
        wiped = true;
        break;
      }
      // A fielded mon fainted with a living bench -> the faint replacement SwitchPhase runs at TURN
      // END (after TurnEndPhase, before the next CommandPhase). Register a one-shot handler ONLY now
      // (when actually needed) so it can never linger at the queue head and block a later turn.
      const battlerCount = game.scene.currentBattle.getBattlerCount();
      const needsFaintSwitch =
        game.scene.getPlayerField().some(m => m.isFainted())
        && game.scene.getPlayerParty().some((p, i) => i >= battlerCount && p.isAllowedInBattle());
      if (needsFaintSwitch) {
        registerFaintSwitch(game, action?.switch, actionLog);
      }
      if (turn < opts.maxTurns) {
        await game.toNextTurn(); // advance to the next turn's CommandPhase (drives any pending SwitchPhase)
      } else if (needsFaintSwitch) {
        // Last turn but a send-out is pending: advance past the SwitchPhase so the bench mon comes out.
        await game.phaseInterceptor.to("CommandPhase");
      }
    }

    if (wiped) {
      outcome = "player-wiped";
      break;
    }
    if (!won) {
      outcome = "max-turns-reached";
      break;
    }
    // Won this wave.
    if (wave < opts.waves) {
      const rewardChoice = opts.rewards?.[wave - 1] ?? "FIRST";
      await advanceToNextWave(game, rewardChoice, opts.learnMove, actionLog);
    } else {
      outcome = "victory";
    }
  }

  if (actionLog.length > 0) {
    console.log("\nACTIONS:\n - " + actionLog.join("\n - "));
  }
  const endWave = game.scene.currentBattle?.waveIndex ?? startWave;
  return { outcome, turnsPlayed, wavesPlayed, maxHits, log: fullLog.join("\n"), enemyMovesUsed, startWave, endWave };
}

// =============================================================================
// FULL-RUN AUTOPILOT — drive an ENTIRE classic run (wave 1 → 200 / victory).
//
// PROVEN LAW (code audit): headless `ui.showText`/`showDialogue` AUTO-ADVANCE
// (mock-text.ts stubs them, the callback fires unconditionally), but every
// interactive `ui.setMode` MENU stalls until something feeds it input. A full run
// is therefore a FINITE list of menus. This autopilot polls the live UI mode on an
// interval (the same mechanism `PromptHandler` uses) and drives whichever menu is
// up, dispatching on (phaseName, UiMode) to the REAL handler input path — never by
// mutating game state directly, so bug-faithful flows reproduce.
// =============================================================================

/** Resolve a BiomeId enum NAME (case-insensitive, spaces/hyphens → underscores) to its id. */
function resolveBiomeName(v: string | undefined): BiomeId | null {
  if (!v) {
    return null;
  }
  const key = v.toUpperCase().replace(/[\s-]/g, "_");
  const found = (BiomeId as unknown as Record<string, number>)[key];
  return typeof found === "number" ? (found as BiomeId) : null;
}

/** Resolve a MysteryEncounterType enum NAME to its id. */
function resolveMeTypeName(v: string | undefined): MysteryEncounterType | null {
  if (!v) {
    return null;
  }
  const key = v.toUpperCase().replace(/[\s-]/g, "_");
  const found = (MysteryEncounterType as unknown as Record<string, number>)[key];
  return typeof found === "number" ? (found as MysteryEncounterType) : null;
}

/** The assembled between-wave policy (from spec fields + CLI flags). */
interface RunPolicy {
  rewards: string[];
  biomeShops: "SKIP" | BiomeShopVisit[];
  biomePicks: string[];
  crossroads: number[];
  eggs: "skip" | "hatch";
  onCatchFull: OnCatchFull;
  learnMove?: { slot: number } | undefined;
  meOptions: number[][];
  forceMysteryEncounters: { wave: number; type: string }[];
  allowMysteryEncounters: boolean;
  autoFirst: boolean;
}

function buildPolicy(spec: RunnerInput, autoFirst: boolean): RunPolicy {
  return {
    rewards: spec.rewards ?? [],
    biomeShops: spec.biomeShops ?? "SKIP",
    biomePicks: [...(spec.biomePicks ?? [])],
    crossroads: [...(spec.crossroads ?? [])],
    eggs: spec.eggs ?? "skip",
    onCatchFull: spec.onCatchFull ?? "release",
    learnMove: spec.learnMove,
    meOptions: (spec.meOptions ?? []).map(p => [...p]),
    forceMysteryEncounters: [...(spec.forceMysteryEncounters ?? [])],
    allowMysteryEncounters: spec.run?.allowMysteryEncounters ?? false,
    autoFirst,
  };
}

/** Mutable run state the autopilot threads through (menu cursors + diagnostics). */
interface RunState {
  policy: RunPolicy;
  log: string[];
  autoFirstLog: string[];
  biomePickCursor: number;
  crossroadCursor: number;
  meCursor: number;
  rewardCursor: number;
  /** Last driven phase instance + mode, so consecutive same-name phases are distinct appearances. */
  lastDrivenPhase: object | null;
  lastDrivenMode: UiMode | null;
  /** Distinguishes consecutive forced replacements that reuse one SwitchPhase and PARTY mode. */
  lastDrivenPartyCallback: unknown;
  /** When an unhandled interactive menu was first seen (ms), for the stall watchdog. */
  stallSince: number;
  stallMode: string | null;
  meDriven: boolean;
  catchFullDriven: boolean;
  eggDriven: boolean;
  biomeShopDriven: boolean;
  driveError: unknown;
  autopilotTicks: number;
  partyTicks: number;
  lastPartyAttempt: string | null;
}

function newRunState(policy: RunPolicy): RunState {
  return {
    policy,
    log: [],
    autoFirstLog: [],
    biomePickCursor: 0,
    crossroadCursor: 0,
    meCursor: 0,
    rewardCursor: 0,
    lastDrivenPhase: null,
    lastDrivenMode: null,
    lastDrivenPartyCallback: null,
    stallSince: 0,
    stallMode: null,
    meDriven: false,
    catchFullDriven: false,
    eggDriven: false,
    biomeShopDriven: false,
    driveError: null,
    autopilotTicks: 0,
    partyTicks: 0,
    lastPartyAttempt: null,
  };
}

/** Seed the pokéball inventory from `items.pokeballs`, and auto-stock when any script throws a ball. */
function seedPokeballs(game: GameManager, spec: RunnerInput): void {
  const rows = spec.items?.pokeballs;
  const scriptThrowsBall = (spec.script ?? []).some(a => a.ball != null || a.ball2 != null || a.ball3 != null);
  if (rows && Object.keys(rows).length > 0) {
    for (const [name, count] of Object.entries(rows)) {
      game.scene.pokeballCounts[resolveBall(name)] = Math.max(0, Math.floor(count));
    }
    return;
  }
  if (scriptThrowsBall) {
    // Auto-seed a default stock so an unowned-ball throw never hangs the BALL submenu.
    const kinds = [
      PokeballType.POKEBALL,
      PokeballType.GREAT_BALL,
      PokeballType.ULTRA_BALL,
      PokeballType.ROGUE_BALL,
      PokeballType.MASTER_BALL,
    ];
    for (const k of kinds) {
      game.scene.pokeballCounts[k] = Math.max(game.scene.pokeballCounts[k] ?? 0, 20);
    }
  }
}

/** The `modifierTypes` keys to buy at the biome shop for this global wave (empty = leave). */
function biomeShopBuysForWave(policy: RunPolicy, wave: number): string[] {
  if (policy.biomeShops === "SKIP") {
    return [];
  }
  const buys: string[] = [];
  for (const visit of policy.biomeShops) {
    if (visit.wave == null || visit.wave === wave) {
      buys.push(...visit.buys);
    }
  }
  return buys;
}

/**
 * Which UiModes the autopilot OWNS (drives between waves / during capture / eggs /
 * MEs). Turn-level modes (COMMAND / FIGHT / BALL / TARGET_SELECT) are deliberately
 * NOT owned — the per-turn logic drives those.
 */
function isAutopilotMode(phaseName: string, mode: UiMode, handler?: object): boolean {
  switch (mode) {
    case UiMode.BIOME_SHOP:
    case UiMode.ER_MAP:
    case UiMode.MYSTERY_ENCOUNTER:
      return true;
    case UiMode.LEARN_MOVE_BATCH:
      return phaseName === "LearnMoveBatchPhase";
    case UiMode.MODIFIER_SELECT:
      return phaseName === "SelectModifierPhase";
    case UiMode.OPTION_SELECT:
      return (
        phaseName === "ErCrossroadsPhase"
        || phaseName === "SelectBiomePhase"
        || phaseName.startsWith("MysteryEncounter")
      );
    case UiMode.CONFIRM:
      return (
        phaseName === "EggLapsePhase"
        || phaseName === "AttemptCapturePhase"
        || phaseName === "LearnMovePhase"
        || phaseName === "SelectModifierPhase"
        || phaseName === "CheckSwitchPhase"
      );
    case UiMode.PARTY: {
      // If every active player slot fainted, the phase queue can advance while
      // the mandatory replacement menu remains open.
      const partyUiMode = (handler as { partyUiMode?: PartyUiMode } | undefined)?.partyUiMode;
      return (
        phaseName === "SelectModifierPhase"
        || phaseName === "SwitchPhase"
        || phaseName === "EnemyCommandPhase"
        || phaseName === "AttemptCapturePhase"
        || phaseName === "RevivalBlessingPhase"
        || partyUiMode === PartyUiMode.SWITCH
        || partyUiMode === PartyUiMode.FAINT_SWITCH
        || partyUiMode === PartyUiMode.POST_BATTLE_SWITCH
      );
    }
    case UiMode.TARGET_SELECT:
      // Combat batches can inherit an engine-created target confirmation from a
      // committed/virtual command for a slot that no longer takes model input.
      return !!COMBAT_BATCH && phaseName === "SelectTargetPhase";
    case UiMode.SUMMARY:
      return (
        phaseName === "LearnMovePhase"
        || phaseName === "AttemptCapturePhase"
        || (!!COMBAT_BATCH && phaseName === "SwitchPhase")
      );
    case UiMode.MESSAGE:
      return phaseName.startsWith("MysteryEncounter") || phaseName === "PostMysteryEncounterPhase";
    default:
      return false;
  }
}

/** A UiMode that indicates an interactive menu is waiting (for the stall watchdog). */
function isInteractiveMenuMode(mode: UiMode): boolean {
  switch (mode) {
    case UiMode.CONFIRM:
    case UiMode.OPTION_SELECT:
    case UiMode.PARTY:
    case UiMode.MODIFIER_SELECT:
    case UiMode.BIOME_SHOP:
    case UiMode.ER_MAP:
    case UiMode.MYSTERY_ENCOUNTER:
    case UiMode.SUMMARY:
    case UiMode.POKEDEX_PAGE:
    case UiMode.EGG_HATCH_SUMMARY:
    case UiMode.EGG_HATCH_SCENE:
    case UiMode.SAVE_SLOT:
    case UiMode.LEARN_MOVE_BATCH:
      return true;
    default:
      return false;
  }
}

/** Reset the ME rate override to the game's natural spawn logic (undo the `chance(0)` clamp). */
function restoreNaturalMeRate(): void {
  vi.spyOn(Overrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(null);
  vi.spyOn(Overrides, "MYSTERY_ENCOUNTER_OVERRIDE", "get").mockReturnValue(null);
}

/** Apply the ME overrides for the wave the run is about to enter (force / allow / suppress). */
function applyMeOverridesForUpcomingWave(game: GameManager, st: RunState, upcomingWave: number): void {
  const forced = st.policy.forceMysteryEncounters.find(f => f.wave === upcomingWave);
  if (forced) {
    const t = resolveMeTypeName(forced.type);
    game.override.disableTrainerWaves();
    game.override.mysteryEncounterChance(100);
    if (t != null) {
      game.override.mysteryEncounter(t);
    }
    return;
  }
  if (st.policy.allowMysteryEncounters) {
    restoreNaturalMeRate();
    return;
  }
  game.override.mysteryEncounterChance(0);
  vi.spyOn(Overrides, "MYSTERY_ENCOUNTER_OVERRIDE", "get").mockReturnValue(null);
}

// --- Individual menu drivers (each drives the REAL handler input path) -----------

function driveReward(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
  const choice = st.policy.rewards[st.rewardCursor] ?? "SKIP";
  st.rewardCursor++;
  const options = handler.options ?? [];
  if (choice === "SKIP" || options.length === 0) {
    handler.processInput(Button.CANCEL); // opens the skip-confirm (autopilot ACTIONs it next tick)
    st.log.push("reward: SKIP");
    return;
  }
  let idx = 0;
  if (choice !== "FIRST") {
    const found = options.findIndex(o => o.modifierTypeOption?.type?.id === choice);
    idx = found >= 0 ? found : 0;
  }
  handler.setRowCursor(1); // the rewards row
  handler.setCursor(idx);
  handler.processInput(Button.ACTION);
  st.log.push(`reward: picked ${options[idx]?.modifierTypeOption?.type?.id ?? "?"}`);
}

function driveBiomeShop(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as BiomeShopUiHandler;
  const wave = game.scene.currentBattle?.waveIndex ?? 0;
  const buys = biomeShopBuysForWave(st.policy, wave);
  st.biomeShopDriven = true;
  if (buys.length === 0) {
    // Leave cleanly: CANCEL → confirmLeave() (hides shop, shows leave-confirm CONFIRM),
    // which the autopilot then ACTIONs (Yes) — biome-shop-phase.ts:106,140-162.
    handler.processInput(Button.CANCEL);
    st.log.push(`biome-shop w${wave}: leave`);
    return;
  }
  // NB: BiomeShopUiHandler.options is private, so specific-key buys can't be matched
  // without touching the handler (not in this agent's file set). Leave cleanly and
  // record the intended buys so a run never stalls; see the TODO in the report.
  handler.processInput(Button.CANCEL);
  st.log.push(`biome-shop w${wave}: leave (buys ${buys.join(",")} not driven — handler.options is private, see TODO)`);
}

function driveBiomePick(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as ErMapUiHandler;
  const wantName = st.policy.biomePicks[st.biomePickCursor];
  if (wantName !== undefined) {
    st.biomePickCursor++;
  }
  const want = resolveBiomeName(wantName);
  // The pick handler exposes no public onward-node reader, so derive the node order
  // from the shared routing state (getErPendingNodes → the SAME revealed set the
  // handler shows) to find the target index; default (want == null) = leftmost.
  let idx = 0;
  if (want != null) {
    const nodes = getErPendingNodes().filter(n => n.revealed);
    const found = nodes.findIndex(n => n.biome === want);
    idx = found >= 0 ? found : 0;
  }
  for (let i = 0; i < idx; i++) {
    handler.processInput(Button.RIGHT);
  }
  handler.processInput(Button.ACTION); // travel — er-map-ui-handler.ts:596-601
  st.log.push(`biome-pick: node ${idx}${want == null ? " (leftmost)" : ` (${BiomeId[want]})`}`);
}

function driveOptionSelect(game: GameManager, st: RunState, phaseName: string): void {
  const handler = game.scene.ui.getHandler() as AbstractOptionSelectUiHandler;
  handler.unblockInput?.();
  let idx = 0;
  if (phaseName === "ErCrossroadsPhase") {
    idx = st.policy.crossroads[st.crossroadCursor] ?? 0;
    if (st.crossroadCursor < st.policy.crossroads.length) {
      st.crossroadCursor++;
    }
    st.log.push(`crossroads: option ${idx}`);
  } else if (phaseName === "SelectBiomePhase") {
    // Vanilla biome-select (MapModifier held): leftmost node deterministically.
    idx = 0;
    st.log.push("biome-select(vanilla): option 0");
  }
  handler.setCursor(idx);
  handler.processInput(Button.ACTION);
}

function driveCatchFull(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as AbstractOptionSelectUiHandler;
  handler.unblockInput?.();
  st.catchFullDriven = true;
  const pol = st.policy.onCatchFull;
  // The party-full CONFIRM has 4 options: Summary(0), Pokédex(1), Yes/replace(2),
  // No/decline(3) — confirm-ui-handler.ts:31-61 + attempt-capture-phase.ts:377-448.
  if (pol === "release") {
    handler.setCursor(3);
    handler.processInput(Button.ACTION); // decline → removePokemon → run continues (no stall)
    st.log.push("catch-full: release (declined)");
    return;
  }
  handler.setCursor(2);
  handler.processInput(Button.ACTION); // Yes → opens PARTY (RELEASE) → the PARTY driver picks the slot
  st.log.push("catch-full: replace (open party)");
}

function driveEggLapse(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as AbstractOptionSelectUiHandler;
  handler.unblockInput?.();
  st.eggDriven = true;
  // egg-lapse CONFIRM ("skip hatching animation?", noCancel): YES(0)=skip anim+summary,
  // NO(1)=animated+no summary — egg-lapse-phase.ts:88-104.
  if (st.policy.eggs === "hatch") {
    handler.setCursor(0);
  } else {
    handler.setCursor(1);
  }
  handler.processInput(Button.ACTION);
  st.log.push(`eggs: ${st.policy.eggs}`);
}

function driveLearnMoveConfirm(game: GameManager, st: RunState): void {
  // LearnMovePhase CONFIRM (full moveset): ACTION advances the chain. On SUMMARY the
  // dedicated driver picks the forget slot (or the "new move" row = decline).
  game.scene.ui.processInput(Button.ACTION);
  st.log.push("learn-move: confirm");
}

function driveLearnMoveSummary(game: GameManager, st: RunState): void {
  const slot = st.policy.learnMove?.slot ?? game.scene.getPlayerParty()[0].getMaxMoveCount();
  game.scene.ui.setCursor(slot);
  game.scene.ui.processInput(Button.ACTION);
  st.log.push(st.policy.learnMove ? `learn-move: forget slot ${slot}` : "learn-move: declined");
}

/**
 * Select a party slot through the same public UI boundary as a player. The PARTY
 * screen can be active while its fade or internal block still rejects input, so
 * `false` deliberately leaves the current prompt/autopilot appearance retryable.
 */
function drivePartySelection(
  game: GameManager,
  slot: number,
  acceptedOptions: readonly PartyOption[] = [PartyOption.SEND_OUT, PartyOption.PASS_BATON],
): boolean {
  const handler = game.scene.ui.getHandler() as PartyUiHandler;
  const state = handler as unknown as {
    cursor?: number;
    options?: PartyOption[];
    optionsMode?: boolean;
  };
  if (state.optionsMode === true) {
    const selectionOption = partySelectionOption(state.options, acceptedOptions);
    if (state.cursor === slot && selectionOption >= 0) {
      // `setCursor` addresses the options cursor while this submenu is open.
      handler.setCursor(selectionOption);
      return game.scene.ui.processInput(Button.ACTION);
    }
    // Consecutive triple replacements can reopen with the prior active slot's
    // option menu still visible. Close that stale submenu before moving the
    // party cursor; otherwise option 0 can be Summary instead of Send Out.
    if (!game.scene.ui.processInput(Button.CANCEL)) {
      return false;
    }
  }
  handler.setCursor(slot);
  if (!game.scene.ui.processInput(Button.ACTION)) {
    return false;
  }
  if (game.scene.ui.getMode() !== UiMode.PARTY || !handler.active) {
    return true;
  }
  const selectionOption = partySelectionOption(state.options, acceptedOptions);
  if (state.optionsMode !== true || selectionOption < 0) {
    return false;
  }
  handler.setCursor(selectionOption);
  return game.scene.ui.processInput(Button.ACTION);
}

function partySelectionOption(options: PartyOption[] | undefined, acceptedOptions: readonly PartyOption[]): number {
  for (const acceptedOption of acceptedOptions) {
    const optionIndex = options?.indexOf(acceptedOption) ?? -1;
    if (optionIndex >= 0) {
      return optionIndex;
    }
  }
  return -1;
}

/** Use the production party filter to avoid repeatedly choosing a bench mon this exact prompt rejects. */
function partySlotCanSendOut(handler: PartyUiHandler, pokemon: Pokemon): boolean {
  const getFilterResult = (
    handler as unknown as { getFilterResult?: (option: PartyOption, candidate: Pokemon) => string | null }
  ).getFilterResult;
  return !getFilterResult || getFilterResult.call(handler, PartyOption.SEND_OUT, pokemon) === null;
}

function partySlotCanReplace(game: GameManager, handler: PartyUiHandler, pokemon: Pokemon, index: number): boolean {
  const battlerCount = game.scene.currentBattle.getBattlerCount();
  // PartyUiHandler only exposes SEND_OUT/PASS_BATON for indices at or beyond
  // battlerCount. A former field Pokemon can be off-field in the active prefix,
  // but selecting it opens only the common options and strands the public-UI driver.
  return index >= battlerCount && pokemon.isAllowedInBattle() && partySlotCanSendOut(handler, pokemon);
}

function driveParty(game: GameManager, st: RunState, phaseName: string): boolean {
  st.partyTicks++;
  const handler = game.scene.ui.getHandler() as PartyUiHandler;
  const partyUiMode = (handler as unknown as { partyUiMode?: PartyUiMode }).partyUiMode;
  if (phaseName === "RevivalBlessingPhase") {
    const slot = game.scene.getPlayerParty().findIndex(pokemon => pokemon.isFainted());
    if (slot < 0) {
      throw new Error("Revival Blessing opened its party target menu without a fainted Pokemon");
    }
    const handled = drivePartySelection(game, slot, [PartyOption.REVIVE]);
    if (handled) {
      st.log.push(`revival-blessing -> party[${slot}]`);
    }
    return handled;
  }
  if (
    partyUiMode === PartyUiMode.SWITCH
    || partyUiMode === PartyUiMode.FAINT_SWITCH
    || partyUiMode === PartyUiMode.POST_BATTLE_SWITCH
  ) {
    const party = game.scene.getPlayerParty();
    const slot = party.findIndex((pokemon, index) => partySlotCanReplace(game, handler, pokemon, index));
    if (slot < 0) {
      st.lastPartyAttempt = `${phaseName}: no legal bench slot`;
      return true;
    }
    const handled = drivePartySelection(game, slot);
    st.lastPartyAttempt = `${phaseName}: slot=${slot} handled=${handled}`;
    if (handled) {
      st.log.push(`faint-switch → party[${slot}]`);
    }
    return handled;
  }
  if (phaseName === "AttemptCapturePhase") {
    // Party-full replace: RELEASE mode → pick the slot to release (keep = slot 0).
    const pol = st.policy.onCatchFull;
    const slot = typeof pol === "object" ? pol.replaceSlot : 0;
    handler.setCursor(slot);
    const handled = game.scene.ui.processInput(Button.ACTION);
    if (handled) {
      st.log.push(`catch-full: replace slot ${slot}`);
    }
    return handled;
  }
  // Reward party-target (SelectModifierPhase): apply the reward to the lead.
  const handled = drivePartySelection(game, 0, [PartyOption.APPLY]);
  if (handled) {
    st.log.push("reward-target → lead");
  }
  return handled;
}

function driveMysteryEncounter(game: GameManager, st: RunState): void {
  const handler = game.scene.ui.getHandler() as MysteryEncounterUiHandler;
  handler.unblockInput();
  const path = st.policy.meOptions[st.meCursor] ?? [0];
  st.meCursor++;
  st.meDriven = true;
  const top = path[0] ?? 0;
  // 2×2 option grid navigation (mirrors encounter-test-utils optionNo→button mapping).
  if (top === 1) {
    handler.processInput(Button.RIGHT);
  } else if (top === 2) {
    handler.processInput(Button.DOWN);
  } else if (top === 3) {
    handler.processInput(Button.RIGHT);
    handler.processInput(Button.DOWN);
  }
  handler.processInput(Button.ACTION);
  st.log.push(`ME: option ${top}`);
  // One-shot: stop the forced-ME rate override from cascading onto the very next
  // NewBattlePhase(s) (a single between-wave advance can create several waves). The
  // next real advance re-applies the correct override for its upcoming wave.
  if (st.policy.allowMysteryEncounters) {
    restoreNaturalMeRate();
  } else {
    game.override.mysteryEncounterChance(0);
    vi.spyOn(Overrides, "MYSTERY_ENCOUNTER_OVERRIDE", "get").mockReturnValue(null);
  }
}

/** Dispatch the current menu to its driver. Returns whether a driver handled it. */
function dispatchMenu(game: GameManager, st: RunState, phaseName: string, mode: UiMode): boolean {
  switch (mode) {
    case UiMode.MODIFIER_SELECT:
      driveReward(game, st);
      return true;
    case UiMode.BIOME_SHOP:
      driveBiomeShop(game, st);
      return true;
    case UiMode.ER_MAP:
      driveBiomePick(game, st);
      return true;
    case UiMode.OPTION_SELECT:
      if (phaseName.startsWith("MysteryEncounter")) {
        game.scene.ui.processInput(Button.ACTION); // ME secondary option-select: take the default
        return true;
      }
      driveOptionSelect(game, st, phaseName);
      return true;
    case UiMode.CONFIRM:
      if (phaseName === "EggLapsePhase") {
        driveEggLapse(game, st);
      } else if (phaseName === "AttemptCapturePhase") {
        driveCatchFull(game, st);
      } else if (phaseName === "LearnMovePhase") {
        driveLearnMoveConfirm(game, st);
      } else if (phaseName === "CheckSwitchPhase") {
        (game.scene.ui.getHandler() as AbstractOptionSelectUiHandler).unblockInput?.();
        game.scene.ui.setCursor(1); // "No" — don't switch at wave start
        game.scene.ui.processInput(Button.ACTION);
      } else {
        // SelectModifierPhase: reward-skip confirm / biome-shop leave confirm → Yes.
        (game.scene.ui.getHandler() as AbstractOptionSelectUiHandler).unblockInput?.();
        game.scene.ui.processInput(Button.ACTION);
      }
      return true;
    case UiMode.PARTY:
      return driveParty(game, st, phaseName);
    case UiMode.TARGET_SELECT: {
      // Explicit per-slot prompts carry the model's selected target and always
      // win. Only confirm the handler default when this exact actor has no prompt
      // (for example, a stale virtual command on a newly-fainted field slot).
      if (game.promptHandler.hasMatchingPrompt()) {
        return false;
      }
      const phase = game.scene.phaseManager.getCurrentPhase() as SelectTargetPhase;
      const actor = phase.getPokemon().getBattlerIndex();
      const handled = game.scene.ui.processInput(Button.ACTION);
      if (handled) {
        st.log.push(`slot${actor}: automatic target confirmation`);
      }
      return handled;
    }
    case UiMode.SUMMARY:
      if (COMBAT_BATCH && phaseName === "SwitchPhase") {
        return game.scene.ui.processInput(Button.CANCEL);
      }
      if (phaseName === "LearnMovePhase") {
        driveLearnMoveSummary(game, st);
      } else {
        game.scene.ui.processInput(Button.ACTION); // dismiss the caught-mon summary
      }
      return true;
    case UiMode.MYSTERY_ENCOUNTER:
      driveMysteryEncounter(game, st);
      return true;
    case UiMode.LEARN_MOVE_BATCH:
      // Decline the whole batch deterministically: Cancel opens the confirmation,
      // Right selects "Yes", and Action exits without altering the moveset.
      game.scene.ui.processInput(Button.CANCEL);
      game.scene.ui.processInput(Button.RIGHT);
      game.scene.ui.processInput(Button.ACTION);
      st.log.push("learn-move-batch: declined");
      return true;
    case UiMode.MESSAGE:
      game.scene.ui.processInput(Button.ACTION); // advance ME intro/outro dialogue
      return true;
    default:
      return false;
  }
}

const STALL_MS = 4000; // how long an unhandled interactive menu may persist before acting

/** One autopilot tick: drive the current menu if it's one we own; watchdog otherwise. */
function autopilotTick(game: GameManager, st: RunState): void {
  st.autopilotTicks++;
  const ui = game.scene.ui;
  const mode = ui.getMode();
  const handler = ui.getHandler();
  const phase = game.scene.phaseManager.getCurrentPhase();
  const phaseName = phase?.phaseName ?? "";
  if (!handler?.active) {
    return;
  }

  // Multi-slot command menus are asynchronous. A late FIGHT/COMMAND surface from
  // the previous field slot can otherwise cover the next slot's CommandPhase and
  // leave every actor-keyed prompt correctly refusing to submit against the wrong
  // Pokemon. Restore the public command menu for the phase's actual actor; the
  // matching prompt then continues through the same UI path as a player.
  if (COMBAT_BATCH && phaseName === "CommandPhase" && (mode === UiMode.COMMAND || mode === UiMode.FIGHT)) {
    const phaseActor = (phase as CommandPhase).getFieldIndex();
    const handlerActor = (handler as unknown as { fieldIndex?: number }).fieldIndex;
    if (handlerActor != null && handlerActor !== phaseActor) {
      void game.scene.ui.setMode(UiMode.COMMAND, phaseActor);
      st.log.push(`command surface realigned: slot${handlerActor} -> slot${phaseActor}`);
      st.lastDrivenPhase = null;
      st.lastDrivenMode = null;
      st.lastDrivenPartyCallback = null;
      return;
    }
  }

  // Repeatable dismiss modes: a block-timer gates them (egg-summary-ui-handler.ts:222,
  // blockExit for ~1s), so press EACH tick until they clear — NOT sig-guarded.
  if (mode === UiMode.EGG_HATCH_SUMMARY) {
    game.scene.ui.processInput(Button.CANCEL); // egg summary dismisses on CANCEL once blockExit elapses
    st.lastDrivenPhase = null;
    st.lastDrivenMode = null;
    st.lastDrivenPartyCallback = null;
    return;
  }
  if (mode === UiMode.EGG_HATCH_SCENE) {
    game.scene.ui.processInput(Button.ACTION); // skip the animated hatch scene
    st.lastDrivenPhase = null;
    st.lastDrivenMode = null;
    st.lastDrivenPartyCallback = null;
    return;
  }

  // Battle text can occasionally request an explicit player acknowledgement
  // without inserting a MessagePhase (for example, an effect reached from
  // MovePhase). A real player advances it through the public UI. Combat batches
  // must do the same, but only after the handler proves it is ready; ordinary
  // animated battle text keeps awaitingActionInput=false and is left alone.
  if (COMBAT_BATCH && mode === UiMode.MESSAGE && handlerAwaitingInput(handler)) {
    game.scene.ui.processInput(Button.ACTION);
    st.lastDrivenPhase = null;
    st.lastDrivenMode = null;
    st.lastDrivenPartyCallback = null;
    return;
  }

  // A rejected party option displays an acknowledgement prompt without changing
  // the phase or mode. Clear it through the public UI before selecting another
  // legal bench member.
  if (mode === UiMode.PARTY && (handler as { awaitingActionInput?: unknown }).awaitingActionInput === true) {
    game.scene.ui.processInput(Button.ACTION);
    st.lastDrivenPhase = null;
    st.lastDrivenMode = null;
    st.lastDrivenPartyCallback = null;
    return;
  }

  // Voluntary switches already have an actor-scoped PromptHandler callback that
  // selects the policy's exact reserve. Letting the generic menu autopilot drive
  // the same PARTY surface can replace that choice with the first legal bench
  // slot, strand the original prompt, or select one reserve for two doubles seats.
  if (COMBAT_BATCH && mode === UiMode.PARTY && game.promptHandler.hasMatchingPrompt()) {
    return;
  }

  if (isAutopilotMode(phaseName, mode, handler)) {
    const partyCallback =
      mode === UiMode.PARTY ? ((handler as unknown as { selectCallback?: unknown }).selectCallback ?? null) : null;
    if (
      phase === st.lastDrivenPhase
      && mode === st.lastDrivenMode
      && (mode !== UiMode.PARTY || partyCallback === st.lastDrivenPartyCallback)
    ) {
      return; // already driven this appearance; wait for the transition it triggers
    }
    // The reward shop + ME/ intro MESSAGE handlers (AwaitableUiHandler) IGNORE input
    // until `awaitingActionInput` flips true (modifier-select-ui-handler.ts:471). Wait
    // for that WITHOUT marking the appearance driven, so we don't press into the void.
    if ((mode === UiMode.MODIFIER_SELECT || mode === UiMode.MESSAGE) && !handlerAwaitingInput(handler)) {
      return;
    }
    if (dispatchMenu(game, st, phaseName, mode)) {
      st.lastDrivenPhase = phase ?? null;
      st.lastDrivenMode = mode;
      // Remember the callback for the appearance we just drove. A successful party
      // selection may synchronously clear or replace handler.selectCallback before
      // processInput returns; reading it again here makes the still-visible old prompt
      // look new and can submit the same sole reserve twice.
      st.lastDrivenPartyCallback = mode === UiMode.PARTY ? partyCallback : null;
      st.stallSince = 0;
      st.stallMode = null;
    }
    return;
  }

  // Not a menu we own. Reset the per-appearance guard so a repeat drivable menu re-fires.
  st.lastDrivenPhase = null;
  st.lastDrivenMode = null;
  st.lastDrivenPartyCallback = null;

  // CATCH-ALL FUTURE-PROOFING: an interactive menu with no registered driver.
  if (isInteractiveMenuMode(mode) && phaseName !== "CommandPhase") {
    if (st.stallSince === 0) {
      st.stallSince = Date.now();
      st.stallMode = `${getUiModeName(mode)} during ${phaseName}`;
    } else if (Date.now() - st.stallSince > STALL_MS) {
      if (st.policy.autoFirst) {
        // Press through deterministically so future content never hard-hangs a run.
        game.scene.ui.processInput(Button.ACTION);
        game.scene.ui.processInput(Button.CANCEL);
        st.autoFirstLog.push(`[auto-first] ${st.stallMode}`);
        console.log(`[auto-first] ${st.stallMode}`);
        st.stallSince = Date.now(); // re-arm in case it needs another press
      } else if (!st.driveError) {
        // FAIL LOUDLY naming the mode (the default). Surfaced by the main loop.
        st.driveError = new Error(
          `Unhandled interactive menu (no driver): ${st.stallMode}. Use --auto-first to press through.`,
        );
      }
    }
  } else {
    st.stallSince = 0;
    st.stallMode = null;
  }
}

function getUiModeName(mode: UiMode): string {
  return UiMode[mode] ?? String(mode);
}

/** Whether an AwaitableUiHandler is ready to accept input (undefined field = not awaitable → ready). */
function handlerAwaitingInput(handler: object): boolean {
  const awaiting = (handler as { awaitingActionInput?: unknown }).awaitingActionInput;
  return typeof awaiting === "boolean" ? awaiting : true;
}

/** Install the polling autopilot (mirrors PromptHandler's interval). Returns a stopper. */
function installMenuAutopilot(game: GameManager, st: RunState): () => void {
  const handle = setInterval(() => {
    try {
      autopilotTick(game, st);
    } catch (err) {
      // Never let a throw escape the interval (it would crash the process); record it
      // so the main loop can surface it with context.
      if (!st.driveError) {
        st.driveError = err;
      }
    }
  });
  return () => clearInterval(handle);
}

/** A one-line per-wave summary of a played battle wave. */
interface WaveSummary {
  wave: number;
  turns: number;
  result: string;
  ms: number;
  playerAlive: number;
  enemyName: string;
}

interface RunnerStateSnapshot {
  money: number;
  terrain: string | null;
  terrainTurnsLeft: number | null;
  pokeballs: Record<string, number>;
  party: Array<{ species: string; level: number; exp: number; heldItems: string[] }>;
  playerNature: string | null;
  enemyNature: string | null;
  playerHeldItems: string[];
  enemyHeldItems: string[];
  biomeOptions: string[];
}

function biomeName(id: BiomeId): string {
  return Object.entries(BiomeId).find(([, value]) => value === id)?.[0] ?? String(id);
}

function captureRunnerState(game: GameManager, biomeOptions?: string[]): RunnerStateSnapshot {
  const player = game.scene.getPlayerField()[0];
  const enemy = game.scene.getEnemyField()[0];
  const pokeballs: Record<string, number> = {};
  for (const [name, value] of Object.entries(PokeballType)) {
    if (typeof value === "number") {
      pokeballs[name] = game.scene.pokeballCounts[value] ?? 0;
    }
  }
  return {
    money: game.scene.money,
    terrain: game.scene.arena?.terrain ? TerrainType[game.scene.arena.terrain.terrainType] : null,
    terrainTurnsLeft: game.scene.arena?.terrain?.turnsLeft ?? null,
    pokeballs,
    party: game.scene.getPlayerParty().map(mon => ({
      species: mon.species.name,
      level: mon.level,
      exp: mon.exp,
      heldItems: heldItemNames(mon),
    })),
    playerNature: player ? Nature[player.nature] : null,
    enemyNature: enemy ? Nature[enemy.nature] : null,
    playerHeldItems: heldItemNames(player),
    enemyHeldItems: heldItemNames(enemy),
    biomeOptions:
      biomeOptions
      ?? getErPendingNodes()
        .filter(node => node.revealed)
        .map(node => biomeName(node.biome)),
  };
}

interface RunResult {
  outcome: "victory" | "player-wiped" | "max-waves" | "max-turns" | "error";
  startWave: number;
  finalWave: number;
  wavesCleared: number;
  waves: WaveSummary[];
  totalMs: number;
  bootToRunMs: number;
  log: string;
  fullLog: string;
  meDriven: boolean;
  catchFullDriven: boolean;
  eggDriven: boolean;
  biomeShopDriven: boolean;
  autoFirstLog: string[];
  state: RunnerStateSnapshot;
}

/**
 * Build a per-slot default action entirely from the engine adapter's legal candidate
 * set. In triples, the first live foe can be outside a wing Pokemon's reach; assigning
 * that flat battler index directly creates an action that combat has to retarget and
 * that cannot serve as a supervised-learning label.
 */
function smartDefaultAction(game: GameManager): TurnAction {
  const action: TurnAction = {};
  const earlier: ErCombatEarlierChoice[] = [];
  const field = game.scene.getPlayerField();
  for (let actorSlot = 0; actorSlot < field.length; actorSlot++) {
    const actor = field[actorSlot];
    if (!actor?.isActive(true) || actor.isFainted() || slotCommandIsAutomatic(game, actor)) {
      continue;
    }
    const moveCandidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier).filter(
      (candidate): candidate is ErCombatMoveCandidate => candidate.kind === "move" && !candidate.tera,
    );
    const damaging = moveCandidates.filter(candidate => allMoves[candidate.moveId].category !== MoveCategory.STATUS);
    const pool = damaging.length > 0 ? damaging : moveCandidates;
    const chosen = pool.sort((a, b) => b.baseTypeMultiplier - a.baseTypeMultiplier || a.id.localeCompare(b.id))[0];
    if (!chosen) {
      continue;
    }
    setCandidateAction(game, action, actorSlot, chosen);
    earlier.push({ kind: chosen.kind, id: chosen.id, tera: chosen.tera });
  }
  return action;
}

/**
 * Player-side adapter for the shipped hardest trainer AI. It reuses the exact
 * EnemyPokemon move chooser once, then maps that choice back to a legal public
 * candidate. The switch comparison mirrors EnemyCommandPhase's threshold rule.
 */
function engineHardestAction(game: GameManager): TurnAction {
  const action: TurnAction = {};
  const earlier: ErCombatEarlierChoice[] = [];
  for (let actorSlot = 0; actorSlot < game.scene.getPlayerField().length; actorSlot++) {
    const actor = game.scene.getPlayerField()[actorSlot];
    if (!actor?.isActive(true) || actor.isFainted() || slotCommandIsAutomatic(game, actor)) {
      continue;
    }
    const candidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier).filter(
      candidate => candidate.kind !== "shift",
    );
    const switchCandidate = engineHardestSwitchCandidate(game, actor, candidates);
    const chosen = switchCandidate ?? engineHardestMoveCandidate(game, actor, candidates);
    if (!chosen) {
      throw new Error(
        `engine-hardest-v1 produced no legal action for actor slot ${actorSlot}; candidates=${candidates
          .map(candidate => candidate.id)
          .join(",")}`,
      );
    }
    setCandidateAction(game, action, actorSlot, chosen);
    earlier.push({
      kind: chosen.kind,
      id: chosen.id,
      ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
      ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
    });
  }
  return action;
}

function engineHardestSwitchCandidate(
  game: GameManager,
  actor: Pokemon,
  candidates: readonly ErCombatCandidate[],
): ErCombatCandidate | null {
  if (actor.isTrapped() || actor.getMoveQueue().length > 0) {
    return null;
  }
  const switchCandidates = candidates.filter(candidate => candidate.kind === "switch");
  const opponents = actor.getOpponents().filter(opponent => opponent.isAllowedInBattle());
  if (switchCandidates.length === 0 || opponents.length === 0) {
    return null;
  }
  const scorePokemon = (pokemon: Pokemon): number => {
    let score = 0;
    for (const opponent of opponents) {
      score += pokemon.getMatchupScore(opponent, true);
      if (opponent.species.legendary) {
        score /= 2;
      }
    }
    return score / opponents.length;
  };
  const ranked = switchCandidates
    .map(candidate => ({ candidate, score: scorePokemon(game.scene.getPlayerParty()[candidate.partyIndex]) }))
    .sort((a, b) => b.score - a.score || a.candidate.partyIndex - b.candidate.partyIndex);
  const activeScore = scorePokemon(actor);
  const aiActor = actor as unknown as EnemyPokemon;
  const profile = getErAiProfile(aiActor);
  let threshold = profile.active ? profile.switchThreshold : 3;
  if (profile.active) {
    const threat = erAssessThreat(aiActor);
    if (threat.incomingKO && !threat.outspeeds) {
      threshold *= ER_DOOMED_SWITCH_THRESHOLD_MULT;
    }
  }
  const switchMultiplier = 1 - (enginePlayerSwitchCounter ? Math.pow(0.1, 1 / enginePlayerSwitchCounter) : 0);
  if (ranked[0].score * switchMultiplier < activeScore * threshold) {
    enginePlayerSwitchCounter = Math.max(enginePlayerSwitchCounter - 1, 0);
    return null;
  }
  enginePlayerSwitchCounter++;
  return ranked[0].candidate;
}

function engineHardestMoveCandidate(
  game: GameManager,
  actor: Pokemon,
  candidates: readonly ErCombatCandidate[],
): ErCombatCandidate | null {
  const nextMove = chooseEngineHardestMove(actor);
  enginePlayerSwitchCounter = Math.max(enginePlayerSwitchCounter - 1, 0);
  const moveSlot = actor.getMoveset().findIndex(move => move.moveId === nextMove.move);
  const targets = nextMove.targets
    .map(target => perspectiveTargetRef(game.scene, "player", target))
    .filter((target): target is ErCombatTargetRef => target != null);
  const matches = candidates.filter(
    candidate =>
      candidate.kind === "move"
      && candidate.moveId === nextMove.move
      && candidate.moveSlot === moveSlot
      && !candidate.tera
      && (candidate.targetMode === "random" || sameTargetSet(candidate.targets, targets)),
  );
  if (matches.length === 1) {
    return matches[0];
  }
  throw new Error(
    `engine-hardest-v1 decision did not map to exactly one legal candidate: actor=${actor.getNameToRender()} `
      + `move=${MoveId[nextMove.move]} slot=${moveSlot} targets=${targets
        .map(target => `${target.side}:${target.activeSlot}`)
        .join(",")} matches=${matches.length}`,
  );
}

/** Run the enemy chooser against the real battler so tags such as Disable retain identity semantics. */
function chooseEngineHardestMove(actor: Pokemon): TurnMove {
  const aiActor = actor as unknown as EnemyPokemon;
  const aiTypeDescriptor = Object.getOwnPropertyDescriptor(actor, "aiType");
  const getNextTargetsDescriptor = Object.getOwnPropertyDescriptor(actor, "getNextTargets");
  const originalMoveQueue = actor.getMoveQueue().slice();

  Object.defineProperty(actor, "aiType", {
    configurable: true,
    writable: true,
    value: AiType.SMART,
  });
  Object.defineProperty(actor, "getNextTargets", {
    configurable: true,
    writable: true,
    value: (moveId: MoveId) => EnemyPokemon.prototype.getNextTargets.call(aiActor, moveId),
  });

  try {
    return EnemyPokemon.prototype.getNextMove.call(aiActor);
  } finally {
    actor.summonData.moveQueue = originalMoveQueue;
    if (aiTypeDescriptor) {
      Object.defineProperty(actor, "aiType", aiTypeDescriptor);
    } else {
      delete (actor as Pokemon & { aiType?: AiType }).aiType;
    }
    if (getNextTargetsDescriptor) {
      Object.defineProperty(actor, "getNextTargets", getNextTargetsDescriptor);
    } else {
      delete (actor as Pokemon & { getNextTargets?: EnemyPokemon["getNextTargets"] }).getNextTargets;
    }
  }
}

function setCandidateAction(
  game: GameManager,
  action: TurnAction,
  actorSlot: number,
  candidate: ErCombatCandidate,
): void {
  const targetRef =
    candidate.kind === "move" && !allMoves[candidate.moveId].isMultiTarget() && candidate.targets.length === 1
      ? candidate.targets[0]
      : undefined;
  const targetMon = targetRef
    ? (targetRef.side === "self" ? game.scene.getPlayerField() : game.scene.getEnemyField())[targetRef.activeSlot]
    : undefined;
  const target = targetMon?.getBattlerIndex();
  const chosenAction: SlotAction =
    candidate.kind === "move"
      ? { move: candidate.moveId, tera: candidate.tera, target }
      : candidate.kind === "switch"
        ? { switch: candidate.partyIndex, switchTransfer: candidate.transfer }
        : {};
  if (actorSlot === 0) {
    Object.assign(action, chosenAction);
  } else if (actorSlot === 1) {
    if (chosenAction.move !== undefined) {
      action.move2 = chosenAction.move;
    }
    if (chosenAction.target !== undefined) {
      action.target2 = chosenAction.target;
    }
    if (chosenAction.tera !== undefined) {
      action.tera2 = chosenAction.tera;
    }
    if (chosenAction.switch !== undefined) {
      action.switch2 = chosenAction.switch;
      if (chosenAction.switchTransfer !== undefined) {
        action.switch2Transfer = chosenAction.switchTransfer;
      }
    }
  } else {
    if (chosenAction.move !== undefined) {
      action.move3 = chosenAction.move;
    }
    if (chosenAction.target !== undefined) {
      action.target3 = chosenAction.target;
    }
    if (chosenAction.tera !== undefined) {
      action.tera3 = chosenAction.tera;
    }
    if (chosenAction.switch !== undefined) {
      action.switch3 = chosenAction.switch;
      if (chosenAction.switchTransfer !== undefined) {
        action.switch3Transfer = chosenAction.switchTransfer;
      }
    }
  }
}

function deterministicPolicyFraction(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function deterministicRandomCandidate(
  candidates: readonly ErCombatCandidate[],
  policyKey: string,
): ErCombatCandidate | null {
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const index = Math.floor(deterministicPolicyFraction(policyKey) * ordered.length);
  return ordered[index] ?? null;
}

function randomPolicyAction(game: GameManager): TurnAction {
  const observation = snapshotErCombatObservation(game.scene);
  const action: TurnAction = {};
  const earlier: ErCombatEarlierChoice[] = [];
  for (let actorSlot = 0; actorSlot < game.scene.getPlayerField().length; actorSlot++) {
    const actor = game.scene.getPlayerField()[actorSlot];
    if (!actor?.isActive(true) || actor.isFainted() || slotCommandIsAutomatic(game, actor)) {
      continue;
    }
    const candidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier).filter(
      candidate => candidate.kind !== "shift",
    );
    const chosen = deterministicRandomCandidate(
      candidates,
      `${activeAiEpisodeId}:${observation.wave}:${observation.turn}:${actorSlot}:player:random`,
    );
    if (!chosen) {
      throw new Error(
        `random-v1 produced no legal action for actor slot ${actorSlot}; candidates=${candidates
          .map(candidate => candidate.id)
          .join(",")}`,
      );
    }
    setCandidateAction(game, action, actorSlot, chosen);
    earlier.push({
      kind: chosen.kind,
      id: chosen.id,
      ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
      ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
    });
  }
  return action;
}

function chooseTreeCandidate(
  model: ErTreeModelArtifact,
  observation: ErCombatDecisionRecord["observation"],
  candidates: ErCombatCandidate[],
  epsilon: number,
  policyKey: string,
): ErCombatCandidate | null {
  const scopedCandidates =
    model.candidateScope === "move-only" ? candidates.filter(candidate => candidate.kind === "move") : candidates;
  if (scopedCandidates.length === 0) {
    return null;
  }
  const ranked = scopedCandidates
    .map(candidate => ({
      candidate,
      score: scoreErTreeModel(model, extractErCombatCandidateFeatures(observation, candidate)),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const explore = epsilon > 0 && deterministicPolicyFraction(`${policyKey}:explore`) < epsilon;
  const randomIndex = Math.floor(deterministicPolicyFraction(`${policyKey}:candidate`) * scopedCandidates.length);
  return (explore ? scopedCandidates[randomIndex] : ranked[0]?.candidate) ?? ranked[0]?.candidate ?? null;
}

async function chooseNeuralCandidate(
  client: AiNeuralPolicyClient,
  contextId: string,
  observation: ErCombatDecisionRecord["observation"],
  candidates: ErCombatCandidate[],
  epsilon: number,
  policyKey: string,
): Promise<ErCombatCandidate | null> {
  if (candidates.length === 0) {
    return null;
  }
  const features = candidates.map(candidate => extractErCombatCandidateFeatures(observation, candidate));
  const tokenGroups = candidates.map(candidate => extractErCombatCandidateTokenGroups(observation, candidate));
  const scores = await client.score(contextId, features, tokenGroups);
  if (scores.length !== candidates.length) {
    throw new Error(`neural policy returned ${scores.length} scores for ${candidates.length} candidates`);
  }
  const ranked = candidates
    .map((candidate, index) => ({ candidate, score: scores[index] }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const explore = epsilon > 0 && deterministicPolicyFraction(`${policyKey}:explore`) < epsilon;
  const randomIndex = Math.floor(deterministicPolicyFraction(`${policyKey}:candidate`) * candidates.length);
  const chosen = (explore ? candidates[randomIndex] : ranked[0]?.candidate) ?? ranked[0]?.candidate ?? null;
  if (chosen) {
    client.commit(contextId, features, tokenGroups, candidates.indexOf(chosen));
  }
  return chosen;
}

function treeModelAction(game: GameManager, model: ErTreeModelArtifact): TurnAction {
  const observation = snapshotErCombatObservation(game.scene);
  const action: TurnAction = {};
  const earlier: ErCombatEarlierChoice[] = [];
  const field = game.scene.getPlayerField();
  for (let actorSlot = 0; actorSlot < field.length; actorSlot++) {
    const actor = field[actorSlot];
    if (!actor?.isActive(true) || actor.isFainted() || slotCommandIsAutomatic(game, actor)) {
      continue;
    }
    // Shift commands are not yet represented by TurnAction; doubles (the baseline
    // training/eval format) never enumerate them. Keep triple data legal but do not
    // let an unsupported action leak into execution.
    const candidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier).filter(
      candidate => candidate.kind !== "shift",
    );
    const policyKey = `${activeAiEpisodeId}:${observation.wave}:${observation.turn}:${actorSlot}`;
    const chosen = chooseTreeCandidate(model, observation, candidates, AI_POLICY_EPSILON, policyKey);
    if (!chosen) {
      continue;
    }
    setCandidateAction(game, action, actorSlot, chosen);
    earlier.push({
      kind: chosen.kind,
      id: chosen.id,
      ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
      ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
    });
  }
  return action;
}

async function neuralModelAction(game: GameManager, client: AiNeuralPolicyClient): Promise<TurnAction> {
  const observation = snapshotErCombatObservation(game.scene);
  const action: TurnAction = {};
  const earlier: ErCombatEarlierChoice[] = [];
  const field = game.scene.getPlayerField();
  for (let actorSlot = 0; actorSlot < field.length; actorSlot++) {
    const actor = field[actorSlot];
    if (!isNeuralPolicyActor(game, actor)) {
      continue;
    }
    const candidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier).filter(
      candidate => candidate.kind !== "shift",
    );
    if (candidates.length === 0) {
      continue;
    }
    const policyKey = `${activeAiEpisodeId}:${observation.wave}:${observation.turn}:${actorSlot}`;
    const chosen = await chooseNeuralCandidate(
      client,
      `${activeAiEpisodeId}:seat-player`,
      observation,
      candidates,
      AI_POLICY_EPSILON,
      policyKey,
    );
    if (!chosen) {
      continue;
    }
    setCandidateAction(game, action, actorSlot, chosen);
    earlier.push({
      kind: chosen.kind,
      id: chosen.id,
      ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
      ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
    });
  }
  return action;
}

function isNeuralPolicyActor(game: GameManager, actor: Pokemon | undefined): actor is Pokemon {
  return !!actor?.isActive(true) && !actor.isFainted() && !slotCommandIsAutomatic(game, actor);
}

async function unattendedPolicyAction(game: GameManager): Promise<TurnAction> {
  if (AI_TREE_MODEL) {
    return treeModelAction(game, AI_TREE_MODEL);
  }
  if (AI_NEURAL_CLIENT) {
    return await neuralModelAction(game, AI_NEURAL_CLIENT);
  }
  if (AI_POLICY_MODE === "engine-hardest") {
    return engineHardestAction(game);
  }
  if (AI_POLICY_MODE === "random") {
    return randomPolicyAction(game);
  }
  return smartDefaultAction(game);
}

function policyTarget(override: string, fallback: boolean): boolean {
  return override ? override === "1" : fallback;
}

function defaultUnattendedPolicySource(): ErCombatPolicySource {
  if (AI_TREE_MODEL) {
    return AI_POLICY_EPSILON > 0 ? "epsilon-tree-v1" : "tree-model-v1";
  }
  if (AI_NEURAL_CLIENT) {
    return AI_POLICY_EPSILON > 0 ? "epsilon-trajectory-neural-v3" : "trajectory-neural-v3";
  }
  if (AI_POLICY_MODE === "engine-hardest") {
    return "engine-hardest-v1";
  }
  if (AI_POLICY_MODE === "random") {
    return "random-v1";
  }
  return "smart-default-v1";
}

function unattendedPolicyMetadata(): PolicyCaptureMetadata {
  return {
    policySource: AI_POLICY_SOURCE ?? defaultUnattendedPolicySource(),
    policyTarget: policyTarget(AI_POLICY_TARGET_OVERRIDE, !!AI_NEURAL_CLIENT),
  };
}

function customOpponentPolicyMetadata(): PolicyCaptureMetadata {
  if (AI_OPPONENT_TREE_MODEL) {
    return {
      policySource: AI_OPPONENT_POLICY_SOURCE ?? "checkpoint-tree-v1",
      policyTarget: policyTarget(AI_OPPONENT_POLICY_TARGET_OVERRIDE, true),
    };
  }
  if (AI_OPPONENT_NEURAL_CLIENT) {
    return {
      policySource: AI_OPPONENT_POLICY_SOURCE ?? "checkpoint-neural-v4",
      policyTarget: policyTarget(AI_OPPONENT_POLICY_TARGET_OVERRIDE, true),
    };
  }
  if (AI_OPPONENT_POLICY_MODE === "random") {
    return {
      policySource: AI_OPPONENT_POLICY_SOURCE ?? "random-v1",
      policyTarget: policyTarget(AI_OPPONENT_POLICY_TARGET_OVERRIDE, false),
    };
  }
  return {
    policySource: AI_OPPONENT_POLICY_SOURCE ?? "first-usable",
    policyTarget: policyTarget(AI_OPPONENT_POLICY_TARGET_OVERRIDE, false),
  };
}

function resolveCandidateTargets(
  game: GameManager,
  actor: Pokemon,
  candidate: ErCombatMoveCandidate,
  perspective: CombatCapturePerspective,
): BattlerIndex[] {
  if (candidate.targetMode === "random" || candidate.targets.length === 0) {
    return getMoveTargets(actor, candidate.moveId).targets as BattlerIndex[];
  }
  const selfField = perspective === "player" ? game.scene.getPlayerField() : game.scene.getEnemyField();
  const opponentField = perspective === "player" ? game.scene.getEnemyField() : game.scene.getPlayerField();
  return candidate.targets.map(target => {
    const field = target.side === "self" ? selfField : opponentField;
    const pokemon = field.find(mon => mon.id === target.entityId);
    const battlerIndex = pokemon?.getBattlerIndex();
    if (pokemon == null || battlerIndex == null || !pokemon.isActive(true)) {
      throw new Error(`candidate target is no longer active: ${JSON.stringify(target)}`);
    }
    return battlerIndex;
  });
}

function commitOpponentCandidate(
  game: GameManager,
  actorSlot: number,
  actor: Pokemon,
  candidate: ErCombatCandidate,
): void {
  const battle = game.scene.currentBattle;
  const flatSlot = battle.arrangement.enemyOffset + actorSlot;
  if (candidate.kind === "switch") {
    battle.turnCommands[flatSlot] = {
      command: Command.POKEMON,
      cursor: candidate.partyIndex,
      args: [candidate.transfer === "baton"],
      skip: false,
    };
    return;
  }
  if (candidate.kind === "shift") {
    battle.turnCommands[flatSlot] = {
      command: Command.SHIFT,
      cursor: candidate.targetActorSlot,
      skip: false,
    };
    return;
  }
  if (candidate.tera) {
    battle.preTurnCommands[flatSlot] = { command: Command.TERA };
  }
  battle.turnCommands[flatSlot] = {
    command: Command.FIGHT,
    cursor: candidate.moveSlot,
    move: {
      move: candidate.moveId,
      targets: resolveCandidateTargets(game, actor, candidate, "enemy"),
      useMode: MoveUseMode.NORMAL,
    },
    skip: false,
  };
}

async function chooseCustomOpponentCandidate(
  observation: ErCombatDecisionRecord["observation"],
  candidates: ErCombatCandidate[],
  actorSlot: number,
): Promise<ErCombatCandidate | null> {
  const policyKey = `${activeAiEpisodeId}:${observation.wave}:${observation.turn}:${actorSlot}:enemy`;
  if (AI_OPPONENT_TREE_MODEL) {
    return chooseTreeCandidate(AI_OPPONENT_TREE_MODEL, observation, candidates, AI_OPPONENT_POLICY_EPSILON, policyKey);
  }
  if (AI_OPPONENT_NEURAL_CLIENT) {
    return await chooseNeuralCandidate(
      AI_OPPONENT_NEURAL_CLIENT,
      `${activeAiEpisodeId}:seat-enemy`,
      observation,
      candidates,
      AI_OPPONENT_POLICY_EPSILON,
      policyKey,
    );
  }
  if (AI_OPPONENT_POLICY_MODE === "random") {
    return deterministicRandomCandidate(candidates, `${policyKey}:random`);
  }
  return candidates[0] ?? null;
}

async function driveCustomOpponentCommandPhase(
  game: GameManager,
  earlier: ErCombatEarlierChoice[],
  jointActionId: string,
): Promise<void> {
  await game.phaseInterceptor.to("EnemyCommandPhase", false);
  const phase = game.scene.phaseManager.getCurrentPhase() as { getFieldIndex(): number };
  const actorSlot = phase.getFieldIndex();
  const actor = game.scene.getEnemyField()[actorSlot];
  if (actor == null || !actor.isActive(true) || actor.isFainted() || hasAutomaticQueuedCommand(actor)) {
    await game.phaseInterceptor.to("EnemyCommandPhase");
    return;
  }
  const observation = snapshotErCombatObservation(game.scene, {
    perspective: "enemy",
    knownOpponentEntityIds: AI_CUSTOM_OPPONENT_KNOWN_PLAYER_IDS,
  });
  const candidates = enumerateErCombatCandidates(game.scene, actorSlot, earlier, "enemy");
  const chosen = await chooseCustomOpponentCandidate(observation, candidates, actorSlot);
  if (!chosen) {
    throw new Error(`custom opponent policy produced no legal command for enemy slot ${actorSlot}`);
  }
  commitOpponentCandidate(game, actorSlot, actor, chosen);
  if (AI_DATA_OUT) {
    const captured = appendCommittedDecision({
      game,
      perspective: "enemy",
      episodeId: `${activeAiEpisodeId}:seat-enemy`,
      actorSlot,
      jointActionId,
      earlier,
      observation,
      candidates,
      ...customOpponentPolicyMetadata(),
    });
    if (captured?.id !== chosen.id) {
      throw new Error(`custom opponent committed ${captured?.id ?? "nothing"}, expected ${chosen.id}`);
    }
  }
  earlier.push({
    kind: chosen.kind,
    id: chosen.id,
    ...(chosen.kind === "switch" ? { partyIndex: chosen.partyIndex } : {}),
    ...(chosen.kind === "move" ? { tera: chosen.tera } : {}),
  });
  game.phaseInterceptor.shiftPhase();
}

/** Commit a second arbitrary policy through the enemy seat without invoking the engine chooser. */
async function driveCustomOpponentPolicyTurn(game: GameManager): Promise<void> {
  if (!AI_HAS_CUSTOM_OPPONENT) {
    return;
  }
  game.scene.getPlayerField().forEach(mon => AI_CUSTOM_OPPONENT_KNOWN_PLAYER_IDS.add(mon.id));
  // TurnInitPhase queues one EnemyCommandPhase per currently active enemy, not
  // per occupied field slot. Fainted slots can remain in getEnemyField() until
  // replacement/end-of-battle processing, so counting them waits for a phase
  // that does not exist and runs into the next player CommandPhase.
  const phaseCount = game.scene.getEnemyField().filter(mon => mon.isActive()).length;
  const earlier: ErCombatEarlierChoice[] = [];
  const { waveIndex: wave, turn } = game.scene.currentBattle;
  const jointActionId = `${activeAiEpisodeId}:${wave}:${turn}:enemy`;
  for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex++) {
    await driveCustomOpponentCommandPhase(game, earlier, jointActionId);
  }
}

function isTerminalRunPhase(game: GameManager): boolean {
  const phaseName = game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "";
  return phaseName === "TitlePhase" || phaseName === "GameOverPhase" || phaseName === "EndCardPhase";
}

/**
 * Advance a combat-only batch through the current turn without waiting for an
 * impossible TurnEndPhase after a wipe. Normal scenario tests retain the
 * stricter GameManager.toEndOfTurn() contract.
 */
async function toCombatBatchTurnBoundary(game: GameManager): Promise<"turn-ended" | "victory" | "run-ended"> {
  while (true) {
    const boundary = await game.phaseInterceptor.toFirst([
      "TurnEndPhase",
      "VictoryPhase",
      "BattleEndPhase",
      "TrainerVictoryPhase",
      "SelectModifierPhase",
      "BiomeShopPhase",
      "NewBattlePhase",
      "GameOverPhase",
      "TitlePhase",
      "EndCardPhase",
    ] as const);
    if (boundary === "VictoryPhase") {
      if (isCombatBatchVictory(game)) {
        return "victory";
      }
      await game.phaseInterceptor.to("VictoryPhase");
      if (isCombatBatchVictory(game)) {
        return "victory";
      }
      continue;
    }
    if (boundary === "TurnEndPhase") {
      await game.phaseInterceptor.to("TurnEndPhase");
      const nextPhase = game.scene.phaseManager.getCurrentPhase()?.phaseName;
      if (
        nextPhase === "VictoryPhase"
        || nextPhase === "BattleEndPhase"
        || nextPhase === "TrainerVictoryPhase"
        || nextPhase === "SelectModifierPhase"
        || nextPhase === "BiomeShopPhase"
        || nextPhase === "NewBattlePhase"
      ) {
        continue;
      }
      return "turn-ended";
    }
    if (
      boundary === "BattleEndPhase"
      || boundary === "TrainerVictoryPhase"
      || boundary === "SelectModifierPhase"
      || boundary === "BiomeShopPhase"
      || boundary === "NewBattlePhase"
    ) {
      return "victory";
    }
    return "run-ended";
  }
}

/** Match VictoryPhase's trainer terminal predicate, including segmented/final-faint state. */
function isCombatBatchVictory(game: GameManager): boolean {
  return game.scene.getEnemyParty().every(pokemon => pokemon.isFainted(true));
}

/** Advance toward the next command without crossing an indirect-KO victory tail. */
async function toCombatBatchNextCommand(game: GameManager): Promise<"command" | "victory" | "run-ended"> {
  while (true) {
    const boundary = await game.phaseInterceptor.toFirst([
      "CommandPhase",
      "VictoryPhase",
      "BattleEndPhase",
      "TrainerVictoryPhase",
      "SelectModifierPhase",
      "BiomeShopPhase",
      "NewBattlePhase",
      "GameOverPhase",
      "TitlePhase",
      "EndCardPhase",
    ] as const);
    if (boundary === "CommandPhase") {
      await game.phaseInterceptor.to("CommandPhase");
      return "command";
    }
    if (boundary === "VictoryPhase") {
      if (isCombatBatchVictory(game)) {
        return "victory";
      }
      await game.phaseInterceptor.to("VictoryPhase");
      if (isCombatBatchVictory(game)) {
        return "victory";
      }
      continue;
    }
    if (
      boundary === "BattleEndPhase"
      || boundary === "TrainerVictoryPhase"
      || boundary === "SelectModifierPhase"
      || boundary === "BiomeShopPhase"
      || boundary === "NewBattlePhase"
    ) {
      return "victory";
    }
    return "run-ended";
  }
}

/** Play the CURRENT battle wave to completion (victory / wipe / maxTurns). */
async function playWaveTurns(
  game: GameManager,
  st: RunState,
  opts: { script?: TurnAction[] | undefined; forcedMove?: MoveId | null | undefined; maxTurns: number; quiet: boolean },
  fullLog: string[],
): Promise<{
  won: boolean;
  wiped: boolean;
  turns: number;
  maxHits: number;
  enemyMovesUsed: string[];
  runEnded?: boolean;
}> {
  let won = false;
  let wiped = false;
  let turns = 0;
  let maxHits = 0;
  const enemyMovesUsed: string[] = [];

  if (COMBAT_BATCH ? isCombatBatchVictory(game) : game.isVictory()) {
    return { won: true, wiped: false, turns: 0, maxHits: 0, enemyMovesUsed };
  }

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    turns = turn;
    if (st.driveError) {
      break;
    }
    if (COMBAT_BATCH) {
      // A move whose own phase owns targeting can bypass SelectTargetPhase. Any
      // helper prompt left from that completed turn must not head-block the next
      // real CommandPhase in a long unattended batch.
      game.promptHandler.clearPrompts();
    }
    // Scripted action for this turn; else force the requested move; else pick the best
    // damaging move per slot (so type immunities don't wall an otherwise-winnable wave).
    const playerDecisionObservations = preparePlayerDecisionObservations(game);
    const scriptedAction = opts.script?.[turn - 1];
    const action = scriptedAction ?? (opts.forcedMove == null ? await unattendedPolicyAction(game) : undefined);
    const captureMetadata: PolicyCaptureMetadata = scriptedAction
      ? { policySource: "scripted", policyTarget: false }
      : opts.forcedMove == null
        ? unattendedPolicyMetadata()
        : { policySource: "forced-move", policyTarget: false };
    doPlayerActions(game, action, opts.forcedMove ?? null, st.log);
    await recordCommittedPlayerTurn(game, captureMetadata, playerDecisionObservations);
    if (action && hasEnemyForce(action)) {
      if (AI_RECORD_ENGINE_BASELINE || AI_HAS_CUSTOM_OPPONENT) {
        throw new Error("a configured opponent policy cannot be combined with a scripted enemy command");
      }
      await forceEnemyActions(game, action, st.log);
    }
    if (AI_HAS_CUSTOM_OPPONENT) {
      await driveCustomOpponentPolicyTurn(game);
    } else {
      await recordEngineBaselineTurn(game);
    }
    let combatBoundary: Awaited<ReturnType<typeof toCombatBatchTurnBoundary>> | null = null;
    try {
      if (COMBAT_BATCH) {
        combatBoundary = await toCombatBatchTurnBoundary(game);
      } else {
        await game.toEndOfTurn();
      }
    } catch (e) {
      // A mid-turn RUN END (wipe -> GameOverPhase -> TitlePhase, or the post-victory
      // credits) never reaches TurnEndPhase - that is an OUTCOME, not a soft-lock.
      if (isTerminalRunPhase(game)) {
        return {
          won: false,
          wiped: game.scene.getPlayerParty().every(p => p.isFainted()),
          turns,
          maxHits,
          enemyMovesUsed,
          runEnded: true,
        };
      }
      const pendingPrompts = (
        game.promptHandler as unknown as {
          prompts?: Array<{ phaseTarget?: string; mode?: UiMode; debugLabel?: string }>;
        }
      ).prompts;
      const promptSummary = pendingPrompts
        ?.map(
          prompt =>
            `${prompt.phaseTarget ?? "?"}/${getUiModeName(prompt.mode ?? UiMode.MESSAGE)}`
            + `${prompt.debugLabel ? ` (${prompt.debugLabel})` : ""}`,
        )
        .join(", ");
      const currentPhase = game.scene.phaseManager.getCurrentPhase();
      const commandActor =
        currentPhase?.phaseName === "CommandPhase" ? (currentPhase as CommandPhase).getFieldIndex() : null;
      const targetActor =
        currentPhase?.phaseName === "SelectTargetPhase"
          ? (currentPhase as SelectTargetPhase).getPokemon().getBattlerIndex()
          : null;
      const uiDebug = game.scene.ui as unknown as { overlayActive?: boolean };
      const fieldDebug = game.scene.getPlayerField().map((mon, fieldSlot) => ({
        fieldSlot,
        id: mon.id,
        species: mon.species.name,
        battlerIndex: mon.getBattlerIndex(),
        hp: mon.hp,
        fainted: mon.isFainted(),
        active: mon.isActive(true),
        queue: mon.getMoveQueue().map(move => ({
          move: MoveId[move.move],
          targets: move.targets,
          useMode: MoveUseMode[move.useMode],
        })),
        moves: mon.getMoveset().map((move, moveSlot) => ({
          moveSlot,
          move: MoveId[move.moveId],
          pp: move.getMovePp() - move.ppUsed,
          usable: move.isUsable(mon, false, true),
        })),
        command: game.scene.currentBattle.turnCommands[mon.getBattlerIndex()] ?? null,
      }));
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}`
          + `\nEpisode: ${activeAiEpisodeId || "(none)"}`
          + `\nCurrent command actor: ${commandActor ?? "(none)"}`
          + `\nCurrent target actor: ${targetActor ?? "(none)"}; handlerActive=${game.scene.ui.getHandler()?.active === true}; overlayActive=${uiDebug.overlayActive === true}`
          + `\nLast rejected move: ${game.move.lastRejectedSelection ?? "(none)"}`
          + `\nPlayer field: ${JSON.stringify(fieldDebug)}`
          + `\nRecent phases: ${game.phaseInterceptor.log.slice(-30).join(" -> ")}`
          + `\nRecent combat actions: ${st.log.slice(-12).join(" | ") || "(none)"}`
          + `\nPending prompts: ${promptSummary || "(none)"}`,
      );
    }
    fullLog.push(...game.textInterceptor.logs);
    game.textInterceptor.clearLogs();
    for (const m of [...game.scene.getPlayerField(), ...game.scene.getEnemyField()]) {
      maxHits = Math.max(maxHits, m.turnData?.hitCount ?? 0);
    }
    for (const enemy of game.scene.getEnemyField()) {
      const lastMove = enemy.getLastXMoves(1)[0];
      if (lastMove?.move != null) {
        enemyMovesUsed.push(MoveId[lastMove.move]);
      }
    }
    if (!opts.quiet) {
      console.log("STATE", JSON.stringify(snapshot(game)));
    }
    if (combatBoundary === "victory" || (COMBAT_BATCH ? isCombatBatchVictory(game) : game.isVictory())) {
      won = true;
      break;
    }
    if (game.scene.getPlayerParty().every(p => p.isFainted())) {
      wiped = true;
      break;
    }
    if (turn < opts.maxTurns) {
      try {
        if (COMBAT_BATCH) {
          const nextBoundary = await toCombatBatchNextCommand(game);
          if (nextBoundary === "victory") {
            won = true;
            break;
          }
          if (nextBoundary === "run-ended") {
            return {
              won: false,
              wiped: game.scene.getPlayerParty().every(p => p.isFainted()),
              turns,
              maxHits,
              enemyMovesUsed,
              runEnded: true,
            };
          }
        } else {
          await game.toNextTurn(); // autopilot drives any pending faint-switch PARTY
        }
      } catch (error) {
        if (isTerminalRunPhase(game)) {
          return {
            won: false,
            wiped: game.scene.getPlayerParty().every(p => p.isFainted()),
            turns,
            maxHits,
            enemyMovesUsed,
            runEnded: true,
          };
        }
        throw error;
      }
    }
  }
  return { won, wiped, turns, maxHits, enemyMovesUsed };
}

/**
 * Play an ENTIRE run: drive every wave + every between-wave menu until victory /
 * wipe / the wave target. `waveTarget` bounds a non-`toEnd` run.
 */
async function playRun(
  game: GameManager,
  opts: {
    script?: TurnAction[] | undefined;
    forcedMove?: MoveId | null;
    maxTurnsPerWave: number;
    waveTarget: number;
    toEnd: boolean;
    policy: RunPolicy;
    quiet: boolean;
    bootToRunMs: number;
  },
): Promise<RunResult> {
  const st = newRunState(opts.policy);
  const fullLog: string[] = [...game.textInterceptor.logs];
  game.textInterceptor.clearLogs();
  // Exercise the egg-lapse CONFIRM path deterministically when an egg policy is set.
  if (game.scene.gameData) {
    game.scene.eggSkipPreference = 1;
  }
  const stop = installMenuAutopilot(game, st);
  const startWave = game.scene.currentBattle?.waveIndex ?? 0;
  const waves: WaveSummary[] = [];
  let outcome: RunResult["outcome"] = "max-waves";
  let wavesCleared = 0;
  const runStart = performance.now();
  const HARD_CAP = 260; // safety: never loop forever

  try {
    for (let iter = 0; iter < HARD_CAP; iter++) {
      const wave = game.scene.currentBattle?.waveIndex ?? 0;
      const enemyName = game.scene.getEnemyField()[0]?.species?.name ?? "?";
      const t0 = performance.now();
      // A `script` targets the OPENING battle; later waves fall back to the default
      // action (forced move / first usable move) so a 200-wave run isn't scripted turn-by-turn.
      const res = await playWaveTurns(
        game,
        st,
        {
          script: iter === 0 ? opts.script : undefined,
          forcedMove: opts.forcedMove,
          maxTurns: opts.maxTurnsPerWave,
          quiet: opts.quiet,
        },
        fullLog,
      );
      const ms = Math.round(performance.now() - t0);
      const playerAlive = game.scene.getPlayerParty().filter(p => !p.isFainted()).length;
      const result = res.wiped ? "wiped" : res.won ? "won" : "stuck";
      const summary: WaveSummary = { wave, turns: res.turns, result, ms, playerAlive, enemyName };
      waves.push(summary);
      console.log(`WAVE ${wave}: ${result} in ${res.turns}t, ${ms}ms, ${playerAlive} alive vs ${enemyName}`);
      if (result === "stuck") {
        const enemyState = game.scene
          .getEnemyParty()
          .map(e => `${e.species.name} ${e.hp}/${e.getMaxHp()}${e.isFainted() ? " (fainted)" : ""}`)
          .join(", ");
        const playerState = game.scene
          .getPlayerField()
          .map(p => `${p.species.name} ${p.hp}/${p.getMaxHp()} last=${MoveId[p.getLastXMoves(1)[0]?.move ?? 0] ?? "-"}`)
          .join(", ");
        const enemyField = game.scene
          .getEnemyField()
          .map(e => `${e.species.name} ${e.hp}/${e.getMaxHp()}${e.isFainted() ? " (fainted)" : ""}`)
          .join(", ");
        console.log(`  STUCK enemy party: ${enemyState}`);
        console.log(`  STUCK enemy field: ${enemyField}`);
        console.log(`  STUCK player field: ${playerState}`);
        console.log(
          `  STUCK battle: type=${game.scene.currentBattle.battleType} double=${game.scene.currentBattle.double} nextAction=${JSON.stringify(smartDefaultAction(game))}`,
        );
        const reserves = game.scene
          .getEnemyParty()
          .map(
            e =>
              `${e.species.name}[active=${e.isActive()},onField=${e.isOnField()},slot=${(e as unknown as { trainerSlot: number }).trainerSlot},fainted=${e.isFainted()}]`,
          )
          .join(", ");
        console.log(`  STUCK enemy reserves: ${reserves}`);
      }

      if (st.driveError) {
        outcome = "error";
        break;
      }
      if ((res as { runEnded?: boolean }).runEnded) {
        // The engine ended the run mid-turn (wipe -> GameOver -> Title, or the
        // post-final-boss credits): classify by wave, don't treat it as a stall.
        outcome = res.wiped || !game.scene.gameMode.isWaveFinal(wave) ? "player-wiped" : "victory";
        break;
      }
      if (res.wiped) {
        outcome = "player-wiped";
        break;
      }
      if (!res.won) {
        outcome = "max-turns";
        break;
      }
      wavesCleared++;

      if (game.scene.gameMode.isWaveFinal(wave)) {
        await game.phaseInterceptor.to("GameOverPhase", false);
        outcome = "victory";
        break;
      }
      if (!opts.toEnd && wavesCleared >= opts.waveTarget) {
        outcome = "max-waves";
        break;
      }

      applyMeOverridesForUpcomingWave(game, st, wave + 1);
      await game.phaseInterceptor.to("CommandPhase"); // autopilot drives all between-wave menus
      if (st.driveError) {
        outcome = "error";
        break;
      }
      console.log("==================[New Wave]==================");
    }
  } finally {
    stop();
  }

  const finalWave = game.scene.currentBattle?.waveIndex ?? startWave;
  const totalMs = Math.round(performance.now() - runStart);
  if (st.driveError) {
    console.log(`\nDRIVE ERROR: ${st.driveError instanceof Error ? st.driveError.message : String(st.driveError)}`);
  }
  return {
    outcome,
    startWave,
    finalWave,
    wavesCleared,
    waves,
    totalMs,
    bootToRunMs: opts.bootToRunMs,
    log: st.log.join("\n"),
    fullLog: fullLog.join("\n"),
    meDriven: st.meDriven,
    catchFullDriven: st.catchFullDriven,
    eggDriven: st.eggDriven,
    biomeShopDriven: st.biomeShopDriven,
    autoFirstLog: st.autoFirstLog,
    state: captureRunnerState(game),
  };
}

interface CombatBatchEpisodeResult {
  id: string;
  outcome: string;
  turns: number;
  startWave: number;
  finalWave: number;
  bootMs: number;
  combatMs: number;
  decisions: number;
  enemyMovesUsed: string[];
  phaseMs: Record<string, number>;
  slowPhases: Array<{ phase: string; ms: number }>;
  progressionPhaseEntries: number;
}

interface CombatBatchCheckpoint {
  version: 1;
  complete: boolean;
  combatOnly: true;
  hardestTrainerAi: boolean;
  opponentController: string;
  progressionPhaseEntries: number;
  expectedEpisodeCount: number;
  episodeCount: number;
  totalMs: number;
  averageMsPerEpisode: number;
  results: CombatBatchEpisodeResult[];
}

function loadCombatBatchCheckpoint(batch: CombatBatchInput): CombatBatchCheckpoint | null {
  if (!RESUME_COMBAT_BATCH) {
    return null;
  }
  if (!JSON_OUT || !existsSync(JSON_OUT)) {
    throw new Error("combat batch resume requires an existing ER_RUN_JSON_OUT checkpoint");
  }
  if (AI_DATA_OUT) {
    throw new Error("combat batch resume is not supported while recording policy data");
  }
  const checkpoint = JSON.parse(readFileSync(JSON_OUT, "utf8")) as Partial<CombatBatchCheckpoint>;
  const expectedOpponent = AI_HAS_CUSTOM_OPPONENT ? "custom-policy" : "engine-hardest-v1";
  if (
    checkpoint.version !== 1
    || checkpoint.combatOnly !== true
    || checkpoint.expectedEpisodeCount !== batch.episodes.length
    || checkpoint.opponentController !== expectedOpponent
    || checkpoint.hardestTrainerAi !== !AI_HAS_CUSTOM_OPPONENT
    || !Array.isArray(checkpoint.results)
    || checkpoint.episodeCount !== checkpoint.results.length
    || typeof checkpoint.totalMs !== "number"
    || !Number.isFinite(checkpoint.totalMs)
    || checkpoint.totalMs < 0
    || checkpoint.results.length > batch.episodes.length
  ) {
    throw new Error("combat batch resume checkpoint does not match the requested batch or controller");
  }
  for (const [index, result] of checkpoint.results.entries()) {
    if (result?.id !== batch.episodes[index]?.id) {
      throw new Error(
        `combat batch resume checkpoint is not an exact episode prefix at index ${index}: `
          + `${result?.id ?? "(missing)"} != ${batch.episodes[index]?.id ?? "(missing)"}`,
      );
    }
  }
  if (checkpoint.complete !== (checkpoint.results.length === batch.episodes.length)) {
    throw new Error("combat batch resume checkpoint has an inconsistent complete flag");
  }
  return checkpoint as CombatBatchCheckpoint;
}

function combatBatchFailureContext(game: GameManager, st: RunState): string {
  const handler = game.scene.ui.getHandler() as unknown as Record<string, unknown>;
  const prompts = (
    game.promptHandler as unknown as {
      prompts?: Array<{ phaseTarget?: string; mode?: UiMode; debugLabel?: string }>;
    }
  ).prompts;
  const handlerState = {
    type: (handler as unknown as { constructor?: { name?: string } }).constructor?.name ?? "unknown",
    active: handler?.active,
    awaitingActionInput: handler?.awaitingActionInput,
    blockInput: handler?.blockInput,
    pendingPrompt: !!handler?.pendingPrompt,
    optionsMode: handler?.optionsMode,
    partyUiMode: handler?.partyUiMode,
    fieldIndex: handler?.fieldIndex,
    cursor: handler?.cursor,
    optionsCursor: handler?.optionsCursor,
    options: Array.isArray(handler?.options)
      ? (handler.options as number[]).map(option => PartyOption[option] ?? option)
      : undefined,
    hasSelectCallback: typeof handler?.selectCallback === "function",
    sameDrivenPhase: game.scene.phaseManager.getCurrentPhase() === st.lastDrivenPhase,
    sameDrivenMode: game.scene.ui.getMode() === st.lastDrivenMode,
    sameDrivenCallback: handler?.selectCallback === st.lastDrivenPartyCallback,
  };
  const getFilterResult = handler?.getFilterResult as
    | ((option: PartyOption, candidate: Pokemon) => string | null)
    | undefined;
  const party = game.scene.getPlayerParty().map((pokemon, index) => ({
    index,
    id: pokemon.id,
    species: pokemon.species.name,
    hp: pokemon.hp,
    fainted: pokemon.isFainted(),
    active: pokemon.isActive(true),
    allowed: pokemon.isAllowedInBattle(),
    sendOutFilter: getFilterResult?.call(handler, PartyOption.SEND_OUT, pokemon) ?? null,
  }));
  const pendingPrompts = prompts?.map(prompt => ({
    phase: prompt.phaseTarget,
    mode: prompt.mode == null ? undefined : getUiModeName(prompt.mode),
    label: prompt.debugLabel,
  }));
  return (
    `\nHandler: ${JSON.stringify(handlerState)}`
    + `\nParty: ${JSON.stringify(party)}`
    + `\nRecent actions: ${st.log.slice(-20).join(" | ") || "(none)"}`
    + `\nAutopilot: ${JSON.stringify({ ticks: st.autopilotTicks, partyTicks: st.partyTicks, lastPartyAttempt: st.lastPartyAttempt, driveError: st.driveError instanceof Error ? st.driveError.message : st.driveError })}`
    + `\nPending prompts: ${JSON.stringify(pendingPrompts ?? [])}`
  );
}

function assertCombatOnlyEpisode(episode: CombatBatchEpisode): void {
  const spec = episode.scenario;
  if (spec.run?.difficulty !== "hell" || spec.run?.enemyAi !== "hardest") {
    throw new Error(`${episode.id}: combat batches require Hell difficulty and enemyAi=hardest`);
  }
  if (spec.enemy?.kind !== "party" && spec.enemy?.kind !== "trainer") {
    throw new Error(`${episode.id}: combat batches require a trainer or custom trainer party`);
  }
  if (
    (spec.run?.waves ?? 1) !== 1
    || (spec.rewards?.length ?? 0) > 0
    || (spec.items?.shop?.length ?? 0) > 0
    || usesFullRunPolicy(spec)
  ) {
    throw new Error(`${episode.id}: rewards and run-progression policy are forbidden in combat batches`);
  }
}

async function playCombatBatch(phaserGame: Phaser.Game, batch: CombatBatchInput): Promise<void> {
  const checkpoint = loadCombatBatchCheckpoint(batch);
  const results: CombatBatchEpisodeResult[] = checkpoint ? [...checkpoint.results] : [];
  const priorTotalMs = checkpoint?.totalMs ?? 0;
  const batchStart = performance.now();
  const writeBatchCheckpoint = (complete: boolean): void => {
    if (!JSON_OUT) {
      return;
    }
    const totalMs = priorTotalMs + Math.round(performance.now() - batchStart);
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          version: 1,
          complete,
          combatOnly: true,
          hardestTrainerAi: !AI_HAS_CUSTOM_OPPONENT,
          opponentController: AI_HAS_CUSTOM_OPPONENT ? "custom-policy" : "engine-hardest-v1",
          progressionPhaseEntries: results.reduce((total, result) => total + result.progressionPhaseEntries, 0),
          expectedEpisodeCount: batch.episodes.length,
          episodeCount: results.length,
          totalMs,
          averageMsPerEpisode: results.length > 0 ? Math.round(totalMs / results.length) : 0,
          results,
        },
        null,
        2,
      ),
    );
  };
  for (const episode of batch.episodes.slice(results.length)) {
    assertCombatOnlyEpisode(episode);
    activeAiEpisodeId = episode.id;
    AI_NEURAL_CLIENT?.reset(`${activeAiEpisodeId}:seat-player`);
    AI_OPPONENT_NEURAL_CLIENT?.reset(`${activeAiEpisodeId}:seat-enemy`);
    AI_ENGINE_BASELINE_KNOWN_OPPONENT_IDS.clear();
    AI_CUSTOM_OPPONENT_KNOWN_PLAYER_IDS.clear();
    enginePlayerSwitchCounter = 0;
    activeAiSplitGroupId = episode.splitGroupId?.trim() || episode.id;
    activeAiSourcePartitionId = episode.sourcePartitionId?.trim() || activeAiSplitGroupId;
    const recordStart = AI_DATASET_RECORDS.length;
    const bootStart = performance.now();
    const game = await launchScenario(phaserGame, episode.scenario, {
      realRng: REAL_RNG,
      driveEntryMenus: true,
    });
    const bootMs = Math.round(performance.now() - bootStart);
    // Combat-only evaluation uses the fastest production-supported speed. This
    // scales presentation waits, not turn order, RNG, damage, or policy inputs.
    game.scene.gameSpeed = 10;
    const combatStart = performance.now();
    const state = newRunState(buildPolicy(episode.scenario, true));
    const stopAutopilot = installMenuAutopilot(game, state);
    const fullLog: string[] = [];
    let result: Awaited<ReturnType<typeof playWaveTurns>>;
    try {
      result = await playWaveTurns(game, state, { forcedMove: FORCED_MOVE, maxTurns: MAX_TURNS, quiet: true }, fullLog);
    } catch (error) {
      throw new Error(
        `${episode.id}: ${error instanceof Error ? error.message : String(error)}`
          + combatBatchFailureContext(game, state),
      );
    } finally {
      stopAutopilot();
    }
    const combatMs = Math.round(performance.now() - combatStart);
    const forbiddenProgressionPhases = new Set([
      "BattleEndPhase",
      "TrainerVictoryPhase",
      "SelectModifierPhase",
      "BiomeShopPhase",
      "NewBattlePhase",
    ]);
    const progressionPhaseEntries = game.phaseInterceptor.log.filter(phase =>
      forbiddenProgressionPhases.has(phase),
    ).length;
    const phaseMs = Object.fromEntries(
      [
        ...game.phaseInterceptor.timings.reduce(
          (totals, timing) => totals.set(timing.phase, (totals.get(timing.phase) ?? 0) + timing.ms),
          new Map<string, number>(),
        ),
      ]
        .sort((a, b) => b[1] - a[1])
        .map(([phase, ms]) => [phase, Math.round(ms)]),
    );
    const slowPhases = game.phaseInterceptor.timings
      .map(timing => ({ phase: timing.phase, ms: Math.round(timing.ms) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 20);
    if (progressionPhaseEntries > 0) {
      const executed = game.phaseInterceptor.log.filter(phase => forbiddenProgressionPhases.has(phase));
      throw new Error(
        `${episode.id}: combat-only worker executed a reward or progression phase: ${executed.join(", ")}`,
      );
    }
    appendAiEpisodeTerminal({
      outcome: result.won ? "victory" : result.wiped || result.runEnded ? "player-wiped" : "max-turns-reached",
      startWave: episode.scenario.run?.wave ?? 1,
      finalWave: episode.scenario.run?.wave ?? 1,
      wavesCleared: result.won ? 1 : 0,
    });
    const decisions = AI_DATASET_RECORDS.slice(recordStart).filter(record => record.kind === "combat_decision").length;
    results.push({
      id: episode.id,
      outcome: result.won ? "victory" : result.wiped || result.runEnded ? "player-wiped" : "max-turns-reached",
      turns: result.turns,
      startWave: episode.scenario.run?.wave ?? 1,
      finalWave: episode.scenario.run?.wave ?? 1,
      bootMs,
      combatMs,
      decisions,
      enemyMovesUsed: result.enemyMovesUsed,
      phaseMs,
      slowPhases,
      progressionPhaseEntries,
    });
    writeBatchCheckpoint(false);
    console.log(
      `COMBAT EPISODE ${episode.id}: ${results.at(-1)?.outcome}, ${result.turns} turns, `
        + `${combatMs}ms combat, ${bootMs}ms reset, ${decisions} decisions`,
    );
    game.promptHandler.clearPrompts();
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
    vi.restoreAllMocks();
  }
  flushAiDataset();
  writeBatchCheckpoint(true);
  const summary = JSON_OUT
    ? JSON.parse(readFileSync(JSON_OUT, "utf8"))
    : {
        version: 1,
        complete: true,
        combatOnly: true,
        hardestTrainerAi: !AI_HAS_CUSTOM_OPPONENT,
        opponentController: AI_HAS_CUSTOM_OPPONENT ? "custom-policy" : "engine-hardest-v1",
        progressionPhaseEntries: results.reduce((total, result) => total + result.progressionPhaseEntries, 0),
        expectedEpisodeCount: batch.episodes.length,
        episodeCount: results.length,
        totalMs: priorTotalMs + Math.round(performance.now() - batchStart),
        averageMsPerEpisode: Math.round((priorTotalMs + performance.now() - batchStart) / results.length),
        results,
      };
  console.log(`BATCH RESULT ${JSON.stringify(summary)}`);
}

const MOODY_AUDIT = process.env.ER_RUN_MOODY_AUDIT === "1";
const RUN = (!!SPEC || !!COMBAT_BATCH) && process.env.ER_SCENARIO === "1" && !MOODY_AUDIT;

describe.skipIf(!RUN)("headless scenario runner", () => {
  let phaserGame: Phaser.Game;

  beforeAll(
    async () => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
      await Promise.all(AI_NEURAL_CLIENTS.map(client => client.start()));
    },
    AI_NEURAL_CLIENT || AI_OPPONENT_NEURAL_CLIENT ? 30_000 : 10_000,
  );

  afterAll(() => {
    AI_NEURAL_CLIENTS.forEach(client => client.stop());
  });

  // biome-ignore format: keep the large established scenario-runner callback stable
  it(`plays scenario: ${SPEC?.name || RAW}`, async () => {
    if (COMBAT_BATCH) {
      await playCombatBatch(phaserGame, COMBAT_BATCH);
      return;
    }
    const spec = SPEC as RunnerInput;
    console.log(`\n===== SCENARIO: ${spec.name || "(unnamed)"} =====`);
    console.log(describeScenarioSpec(spec));
    console.log(
      SCRIPT
        ? `player action: scripted (${SCRIPT.length} turns)`
        : FORCED_MOVE
          ? `player action: force ${MoveId[FORCED_MOVE]} every turn`
          : AI_TREE_MODEL
            ? `player action: tree model ${AI_TREE_MODEL.modelName}${AI_POLICY_EPSILON > 0 ? ` (epsilon ${AI_POLICY_EPSILON})` : ""}`
            : AI_NEURAL_CLIENT
              ? `player action: neural model${AI_POLICY_EPSILON > 0 ? ` (epsilon ${AI_POLICY_EPSILON})` : ""}`
              : AI_POLICY_MODE === "smart-default"
                ? "player action: smart-default-v1"
                : "player action: first usable move",
    );

    const bootStart = performance.now();
    const game = await launchScenario(phaserGame, spec, {
      noMiss: NO_MISS,
      noCrit: NO_CRIT,
      realRng: REAL_RNG,
      minRng: spec.run?.battleRng === "min",
      driveEntryMenus: true,
    });
    const bootToRunMs = Math.round(performance.now() - bootStart);

    // Full-run path: --to-end, multi-wave, or any full-run policy field present → drive
    // the entire run (every menu) via the autopilot. Otherwise the legacy single-battle
    // path (kept verbatim for the `expect`-style repro scenarios).
    if (TO_END || WAVES > 1 || usesFullRunPolicy(spec)) {
      const policy = buildPolicy(spec, AUTO_FIRST);
      const result = await playRun(game, {
        script: SCRIPT,
        forcedMove: FORCED_MOVE,
        maxTurnsPerWave: MAX_TURNS,
        waveTarget: WAVES,
        toEnd: TO_END,
        policy,
        quiet: QUIET,
        bootToRunMs,
      });
      const perWave = result.waves.length > 0 ? Math.round(result.totalMs / result.waves.length) : 0;
      console.log(
        `\nRESULT ${JSON.stringify({
          outcome: result.outcome,
          startWave: result.startWave,
          finalWave: result.finalWave,
          wavesCleared: result.wavesCleared,
          bootMs: result.bootToRunMs,
          totalMs: result.totalMs,
          msPerWave: perWave,
          meDriven: result.meDriven,
          eggDriven: result.eggDriven,
          biomeShopDriven: result.biomeShopDriven,
          catchFullDriven: result.catchFullDriven,
          state: result.state,
        })}`,
      );
      console.log(`TIMING: boot ${result.bootToRunMs}ms, run ${result.totalMs}ms, ${perWave}ms/wave`);
      if (result.autoFirstLog.length > 0) {
        console.log("AUTO-FIRST:\n - " + result.autoFirstLog.join("\n - "));
      }
      writeJsonOut(result);
      writeAiDataOut({
        outcome: result.outcome,
        startWave: result.startWave,
        finalWave: result.finalWave,
        wavesCleared: result.wavesCleared,
      });
      if (EXPECT) {
        const failures = evaluateExpect(EXPECT, {
          game,
          player: game.scene.getPlayerField()[0],
          enemy: game.scene.getEnemyField()[0],
          outcome: result.outcome,
          maxHits: 0,
          log: result.fullLog,
          enemyMovesUsed: [],
          biomeOptions: result.state.biomeOptions,
        });
        console.log(
          failures.length > 0 ? `\nEXPECT FAILURES:\n - ${failures.join("\n - ")}` : "\nEXPECT: all checks passed",
        );
        expect(failures, `expect mismatches:\n${failures.join("\n")}`).toEqual([]);
      } else {
        expect(result.outcome, "run should not error out").not.toBe("error");
      }
      return;
    }

    const { outcome, turnsPlayed, wavesPlayed, maxHits, log, enemyMovesUsed, startWave, endWave } = await playBattle(
      game,
      {
        script: SCRIPT,
        forcedMove: FORCED_MOVE,
        maxTurns: MAX_TURNS,
        waves: WAVES,
        rewards: SPEC?.rewards,
        learnMove: LEARN_MOVE,
      },
    );
    const state = captureRunnerState(game);
    console.log(
      `\nRESULT ${JSON.stringify({ outcome, turnsPlayed, wavesPlayed, maxHits, startWave, endWave, enemyMovesUsed, state })}`,
    );
    writeAiDataOut({
      outcome,
      startWave,
      finalWave: endWave,
      wavesCleared: outcome === "victory" ? wavesPlayed : Math.max(0, wavesPlayed - 1),
    });

    // Self-verify against the optional `expect` block; otherwise a clean finish
    // (no throw / no soft-lock) is the pass.
    if (EXPECT) {
      const failures = evaluateExpect(EXPECT, {
        game,
        player: game.scene.getPlayerField()[0],
        enemy: game.scene.getEnemyField()[0],
        outcome,
        maxHits,
        log,
        enemyMovesUsed,
        biomeOptions: state.biomeOptions,
      });
      console.log(
        failures.length > 0 ? `\nEXPECT FAILURES:\n - ${failures.join("\n - ")}` : "\nEXPECT: all checks passed",
      );
      expect(failures, `expect mismatches:\n${failures.join("\n")}`).toEqual([]);
    } else {
      expect(SPEC).toBeTruthy();
    }
  }, RUN_TEST_TIMEOUT_MS);
});

const MOODY_EDITORIAL_COPY = [
  /\bimplementation(?: status| detail)?\b/i,
  /\bimplemented\b/i,
  /\bcorrection text\b/i,
  /\bscreenshot wording\b/i,
  /\bdesigner note\b/i,
  /\bdeveloper note\b/i,
  /\bplayer-facing\b/i,
  /\bmust be displayed(?: prominently)?\b/i,
  /\bneeds an explicit .* adapter\b/i,
  /\brequires a properly audited\b/i,
  /\bmust prove basic feasibility\b/i,
  /\bcontent remains blocked\b/i,
  /\bauthored set\b/i,
  /\bauthoritative rng\b/i,
] as const;

function moodyBranches(): MoodyBoonInstance[] {
  return MOODY_BOONS.flatMap(boon => [
    { instanceId: `${boon.id}:base`, boonId: boon.id, rank: 1 as const, acquiredAtWave: 10 },
    { instanceId: `${boon.id}:rank-two`, boonId: boon.id, rank: 2 as const, acquiredAtWave: 20 },
    ...boon.evolutions.map((evolution, index) => ({
      instanceId: `${boon.id}:${evolution.id}`,
      boonId: boon.id,
      rank: 3 as const,
      evolutionId: evolution.id,
      acquiredAtWave: 30 + index * 10,
    })),
  ]);
}

describe.skipIf(!MOODY_AUDIT)("headless scenario runner - exhaustive Moody audit", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("boots the real game, verifies every boon branch and curse, both ownership paths, save wire, and player copy", async () => {
    const game = await launchScenario(phaserGame, DEMO_SPEC, { noMiss: true, noCrit: true });
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({
      ...getFunModeConfig(),
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      moodyMode: true,
    });
    const player = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    const branches = moodyBranches();
    const expectedBranches = MOODY_BOONS.reduce((sum, boon) => sum + 2 + boon.evolutions.length, 0);
    expect(branches).toHaveLength(expectedBranches);

    for (const branch of branches) {
      const state = createMoodyModeState(`cli:${branch.instanceId}`);
      state.boons = [
        {
          ...branch,
          target: {
            pokemonIds: [player.id],
            partySlots: [0],
            moveIds: [MoveId.TACKLE],
            itemTypeIds: ["LEFTOVERS"],
            option: branch.boonId === "set-collector" ? "complete-nutrition" : "cli-audit",
          },
          progress: { counters: { triggers: 2 }, flags: { primed: true }, values: { multiplier: 1.25 } },
        },
      ];
      state.curses = MOODY_CURSES.map(curse => ({
        curseId: curse.id,
        acquiredAtWave: curse.number * 10,
        progress: { counters: { triggers: curse.number }, flags: { active: true }, values: { multiplier: 1.1 } },
      }));
      expect(restoreMoodyModeState(JSON.parse(JSON.stringify(state))), branch.instanceId).toBe(true);
      expect(getMoodyModeSaveData()?.boons[0], branch.instanceId).toEqual(state.boons[0]);
      expect(getMoodyModeSaveData()?.curses, branch.instanceId).toEqual(state.curses);
    }

    const ownership = createMoodyModeState("cli:ownership");
    ownership.boons = [
      {
        instanceId: "player:crowned-vanguard",
        boonId: "crowned-vanguard",
        rank: 1,
        target: { pokemonIds: [player.id], partySlots: [0] },
        acquiredAtWave: 10,
      },
    ];
    expect(restoreMoodyModeState(ownership)).toBe(true);
    setMoodyEnemyBoonLoadout({
      waveIndex: game.scene.currentBattle.waveIndex,
      boons: [
        {
          instanceId: "enemy:crowned-vanguard",
          boonId: "crowned-vanguard",
          rank: 1,
          target: { pokemonIds: [enemy.id], partySlots: [0] },
          acquiredAtWave: 10,
        },
      ],
    });
    expect(
      queryMoodySceneEffects({
        actor: player,
        target: enemy,
        move: player.getMoveset()[0].getMove(),
        flags: { firstDamagingMove: true },
      })?.priorityDelta,
    ).toBe(1);
    expect(
      queryMoodySceneEffects({
        actor: enemy,
        target: player,
        move: enemy.getMoveset()[0].getMove(),
        flags: { firstDamagingMove: true },
      })?.priorityDelta,
    ).toBe(1);
    const serialized = JSON.stringify(game.scene.gameData.getSessionSaveData());
    const parsed = game.scene.gameData.parseSessionData(serialized);
    expect(parsed.funModeConfig?.moodyMode).toBe(true);
    expect(parsed.moodyModeState).toEqual(getMoodyModeSaveData());

    const fields = [
      ...MOODY_BOONS.flatMap(
        boon =>
          [
            [`${boon.id}.scope`, boon.scope],
            [`${boon.id}.base`, boon.base],
            [`${boon.id}.rankTwo`, boon.rankTwo],
            [`${boon.id}.fullDescription`, boon.fullDescription],
            ...boon.evolutions.map(evolution => [`${boon.id}.${evolution.id}`, evolution.description]),
          ] as const,
      ),
      ...MOODY_CURSES.map(curse => [`${curse.id}.description`, curse.description] as const),
    ];
    for (const [field, copy] of fields) {
      expect(copy.trim().length, field).toBeGreaterThan(0);
      for (const forbidden of MOODY_EDITORIAL_COPY) {
        expect(copy, `${field} contains ${forbidden}`).not.toMatch(forbidden);
      }
    }

    console.log(
      `MOODY AUDIT PASS: ${MOODY_BOONS.length} boons, ${branches.length} boon branches, ${MOODY_CURSES.length} curses`,
    );
    resetMoodyEnemyBoonLoadout();
    resetMoodyModeState();
    resetFunModeConfig();
  }, 1_200_000);
});

/** Whether the spec opts into any full-run behaviour (so the autopilot path is taken). */
function usesFullRunPolicy(spec: RunnerInput): boolean {
  return (
    spec.biomeShops != null
    || (spec.biomePicks?.length ?? 0) > 0
    || (spec.crossroads?.length ?? 0) > 0
    || (spec.forceMysteryEncounters?.length ?? 0) > 0
    || (spec.meOptions?.length ?? 0) > 0
    || spec.onCatchFull != null
    || spec.eggs != null
    || (spec.betweenWaves?.length ?? 0) > 0
    || spec.run?.allowMysteryEncounters === true
  );
}

/** Write the machine-readable run result to `ER_RUN_JSON_OUT` if set. */
function writeJsonOut(result: RunResult): void {
  if (!JSON_OUT) {
    return;
  }
  const out = {
    outcome: result.outcome,
    startWave: result.startWave,
    finalWave: result.finalWave,
    wavesCleared: result.wavesCleared,
    totalMs: result.totalMs,
    bootMs: result.bootToRunMs,
    msPerWave: result.waves.length > 0 ? Math.round(result.totalMs / result.waves.length) : 0,
    meDriven: result.meDriven,
    eggDriven: result.eggDriven,
    catchFullDriven: result.catchFullDriven,
    biomeShopDriven: result.biomeShopDriven,
    autoFirst: result.autoFirstLog,
    waves: result.waves,
    state: result.state,
  };
  try {
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
    console.log(`JSON result written to ${JSON_OUT}`);
  } catch (err) {
    console.log(`could not write JSON result: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeAiDataOut(result: { outcome: string; startWave: number; finalWave: number; wavesCleared: number }): void {
  if (!AI_DATA_OUT) {
    return;
  }
  appendAiEpisodeTerminal(result);
  flushAiDataset();
}

function appendAiEpisodeTerminal(result: {
  outcome: string;
  startWave: number;
  finalWave: number;
  wavesCleared: number;
}): void {
  if (AI_HAS_DUAL_SEAT_CAPTURE) {
    appendAiEpisodeTerminalForSeat(`${activeAiEpisodeId}:seat-player`, result, false);
    appendAiEpisodeTerminalForSeat(`${activeAiEpisodeId}:seat-enemy`, result, true);
    return;
  }
  appendAiEpisodeTerminalForSeat(activeAiEpisodeId, result, AI_RECORD_ENGINE_BASELINE);
}

function appendAiEpisodeTerminalForSeat(
  episodeId: string,
  result: { outcome: string; startWave: number; finalWave: number; wavesCleared: number },
  invert: boolean,
): void {
  const outcome = invert
    ? result.outcome === "victory"
      ? "player-wiped"
      : result.outcome === "player-wiped"
        ? "victory"
        : result.outcome
    : result.outcome;
  AI_DATASET_RECORDS.push({
    kind: "episode_terminal",
    schemaVersion: ER_COMBAT_CONTRACT_VERSION,
    buildSha: AI_BUILD_SHA,
    dexHash: AI_DEX_HASH,
    dictionaryHash: AI_DICTIONARY_HASH,
    episodeId,
    splitGroupId: activeAiSplitGroupId,
    sourcePartitionId: activeAiSourcePartitionId,
    outcome,
    startWave: result.startWave,
    finalWave: result.finalWave,
    wavesCleared: invert ? +(outcome === "victory") : result.wavesCleared,
    truncated: !["victory", "player-wiped"].includes(result.outcome),
  });
}

function flushAiDataset(): void {
  if (!AI_DATA_OUT) {
    return;
  }
  try {
    mkdirSync(dirname(AI_DATA_OUT), { recursive: true });
    writeFileSync(AI_DATA_OUT, `${AI_DATASET_RECORDS.map(record => JSON.stringify(record)).join("\n")}\n`);
    const terminals = AI_DATASET_RECORDS.filter(record => record.kind === "episode_terminal").length;
    console.log(
      `AI dataset written to ${AI_DATA_OUT} (${AI_DATASET_RECORDS.length - terminals} decisions + ${terminals} terminals)`,
    );
  } catch (err) {
    throw new Error(`could not write AI dataset: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =============================================================================
// SELF-VERIFYING SCENARIOS — one per new capability, exercised whenever the
// harness runs WITHOUT a specific `ER_RUN_SCENARIO` (so `ER_SCENARIO=1 vitest run
// test/tools/run-scenario.test.ts` proves every capability end-to-end headlessly).
// Each builds an inline spec, plays it through the SAME pipeline, and asserts.
// =============================================================================

const EASY_ABILITY_ADDITION_CHECK = process.env.ER_ABILITY_EASY_ADDITIONS === "1";
const NEWCOMER_SIGNATURE_CHECK = process.env.ER_NEWCOMER_SIGNATURE_CHECK === "1";
const AI_CONTRACT_CHECK = process.env.ER_AI_CONTRACT_CHECK === "1";
const TELEMETRY_ISOLATION_CHECK = process.env.ER_TELEMETRY_ISOLATION_CHECK === "1";
const SELF_CHECK =
  process.env.ER_SCENARIO === "1"
  && !process.env.ER_RUN_SCENARIO
  && !process.env.ER_RUN_COMBAT_BATCH
  && !EASY_ABILITY_ADDITION_CHECK
  && !NEWCOMER_SIGNATURE_CHECK
  && !AI_CONTRACT_CHECK
  && !TELEMETRY_ISOLATION_CHECK;

/** Run one inline spec through the full pipeline and return the summary + the game. */
async function runInline(
  phaserGame: Phaser.Game,
  spec: RunnerInput,
  launchOpts: LaunchOpts = {},
): Promise<{ game: GameManager; summary: Awaited<ReturnType<typeof playBattle>> }> {
  normalizeSpec(spec);
  const forced: MoveId | null = null;
  const game = await launchScenario(phaserGame, spec, launchOpts);
  const maxTurns = spec.script && spec.script.length > 0 ? spec.script.length : 5;
  const summary = await playBattle(game, {
    script: spec.script,
    forcedMove: forced,
    maxTurns,
    waves: spec.run?.waves && spec.run.waves > 0 ? spec.run.waves : 1,
    rewards: spec.rewards,
    learnMove: spec.learnMove,
  });
  if (spec.expect) {
    const failures = evaluateExpect(spec.expect, {
      game,
      player: game.scene.getPlayerField()[0],
      enemy: game.scene.getEnemyField()[0],
      outcome: summary.outcome,
      maxHits: summary.maxHits,
      log: summary.log,
      enemyMovesUsed: summary.enemyMovesUsed,
    });
    expect(failures, `expect mismatches:\n${failures.join("\n")}`).toEqual([]);
  }
  return { game, summary };
}

/** Run one inline spec through the FULL-RUN autopilot pipeline (playRun) and return the rich result. */
async function runInlineRun(
  phaserGame: Phaser.Game,
  spec: RunnerInput,
  waveTarget: number,
  extra: { quiet?: boolean; autoFirst?: boolean; toEnd?: boolean } = {},
): Promise<{ game: GameManager; result: RunResult }> {
  normalizeSpec(spec);
  const bootStart = performance.now();
  const game = await launchScenario(phaserGame, spec, {});
  const bootToRunMs = Math.round(performance.now() - bootStart);
  const policy = buildPolicy(spec, extra.autoFirst ?? false);
  const result = await playRun(game, {
    script: spec.script,
    forcedMove: null,
    maxTurnsPerWave: 8,
    waveTarget,
    toEnd: extra.toEnd ?? false,
    policy,
    quiet: extra.quiet ?? true,
    bootToRunMs,
  });
  return { game, result };
}

describe.skipIf(!SELF_CHECK)("headless scenario runner — capability self-checks", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("scripted moves ALREADY in the moveset deplete PP (non-destructive select routing)", async () => {
    const spec: RunnerInput = {
      v: 1,
      // Defense Curl (a harmless self-buff) played 3 turns; both sides forced to Defense Curl so
      // nobody faints and the battle lasts all 3 turns. PP must fall AND the other 3 moves survive.
      name: "PP depletion regression",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.DEFENSE_CURL, MoveId.SPLASH, MoveId.REST, MoveId.PROTECT] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.SPLASH] } },
      script: [
        { move: "DEFENSE_CURL", enemyMove: "DEFENSE_CURL" },
        { move: "DEFENSE_CURL", enemyMove: "DEFENSE_CURL" },
        { move: "DEFENSE_CURL", enemyMove: "DEFENSE_CURL" },
      ],
    };
    const { game } = await runInline(phaserGame, spec);
    const lead = game.scene.getPlayerField()[0];
    const moveset = lead.getMoveset();
    expect(moveset.length, "moveset must NOT be spliced down to a single move").toBe(4);
    const curl = moveset.find(m => m.moveId === MoveId.DEFENSE_CURL);
    expect(curl?.ppUsed, "Defense Curl PP must have depleted across 3 turns").toBe(3);
  }, 180_000);

  it("engine-synthesized Struggle preserves an exhausted real moveset", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "synthetic Struggle preserves moveset",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH, MoveId.PROTECT] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{}],
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, {});
    const lead = game.scene.getPlayerField()[0];
    const originalMoveIds = lead.getMoveset().map(move => move.moveId);
    lead.getMoveset().forEach(move => {
      move.ppUsed = move.getMovePp();
    });

    await playBattle(game, { script: spec.script, forcedMove: null, maxTurns: 1, waves: 1 });

    expect(
      lead.getMoveset().map(move => move.moveId),
      "synthetic Struggle must not splice the moveset",
    ).toEqual(originalMoveIds);
    expect(lead.getLastXMoves()[0]?.move, "the exhausted Pokemon should execute Struggle").toBe(MoveId.STRUGGLE);
  }, 180_000);

  it("a queued two-turn continuation does not consume the next scripted command", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "automatic continuation command regression",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.KARTANA, moves: [MoveId.SOLAR_BLADE, MoveId.SPLASH] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.SHUCKLE, level: 100, moves: [MoveId.TORMENT, MoveId.SPLASH] } },
      script: [
        { move: "SOLAR_BLADE", enemyMove: "TORMENT" },
        // Solar Blade executes automatically here. Queueing this duplicate command
        // used to leave a stale FIGHT prompt that Torment rejected on turn three.
        { move: "SOLAR_BLADE", enemyMove: "SPLASH" },
        { move: "SPLASH", enemyMove: "SPLASH" },
      ],
    };
    const { game, summary } = await runInline(phaserGame, spec);
    expect(summary.turnsPlayed).toBe(3);
    const moveset = game.scene.getPlayerField()[0].getMoveset();
    expect(moveset.find(move => move.moveId === MoveId.SOLAR_BLADE)?.ppUsed).toBe(1);
    expect(moveset.find(move => move.moveId === MoveId.SPLASH)?.ppUsed).toBe(1);
  }, 180_000);

  it("a fallback move NOT in the moveset uses the destructive `use` path", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "use fallback",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ move: "TACKLE", target: BattlerIndex.ENEMY }],
    };
    const { game } = await runInline(phaserGame, spec);
    const lead = game.scene.getPlayerField()[0];
    // `use` splices in TACKLE as the sole move.
    expect(lead.getMoveset().some(m => m.moveId === MoveId.TACKLE)).toBe(true);
  }, 180_000);

  it("voluntary switch sends out the bench mon via the real Command path", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "voluntary switch",
      run: { level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.THUNDERBOLT] },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ switch: 1 }],
    };
    const { game } = await runInline(phaserGame, spec);
    expect(game.scene.getPlayerField()[0].species.speciesId, "PIKACHU should be active after the switch").toBe(
      SpeciesId.PIKACHU,
    );
  }, 180_000);

  it("the policy adapter preserves a trapped holder's legal Baton transfer", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "policy Baton transfer",
      run: { level: 100, difficulty: "hell", enemyAi: "hardest" },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH], heldItems: [{ name: "BATON" }] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.THUNDERBOLT] },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.DUGTRIO,
            level: 100,
            moves: [MoveId.SPLASH],
            ability: AbilityId.ARENA_TRAP,
          },
        ],
      },
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, {});
    const actor = game.scene.getPlayerField()[0];
    expect(actor.isTrapped([], true), "Arena Trap should forbid a normal switch").toBe(true);
    const candidates = enumerateErCombatCandidates(game.scene, 0);
    expect(candidates.some(candidate => candidate.kind === "switch" && candidate.transfer === "normal")).toBe(false);
    const baton = candidates.find(
      candidate => candidate.kind === "switch" && candidate.partyIndex === 1 && candidate.transfer === "baton",
    );
    expect(baton, "the held Baton should expose a trap-bypassing transfer candidate").toBeDefined();

    const action: TurnAction = {};
    setCandidateAction(game, action, 0, baton!);
    doPlayerActions(game, action, null, []);
    await game.phaseInterceptor.to("EnemyCommandPhase", false);
    expect(game.scene.currentBattle.turnCommands[0]).toMatchObject({
      command: Command.POKEMON,
      cursor: 1,
      args: [true],
    });
  }, 180_000);

  it("Revival Blessing selects the REVIVE party option through the public UI", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "revival blessing party routing",
      run: { level: 100, difficulty: "hell", enemyAi: "hardest" },
      party: [
        { species: SpeciesId.MEW, moves: [MoveId.MEMENTO] },
        { species: SpeciesId.RABSCA, moves: [MoveId.REVIVAL_BLESSING, MoveId.HYPER_BEAM] },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 1, moves: [MoveId.SPLASH] } },
      script: [
        { move: "MEMENTO", enemyMove: "SPLASH" },
        { move: "REVIVAL_BLESSING", enemyMove: "SPLASH" },
        { move: "HYPER_BEAM", enemyMove: "SPLASH" },
      ],
    };
    const { game } = await runInlineRun(phaserGame, spec, 1);
    expect(game.scene.getPlayerParty()[0].isFainted(), "Memento user should have been revived").toBe(false);
  }, 180_000);

  it("simultaneous voluntary switches route each doubles slot through its own party prompt", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "actor-keyed doubles switches",
      run: { level: 100, difficulty: "hell", enemyAi: "hardest", double: true },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.THUNDERBOLT] },
        { species: SpeciesId.BLISSEY, moves: [MoveId.SEISMIC_TOSS] },
        { species: SpeciesId.RAICHU, moves: [MoveId.THUNDERBOLT] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] },
          { species: SpeciesId.SHUCKLE, level: 100, moves: [MoveId.SPLASH] },
        ],
      },
      script: [{ switch: 2, switch2: 3 }],
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, {});
    doPlayerActions(game, spec.script?.[0], null, []);
    await game.phaseInterceptor.to("EnemyCommandPhase", false);
    expect([game.scene.currentBattle.turnCommands[0], game.scene.currentBattle.turnCommands[1]]).toMatchObject([
      { command: Command.POKEMON, cursor: 2 },
      { command: Command.POKEMON, cursor: 3 },
    ]);
  }, 180_000);

  it("a ghost evaluator trainer fixture starts both seats with canonical state parity", async () => {
    const sharedParty: SpecMon[] = [
      {
        species: SpeciesId.GARCHOMP,
        abilitySlot: 0,
        passive: true,
        ivs: [31, 30, 29, 28, 27, 26],
        nature: Nature.ADAMANT,
        moves: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.PROTECT, MoveId.SWORDS_DANCE],
        heldItems: [{ name: "LEFTOVERS", count: 2 }],
      },
      {
        species: SpeciesId.SNORLAX,
        abilitySlot: 1,
        passive: false,
        ivs: [20, 21, 22, 23, 24, 25],
        nature: Nature.CAREFUL,
        moves: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.REST, MoveId.PROTECT],
        heldItems: [{ name: "BATON" }],
      },
      {
        species: SpeciesId.PIKACHU,
        abilitySlot: 0,
        passive: true,
        ivs: [11, 12, 13, 14, 15, 16],
        nature: Nature.TIMID,
        moves: [MoveId.THUNDERBOLT, MoveId.VOLT_SWITCH, MoveId.NASTY_PLOT, MoveId.PROTECT],
        heldItems: [{ name: "SOUL_DEW", count: 3 }],
      },
      {
        species: SpeciesId.GENGAR,
        abilitySlot: 0,
        passive: false,
        ivs: [1, 2, 3, 4, 5, 6],
        nature: Nature.MODEST,
        moves: [MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.DESTINY_BOND, MoveId.PROTECT],
      },
    ];
    const spec: RunnerInput = {
      v: 1,
      name: "ghost evaluator canonical start parity",
      run: {
        wave: 199,
        level: 100,
        difficulty: "hell",
        enemyAi: "hardest",
        double: true,
        seed: "ghost-evaluator-start-parity",
      },
      party: sharedParty,
      enemy: {
        kind: "party",
        trainerType: TrainerType.ACE_TRAINER,
        neutralEvaluator: true,
        party: sharedParty.map(member => ({ ...member, level: 100 })),
      },
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, { realRng: true, driveEntryMenus: true });
    expect(game.scene.currentBattle.trainer, "the custom roster must retain native trainer switching").not.toBeNull();

    const playerObservation = snapshotErCombatObservation(game.scene);
    const enemyObservation = snapshotErCombatObservation(game.scene, {
      perspective: "enemy",
    });
    const canonicalizeSelf = (observation: ErCombatDecisionRecord["observation"]): unknown => {
      const entityLabels = new Map<number, string>();
      observation.selfParty.forEach(mon => entityLabels.set(mon.entityId, `self:${mon.partyIndex}`));
      const visit = (value: unknown, key = ""): unknown => {
        if (Array.isArray(value)) {
          return value.map(entry => visit(entry));
        }
        if (value && typeof value === "object") {
          return Object.fromEntries(
            Object.entries(value).map(([childKey, childValue]) => [childKey, visit(childValue, childKey)]),
          );
        }
        if (
          typeof value === "number"
          && ["entityId", "sourceEntityId", "ownerEntityId", "actorEntityId"].includes(key)
        ) {
          return entityLabels.get(value) ?? `unmapped:${key}`;
        }
        return value;
      };
      return visit({
        format: observation.format,
        weather: observation.weather,
        terrain: observation.terrain,
        fieldEffects: observation.fieldEffects.filter(effect => effect.side !== "opponent"),
        positionalEffects: observation.positionalEffects.filter(effect => effect.side !== "opponent"),
        mechanics: observation.mechanics.filter(effect => effect.side !== "opponent"),
        modifiers: observation.modifiers.filter(modifier => modifier.side === "self" && modifier.modifierId !== "MAP"),
        selfParty: observation.selfParty,
        playerTerasUsed: observation.playerTerasUsed,
      });
    };
    expect(playerObservation.selfParty).toHaveLength(sharedParty.length);
    expect(enemyObservation.selfParty).toHaveLength(sharedParty.length);
    expect(canonicalizeSelf(playerObservation)).toEqual(canonicalizeSelf(enemyObservation));

    const candidateShape = (candidate: ErCombatCandidate): unknown => {
      if (candidate.kind === "switch") {
        return {
          kind: candidate.kind,
          actorSlot: candidate.actorSlot,
          partyIndex: candidate.partyIndex,
          transfer: candidate.transfer,
        };
      }
      if (candidate.kind === "shift") {
        return { kind: candidate.kind, actorSlot: candidate.actorSlot, targetActorSlot: candidate.targetActorSlot };
      }
      return {
        ...candidate,
        id: undefined,
        targets: candidate.targets.map(target => ({ side: target.side, activeSlot: target.activeSlot })),
        derived: {
          ...candidate.derived,
          targetOutcomes: candidate.derived.targetOutcomes.map(row => ({
            ...row,
            target: { side: row.target.side, activeSlot: row.target.activeSlot },
          })),
        },
      };
    };
    for (let actorSlot = 0; actorSlot < 2; actorSlot++) {
      const playerCandidates = enumerateErCombatCandidates(game.scene, actorSlot, [], "player")
        .map(candidateShape)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const enemyCandidates = enumerateErCombatCandidates(game.scene, actorSlot, [], "enemy")
        .map(candidateShape)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(playerCandidates).toEqual(enemyCandidates);
    }
  }, 180_000);

  it("the engine-hardest player adapter matches a native hardest command under identical RNG", async () => {
    const member: SpecMon = {
      species: SpeciesId.GARCHOMP,
      abilitySlot: 0,
      passive: true,
      ivs: [31, 30, 29, 28, 27, 26],
      nature: Nature.ADAMANT,
      moves: [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.PROTECT, MoveId.SWORDS_DANCE],
    };
    const spec: RunnerInput = {
      v: 1,
      name: "native hardest command parity",
      run: {
        wave: 199,
        level: 100,
        difficulty: "hell",
        enemyAi: "hardest",
        seed: "native-hardest-command-parity",
      },
      party: [member],
      enemy: {
        kind: "party",
        trainerType: TrainerType.ACE_TRAINER,
        neutralEvaluator: true,
        party: [{ ...member, level: 100 }],
      },
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, { realRng: true, driveEntryMenus: true });
    const battle = game.scene.currentBattle as unknown as {
      battleSeedState: string | null;
      enemySwitchCounter: number;
    };
    const initialRngState = battle.battleSeedState;
    const playerCandidates = enumerateErCombatCandidates(game.scene, 0, [], "player");
    const action = engineHardestAction(game);
    doPlayerActions(game, action, null, []);
    battle.battleSeedState = initialRngState;
    battle.enemySwitchCounter = 0;
    await game.phaseInterceptor.to("EnemyCommandPhase", false);
    const playerChoice = findCommittedCombatCandidate(game.scene, "player", 0, playerCandidates);
    expect(playerChoice, "the adapter command must map to one legal player candidate").not.toBeNull();

    const enemyCandidates = enumerateErCombatCandidates(game.scene, 0, [], "enemy");
    await game.phaseInterceptor.to("EnemyCommandPhase");
    const enemyChoice = findCommittedCombatCandidate(game.scene, "enemy", 0, enemyCandidates);
    expect(enemyChoice, "the native command must map to one legal enemy candidate").not.toBeNull();

    const semanticChoice = (candidate: ErCombatCandidate | null): unknown => {
      if (candidate?.kind === "move") {
        return {
          kind: candidate.kind,
          moveSlot: candidate.moveSlot,
          moveId: candidate.moveId,
          tera: candidate.tera,
          targetMode: candidate.targetMode,
          targets: candidate.targets.map(target => ({ side: target.side, activeSlot: target.activeSlot })),
        };
      }
      if (candidate?.kind === "switch") {
        return { kind: candidate.kind, partyIndex: candidate.partyIndex, transfer: candidate.transfer };
      }
      return candidate == null ? null : { kind: candidate.kind, targetActorSlot: candidate.targetActorSlot };
    };
    expect(semanticChoice(playerChoice)).toEqual(semanticChoice(enemyChoice));
  }, 180_000);

  it("a pivot move selects a bench replacement instead of the withdrawn source", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "pivot replacement",
      run: { level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.KILOWATTREL, moves: [MoveId.VOLT_SWITCH] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ move: "VOLT_SWITCH", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" }],
    };
    const { game } = await runInlineRun(phaserGame, spec, 1);
    expect(game.scene.getPlayerField()[0].species.speciesId, "the bench Snorlax should replace Kilowattrel").toBe(
      SpeciesId.SNORLAX,
    );
  }, 180_000);

  it("throwing a poke ball consumes a ball (capture attempt is scriptable)", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "ball throw",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ ball: "GREAT_BALL" }],
    };
    const game = await launchScenario(phaserGame, spec, {});
    game.scene.pokeballCounts[PokeballType.GREAT_BALL] = 5;
    const before = game.scene.pokeballCounts[PokeballType.GREAT_BALL];
    await playBattle(game, { script: spec.script, forcedMove: null, maxTurns: 1, waves: 1 });
    expect(game.scene.pokeballCounts[PokeballType.GREAT_BALL], "a Great Ball must have been consumed").toBe(before - 1);
  }, 180_000);

  it("a flee attempt runs the AttemptRunPhase (no hang)", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "flee attempt",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.NINJASK, moves: [MoveId.TACKLE] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.SNORLAX, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ run: true }],
      // Max-roll RNG => the flee deterministically fails, so the battle continues (assert the attempt happened).
      expect: { logIncludes: ["escape"] },
    };
    await runInline(phaserGame, spec);
  }, 180_000);

  it("Terastallizing on the acting slot's move sets isTerastallized", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "tera move",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.GARCHOMP, moves: [MoveId.EARTHQUAKE] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.SNORLAX, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ move: "EARTHQUAKE", target: BattlerIndex.ENEMY, tera: true }],
    };
    const game = await launchScenario(phaserGame, spec, {});
    game.scene.getPlayerField()[0].teraType = game.scene.getPlayerField()[0].getTypes()[0];
    await playBattle(game, { script: spec.script, forcedMove: null, maxTurns: 1, waves: 1 });
    expect(game.scene.getPlayerField()[0].isTerastallized, "the lead should have Terastallized").toBe(true);
  }, 180_000);

  it("per-turn enemy move forcing + enemyUsedMoves assert", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "force enemy move",
      run: { level: 100, difficulty: "ace" },
      // Player only Defense Curls (0 dmg) so the frail foe survives to use both forced moves.
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.DEFENSE_CURL] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.SPLASH] } },
      script: [
        { move: "DEFENSE_CURL", enemyMove: "POUND", enemyTarget: BattlerIndex.PLAYER },
        { move: "DEFENSE_CURL", enemyMove: "GROWL", enemyTarget: BattlerIndex.PLAYER },
      ],
      expect: { enemyUsedMoves: ["POUND", "GROWL"] },
    };
    await runInline(phaserGame, spec);
  }, 180_000);

  it("a 2-mon custom enemy party runs as a DOUBLE battle", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "auto-double custom party",
      run: { level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.SPLASH] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] },
          { species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SPLASH] },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, {});
    expect(game.scene.currentBattle.double, "a 2-mon custom party must be a double battle").toBe(true);
    expect(game.scene.getEnemyField().length).toBe(2);
    expect(game.scene.getPlayerField().length).toBe(2);
  }, 180_000);

  it("per-mon custom enemy fields (status / bossSegments / heldItems) are applied", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "per-mon enemy fields",
      // Default wave (no rival/BST-cap surprises); a low-BST foe that won't devolve.
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.DEFENSE_CURL] }],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.MAGIKARP,
            level: 100,
            moves: [MoveId.DEFENSE_CURL],
            status: StatusEffect.BURN,
            bossSegments: 3,
            heldItems: [{ name: "LEFTOVERS" }],
          },
        ],
      },
      // trySetStatus is PENDING (unshifts ObtainStatusEffectPhase); play one 0-dmg turn to realize it.
      script: [{ move: "DEFENSE_CURL", enemyMove: "DEFENSE_CURL" }],
    };
    const { game } = await runInline(phaserGame, spec);
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.status?.effect, "enemy should be burned").toBe(StatusEffect.BURN);
    expect(enemy.bossSegments, "enemy should have 3 boss segments").toBe(3);
    expect(
      enemy.getHeldItems().some(m => m.type.name.toLowerCase().includes("leftovers")),
      "enemy should hold Leftovers",
    ).toBe(true);
  }, 180_000);

  it("generated per-mon held items use their default variant when type is omitted", async () => {
    const juice = { name: "MYSTERY_ENCOUNTER_SHUCKLE_JUICE" } as const;
    const spec: RunnerInput = {
      v: 1,
      name: "generated held item default variant",
      run: { level: 100, difficulty: "hell" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH], heldItems: [juice] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH], heldItems: [juice] }],
      },
    };

    const game = await launchScenario(phaserGame, spec, {});
    const pokemon = [game.scene.getPlayerField()[0], game.scene.getEnemyField()[0]];

    for (const mon of pokemon) {
      expect(mon.getHeldItems().some(item => item.type.name.toLowerCase().includes("shuckle juice"))).toBe(true);
      expect(Number.isFinite(mon.hp)).toBe(true);
      expect(Number.isFinite(mon.getMaxHp())).toBe(true);
      expect(mon.getStats().every(Number.isFinite)).toBe(true);
    }
  }, 180_000);

  it("per-mon player held items are applied to their exact party members", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "per-mon player held items",
      run: { level: 100, difficulty: "ace", double: true },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH], heldItems: [{ name: "LEFTOVERS" }] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.SPLASH], heldItems: [{ name: "SHELL_BELL" }] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] },
          { species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SPLASH] },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, {});
    const party = game.scene.getPlayerParty();
    expect(party[0].getHeldItems().some(item => item.type.name.toLowerCase().includes("leftovers"))).toBe(true);
    expect(party[0].getHeldItems().some(item => item.type.name.toLowerCase().includes("shell bell"))).toBe(false);
    expect(party[1].getHeldItems().some(item => item.type.name.toLowerCase().includes("shell bell"))).toBe(true);
    expect(party[1].getHeldItems().some(item => item.type.name.toLowerCase().includes("leftovers"))).toBe(false);
  }, 180_000);

  it("extended expect surface reports Nature, items, money, progress, balls, and biome mismatches", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "extended expect mismatch detection",
      run: { level: 100, money: 4321, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, nature: Nature.ADAMANT, moves: [MoveId.SPLASH] }],
      enemy: {
        kind: "wild",
        wild: {
          species: SpeciesId.MAGIKARP,
          level: 100,
          nature: Nature.MODEST,
          moves: [MoveId.SPLASH],
          heldItems: [{ name: "LEFTOVERS" }],
        },
      },
      items: {
        held: [{ name: "LEFTOVERS" }],
        pokeballs: { GREAT_BALL: 3 },
      },
    };
    const game = await launchScenario(phaserGame, spec, {});
    const failures = evaluateExpect(
      {
        playerNature: "MODEST",
        enemyNature: "NOT_A_NATURE",
        playerHeldItems: ["Lucky Egg"],
        playerHeldItemsAbsent: ["Leftovers"],
        enemyHeldItems: ["Shell Bell"],
        enemyHeldItemsAbsent: ["Leftovers"],
        money: 9,
        partyProgress: [
          {
            slot: 0,
            species: "PIKACHU",
            level: 1,
            exp: -1,
            heldItems: ["Lucky Egg"],
            heldItemsAbsent: ["Leftovers"],
          },
        ],
        pokeballs: { GREAT_BALL: 99 },
        terrainTurnsLeft: 999,
        biomeOptions: ["VOLCANO"],
        biomeOptionCount: 3,
      },
      {
        game,
        player: game.scene.getPlayerField()[0],
        enemy: game.scene.getEnemyField()[0],
        outcome: "ongoing",
        maxHits: 0,
        log: "",
        enemyMovesUsed: [],
        biomeOptions: ["PLAINS", "FOREST"],
      },
    );
    const report = failures.join("\n").toLowerCase();
    for (const label of [
      "player nature",
      "enemy nature",
      "player held item",
      "enemy held item",
      "money",
      "party slot 0",
      "party slot 0 held item",
      "great_ball",
      "terrain turns left",
      "biome option count",
      "biome options",
    ]) {
      expect(report, `missing mismatch for ${label}`).toContain(label);
    }
  }, 180_000);

  it("extended expect surface reads live scenario state", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "extended expect live state",
      run: { level: 100, money: 4321, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, nature: "ADAMANT" as unknown as number, moves: [MoveId.SPLASH] }],
      enemy: {
        kind: "wild",
        wild: {
          species: SpeciesId.MAGIKARP,
          level: 100,
          nature: "MODEST" as unknown as number,
          moves: [MoveId.SPLASH],
          heldItems: [{ name: "LEFTOVERS" }],
        },
      },
      items: {
        held: [{ name: "LEFTOVERS" }],
        pokeballs: { GREAT_BALL: 3 },
      },
      script: [{ move: "SPLASH", enemyMove: "SPLASH" }],
      expect: {
        playerNature: "ADAMANT",
        enemyNature: "MODEST",
        playerHeldItems: ["Leftovers"],
        enemyHeldItems: ["Leftovers"],
        money: 4321,
        partyProgress: [{ slot: 0, species: "Snorlax", level: 100, exp: { min: 0 } }],
        pokeballs: { GREAT_BALL: 3 },
      },
    };
    await runInline(phaserGame, spec);
  }, 180_000);

  it("extended expect surface verifies held-item ownership after an in-battle transfer", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "held-item transfer state",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.ALAKAZAM, moves: [MoveId.TRICK] }],
      enemy: {
        kind: "wild",
        wild: {
          species: SpeciesId.MAGIKARP,
          level: 100,
          ability: AbilityId.SWIFT_SWIM,
          moves: [MoveId.SPLASH],
          heldItems: [{ name: "SHELL_BELL" }],
        },
      },
      items: { held: [{ name: "LEFTOVERS" }] },
      script: [{ move: "TRICK", enemyMove: "SPLASH" }],
      expect: {
        playerHeldItems: ["Shell Bell"],
        playerHeldItemsAbsent: ["Leftovers"],
        enemyHeldItems: ["Leftovers"],
        enemyHeldItemsAbsent: ["Shell Bell"],
      },
    };
    await runInline(phaserGame, spec);
  }, 180_000);

  it("run result captures money, progression, items, balls, Natures, and biome options", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "rich result state",
      run: { level: 100, money: 4321, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, nature: Nature.ADAMANT, moves: [MoveId.SPLASH] }],
      enemy: {
        kind: "wild",
        wild: {
          species: SpeciesId.MAGIKARP,
          level: 100,
          nature: Nature.MODEST,
          moves: [MoveId.SPLASH],
          heldItems: [{ name: "LEFTOVERS" }],
        },
      },
      items: { held: [{ name: "LEFTOVERS" }], pokeballs: { GREAT_BALL: 3 } },
    };
    const game = await launchScenario(phaserGame, spec, {});
    setErPendingNodes([
      { biome: BiomeId.PLAINS, revealed: true, source: "base" },
      { biome: BiomeId.FOREST, revealed: true, source: "upgrade" },
    ]);
    try {
      const result = await playRun(game, {
        script: undefined,
        forcedMove: null,
        maxTurnsPerWave: 0,
        waveTarget: 1,
        toEnd: false,
        policy: buildPolicy(spec, false),
        quiet: true,
        bootToRunMs: 0,
      });
      expect(result.state).toMatchObject({
        money: 4321,
        pokeballs: { GREAT_BALL: 3 },
        playerNature: "ADAMANT",
        enemyNature: "MODEST",
        playerHeldItems: expect.arrayContaining([expect.stringMatching(/leftovers/i)]),
        enemyHeldItems: expect.arrayContaining([expect.stringMatching(/leftovers/i)]),
        biomeOptions: ["PLAINS", "FOREST"],
        party: [expect.objectContaining({ species: expect.stringMatching(/snorlax/i), level: 100 })],
      });
    } finally {
      resetErRouting();
    }
  }, 180_000);

  it("a trainer battle reaches CommandPhase without a dialogue hang", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "trainer no-hang",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] }],
      enemy: { kind: "trainer", trainerType: TrainerType.YOUNGSTER },
    };
    const game = await launchScenario(phaserGame, spec, {});
    // Reaching here (the first CommandPhase) is the pass — the intro dialogue did not hang.
    expect(game.scene.currentBattle).toBeTruthy();
    expect(game.scene.getEnemyField().length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it("battle-entry damage can faint a lead and drive its replacement before the first command", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "pre-command faint replacement",
      run: { wave: 199, level: 200, difficulty: "hell", enemyAi: "hardest" },
      party: [
        { species: SpeciesId.IRON_JUGULIS, moves: [MoveId.AIR_SLASH] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.CHARIZARD,
            formIndex: 4,
            level: 200,
            moves: [MoveId.SPLASH],
          },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true, driveEntryMenus: true });
    expect(
      game.scene
        .getPlayerParty()
        .some(pokemon => pokemon.species.speciesId === SpeciesId.IRON_JUGULIS && pokemon.isFainted()),
      "Wildfire should faint the lead during battle entry",
    ).toBe(true);
    expect(
      game.scene.getPlayerField()[0].species.speciesId,
      "the replacement must be active at the first command",
    ).toBe(SpeciesId.SNORLAX);
  }, 180_000);

  it("player faint with a living bench does NOT hang (auto send-out)", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "faint-switch no-hang",
      run: { level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] }, // frail lead, pinned to ~1 HP below
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] }, // tanky bench that survives to continue the battle
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.GARCHOMP, level: 100, moves: [MoveId.EARTHQUAKE] } },
      start: { playerHpPct: 1 },
      script: [
        // Turn 1: the ~1-HP Magikarp faints to the forced Earthquake -> the bench Snorlax auto-sends-out.
        { move: "SPLASH", enemyMove: "EARTHQUAKE", enemyTarget: BattlerIndex.PLAYER },
        // Turn 2: the bulky Snorlax attacks and SURVIVES the enemy's turn (no wipe -> no game-over hang).
        { move: "TACKLE", target: BattlerIndex.ENEMY },
      ],
    };
    const { game } = await runInline(phaserGame, spec);
    // The lead fainted; the bench Snorlax came out and the battle continued (no hang).
    expect(
      game.scene.getPlayerParty().some(p => p.species.speciesId === SpeciesId.MAGIKARP && p.isFainted()),
      "the frail Magikarp lead should have fainted",
    ).toBe(true);
    expect(game.scene.getPlayerField()[0].species.speciesId, "the bench Snorlax should be active").toBe(
      SpeciesId.SNORLAX,
    );
  }, 180_000);

  it("the full-run autopilot replaces an all-fainted doubles field after enemy command starts", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "full-run doubles replacement phase regression",
      run: { level: 100, difficulty: "ace", double: true },
      party: [
        { species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] },
        { species: SpeciesId.FEEBAS, moves: [MoveId.SPLASH] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.GARCHOMP, level: 100, moves: [MoveId.EARTHQUAKE] },
          { species: SpeciesId.RAYQUAZA, level: 100, moves: [MoveId.PROTECT] },
        ],
      },
      start: { playerHpPct: 1, player2HpPct: 1 },
      script: [
        {
          move: "SPLASH",
          move2: "SPLASH",
          enemyMove: "EARTHQUAKE",
          enemyMove2: "PROTECT",
        },
      ],
    };
    const { result } = await runInlineRun(phaserGame, spec, 1);
    expect(result.outcome).not.toBe("error");
    expect(result.log).toContain("faint-switch");
    expect(result.autoFirstLog).toEqual([]);
  }, 180_000);

  it("the combat autopilot submits the sole reserve once after separate double knockouts", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "doubles sole-reserve replacement callback regression",
      run: { wave: 146, level: 100, difficulty: "hell", enemyAi: "hardest", double: true },
      party: [
        { species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] },
        { species: SpeciesId.FEEBAS, moves: [MoveId.SPLASH] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.RAYQUAZA,
            level: 500,
            moves: [MoveId.HYPER_BEAM],
            ability: AbilityId.HONEY_GATHER,
            passiveAbility: AbilityId.HONEY_GATHER,
          },
          {
            species: SpeciesId.RAYQUAZA,
            level: 500,
            moves: [MoveId.HYPER_BEAM],
            ability: AbilityId.HONEY_GATHER,
            passiveAbility: AbilityId.HONEY_GATHER,
          },
        ],
      },
      start: { playerHpPct: 1, player2HpPct: 1 },
      script: [
        {
          move: "SPLASH",
          move2: "SPLASH",
          enemyMove: "HYPER_BEAM",
          enemyTarget: BattlerIndex.PLAYER,
          enemyMove2: "HYPER_BEAM",
          enemyTarget2: BattlerIndex.PLAYER_2,
        },
      ],
    };
    const { result } = await runInlineRun(phaserGame, spec, 1);
    expect(result.outcome).not.toBe("error");
    expect(result.log.match(/faint-switch/g)).toHaveLength(1);
    expect(result.waves[0]?.turns).toBeGreaterThan(1);
  }, 180_000);

  it("the combat autopilot drives consecutive triple faint replacements", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "triple consecutive faint replacements",
      run: { wave: 146, level: 100, difficulty: "hell", enemyAi: "hardest", triple: true },
      party: [
        { species: SpeciesId.MAGIKARP, moves: [MoveId.SPLASH] },
        { species: SpeciesId.FEEBAS, moves: [MoveId.SPLASH] },
        { species: SpeciesId.CATERPIE, moves: [MoveId.STRING_SHOT] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
        { species: SpeciesId.BLISSEY, moves: [MoveId.TACKLE] },
        { species: SpeciesId.SHUCKLE, moves: [MoveId.TACKLE] },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.RAYQUAZA,
            level: 500,
            moves: [MoveId.HYPER_BEAM],
            ability: AbilityId.HONEY_GATHER,
            passiveAbility: AbilityId.HONEY_GATHER,
          },
          {
            species: SpeciesId.RAYQUAZA,
            level: 500,
            moves: [MoveId.HYPER_BEAM],
            ability: AbilityId.HONEY_GATHER,
            passiveAbility: AbilityId.HONEY_GATHER,
          },
          {
            species: SpeciesId.RAYQUAZA,
            level: 500,
            moves: [MoveId.HYPER_BEAM],
            ability: AbilityId.HONEY_GATHER,
            passiveAbility: AbilityId.HONEY_GATHER,
          },
        ],
      },
      start: { playerHpPct: 1, player2HpPct: 1, player3HpPct: 1 },
      script: [
        {
          move: "SPLASH",
          move2: "SPLASH",
          move3: "STRING_SHOT",
          enemyMove: "HYPER_BEAM",
          enemyTarget: BattlerIndex.PLAYER,
          enemyMove2: "HYPER_BEAM",
          enemyTarget2: BattlerIndex.PLAYER_2,
          enemyMove3: "HYPER_BEAM",
          enemyTarget3: 2 as BattlerIndex,
        },
      ],
    };
    const { game, result } = await runInlineRun(phaserGame, spec, 1);
    expect(result.outcome).not.toBe("error");
    expect(result.log.match(/faint-switch/g)).toHaveLength(3);
    expect(game.scene.getPlayerField()).toHaveLength(3);
  }, 180_000);

  it("per-slot expect surface (doubles): player2 / enemy2 HP + fainted", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "per-slot expects",
      run: { level: 100, difficulty: "ace", double: true },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.DEFENSE_CURL] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.DEFENSE_CURL] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.DEFENSE_CURL] },
          { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.DEFENSE_CURL] },
        ],
      },
      // Both sides only Defense Curl (0 dmg) -> nobody faints, so the per-slot fields are meaningful.
      script: [{ move: "DEFENSE_CURL", move2: "DEFENSE_CURL" }],
      expect: { player2Fainted: false, enemy2Fainted: false },
    };
    const { game } = await runInline(phaserGame, spec);
    expect(game.scene.getEnemyField().length).toBe(2);
  }, 180_000);

  it("keeps a timed ability suppression active through its final terrain lapse", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "timed suppression terrain ordering",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.MUK,
          ability: AbilityId.STENCH,
          moves: [5163, MoveId.MINIMIZE, MoveId.POISON_JAB, MoveId.KNOCK_OFF],
        },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.MUK, level: 100, moves: [MoveId.HARDEN] }],
      },
      start: {
        playerAbilitySuppression: {
          ability: AbilityId.STENCH,
          sourceAbility: AbilityId.BALL_FETCH,
          turns: 1,
        },
      },
      script: [
        { move: 5163, enemyMove: "HARDEN" },
        { move: "MINIMIZE", enemyMove: "HARDEN" },
      ],
    };

    const { game } = await runInline(phaserGame, spec);

    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.TOXIC);
    expect(game.scene.arena.terrain?.turnsLeft).toBe(7);
  }, 180_000);

  it("multi-wave: drive the reward shop and advance the waveIndex", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "multi-wave reward",
      run: { level: 100, difficulty: "ace", waves: 2 },
      party: [{ species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.MAGIKARP, level: 5, moves: [MoveId.SPLASH] } },
      // Guarantee a non-party reward in the first shop, then take it.
      items: { shop: ["AMULET_COIN"] },
      rewards: ["AMULET_COIN"],
    };
    const game = await launchScenario(phaserGame, spec, {});
    const startWave = game.scene.currentBattle.waveIndex;
    const startModifiers = game.scene.modifiers.length;
    const summary = await playBattle(game, {
      script: undefined,
      forcedMove: MoveId.PSYCHIC,
      maxTurns: 4,
      waves: 2,
      rewards: spec.rewards,
      learnMove: undefined,
    });
    expect(summary.outcome, "both waves should be won").toBe("victory");
    expect(game.scene.currentBattle.waveIndex, "the waveIndex must have advanced").toBeGreaterThan(startWave);
    expect(game.scene.modifiers.length, "a reward should have been applied (modifier count grew)").toBeGreaterThan(
      startModifiers,
    );
  }, 180_000);

  it("real-RNG flag restores non-clamped seeded battle rolls", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "real rng",
      run: { level: 100, difficulty: "ace", seed: "realrngseed12345" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
    };
    const game = await launchScenario(phaserGame, spec, { realRng: true });
    await playBattle(game, { script: undefined, forcedMove: MoveId.SPLASH, maxTurns: 1, waves: 1 });
    // With the real seeded RNG the roll is NOT pinned to the max (range-1); sample it.
    const rolls = Array.from({ length: 40 }, () => game.scene.randBattleSeedInt(100));
    expect(
      rolls.some(r => r !== 99),
      "real RNG must produce non-max rolls (not the clamp)",
    ).toBe(true);
  }, 180_000);

  it("the deterministic default keeps the max-roll clamp (control for the flag)", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "clamp control",
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
    };
    const game = await launchScenario(phaserGame, spec, {});
    await playBattle(game, { script: undefined, forcedMove: MoveId.SPLASH, maxTurns: 1, waves: 1 });
    const rolls = Array.from({ length: 20 }, () => game.scene.randBattleSeedInt(100));
    expect(
      rolls.every(r => r === 99),
      "the default clamp must pin every roll to the max",
    ).toBe(true);
  }, 180_000);

  // --- FULL-RUN autopilot capabilities (biome shop / biome pick / eggs / catch / ME) ---

  it("full run crosses wave 10 (biome shop) without stalling", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "biome-shop leave",
      // Start just before a x0 boss wave so the every-10 biome market is reached quickly.
      run: { level: 100, difficulty: "ace", wave: 8 },
      party: [
        { species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.ICE_BEAM, MoveId.AURA_SPHERE] },
        { species: SpeciesId.ARCEUS, moves: [MoveId.JUDGMENT, MoveId.RECOVER, MoveId.EARTH_POWER, MoveId.ICE_BEAM] },
      ],
      biomeShops: "SKIP",
    };
    const { game, result } = await runInlineRun(phaserGame, spec, 5);
    expect(result.outcome, `run should not error: ${result.outcome}`).not.toBe("error");
    expect(game.scene.currentBattle.waveIndex, "the run should have advanced past the biome-shop wave").toBeGreaterThan(
      10,
    );
    expect(result.biomeShopDriven, "the biome shop (x0 wave) should have been driven").toBe(true);
  }, 600_000);

  // One GameManager per `it` (the prompt-handler run-interval is a per-test static),
  // so the two egg modes are separate cases sharing this helper.
  const runEggLapseCheck = async (mode: "skip" | "hatch"): Promise<void> => {
    const spec: RunnerInput = {
      v: 1,
      name: `egg ${mode}`,
      run: { level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.MAGIKARP, level: 5, moves: [MoveId.SPLASH] } },
      eggs: mode,
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, {});
    // Grant 2 ready-to-hatch eggs so the every-wave EggLapsePhase raises the skip prompt.
    // `pulled: true` is what registers the egg into gameData.eggs (see Egg ctor / addEggToGameData).
    for (let i = 0; i < 2; i++) {
      new Egg({ pulled: true, hatchWaves: 1, sourceType: EggSourceType.GACHA_LEGENDARY, isShiny: false });
    }
    const before = game.scene.gameData.eggs.length;
    expect(before).toBeGreaterThanOrEqual(2);
    const policy = buildPolicy(spec, false);
    const result = await playRun(game, {
      script: undefined,
      forcedMove: MoveId.PSYCHIC,
      maxTurnsPerWave: 6,
      waveTarget: 2,
      toEnd: false,
      policy,
      quiet: true,
      bootToRunMs: 0,
    });
    expect(result.outcome, `egg ${mode} run should not error`).not.toBe("error");
    expect(result.eggDriven, `the egg-lapse prompt should have been driven for '${mode}'`).toBe(true);
    // Both paths hatch the ready eggs, so the queue must have drained.
    expect(game.scene.gameData.eggs.length, "the ready eggs should have hatched").toBeLessThan(before);
  };

  it("egg lapse (skip) does not stall the run", async () => {
    await runEggLapseCheck("skip");
  }, 600_000);

  it("egg lapse (hatch) drives the summary without stalling", async () => {
    await runEggLapseCheck("hatch");
  }, 600_000);

  it("party-full catch (release) declines and the run continues", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "party-full catch release",
      run: { level: 100, difficulty: "ace" },
      // A full 6-mon party so a successful catch hits the party-full CONFIRM.
      party: [
        { species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.TACKLE] },
        { species: SpeciesId.PIKACHU, moves: [MoveId.THUNDERBOLT] },
        { species: SpeciesId.CHARIZARD, moves: [MoveId.FLAMETHROWER] },
        { species: SpeciesId.BLASTOISE, moves: [MoveId.SURF] },
        { species: SpeciesId.VENUSAUR, moves: [MoveId.GIGA_DRAIN] },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      // A Master Ball is a guaranteed catch even under max-roll RNG.
      items: { pokeballs: { MASTER_BALL: 5 } },
      onCatchFull: "release",
      script: [{ ball: "MASTER_BALL" }],
    };
    const { game, result } = await runInlineRun(phaserGame, spec, 1);
    expect(result.outcome, `run should not error: ${result.outcome}`).not.toBe("error");
    expect(result.catchFullDriven, "the party-full CONFIRM should have been driven").toBe(true);
    // Release declined the caught mon, so the party stays at 6.
    expect(game.scene.getPlayerParty().length, "release keeps the party at 6").toBe(6);
  }, 600_000);

  it("forced mystery encounter mid-run flows back into the wave loop", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "forced ME",
      run: { level: 100, difficulty: "ace", wave: 10 },
      party: [
        { species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.ICE_BEAM, MoveId.AURA_SPHERE] },
        { species: SpeciesId.ARCEUS, moves: [MoveId.JUDGMENT, MoveId.RECOVER, MoveId.EARTH_POWER, MoveId.ICE_BEAM] },
      ],
      // Force a Fortune Teller (a non-battle ER ME) on wave 12; take option 0.
      forceMysteryEncounters: [{ wave: 12, type: "ER_FORTUNE_TELLER" }],
      meOptions: [[0]],
    };
    const { game, result } = await runInlineRun(phaserGame, spec, 6);
    expect(result.outcome, `run should not error: ${result.outcome}`).not.toBe("error");
    expect(result.meDriven, "the forced ME should have been encountered + driven").toBe(true);
    // The run continued past the ME wave.
    expect(game.scene.currentBattle.waveIndex, "the run should have advanced past the ME wave").toBeGreaterThan(12);
  }, 600_000);

  it("25-wave run: biome boundary + biome shop + forced ME + catch + egg, no stall", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "full-run integration",
      // Pin the seed so the wave/rival sequence is deterministic (no flaky matchup).
      run: { level: 100, difficulty: "ace", seed: "erfullrunintegration25" },
      party: [
        // Wide LEAD coverage so no rival/wave matchup can wall the run.
        { species: SpeciesId.MEWTWO, moves: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.ICE_BEAM, MoveId.AURA_SPHERE] },
        { species: SpeciesId.ARCEUS, moves: [MoveId.JUDGMENT, MoveId.RECOVER, MoveId.EARTH_POWER, MoveId.ICE_BEAM] },
        {
          species: SpeciesId.RAYQUAZA,
          moves: [MoveId.DRAGON_ASCENT, MoveId.EARTHQUAKE, MoveId.ICE_BEAM, MoveId.EXTREME_SPEED],
        },
      ],
      // Catch the wave-1 wild with a guaranteed Master Ball (exercises the catch path).
      items: { pokeballs: { MASTER_BALL: 3 } },
      script: [{ ball: "MASTER_BALL" }],
      forceMysteryEncounters: [{ wave: 12, type: "ER_FORTUNE_TELLER" }],
      meOptions: [[0]],
      onCatchFull: "release",
      eggs: "skip",
      biomeShops: "SKIP",
      biomePicks: [],
      crossroads: [0],
    };
    normalizeSpec(spec);
    const game = await launchScenario(phaserGame, spec, {});
    // Grant a couple of eggs so an egg lapse is exercised mid-run.
    for (let i = 0; i < 2; i++) {
      new Egg({ pulled: true, hatchWaves: 3, sourceType: EggSourceType.GACHA_LEGENDARY, isShiny: false });
    }
    const policy = buildPolicy(spec, true /* auto-first: never hard-hang on new content */);
    const result = await playRun(game, {
      script: spec.script,
      forcedMove: null,
      maxTurnsPerWave: 20,
      waveTarget: 25,
      toEnd: false,
      policy,
      quiet: true,
      bootToRunMs: 0,
    });
    console.log(
      `INTEGRATION RESULT ${JSON.stringify({
        outcome: result.outcome,
        finalWave: result.finalWave,
        wavesCleared: result.wavesCleared,
        meDriven: result.meDriven,
        biomeShopDriven: result.biomeShopDriven,
        totalMs: result.totalMs,
      })}`,
    );
    expect(result.outcome, `run should not error: ${result.outcome}`).not.toBe("error");
    expect(result.finalWave, "the run should have reached wave 25+").toBeGreaterThanOrEqual(25);
    expect(result.biomeShopDriven, "at least one biome shop should have been driven").toBe(true);
  }, 900_000);
});

describe.skipIf(!EASY_ABILITY_ADDITION_CHECK)("headless scenario runner - easy ability additions", () => {
  const NEUTRAL_ENEMY_ABILITY = {
    ability: AbilityId.BALL_FETCH,
    passiveAbility: AbilityId.BALL_FETCH,
  } as const;
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  async function playScriptedTurn(game: GameManager, action: TurnAction): Promise<void> {
    const actionLog: string[] = [];
    doPlayerActions(game, action, null, actionLog);
    if (hasEnemyForce(action)) {
      await forceEnemyActions(game, action, actionLog);
    }
    await game.toEndOfTurn();
  }

  it("Healer cures both the natural holder and its ally", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Healer guaranteed holder and ally cure",
      run: { wave: 145, level: 100, difficulty: "ace", double: true },
      party: [
        {
          species: SpeciesId.CHANSEY,
          ability: AbilityId.HEALER,
          moves: [MoveId.PROTECT, MoveId.HEAL_PULSE, MoveId.LIGHT_SCREEN, MoveId.SOFT_BOILED],
        },
        {
          species: SpeciesId.AUDINO,
          abilitySlot: 0,
          moves: [MoveId.SPLASH, MoveId.HELPING_HAND, MoveId.DAZZLING_GLEAM, MoveId.WISH],
        },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.SPLASH] },
          { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.SPLASH] },
        ],
      },
      start: { playerStatus: StatusEffect.BURN, player2Status: StatusEffect.POISON },
      script: [{ move: "PROTECT", move2: "SPLASH", enemyMove: "SPLASH", enemyMove2: "SPLASH" }],
      expect: { playerStatus: "NONE", player2Status: "NONE" },
    };
    const game = await launchScenario(phaserGame, spec, {});
    const [holder, ally] = game.scene.getPlayerField();
    ally.summonData.ability = AbilityId.BALL_FETCH;
    expect(ally.getAbility().id).toBe(AbilityId.BALL_FETCH);
    await playScriptedTurn(game, spec.script?.[0] ?? {});
    await game.toNextTurn();
    expect(holder.status).toBeNull();
    expect(ally.status).toBeNull();
  }, 180_000);

  it("Klutz keeps the foe's Sitrus Berry disabled", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Klutz Unnerve rider",
      run: { level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.CROBAT,
          ability: AbilityId.KLUTZ,
          moves: [MoveId.SPLASH, MoveId.SUPER_FANG, MoveId.ROOST, MoveId.PROTECT],
        },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.SNORLAX,
            level: 100,
            moves: [MoveId.SPLASH],
            heldItems: [{ name: "BERRY", type: BerryType.SITRUS }],
          },
        ],
      },
      start: { enemyHpPct: 60 },
      script: [{ move: "SUPER_FANG", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" }],
      expect: { logExcludes: ["restored its health using its sitrus berry"] },
    };
    const { game } = await runInline(phaserGame, spec, { noMiss: true });
    expect(
      game.scene
        .getEnemyField()[0]
        .getHeldItems()
        .some(item => item.type.name.toLowerCase().includes("sitrus")),
      "the disabled Sitrus Berry must remain held",
    ).toBe(true);
  }, 180_000);

  it("Powder Burst grants powder immunity", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Powder Burst powder immunity",
      run: { level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.SNORLAX,
          ability: ErAbilityId.POWDER_BURST,
          moves: [MoveId.SPLASH, MoveId.PROTECT, MoveId.REST, MoveId.BODY_SLAM],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.BRELOOM, level: 100, moves: [MoveId.SPORE] } },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true });
    game.scene.arena.removeTagOnSide(ArenaTagType.SAFEGUARD, ArenaTagSide.PLAYER, true);
    await playScriptedTurn(game, {
      move: "SPLASH",
      enemyMove: "SPORE",
      enemyTarget: BattlerIndex.PLAYER,
    });
    expect(game.scene.getPlayerField()[0].status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  }, 180_000);

  it.each([
    ["Sweet Veil", AbilityId.SWEET_VEIL],
    ["Pastel Veil", AbilityId.PASTEL_VEIL],
  ] as const)(
    "%s heals the damaged party when the bench holder first enters",
    async (_name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} first-entry party heal`,
        run: { level: 100, difficulty: "ace" },
        party: [
          {
            species: SpeciesId.SNORLAX,
            ability,
            moves: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
          },
          {
            species: SpeciesId.SHUCKLE,
            moves: [MoveId.SPLASH, MoveId.ROCK_SLIDE, MoveId.REST, MoveId.PROTECT],
          },
        ],
        enemy: {
          kind: "wild",
          wild: {
            species: SpeciesId.MAGIKARP,
            level: 100,
            moves: [MoveId.SPLASH],
            ...NEUTRAL_ENEMY_ABILITY,
          },
        },
        start: { playerHpPct: 50 },
        script: [{ switch: 1 }],
      };
      const { game } = await runInline(phaserGame, spec);
      const originalLead = game.scene.getPlayerParty().find(pokemon => pokemon.species.speciesId === SpeciesId.SNORLAX);
      expect(originalLead, "the original lead must remain in the party").toBeDefined();
      expect(originalLead?.getHpRatio(), "the original lead must be healed above 50% HP").toBeGreaterThan(0.55);
    },
    180_000,
  );

  it("Steadfast blocks paralysis and self stat drops through Limber", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Steadfast Limber package",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.LUCARIO,
          ability: AbilityId.STEADFAST,
          moves: [MoveId.CLOSE_COMBAT, MoveId.PROTECT, MoveId.EXTREME_SPEED, MoveId.METEOR_MASH],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.PIKACHU, level: 100, moves: [MoveId.THUNDER_WAVE] } },
      script: [{ move: "CLOSE_COMBAT", enemyMove: "THUNDER_WAVE", enemyTarget: BattlerIndex.PLAYER }],
      expect: { playerStatus: "NONE", playerStage: { stat: "DEF", value: 0 } },
    };
    await runInline(phaserGame, spec, { noMiss: true, noCrit: true });
  }, 180_000);

  it.each([
    ["Heavy Metal", AbilityId.HEAVY_METAL],
    ["Superheavy", ErAbilityId.SUPERHEAVY],
  ] as const)(
    "%s halves fixed sound damage",
    async (_name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} sound reduction`,
        run: { wave: 146, level: 100, difficulty: "ace" },
        party: [
          {
            species: SpeciesId.SNORLAX,
            ability,
            moves: [MoveId.SPLASH, MoveId.PROTECT, MoveId.REST, MoveId.HEAVY_SLAM],
          },
        ],
        enemy: { kind: "wild", wild: { species: SpeciesId.EXPLOUD, level: 100, moves: [MoveId.SONIC_BOOM] } },
        script: [{ move: "SPLASH", enemyMove: "SONIC_BOOM", enemyTarget: BattlerIndex.PLAYER }],
      };
      const { game } = await runInline(phaserGame, spec, { noMiss: true, noCrit: true });
      const holder = game.scene.getPlayerField()[0];
      expect(holder.getMaxHp() - holder.hp, "Sonic Boom's fixed 20 damage must be halved").toBe(10);
    },
    180_000,
  );

  it.each([
    ["Heavy Metal", AbilityId.HEAVY_METAL],
    ["Superheavy", ErAbilityId.SUPERHEAVY],
  ] as const)(
    "%s halves overlapping Dark sound damage only once",
    async (_name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} overlapping Dark sound reduction`,
        run: { wave: 146, level: 100, difficulty: "ace" },
        party: [
          {
            species: SpeciesId.SNORLAX,
            ability,
            moves: [MoveId.SWORDS_DANCE, MoveId.PROTECT, MoveId.REST, MoveId.HEAVY_SLAM],
          },
        ],
        enemy: {
          kind: "party",
          party: [
            {
              species: SpeciesId.HOUNDOOM,
              level: 100,
              moves: [MoveId.SNARL],
              ...NEUTRAL_ENEMY_ABILITY,
            },
          ],
        },
      };
      const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
      const action: TurnAction = { move: "SWORDS_DANCE", enemyMove: "SNARL", enemyTarget: BattlerIndex.PLAYER };
      const holder = game.scene.getPlayerField()[0];

      await playScriptedTurn(game, action);
      const reducedDamage = holder.getMaxHp() - holder.hp;
      await game.toNextTurn();
      holder.summonData.ability = AbilityId.BALL_FETCH;
      const hpBeforeControl = holder.hp;
      await playScriptedTurn(game, action);
      const controlDamage = hpBeforeControl - holder.hp;

      expect(reducedDamage).toBeGreaterThanOrEqual(Math.floor(controlDamage * 0.48));
      expect(reducedDamage).toBeLessThanOrEqual(Math.ceil(controlDamage * 0.52));
    },
    180_000,
  );

  it("Perish Body damages the attacker through ER Aftermath when the holder faints", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Perish Body Aftermath rider",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.CURSOLA,
          ability: AbilityId.PERISH_BODY,
          moves: [MoveId.SPLASH, MoveId.PROTECT, MoveId.SHADOW_BALL, MoveId.STRENGTH_SAP],
        },
        {
          species: SpeciesId.BLISSEY,
          moves: [MoveId.SPLASH, MoveId.PROTECT, MoveId.SEISMIC_TOSS, MoveId.SOFT_BOILED],
        },
      ],
      enemy: {
        kind: "wild",
        wild: {
          species: SpeciesId.ALAKAZAM,
          level: 100,
          moves: [MoveId.SHADOW_BALL],
          ...NEUTRAL_ENEMY_ABILITY,
        },
      },
      start: { playerHpPct: 1 },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const enemy = game.scene.getEnemyField()[0];
    await playScriptedTurn(game, {
      move: "SPLASH",
      enemyMove: "SHADOW_BALL",
      enemyTarget: BattlerIndex.PLAYER,
    });
    expect(enemy.hp, "Aftermath must damage the attacker").toBeLessThan(enemy.getMaxHp());
  }, 180_000);

  it("Dazzling's 1.2x accuracy makes Fire Blast connect under max-roll RNG", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Dazzling accuracy rider",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.BRUXISH,
          ability: AbilityId.DAZZLING,
          moves: [MoveId.FIRE_BLAST, MoveId.PROTECT, MoveId.PSYCHIC_FANGS, MoveId.AQUA_JET],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
      script: [{ move: "FIRE_BLAST", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" }],
    };
    const { game } = await runInline(phaserGame, spec, { noCrit: true });
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.hp, "Fire Blast must hit once accuracy exceeds 100").toBeLessThan(enemy.getMaxHp());
  }, 180_000);

  it("Gulp Missile reduces level-based fixed damage by 20%", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Gulp Missile damage reduction",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.CRAMORANT,
          ability: AbilityId.GULP_MISSILE,
          moves: [MoveId.SPLASH, MoveId.SURF, MoveId.ROOST, MoveId.PROTECT],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SEISMIC_TOSS] } },
      script: [{ move: "SPLASH", enemyMove: "SEISMIC_TOSS", enemyTarget: BattlerIndex.PLAYER }],
    };
    const { game } = await runInline(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    expect(holder.getMaxHp() - holder.hp).toBe(80);
  }, 180_000);

  it("Delta Stream starts a three-turn Tailwind in addition to Strong Winds", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Delta Stream Air Blower rider",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.RAYQUAZA,
          ability: AbilityId.DELTA_STREAM,
          moves: [MoveId.SPLASH, MoveId.DRAGON_ASCENT, MoveId.ROOST, MoveId.EXTREME_SPEED],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.SPLASH] } },
    };
    const game = await launchScenario(phaserGame, spec, {});
    const tailwind = game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    expect(tailwind).toBeDefined();
    expect(tailwind?.turnCount).toBe(3);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.STRONG_WINDS);
  }, 180_000);

  it("Parroting is immune to sound moves", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Parroting sound immunity",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.SNORLAX,
          ability: ErAbilityId.PARROTING,
          moves: [MoveId.SPLASH, MoveId.BODY_SLAM, MoveId.REST, MoveId.PROTECT],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.EXPLOUD, level: 100, moves: [MoveId.HYPER_VOICE] } },
      script: [{ move: "SPLASH", enemyMove: "HYPER_VOICE", enemyTarget: BattlerIndex.PLAYER }],
    };
    const { game } = await runInline(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    expect(holder.hp).toBe(holder.getMaxHp());
  }, 180_000);

  it("Antarctic Bird boosts Water damage by 1.3x", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Antarctic Bird Water boost",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.ARTICUNO,
          ability: ErAbilityId.ANTARCTIC_BIRD,
          moves: [MoveId.WATER_PULSE, MoveId.ICE_BEAM, MoveId.AIR_SLASH, MoveId.ROOST],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const action: TurnAction = { move: "WATER_PULSE", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" };
    const enemy = game.scene.getEnemyField()[0];

    await playScriptedTurn(game, action);
    const boostedDamage = enemy.getMaxHp() - enemy.hp;
    await game.toNextTurn();
    game.scene.getPlayerField()[0].summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeControl = enemy.hp;
    await playScriptedTurn(game, action);
    const controlDamage = hpBeforeControl - enemy.hp;

    expect(boostedDamage).toBeGreaterThanOrEqual(Math.floor(controlDamage * 1.25));
  }, 180_000);

  it("Moon Spirit halves Water damage", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Moon Spirit Water reduction",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.UMBREON,
          ability: ErAbilityId.MOON_SPIRIT,
          moves: [MoveId.SPLASH, MoveId.MOONLIGHT, MoveId.DARK_PULSE, MoveId.PROTECT],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.BLASTOISE, level: 100, moves: [MoveId.SURF] } },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const action: TurnAction = { move: "SPLASH", enemyMove: "SURF", enemyTarget: BattlerIndex.PLAYER };
    const holder = game.scene.getPlayerField()[0];

    await playScriptedTurn(game, action);
    const reducedDamage = holder.getMaxHp() - holder.hp;
    await game.toNextTurn();
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeControl = holder.hp;
    await playScriptedTurn(game, action);
    const controlDamage = hpBeforeControl - holder.hp;

    expect(reducedDamage).toBeLessThanOrEqual(Math.ceil(controlDamage * 0.55));
  }, 180_000);

  it.each([
    ["Soothing Aroma", ErAbilityId.SOOTHING_AROMA],
    ["Butter Up", ErAbilityId.BUTTER_UP],
  ] as const)(
    "%s heals its holder and adjacent ally",
    async (name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${name} holder and ally recovery`,
        run: { wave: 145, level: 100, difficulty: "ace", double: true },
        party: [
          {
            species: SpeciesId.SKIPLOOM,
            ability,
            moves: [MoveId.PROTECT, MoveId.GIGA_DRAIN, MoveId.SYNTHESIS, MoveId.HELPING_HAND],
          },
          {
            species: SpeciesId.BLISSEY,
            moves: [MoveId.PROTECT, MoveId.HELPING_HAND, MoveId.LIGHT_SCREEN, MoveId.SOFT_BOILED],
          },
        ],
        enemy: {
          kind: "party",
          party: [
            { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.PROTECT], ...NEUTRAL_ENEMY_ABILITY },
            { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.PROTECT] },
          ],
        },
        start: { playerHpPct: 50, player2HpPct: 50 },
        script: [{ move: "PROTECT", move2: "PROTECT", enemyMove: "PROTECT", enemyMove2: "PROTECT" }],
      };
      const game = await launchScenario(phaserGame, spec, {});
      const [holder, ally] = game.scene.getPlayerField();
      ally.summonData.ability = AbilityId.BALL_FETCH;
      expect(ally.getAbility().id).toBe(AbilityId.BALL_FETCH);
      const hpBefore = [holder.hp, ally.hp];
      await playScriptedTurn(game, spec.script?.[0] ?? {});
      await game.toNextTurn();
      for (const [index, pokemon] of [holder, ally].entries()) {
        expect(pokemon.hp - hpBefore[index]).toBe(Math.floor(pokemon.getMaxHp() / 16));
      }
    },
    180_000,
  );

  it("Neutralizing Fog blocks weather-based enemy attacks", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Neutralizing Fog Weather Control rider",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.CORVIKNIGHT,
          ability: ErAbilityId.NEUTRALIZING_FOG,
          moves: [MoveId.SPLASH, MoveId.ROOST, MoveId.IRON_DEFENSE, MoveId.BODY_PRESS],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CASTFORM, level: 100, moves: [MoveId.WEATHER_BALL] } },
      script: [{ move: "SPLASH", enemyMove: "WEATHER_BALL", enemyTarget: BattlerIndex.PLAYER }],
    };
    const { game } = await runInline(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    expect(holder.hp).toBe(holder.getMaxHp());
  }, 180_000);

  it("Color Spectrum grants STAB to an off-type move", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Color Spectrum Mystic Power rider",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.SNORLAX,
          ability: ErAbilityId.COLOR_SPECTRUM,
          moves: [MoveId.WATER_PULSE, MoveId.THUNDERBOLT, MoveId.ICE_BEAM, MoveId.PSYCHIC],
        },
      ],
      enemy: { kind: "wild", wild: { species: SpeciesId.CHANSEY, level: 100, moves: [MoveId.SPLASH] } },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const entryTypes = [...holder.summonData.types];
    const move = (
      [
        [MoveId.WATER_PULSE, PokemonType.WATER],
        [MoveId.THUNDERBOLT, PokemonType.ELECTRIC],
        [MoveId.ICE_BEAM, PokemonType.ICE],
        [MoveId.PSYCHIC, PokemonType.PSYCHIC],
      ] as const
    ).find(([, type]) => !holder.isOfType(type))?.[0];
    expect(move, "the four-move coverage must include an off-type move").toBeDefined();
    if (move == null) {
      return;
    }
    const action: TurnAction = { move: MoveId[move], target: BattlerIndex.ENEMY, enemyMove: "SPLASH" };
    const enemy = game.scene.getEnemyField()[0];

    await playScriptedTurn(game, action);
    const stabDamage = enemy.getMaxHp() - enemy.hp;
    await game.toNextTurn();
    holder.summonData.ability = AbilityId.BALL_FETCH;
    holder.summonData.types = entryTypes;
    const hpBeforeControl = enemy.hp;
    await playScriptedTurn(game, action);
    const controlDamage = hpBeforeControl - enemy.hp;

    expect(stabDamage).toBeGreaterThanOrEqual(Math.floor(controlDamage * 1.45));
  }, 180_000);

  it("Higher Rank applies the new 1.3x priority boost", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Higher Rank 1.3 priority boost",
      run: { wave: 145, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.PERSIAN,
          ability: ErAbilityId.HIGHER_RANK,
          moves: [MoveId.QUICK_ATTACK, MoveId.TACKLE, MoveId.PROTECT, MoveId.SCREECH],
        },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.CHANSEY,
            level: 100,
            moves: [MoveId.SPLASH],
            ...NEUTRAL_ENEMY_ABILITY,
          },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const action: TurnAction = { move: "QUICK_ATTACK", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" };
    const enemy = game.scene.getEnemyField()[0];

    await playScriptedTurn(game, action);
    const boostedDamage = enemy.getMaxHp() - enemy.hp;
    await game.toNextTurn();
    game.scene.getPlayerField()[0].summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeControl = enemy.hp;
    await playScriptedTurn(game, action);
    const controlDamage = hpBeforeControl - enemy.hp;

    expect(boostedDamage).toBeGreaterThanOrEqual(Math.floor(controlDamage * 1.27));
  }, 180_000);

  it.each([
    ["Flourish", ErAbilityId.FLOURISH, TerrainType.GRASSY],
    ["Celestial Blessing", ErAbilityId.CELESTIAL_BLESSING, TerrainType.MISTY],
    ["Eternal Blessing", ErAbilityId.ETERNAL_BLESSING, TerrainType.MISTY],
  ] as const)(
    "%s heals one eighth in its terrain",
    async (_name, ability, terrain) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} terrain recovery`,
        run: { level: 100, difficulty: "ace", terrain },
        party: [
          {
            species: SpeciesId.MEGANIUM,
            ability,
            moves: [MoveId.PROTECT, MoveId.ENERGY_BALL, MoveId.RECOVER, MoveId.REFLECT],
          },
        ],
        enemy: {
          kind: "wild",
          wild: {
            species: SpeciesId.MAGIKARP,
            level: 100,
            moves: [MoveId.SPLASH],
            ...NEUTRAL_ENEMY_ABILITY,
          },
        },
        start: { playerHpPct: 50 },
      };
      const game = await launchScenario(phaserGame, spec, {});
      const holder = game.scene.getPlayerField()[0];
      const action: TurnAction = { move: "PROTECT", enemyMove: "SPLASH" };
      const hpBeforeAbilityTurn = holder.hp;
      await playScriptedTurn(game, action);
      await game.toNextTurn();
      const abilityTurnDelta = holder.hp - hpBeforeAbilityTurn;
      holder.summonData.ability = AbilityId.BALL_FETCH;
      const hpBeforeControlTurn = holder.hp;
      await playScriptedTurn(game, action);
      await game.toNextTurn();
      const controlTurnDelta = holder.hp - hpBeforeControlTurn;

      expect(abilityTurnDelta - controlTurnDelta).toBeGreaterThanOrEqual(Math.floor(holder.getMaxHp() * 0.12));
    },
    180_000,
  );

  it.each([
    ["Readied Action", ErAbilityId.READIED_ACTION],
    ["Demolitionist", ErAbilityId.DEMOLITIONIST],
  ] as const)(
    "%s doubles direct special damage only on turn one",
    async (_name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} first-turn direct damage`,
        run: { wave: 146, level: 100, difficulty: "ace" },
        party: [
          {
            species: SpeciesId.ALAKAZAM,
            ability,
            moves: [MoveId.PSYCHIC, MoveId.PROTECT, MoveId.RECOVER, MoveId.SHADOW_BALL],
          },
        ],
        enemy: { kind: "wild", wild: { species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SPLASH] } },
      };
      const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
      const action: TurnAction = { move: "PSYCHIC", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" };
      const enemy = game.scene.getEnemyField()[0];

      await playScriptedTurn(game, action);
      const firstTurnDamage = enemy.getMaxHp() - enemy.hp;
      await game.toNextTurn();
      const hpBeforeSecondTurn = enemy.hp;
      await playScriptedTurn(game, action);
      const secondTurnDamage = hpBeforeSecondTurn - enemy.hp;

      expect(firstTurnDamage).toBeGreaterThanOrEqual(Math.floor(secondTurnDamage * 1.8));
    },
    180_000,
  );

  it.each([
    ["Readied Action", ErAbilityId.READIED_ACTION],
    ["Demolitionist", ErAbilityId.DEMOLITIONIST],
  ] as const)(
    "%s doubles direct fixed damage only on turn one",
    async (_name, ability) => {
      const spec: RunnerInput = {
        v: 1,
        name: `${_name} first-turn fixed damage`,
        run: { wave: 146, level: 100, difficulty: "ace" },
        party: [
          {
            species: SpeciesId.ALAKAZAM,
            ability,
            moves: [MoveId.SONIC_BOOM, MoveId.PROTECT, MoveId.RECOVER, MoveId.PSYCHIC],
          },
        ],
        enemy: {
          kind: "party",
          party: [
            {
              species: SpeciesId.BLISSEY,
              level: 100,
              moves: [MoveId.SPLASH],
              ...NEUTRAL_ENEMY_ABILITY,
            },
          ],
        },
      };
      const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
      const action: TurnAction = { move: "SONIC_BOOM", target: BattlerIndex.ENEMY, enemyMove: "SPLASH" };
      const enemy = game.scene.getEnemyField()[0];

      await playScriptedTurn(game, action);
      expect(enemy.getMaxHp() - enemy.hp).toBe(40);
      await game.toNextTurn();
      const hpBeforeSecondTurn = enemy.hp;
      await playScriptedTurn(game, action);
      expect(hpBeforeSecondTurn - enemy.hp).toBe(20);
    },
    180_000,
  );
});

describe.skipIf(!TELEMETRY_ISOLATION_CHECK)("headless scenario runner - player telemetry isolation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let soloMode: ReturnType<typeof getGameMode>;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    const spec: RunnerInput = {
      v: 1,
      name: "player telemetry mode isolation",
      run: { wave: 3, level: 15, difficulty: "youngster" },
      party: [{ species: SpeciesId.PIKACHU, moves: [MoveId.THUNDER_SHOCK] }],
      enemy: { kind: "wild", wild: { species: SpeciesId.RATTATA, level: 15, moves: [MoveId.TACKLE] } },
    };
    game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    soloMode = game.scene.gameMode;
  }, 180_000);

  it("allows a real solo battle", () => {
    clearTournamentMatchContext();
    game.scene.gameMode = soloMode;
    expect(game.scene.currentBattle).toBeDefined();
    expect(game.scene.gameMode.isCoop ?? false).toBe(false);
    expect(game.scene.gameMode.isShowdown ?? false).toBe(false);
    expect(isCurrentPlayerTelemetryBattleEligible()).toBe(true);
  });

  it("rejects a real co-op battle mode", () => {
    clearTournamentMatchContext();
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    expect(isCurrentPlayerTelemetryBattleEligible()).toBe(false);
  });

  it("rejects a real Showdown battle mode before runtime negotiation", () => {
    clearTournamentMatchContext();
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    expect(game.scene.gameMode.isShowdown).toBe(true);
    expect(isTournamentMatch()).toBe(false);
    expect(isCurrentPlayerTelemetryBattleEligible()).toBe(false);
  });

  it("rejects a tournament-tagged Showdown battle mode", () => {
    setTournamentMatchContext({
      tournamentId: "headless-tournament",
      matchId: "headless-tournament-r1-m0",
      expectedOpponent: "opponent",
    });
    game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
    expect(isTournamentMatch()).toBe(true);
    expect(isCurrentPlayerTelemetryBattleEligible()).toBe(false);
  });
});

describe.skipIf(!AI_CONTRACT_CHECK)("headless scenario runner - combat observation contract", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("records only public foe information and preserves ER decision state", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "combat observation public-information boundary",
      run: { wave: 146, level: 100, difficulty: "hell", enemyAi: "hardest" },
      party: [
        {
          species: SpeciesId.BLISSEY,
          ability: AbilityId.FRISK,
          passiveAbility: AbilityId.HONEY_GATHER,
          moves: [MoveId.EARTHQUAKE, MoveId.GIGA_DRAIN, MoveId.HYPER_BEAM, MoveId.PROTECT],
          heldItems: [{ name: "LEFTOVERS", count: 2 }],
        },
      ],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.ROTOM,
            formIndex: 2,
            level: 50,
            ability: AbilityId.LEVITATE,
            passiveAbility: AbilityId.HONEY_GATHER,
            moves: [MoveId.SOLAR_BEAM, MoveId.HYPER_BEAM, MoveId.SPLASH],
            heldItems: [{ name: "LEFTOVERS", count: 2 }],
          },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });

    const initial = snapshotErCombatObservation(game.scene);
    const actor = initial.selfParty[0];
    const opponent = initial.opponentActive[0];
    expect(game.scene.getEnemyField()[0].waveData.seenInBattle).toBe(true);
    expect(initial.opponentKnownParty).toEqual([]);
    expect(actor.heldItems?.find(item => item.itemId === "LEFTOVERS")?.stackCount).toBe(2);
    expect(actor.abilities.some(ability => ability.abilityId === AbilityId.FRISK && ability.active)).toBe(true);
    expect(opponent.hp).toBeNull();
    expect(opponent.maxHp).toBeNull();
    expect(opponent.stats).toBeNull();
    expect(opponent.effectiveStats).toBeNull();
    expect(opponent.abilities).toEqual([]);
    expect(opponent.revealState.items).toBe("complete");
    expect(opponent.heldItems?.find(item => item.itemId === "LEFTOVERS")?.stackCount).toBe(2);
    expect(initial.modifiers.every(modifier => modifier.side === "self")).toBe(true);

    const earthquake = enumerateErCombatCandidates(game.scene, 0).find(
      (candidate): candidate is ErCombatMoveCandidate =>
        candidate.kind === "move" && candidate.moveId === MoveId.EARTHQUAKE && !candidate.tera,
    );
    expect(earthquake).toBeDefined();
    expect({
      targetTypes: opponent.types,
      baseTypeMultiplier: earthquake?.baseTypeMultiplier,
      expectedDamageMax: earthquake?.derived.expectedDamageMax,
      immunityReason: earthquake?.derived.immunityReason,
    }).toEqual({
      targetTypes: [PokemonType.ELECTRIC, PokemonType.WATER, PokemonType.GHOST],
      baseTypeMultiplier: 2,
      expectedDamageMax: 0,
      immunityReason: "engine-preview-zero",
    });
    const drain = enumerateErCombatCandidates(game.scene, 0).find(
      (candidate): candidate is ErCombatMoveCandidate =>
        candidate.kind === "move" && candidate.moveId === MoveId.GIGA_DRAIN && !candidate.tera,
    );
    expect(drain?.derived.hasDrain).toBe(true);
    expect(drain?.derived.drainFraction).toBe(0.5);
    expect(drain?.derived.expectedDamageMax).toBeGreaterThan(0);
    expect(extractErCombatCandidateTokenGroups(initial, drain!).actor).toContain(`ability:${AbilityId.FRISK}`);

    const actionLog: string[] = [];
    const action: TurnAction = {
      move: "EARTHQUAKE",
      target: BattlerIndex.ENEMY,
      enemyMove: "SOLAR_BEAM",
      enemyTarget: BattlerIndex.PLAYER,
    };
    doPlayerActions(game, action, null, actionLog);
    await forceEnemyActions(game, action, actionLog);
    await game.toEndOfTurn();

    const afterTurn = snapshotErCombatObservation(game.scene);
    const revealedOpponent = afterTurn.opponentActive[0];
    expect(revealedOpponent.abilities.some(ability => ability.abilityId === AbilityId.LEVITATE)).toBe(true);
    expect(revealedOpponent.revealState.moves).toBe("partial");
    expect(revealedOpponent.moves.some(move => move.moveId === MoveId.SOLAR_BEAM)).toBe(true);
    expect(revealedOpponent.mechanics.some(effect => effect.effectId === "move-history:0")).toBe(true);
    expect(
      revealedOpponent.mechanics.some(
        effect => effect.effectId.startsWith("move-queue:") && effect.sourceMoveId === MoveId.SOLAR_BEAM,
      ),
    ).toBe(true);
  }, 180_000);
});

describe.skipIf(!NEWCOMER_SIGNATURE_CHECK)("headless scenario runner - newcomer signature abilities", () => {
  const NEUTRAL_ABILITY = { ability: AbilityId.HONEY_GATHER, passiveAbility: AbilityId.HONEY_GATHER } as const;
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  async function playTurn(game: GameManager, action: TurnAction): Promise<void> {
    const actionLog: string[] = [];
    doPlayerActions(game, action, null, actionLog);
    if (hasEnemyForce(action)) {
      await forceEnemyActions(game, action, actionLog);
    }
    await game.toEndOfTurn();
  }

  it("Eclipse Wing uses Sturdy timing, counters, and boosts low-HP Dark damage", async () => {
    const endureSpec: RunnerInput = {
      v: 1,
      name: "Eclipse Wing direct lethal counter",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.SUNKERN,
          ability: ER_ECLIPSE_WING_ABILITY_ID,
          moves: [MoveId.NASTY_PLOT, MoveId.DARK_PULSE],
        },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 200, moves: [MoveId.HYPER_BEAM], ...NEUTRAL_ABILITY }],
      },
    };
    const endureGame = await launchScenario(phaserGame, endureSpec, { noMiss: true, noCrit: true });
    const holder = endureGame.scene.getPlayerField()[0];
    const attacker = endureGame.scene.getEnemyField()[0];
    await playTurn(endureGame, {
      move: "NASTY_PLOT",
      enemyMove: "HYPER_BEAM",
      enemyTarget: BattlerIndex.PLAYER,
    });
    expect(holder.hp).toBe(1);
    expect(attacker.hp).toBeLessThan(attacker.getMaxHp());
    const darkPulse = allMoves[MoveId.DARK_PULSE];
    const boostedPower = darkPulse.calculateBattlePower(holder, attacker, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const controlPower = darkPulse.calculateBattlePower(holder, attacker, true);
    expect(boostedPower / controlPower).toBeCloseTo(1.5, 5);
  }, 180_000);

  it("Final Season only arms on a voluntary switch and sets owned Eerie Fog at turn end", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Final Season voluntary entry",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] },
        { species: SpeciesId.MANDIBUZZ, ability: ER_FINAL_SEASON_ABILITY_ID, moves: [MoveId.DARK_PULSE] },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SPLASH], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    game.scene.getPlayerParty()[1].setAbilityOverrideForSlot(0, ER_FINAL_SEASON_ABILITY_ID as AbilityId);
    expect(game.scene.arena.weather?.weatherType).not.toBe(WeatherType.EERIE_FOG);
    await playTurn(game, { switch: 1, enemyMove: "SPLASH" });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    expect(holder.getAbility().name).toBe("Final Season");
    expect(enemy.getTag(BattlerTagType.ER_QUASHED)).toBeDefined();
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.EERIE_FOG);
    await game.toNextTurn();
    const hpBefore = enemy.hp;
    await playTurn(game, { move: "DARK_PULSE", enemyMove: "SPLASH" });
    const fogDamage = hpBefore - enemy.hp;
    expect(fogDamage).toBeGreaterThan(0);
  }, 180_000);

  it("Foul Harvest drains the last used PP, stores charges, and refunds only its draining move", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Foul Harvest PP and drain charge",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.VENUSAUR,
          ability: ER_FOUL_HARVEST_ABILITY_ID,
          moves: [MoveId.TACKLE, MoveId.GIGA_DRAIN],
        },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.RECOVER], ...NEUTRAL_ABILITY }],
      },
      start: { playerHpPct: 50 },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "TACKLE", enemyMove: "RECOVER" });
    expect(enemy.getMoveset()[0].ppUsed).toBeGreaterThanOrEqual(2);
    expect(foulHarvestCharges(holder)).toBe(1);
    const harvestState = snapshotErCombatObservation(game.scene).selfParty[0].mechanics.find(
      effect => effect.effectId === "ability-state:foul-harvest",
    );
    expect(harvestState?.state).toContainEqual({ key: "charges", value: 1 });
    await game.toNextTurn();
    await playTurn(game, { move: "GIGA_DRAIN", enemyMove: "RECOVER" });
    expect(holder.getMoveset()[1].ppUsed).toBe(0);
    expect(foulHarvestCharges(holder)).toBe(1);
  }, 180_000);

  it("Porous halves sound damage and spends accumulated direct-hit power on Ground", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Porous reduction and charge",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.SNORLAX, ability: ER_POROUS_ABILITY_ID, moves: [MoveId.NASTY_PLOT, MoveId.EARTHQUAKE] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.BLISSEY, level: 150, moves: [MoveId.HYPER_VOICE, MoveId.TACKLE], ...NEUTRAL_ABILITY },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "HYPER_VOICE", enemyTarget: BattlerIndex.PLAYER });
    const reducedSoundDamage = holder.getMaxHp() - holder.hp;
    await game.toNextTurn();
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeSoundControl = holder.hp;
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "HYPER_VOICE", enemyTarget: BattlerIndex.PLAYER });
    const controlSoundDamage = hpBeforeSoundControl - holder.hp;
    expect(reducedSoundDamage).toBeLessThanOrEqual(Math.ceil(controlSoundDamage * 0.55));
    holder.summonData.ability = ER_POROUS_ABILITY_ID as AbilityId;
    await game.toNextTurn();
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "TACKLE", enemyTarget: BattlerIndex.PLAYER });
    await game.toNextTurn();
    const earthquake = allMoves[MoveId.EARTHQUAKE];
    const chargedPower = earthquake.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const controlPower = earthquake.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = ER_POROUS_ABILITY_ID as AbilityId;
    expect(chargedPower / controlPower).toBeCloseTo(1.5, 5);
    await playTurn(game, { move: "EARTHQUAKE", enemyMove: "SPLASH" });
    expect(porousCharges(holder)).toBe(0);
  }, 180_000);

  it("Glam Rock consumes one hazard layer, raises both defenses, and anchors the holder", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Glam Rock hazard and anchor",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.SHUCKLE, ability: ER_GLAM_ROCK_ABILITY_ID, moves: [MoveId.SPLASH] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.SPLASH] },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.SKARMORY, level: 100, moves: [MoveId.SPIKES, MoveId.ROAR], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    await playTurn(game, { move: "SPLASH", enemyMove: "SPIKES" });
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeUndefined();
    await game.toNextTurn();
    expect(holder.getStatStage(Stat.DEF)).toBe(1);
    expect(holder.getStatStage(Stat.SPDEF)).toBe(1);
    await playTurn(game, { move: "SPLASH", enemyMove: "ROAR", enemyTarget: BattlerIndex.PLAYER });
    expect(game.scene.getPlayerField()[0]).toBe(holder);
  }, 180_000);

  it("Sediment Bloom is planted by Rapid Spin, drains the foe, and heals the holder's side", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Sediment Bloom hazard removal",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.BLASTOISE,
          ability: ER_SEDIMENT_BLOOM_ABILITY_ID,
          moves: [MoveId.SPLASH, MoveId.RAPID_SPIN],
        },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SPIKES, MoveId.SPLASH], ...NEUTRAL_ABILITY }],
      },
      start: { playerHpPct: 50 },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "SPLASH", enemyMove: "SPIKES" });
    await game.toNextTurn();
    const hpBefore = holder.hp;
    const enemyBefore = enemy.hp;
    await playTurn(game, { move: "RAPID_SPIN", enemyMove: "SPLASH" });
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(holder.hp).toBeGreaterThan(hpBefore);
    expect(enemyBefore - enemy.hp).toBeGreaterThan(Math.floor(enemy.getMaxHp() / 16));
  }, 180_000);

  it("Two-Faced Unleashed alternates its Dark boost and nonlethal recoil", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Two-Faced alternating unleash",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, ability: ER_TWO_FACED_UNLEASHED_ABILITY_ID, moves: [MoveId.DARK_PULSE] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 300, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    const damages: number[] = [];
    const recoil: number[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const enemyHp = enemy.hp;
      const playerHp = holder.hp;
      await playTurn(game, { move: "DARK_PULSE", enemyMove: "SUNNY_DAY" });
      damages.push(enemyHp - enemy.hp);
      recoil.push(playerHp - holder.hp);
      if (turn < 2) {
        await game.toNextTurn();
      }
    }
    expect(damages[0]).toBeGreaterThanOrEqual(Math.floor(damages[1] * 1.7));
    expect(damages[2]).toBeGreaterThanOrEqual(Math.floor(damages[1] * 1.7));
    expect(recoil[0]).toBe(Math.floor(holder.getMaxHp() * 0.15));
    expect(recoil[1]).toBe(0);
    expect(recoil[2]).toBe(Math.floor(holder.getMaxHp() * 0.15));
    expect(holder.hp).toBeGreaterThan(0);
  }, 180_000);

  it("Skyhook pivots after a direct hit and applies the seeded 20% Speed entry boost", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Skyhook free pivot",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.BLISSEY, moves: [MoveId.RECOVER] }],
      enemy: { kind: "trainer", trainerType: TrainerType.YOUNGSTER },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true, minRng: true });
    const outgoing = game.scene.getEnemyField()[0] as EnemyPokemon;
    for (const member of game.scene.getEnemyParty() as EnemyPokemon[]) {
      member.setAbilityOverrideForSlot(0, AbilityId.BALL_FETCH);
      member.trainerSlot = outgoing.trainerSlot;
    }
    outgoing.setAbilityOverrideForSlot(0, ER_SKYHOOK_ABILITY_ID as AbilityId);
    expect(game.scene.getEnemyParty().some(mon => !mon.isOnField() && !mon.isFainted())).toBe(true);
    await playTurn(game, { move: "RECOVER", enemyMove: "TACKLE", enemyTarget: BattlerIndex.PLAYER });
    await game.toNextTurn();
    const incoming = game.scene.getEnemyField()[0];
    expect(incoming).not.toBe(outgoing);
    expect(incoming.getStatStage(Stat.SPD)).toBe(1);
  }, 180_000);

  it("Anneal raises the matching defense once per resisted move and caps at two per entry", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Anneal resisted hit cap",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.BLASTOISE, ability: ER_ANNEAL_ABILITY_ID, moves: [MoveId.RECOVER] }],
      enemy: {
        kind: "party",
        party: [
          {
            species: SpeciesId.CHARIZARD,
            level: 100,
            moves: [MoveId.FLAME_CHARGE, MoveId.FLAMETHROWER],
            ...NEUTRAL_ABILITY,
          },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    await playTurn(game, { move: "RECOVER", enemyMove: "FLAME_CHARGE", enemyTarget: BattlerIndex.PLAYER });
    await game.toNextTurn();
    expect(holder.getStatStage(Stat.DEF)).toBe(1);
    await playTurn(game, { move: "RECOVER", enemyMove: "FLAMETHROWER", enemyTarget: BattlerIndex.PLAYER });
    await game.toNextTurn();
    expect(holder.getStatStage(Stat.SPDEF)).toBe(1);
    await playTurn(game, { move: "RECOVER", enemyMove: "FLAMETHROWER", enemyTarget: BattlerIndex.PLAYER });
    await game.toNextTurn();
    expect(holder.getStatStage(Stat.SPDEF)).toBe(1);
  }, 180_000);

  it("Living Chrome grants one-turn prior-type Shape Memory without changing typing", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Living Chrome type memory",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, ability: ER_LIVING_CHROME_ABILITY_ID, moves: [MoveId.NASTY_PLOT] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.KANGASKHAN, level: 100, moves: [MoveId.BODY_SLAM], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const originalTypes = holder.getTypes();
    recordLivingChromeTransformation(holder, [PokemonType.NORMAL], 1);
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "BODY_SLAM", enemyTarget: BattlerIndex.PLAYER });
    const reducedDamage = holder.getMaxHp() - holder.hp;
    expect(holder.getTypes()).toEqual(originalTypes);
    await game.toNextTurn();
    const hpBeforeControl = holder.hp;
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "BODY_SLAM", enemyTarget: BattlerIndex.PLAYER });
    const controlDamage = hpBeforeControl - holder.hp;
    expect(reducedDamage).toBeLessThanOrEqual(Math.ceil(controlDamage * 0.55));
  }, 180_000);

  it("Vapor Body makes 100-accuracy contact miss and ignores only contact traps", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Vapor Body contact accuracy and trap",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.VAPOREON, ability: ER_VAPOR_BODY_ABILITY_ID, moves: [MoveId.NASTY_PLOT] }],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.KANGASKHAN, level: 100, moves: [MoveId.TACKLE, MoveId.SWIFT], ...NEUTRAL_ABILITY },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "TACKLE", enemyTarget: BattlerIndex.PLAYER });
    expect(holder.hp).toBe(holder.getMaxHp());
    holder.addTag(BattlerTagType.BIND, 3, MoveId.WRAP, enemy.id);
    expect(hasEffectiveMoveTrap(holder)).toBe(false);
    holder.removeTag(BattlerTagType.BIND);
    holder.addTag(BattlerTagType.SAND_TOMB, 3, MoveId.SAND_TOMB, enemy.id);
    expect(hasEffectiveMoveTrap(holder)).toBe(true);
    await game.toNextTurn();
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "SWIFT", enemyTarget: BattlerIndex.PLAYER });
    expect(holder.hp).toBeLessThan(holder.getMaxHp());
  }, 180_000);

  it("Heavyweight reaches the recommended 1.5x cap and drops Defense once", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Heavyweight scaling",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, ability: ER_HEAVYWEIGHT_ABILITY_ID, moves: [MoveId.MACH_PUNCH] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.DIGLETT, level: 300, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    const machPunch = allMoves[MoveId.MACH_PUNCH];
    const boostedPower = machPunch.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const controlPower = machPunch.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = ER_HEAVYWEIGHT_ABILITY_ID as AbilityId;
    expect(boostedPower / controlPower).toBeCloseTo(1.5, 5);
    await playTurn(game, { move: "MACH_PUNCH", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    expect(enemy.getStatStage(Stat.DEF)).toBe(-1);
  }, 180_000);

  it("Spirit Punch adds its noncritical Ghost echo without recursive KO attribution", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Spirit Punch echo",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.HITMONCHAN, ability: ER_SPIRIT_PUNCH_ABILITY_ID, moves: [MoveId.MACH_PUNCH] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.MEWTWO, level: 300, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    const hpBeforeEcho = enemy.hp;
    await playTurn(game, { move: "MACH_PUNCH", enemyMove: "SUNNY_DAY" });
    const echoDamage = hpBeforeEcho - enemy.hp;
    await game.toNextTurn();
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeControl = enemy.hp;
    await playTurn(game, { move: "MACH_PUNCH", enemyMove: "SUNNY_DAY" });
    expect(echoDamage).toBeGreaterThanOrEqual(Math.floor((hpBeforeControl - enemy.hp) * 1.25));
  }, 180_000);

  it("Deadeye Draw marks with an arrow, guarantees cannon crits, and clears on exit", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Deadeye mark lifecycle",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        {
          species: SpeciesId.BLASTOISE,
          ability: ER_DEADEYE_DRAW_ABILITY_ID,
          moves: [MoveId.PIN_MISSILE, MoveId.WATER_PULSE],
        },
        { species: SpeciesId.SNORLAX, moves: [MoveId.RECOVER] },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 300, moves: [MoveId.RECOVER], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "PIN_MISSILE", enemyMove: "RECOVER" });
    const cannon = allMoves[MoveId.WATER_PULSE];
    expect(enemy.getCriticalHitResult(holder, cannon)).toBe(true);
    await game.toNextTurn();
    await playTurn(game, { switch: 1, enemyMove: "RECOVER" });
    expect(enemy.getCriticalHitResult(holder, cannon)).toBe(false);
  }, 180_000);

  it("Boot Hill plants a one-use Grave Marker after a direct knockout", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Boot Hill entry marker",
      run: { wave: 146, level: 100, difficulty: "ace", double: true },
      party: [
        { species: SpeciesId.MEWTWO, ability: ER_BOOT_HILL_ABILITY_ID, moves: [MoveId.PSYCHIC] },
        { species: SpeciesId.SNORLAX, moves: [MoveId.NASTY_PLOT] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.MAGIKARP, level: 1, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY },
          { species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.NASTY_PLOT], ...NEUTRAL_ABILITY },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const [outgoing, incoming] = game.scene.getEnemyField();
    outgoing.hp = 1;
    await playTurn(game, {
      move: "PSYCHIC",
      move2: "NASTY_PLOT",
      enemyMove: "SUNNY_DAY",
      enemyMove2: "NASTY_PLOT",
    });
    expect(outgoing.isFainted()).toBe(true);
    applyGraveMarkerOnEntry(incoming);
    expect(incoming.getMaxHp() - incoming.hp).toBeGreaterThanOrEqual(Math.floor(incoming.getMaxHp() / 8));
    expect(incoming.getStatStage(Stat.SPD)).toBe(-1);
    const hpAfterEntry = incoming.hp;
    applyGraveMarkerOnEntry(incoming);
    expect(incoming.hp).toBe(hpAfterEntry);
  }, 180_000);

  it("Gillie Suit changes to the move type and heals one quarter after its direct KO", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Gillie Suit composite",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.VENUSAUR, ability: ER_GILLIE_SUIT_ABILITY_ID, moves: [MoveId.WATER_PULSE] }],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.MAGIKARP, level: 1, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY },
          { species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SUNNY_DAY] },
        ],
      },
      start: { playerHpPct: 50 },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    await playTurn(game, { move: "WATER_PULSE", enemyMove: "SUNNY_DAY" });
    expect(holder.getTypes()).toContain(PokemonType.WATER);
    expect(holder.getHpRatio()).toBeGreaterThanOrEqual(0.74);
  }, 180_000);

  it("Ring General delays its above-half non-Ghost trap until the turn after entry", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Ring General delayed trap",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.MACHAMP, ability: ER_RING_GENERAL_ABILITY_ID, moves: [MoveId.NASTY_PLOT] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 100, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const enemy = game.scene.getEnemyField()[0];
    expect(enemy.isTrapped()).toBe(false);
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    expect(enemy.isTrapped()).toBe(true);
  }, 180_000);

  it("Encore Set echoes the prior different damaging move at 40% power", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Encore Set previous move echo",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.BLASTOISE, ability: ER_ENCORE_SET_ABILITY_ID, moves: [MoveId.TACKLE, MoveId.WATER_GUN] },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 300, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "TACKLE", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    const hpBeforeEcho = enemy.hp;
    await playTurn(game, { move: "WATER_GUN", enemyMove: "SUNNY_DAY" });
    const echoTurnDamage = hpBeforeEcho - enemy.hp;
    await game.toNextTurn();
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const hpBeforeControl = enemy.hp;
    await playTurn(game, { move: "WATER_GUN", enemyMove: "SUNNY_DAY" });
    expect(echoTurnDamage).toBeGreaterThan(hpBeforeControl - enemy.hp);
  }, 180_000);

  it("Setlist records two moves then applies 20% and 40% alternating crescendos", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Setlist alternating crescendo",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [
        { species: SpeciesId.BLASTOISE, ability: ER_SETLIST_ABILITY_ID, moves: [MoveId.TACKLE, MoveId.WATER_GUN] },
      ],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 500, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "TACKLE", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    await playTurn(game, { move: "WATER_GUN", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    const tackle = holder.getMoveset()[0].getMove();
    const thirdPower = tackle.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const tackleControl = tackle.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = ER_SETLIST_ABILITY_ID as AbilityId;
    expect(thirdPower / tackleControl).toBeCloseTo(1.2, 5);
    await playTurn(game, { move: "TACKLE", enemyMove: "SUNNY_DAY" });
    await game.toNextTurn();
    const waterGun = holder.getMoveset()[1].getMove();
    const fourthPower = waterGun.calculateBattlePower(holder, enemy, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const waterControl = waterGun.calculateBattlePower(holder, enemy, true);
    expect(fourthPower / waterControl).toBeCloseTo(1.4, 5);
  }, 180_000);

  it("Fan Favorite uses all five living bench cheers for accuracy and special damage", async () => {
    const party: SpecMon[] = [
      { species: SpeciesId.ALAKAZAM, ability: ER_FAN_FAVORITE_ABILITY_ID, moves: [MoveId.HYDRO_PUMP] },
      ...Array.from({ length: 5 }, () => ({ species: SpeciesId.MAGIKARP, moves: [MoveId.SUNNY_DAY] })),
    ];
    const spec: RunnerInput = {
      v: 1,
      name: "Fan Favorite full bench",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party,
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.BLISSEY, level: 300, moves: [MoveId.SUNNY_DAY], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    const hydroPump = allMoves[MoveId.HYDRO_PUMP];
    const cheeredPower = hydroPump.calculateBattlePower(holder, enemy, true);
    const cheeredAccuracy = hydroPump.calculateBattleAccuracy(holder, enemy, true);
    holder.summonData.ability = AbilityId.BALL_FETCH;
    const controlPower = hydroPump.calculateBattlePower(holder, enemy, true);
    const controlAccuracy = hydroPump.calculateBattleAccuracy(holder, enemy, true);
    holder.summonData.ability = ER_FAN_FAVORITE_ABILITY_ID as AbilityId;
    expect(cheeredPower / controlPower).toBeCloseTo(1.25, 5);
    expect(cheeredAccuracy / controlAccuracy).toBeCloseTo(1.25, 5);
    await playTurn(game, { move: "HYDRO_PUMP", enemyMove: "SUNNY_DAY" });
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
  }, 180_000);

  it("Reduction consumes both fields and gives terrain precedence for the dual type", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Reduction terrain precedence",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SNORLAX, ability: ER_REDUCTION_ABILITY_ID, moves: [MoveId.TACKLE] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.DIGLETT, level: 100, moves: [MoveId.NASTY_PLOT], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    game.scene.arena.trySetWeather(WeatherType.RAIN, holder);
    game.scene.arena.trySetTerrain(TerrainType.ELECTRIC, true, holder);
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "TACKLE", enemyMove: "NASTY_PLOT" });
    expect(enemy.hp).toBe(enemy.getMaxHp());
    expect(game.scene.arena.weather).toBeNull();
    expect(game.scene.arena.terrain).toBeNull();
  }, 180_000);

  it("Cracked Vessel removes only the last type and toxics every adjacent battler", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Cracked Vessel adjacent spill",
      // Wave 1 keeps the enemy attacking (past the ~wave-100 BST ladder a `party`
      // enemy resolves to a SWITCHING trainer that withdraws instead of firing, so
      // the lethal hit Cracked Vessel keys off never lands). The lethal attacker is
      // a low-BST NON-Steel/Poison species (Rattata) so the #419 wave-1 cap leaves
      // it un-devolved - a >420-BST attacker (the codex fixture used Mewtwo) is
      // devolved into a Steel replacement here, which would make TWO Steel-immune
      // adjacent mons. Metagross stays the sole intended Steel-immune adjacent, and
      // the forced max-roll L500 Hyper Beam is still lethal to the frail holder.
      run: { wave: 1, level: 100, difficulty: "ace", triple: true },
      party: [
        { species: SpeciesId.CHARIZARD, ability: ER_CRACKED_VESSEL_ABILITY_ID, moves: [MoveId.NASTY_PLOT] },
        { species: SpeciesId.DIGLETT, moves: [MoveId.NASTY_PLOT] },
        { species: SpeciesId.DIGLETT, moves: [MoveId.NASTY_PLOT] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.RATTATA, level: 500, moves: [MoveId.HYPER_BEAM], ...NEUTRAL_ABILITY },
          { species: SpeciesId.METAGROSS, level: 100, moves: [MoveId.NASTY_PLOT] },
          { species: SpeciesId.DIGLETT, level: 100, moves: [MoveId.NASTY_PLOT] },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    game.scene.arena.removeTagOnSide(ArenaTagType.SAFEGUARD, ArenaTagSide.PLAYER, true);
    game.scene.arena.removeTagOnSide(ArenaTagType.SAFEGUARD, ArenaTagSide.ENEMY, true);
    const [holder] = game.scene.getPlayerField();
    const adjacent = [...holder.getAdjacentAllies(), ...holder.getAdjacentOpponents()];
    const poisonImmuneAdjacent = adjacent.filter(
      pokemon => pokemon.isOfType(PokemonType.POISON) || pokemon.isOfType(PokemonType.STEEL),
    );
    const eligibleAdjacent = adjacent.filter(pokemon => !poisonImmuneAdjacent.includes(pokemon));
    const nonAdjacent = [...game.scene.getPlayerField(true), ...game.scene.getEnemyField(true)].filter(
      pokemon => pokemon !== holder && !adjacent.includes(pokemon),
    );
    const typesBefore = holder.getTypes();
    await playTurn(game, {
      move: "NASTY_PLOT",
      move2: "NASTY_PLOT",
      move3: "NASTY_PLOT",
      enemyMove: "HYPER_BEAM",
      enemyTarget: BattlerIndex.PLAYER,
      enemyMove2: "NASTY_PLOT",
      enemyMove3: "NASTY_PLOT",
    });
    expect(holder.hp).toBe(1);
    expect(holder.getTypes()).toEqual(typesBefore.slice(0, -1));
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(poisonImmuneAdjacent).toHaveLength(1);
    for (const pokemon of eligibleAdjacent) {
      expect(
        pokemon.status?.effect,
        `${pokemon.getNameToRender()} pending=${pokemon.turnData.pendingStatus} types=${pokemon.getTypes().join(",")}`,
      ).toBe(StatusEffect.TOXIC);
    }
    for (const pokemon of [...poisonImmuneAdjacent, ...nonAdjacent]) {
      expect(pokemon.status).toBeUndefined();
    }
  }, 180_000);

  it("Center of Attention penalizes ally targeting and reduces spread damage without double-penalizing", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Center of Attention doubles behavior",
      run: { wave: 146, level: 100, difficulty: "ace", double: true },
      party: [
        { species: SpeciesId.BLISSEY, ability: ER_CENTER_OF_ATTENTION_ABILITY_ID, moves: [MoveId.NASTY_PLOT] },
        { species: SpeciesId.BLISSEY, moves: [MoveId.NASTY_PLOT] },
      ],
      enemy: {
        kind: "party",
        party: [
          { species: SpeciesId.ALAKAZAM, level: 100, moves: [MoveId.THUNDERBOLT, MoveId.SURF], ...NEUTRAL_ABILITY },
          { species: SpeciesId.MAGIKARP, level: 100, moves: [MoveId.NASTY_PLOT] },
        ],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    Overrides.ABILITY_OVERRIDE = AbilityId.NONE;
    const [holder, ally] = game.scene.getPlayerField();
    holder.setAbilityOverrideForSlot(0, ER_CENTER_OF_ATTENTION_ABILITY_ID as AbilityId);
    ally.setAbilityOverrideForSlot(0, AbilityId.BALL_FETCH);
    const attacker = game.scene.getEnemyField()[0];
    await playTurn(game, {
      move: "NASTY_PLOT",
      move2: "NASTY_PLOT",
      enemyMove: "THUNDERBOLT",
      enemyTarget: BattlerIndex.PLAYER_2,
      enemyMove2: "NASTY_PLOT",
    });
    await game.toNextTurn();
    expect(attacker.getStatStage(Stat.SPATK)).toBe(-1);
    const before = [holder.hp, ally.hp];
    await playTurn(game, { move: "NASTY_PLOT", move2: "NASTY_PLOT", enemyMove: "SURF", enemyMove2: "NASTY_PLOT" });
    const damages = [before[0] - holder.hp, before[1] - ally.hp];
    expect(damages[0]).toBeLessThan(damages[1]);
    await game.toNextTurn();
    expect(attacker.getStatStage(Stat.SPATK)).toBe(-1);
  }, 180_000);

  it("Superego transfers a foe's boost to its prior stage", async () => {
    const spec: RunnerInput = {
      v: 1,
      name: "Superego stat transfer",
      run: { wave: 146, level: 100, difficulty: "ace" },
      party: [{ species: SpeciesId.SHUCKLE, ability: ER_SUPEREGO_ABILITY_ID, moves: [MoveId.NASTY_PLOT] }],
      enemy: {
        kind: "party",
        party: [{ species: SpeciesId.SNORLAX, level: 100, moves: [MoveId.SWORDS_DANCE], ...NEUTRAL_ABILITY }],
      },
    };
    const game = await launchScenario(phaserGame, spec, { noMiss: true, noCrit: true });
    const holder = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];
    await playTurn(game, { move: "NASTY_PLOT", enemyMove: "SWORDS_DANCE" });
    await game.toNextTurn();
    expect(holder.getStatStage(Stat.ATK)).toBe(2);
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);
  }, 180_000);
});
