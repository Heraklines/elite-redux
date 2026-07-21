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
import { setPendingDevShop } from "#app/dev-tools/registry";
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
import { Egg } from "#data/egg";
import { isInnateSlotSuppressed } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { getErPendingNodes, resetErRouting, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { TerrainType } from "#data/terrain";
import { getTypeDamageMultiplier } from "#data/type";
import { AbilityId } from "#enums/ability-id";
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
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { Move } from "#moves/move";
import type { CommandPhase } from "#phases/command-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import type { AbstractOptionSelectUiHandler } from "#ui/handlers/abstract-option-select-ui-handler";
import type { BiomeShopUiHandler } from "#ui/handlers/biome-shop-ui-handler";
import type { ErMapUiHandler } from "#ui/handlers/er-map-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
  /** Throw a poke ball this turn (PokeballType number or enum name). */
  ball?: number | string;
  /** Flee attempt this turn. */
  run?: boolean;
  /** Double: the 2nd (RIGHT) player mon's action. */
  move2?: number | string;
  target2?: number;
  tera2?: boolean;
  switch2?: number;
  ball2?: number | string;
  run2?: boolean;
  /** Triple: the 3rd player mon's action. */
  move3?: number | string;
  target3?: number;
  tera3?: boolean;
  switch3?: number;
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

/** Per-launch determinism / RNG knobs. */
interface LaunchOpts {
  noMiss?: boolean;
  noCrit?: boolean;
  realRng?: boolean;
  minRng?: boolean;
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
const INPUT = resolveSpec(RAW);
mergePolicyOverride(INPUT); // shallow-merge a `--policy @file.json` blob over the spec
normalizeSpec(INPUT); // resolve any enum NAMES (species/ability/move/…) to ids
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
  ball?: number | string | undefined;
  run?: boolean | undefined;
}

/** Extract slot `slot`'s action fields from a TurnAction (slot 1 = `*2`, slot 2 = `*3`). */
function slotAction(a: TurnAction | undefined, slot: 0 | 1 | 2): SlotAction {
  if (!a) {
    return {};
  }
  if (slot === 0) {
    return { move: a.move, target: a.target, tera: a.tera, switch: a.switch, ball: a.ball, run: a.run };
  }
  if (slot === 1) {
    return { move: a.move2, target: a.target2, tera: a.tera2, switch: a.switch2, ball: a.ball2, run: a.run2 };
  }
  return { move: a.move3, target: a.target3, tera: a.tera3, switch: a.switch3, ball: a.ball3, run: a.run3 };
}

/** Whether `moveId` is in this mon's REAL moveset with PP left (mirrors MoveHelper.getMovePosition). */
function moveInUsableMoveset(mon: Pokemon, moveId: MoveId): boolean {
  return mon.getMoveset().some(m => m.moveId === moveId && m.ppUsed < m.getMovePp());
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
  if (mon.isFainted()) {
    return;
  }
  if (action.switch != null) {
    game.doSwitchPokemon(action.switch);
    log.push(`slot${idx}: switch -> party[${action.switch}]`);
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
    const usable = mon.getMoveset().find(m => m.ppUsed < m.getMovePp());
    moveId = usable ? usable.moveId : MoveId.STRUGGLE;
  }
  const target = action.target == null ? undefined : (action.target as BattlerIndex);
  const tera = !!action.tera;
  const inMoveset = moveInUsableMoveset(mon, moveId);

  if (inMoveset) {
    if (tera && (idx === BattlerIndex.PLAYER || idx === BattlerIndex.PLAYER_2)) {
      game.move.selectWithTera(moveId, idx, target);
    } else {
      game.move.select(moveId, idx, target);
    }
    log.push(`slot${idx}: ${MoveId[moveId]}${tera ? " (tera)" : ""} [select]`);
  } else {
    // Fallback only: the scripted move isn't in the real moveset, so splice it in.
    game.move.use(moveId, idx, target, tera);
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
      const battlerCount = game.scene.currentBattle.getBattlerCount();
      const slot =
        overrideSlot != null && party[overrideSlot]?.isAllowedInBattle()
          ? overrideSlot
          : party.findIndex((p, i) => i >= battlerCount && p.isAllowedInBattle());
      if (slot < 0) {
        return;
      }
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(slot);
      handler.processInput(Button.ACTION); // select the bench mon
      handler.processInput(Button.ACTION); // send out
      log.push(`faint-switch -> party[${slot}]`);
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
    const stat = STAT_BY_NAME[c.effectiveStat.stat.toUpperCase()];
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
    ssp.initBattle(starters, true);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
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
      const action = opts.script?.[turn - 1];
      doPlayerActions(game, action, opts.forcedMove ?? null, actionLog);
      if (action && hasEnemyForce(action)) {
        await forceEnemyActions(game, action, actionLog);
      }

      await game.toEndOfTurn();
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
  /** Last driven (phase|mode) signature, so one menu appearance is driven exactly once. */
  lastSig: string;
  /** When an unhandled interactive menu was first seen (ms), for the stall watchdog. */
  stallSince: number;
  stallMode: string | null;
  meDriven: boolean;
  catchFullDriven: boolean;
  eggDriven: boolean;
  biomeShopDriven: boolean;
  driveError: unknown;
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
    lastSig: "",
    stallSince: 0,
    stallMode: null,
    meDriven: false,
    catchFullDriven: false,
    eggDriven: false,
    biomeShopDriven: false,
    driveError: null,
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
function isAutopilotMode(phaseName: string, mode: UiMode): boolean {
  switch (mode) {
    case UiMode.BIOME_SHOP:
    case UiMode.ER_MAP:
    case UiMode.MYSTERY_ENCOUNTER:
      return true;
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
    case UiMode.PARTY:
      return phaseName === "SelectModifierPhase" || phaseName === "SwitchPhase" || phaseName === "AttemptCapturePhase";
    case UiMode.SUMMARY:
      return phaseName === "LearnMovePhase" || phaseName === "AttemptCapturePhase";
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

function driveParty(game: GameManager, st: RunState, phaseName: string): void {
  const handler = game.scene.ui.getHandler() as PartyUiHandler;
  if (phaseName === "SwitchPhase") {
    const party = game.scene.getPlayerParty();
    const battlerCount = game.scene.currentBattle.getBattlerCount();
    const slot = party.findIndex((p, i) => i >= battlerCount && p.isAllowedInBattle());
    if (slot < 0) {
      return;
    }
    handler.setCursor(slot);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
    st.log.push(`faint-switch → party[${slot}]`);
    return;
  }
  if (phaseName === "AttemptCapturePhase") {
    // Party-full replace: RELEASE mode → pick the slot to release (keep = slot 0).
    const pol = st.policy.onCatchFull;
    const slot = typeof pol === "object" ? pol.replaceSlot : 0;
    handler.setCursor(slot);
    handler.processInput(Button.ACTION);
    st.log.push(`catch-full: replace slot ${slot}`);
    return;
  }
  // Reward party-target (SelectModifierPhase): apply the reward to the lead.
  handler.setCursor(0);
  handler.processInput(Button.ACTION);
  handler.processInput(Button.ACTION);
  st.log.push("reward-target → lead");
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
      driveParty(game, st, phaseName);
      return true;
    case UiMode.SUMMARY:
      if (phaseName === "LearnMovePhase") {
        driveLearnMoveSummary(game, st);
      } else {
        game.scene.ui.processInput(Button.ACTION); // dismiss the caught-mon summary
      }
      return true;
    case UiMode.MYSTERY_ENCOUNTER:
      driveMysteryEncounter(game, st);
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
  const ui = game.scene.ui;
  const mode = ui.getMode();
  const handler = ui.getHandler();
  const phase = game.scene.phaseManager.getCurrentPhase();
  const phaseName = phase?.phaseName ?? "";
  if (!handler?.active) {
    return;
  }

  // Repeatable dismiss modes: a block-timer gates them (egg-summary-ui-handler.ts:222,
  // blockExit for ~1s), so press EACH tick until they clear — NOT sig-guarded.
  if (mode === UiMode.EGG_HATCH_SUMMARY) {
    game.scene.ui.processInput(Button.CANCEL); // egg summary dismisses on CANCEL once blockExit elapses
    st.lastSig = "";
    return;
  }
  if (mode === UiMode.EGG_HATCH_SCENE) {
    game.scene.ui.processInput(Button.ACTION); // skip the animated hatch scene
    st.lastSig = "";
    return;
  }

  if (isAutopilotMode(phaseName, mode)) {
    const sig = `${phaseName}|${mode}`;
    if (sig === st.lastSig) {
      return; // already driven this appearance; wait for the transition it triggers
    }
    // The reward shop + ME/ intro MESSAGE handlers (AwaitableUiHandler) IGNORE input
    // until `awaitingActionInput` flips true (modifier-select-ui-handler.ts:471). Wait
    // for that WITHOUT marking the appearance driven, so we don't press into the void.
    if ((mode === UiMode.MODIFIER_SELECT || mode === UiMode.MESSAGE) && !handlerAwaitingInput(handler)) {
      return;
    }
    if (dispatchMenu(game, st, phaseName, mode)) {
      st.lastSig = sig;
      st.stallSince = 0;
      st.stallMode = null;
    }
    return;
  }

  // Not a menu we own. Reset the per-appearance guard so a repeat drivable menu re-fires.
  st.lastSig = "";

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

/** The type-effectiveness multiplier of a move type against `enemy` (product over its types). */
function moveTypeEffectiveness(moveType: number, enemy: Pokemon): number {
  return enemy.getTypes().reduce((mult, t) => mult * getTypeDamageMultiplier(moveType, t), 1);
}

/**
 * Pick the most type-effective DAMAGING move in the mon's usable moveset against the
 * first live enemy — so a 200-wave run isn't walled by a type immunity (e.g. Psychic
 * into a Dark-type). Falls back to the first usable move. Used as the default action
 * for waves the script/forcedMove don't cover.
 */
function pickBestMove(mon: Pokemon, enemies: (Pokemon | undefined)[]): MoveId | null {
  const usable = mon.getMoveset().filter(m => m.ppUsed < m.getMovePp());
  if (usable.length === 0) {
    return null;
  }
  const target = enemies.find(e => e != null && !e.isFainted());
  if (!target) {
    return usable[0].moveId;
  }
  let best: MoveId | null = null;
  let bestScore = -1;
  for (const m of usable) {
    const move = m.getMove();
    if (move.category === MoveCategory.STATUS) {
      continue; // a status move never wins a wave
    }
    const eff = moveTypeEffectiveness(move.type, target);
    if (eff > bestScore) {
      bestScore = eff;
      best = m.moveId;
    }
  }
  return best ?? usable[0].moveId;
}

/** Whether `moveId` is a single-target move for `mon` (so it needs an explicit target). */
function isSingleTargetMove(mon: Pokemon, moveId: MoveId): boolean {
  const move = mon
    .getMoveset()
    .find(m => m.moveId === moveId)
    ?.getMove();
  return move != null && !move.isMultiTarget();
}

/**
 * Build a per-slot default action that picks each active mon's best damaging move AND
 * (for single-target moves) targets the first LIVE enemy — so a double battle doesn't
 * stall firing into an already-fainted slot (the fixed BattlerIndex.ENEMY default).
 */
function smartDefaultAction(game: GameManager): TurnAction {
  const enemies = game.scene.getEnemyField();
  const field = game.scene.getPlayerField();
  const liveEnemyIdx = enemies.findIndex(e => e != null && !e.isFainted());
  const targetBattler = liveEnemyIdx >= 0 ? ((BattlerIndex.ENEMY + liveEnemyIdx) as BattlerIndex) : undefined;
  const a: TurnAction = {};
  if (field[0]) {
    const m = pickBestMove(field[0], enemies);
    if (m != null) {
      a.move = m;
      if (targetBattler != null && isSingleTargetMove(field[0], m)) {
        a.target = targetBattler;
      }
    }
  }
  if (field[1]) {
    const m = pickBestMove(field[1], enemies);
    if (m != null) {
      a.move2 = m;
      if (targetBattler != null && isSingleTargetMove(field[1], m)) {
        a.target2 = targetBattler;
      }
    }
  }
  if (field[2]) {
    const m = pickBestMove(field[2], enemies);
    if (m != null) {
      a.move3 = m;
      if (targetBattler != null && isSingleTargetMove(field[2], m)) {
        a.target3 = targetBattler;
      }
    }
  }
  return a;
}

/** Play the CURRENT battle wave to completion (victory / wipe / maxTurns). */
async function playWaveTurns(
  game: GameManager,
  st: RunState,
  opts: { script?: TurnAction[] | undefined; forcedMove?: MoveId | null | undefined; maxTurns: number; quiet: boolean },
  fullLog: string[],
): Promise<{ won: boolean; wiped: boolean; turns: number; maxHits: number; runEnded?: boolean }> {
  let won = false;
  let wiped = false;
  let turns = 0;
  let maxHits = 0;

  if (game.isVictory()) {
    return { won: true, wiped: false, turns: 0, maxHits: 0 };
  }

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    turns = turn;
    if (st.driveError) {
      break;
    }
    // Scripted action for this turn; else force the requested move; else pick the best
    // damaging move per slot (so type immunities don't wall an otherwise-winnable wave).
    const action = opts.script?.[turn - 1] ?? (opts.forcedMove == null ? smartDefaultAction(game) : undefined);
    doPlayerActions(game, action, opts.forcedMove ?? null, st.log);
    if (action && hasEnemyForce(action)) {
      await forceEnemyActions(game, action, st.log);
    }
    try {
      await game.toEndOfTurn();
    } catch (e) {
      // A mid-turn RUN END (wipe -> GameOverPhase -> TitlePhase, or the post-victory
      // credits) never reaches TurnEndPhase - that is an OUTCOME, not a soft-lock.
      const phaseName = game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "";
      if (phaseName === "TitlePhase" || phaseName === "GameOverPhase" || phaseName === "EndCardPhase") {
        return {
          won: false,
          wiped: game.scene.getPlayerParty().every(p => p.isFainted()),
          turns,
          maxHits,
          runEnded: true,
        };
      }
      throw e;
    }
    fullLog.push(...game.textInterceptor.logs);
    game.textInterceptor.clearLogs();
    for (const m of [...game.scene.getPlayerField(), ...game.scene.getEnemyField()]) {
      maxHits = Math.max(maxHits, m.turnData?.hitCount ?? 0);
    }
    if (!opts.quiet) {
      console.log("STATE", JSON.stringify(snapshot(game)));
    }
    if (game.isVictory()) {
      won = true;
      break;
    }
    if (game.scene.getPlayerParty().every(p => p.isFainted())) {
      wiped = true;
      break;
    }
    if (turn < opts.maxTurns) {
      await game.toNextTurn(); // autopilot drives any pending faint-switch PARTY
    }
  }
  return { won, wiped, turns, maxHits };
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

const RUN = !!SPEC && process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("headless scenario runner", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it(`plays scenario: ${SPEC?.name || RAW}`, async () => {
    const spec = SPEC as RunnerInput;
    console.log(`\n===== SCENARIO: ${spec.name || "(unnamed)"} =====`);
    console.log(describeScenarioSpec(spec));
    console.log(
      SCRIPT
        ? `player action: scripted (${SCRIPT.length} turns)`
        : FORCED_MOVE
          ? `player action: force ${MoveId[FORCED_MOVE]} every turn`
          : "player action: first usable move",
    );

    const bootStart = performance.now();
    const game = await launchScenario(phaserGame, spec, {
      noMiss: NO_MISS,
      noCrit: NO_CRIT,
      realRng: REAL_RNG,
      minRng: spec.run?.battleRng === "min",
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

// =============================================================================
// SELF-VERIFYING SCENARIOS — one per new capability, exercised whenever the
// harness runs WITHOUT a specific `ER_RUN_SCENARIO` (so `ER_SCENARIO=1 vitest run
// test/tools/run-scenario.test.ts` proves every capability end-to-end headlessly).
// Each builds an inline spec, plays it through the SAME pipeline, and asserts.
// =============================================================================

const EASY_ABILITY_ADDITION_CHECK = process.env.ER_ABILITY_EASY_ADDITIONS === "1";
const SELF_CHECK = process.env.ER_SCENARIO === "1" && !process.env.ER_RUN_SCENARIO && !EASY_ABILITY_ADDITION_CHECK;

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
