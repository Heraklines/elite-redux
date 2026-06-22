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
//   node scripts/run-scenario.mjs <ERS1-code | @path/to/spec.json | demo> [--turns N] [--move MOVE]
// or directly:
//   ER_SCENARIO=1 ER_RUN_SCENARIO='ERS1....' npx vitest run test/tools/run-scenario.test.ts
//
// Env:
//   ER_RUN_SCENARIO   ERS1 share code, raw JSON, '@file.json', or 'demo'   (required)
//   ER_RUN_TURNS      max player turns to play in the first battle (default 5)
//   ER_RUN_MOVE       force the player to use this MoveId (number) or MoveId
//                     name every turn; omitted = the active mon's first usable move
//
// Output: a `=== TURN n ===` block per turn with a `STATE { ... }` snapshot
// (each side's hp / status / stat stages / ability + the weather), the game's
// own log lines interleaved, then a final `RESULT { ... }`. Any thrown error or
// phase-advance timeout (a soft-lock / freeze) fails the run with a nonzero exit
// and the full console, so a hang is caught immediately, not stared at.
// =============================================================================

import {
  buildDevScenario,
  decodeScenarioSpec,
  describeScenarioSpec,
  type ScenarioSpec,
  type SpecMon,
} from "#app/dev-tools/test-suite/scenario-spec";
import { getGameMode } from "#app/game-mode";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { Move } from "#moves/move";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A turn action for the optional `script`: which move the lead (and, in doubles,
// the 2nd) player mon uses, and an optional target BattlerIndex (0/1 player,
// 2/3 enemy). Moves accept a numeric MoveId or an enum name.
interface TurnAction {
  move?: number | string;
  target?: number;
  move2?: number | string;
  target2?: number;
}

// A declarative self-check block. Every field is optional; each that's set is
// asserted against the final state / accumulated events. HP checks take a number
// (exact) or {min?,max?,equals?}. `logIncludes`/`logExcludes` match the battle
// message log (case-insensitive substring) — the swiss-army assertion.
type HpCheck = number | { min?: number; max?: number; equals?: number };
interface ExpectSpec {
  outcome?: string;
  playerFainted?: boolean;
  enemyFainted?: boolean;
  playerStatus?: string;
  enemyStatus?: string;
  /** Active ability display-name (case-insensitive substring) — verifies an ability override. */
  playerAbility?: string;
  enemyAbility?: string;
  playerHp?: HpCheck;
  enemyHp?: HpCheck;
  playerStage?: { stat: string; value: number };
  enemyStage?: { stat: string; value: number };
  weather?: string;
  terrain?: string;
  maxHits?: HpCheck;
  logIncludes?: string[];
  logExcludes?: string[];
}

// The runner accepts a superset of ScenarioSpec: the extra `script` / `expect`
// are runner-only (the in-game launch + `ERS1.` codes ignore them).
type RunnerInput = ScenarioSpec & { script?: TurnAction[]; expect?: ExpectSpec };

const RAW = (process.env.ER_RUN_SCENARIO ?? "").trim();
const INPUT = resolveSpec(RAW);
normalizeSpec(INPUT); // resolve any enum NAMES (species/ability/move/…) to ids
const SPEC: ScenarioSpec | null = INPUT;
const SCRIPT = INPUT?.script;
const EXPECT = INPUT?.expect;
const FORCED_MOVE = parseForcedMove(process.env.ER_RUN_MOVE);
const NO_MISS = process.env.ER_RUN_NO_MISS === "1"; // force every move to hit
const NO_CRIT = process.env.ER_RUN_NO_CRIT === "1"; // force no crits (deterministic stages)

function computeMaxTurns(): number {
  const env = Number(process.env.ER_RUN_TURNS);
  if (Number.isFinite(env) && env > 0) {
    return env;
  }
  if (SCRIPT && SCRIPT.length > 0) {
    return SCRIPT.length;
  }
  return 5;
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

// A ready-made smoke scenario so `... demo` runs out of the box: a real headless
// battle (Snorlax vs a wild Snorlax, both lv100) playing Tackle for a couple of
// turns. Proves the pipeline (start -> turns -> state + console), not any
// specific mechanic — point it at a real `ERS1.` code for that.
const DEMO_SPEC: ScenarioSpec = {
  v: 1,
  name: "harness smoke test",
  notes: "Snorlax vs wild Snorlax, lv100, trading Tackle. Proves the harness plays a real battle headlessly.",
  run: { level: 100, difficulty: "ace" },
  party: [{ species: 143 /* SNORLAX */, moves: [MoveId.TACKLE] }],
  enemy: { kind: "wild", wild: { species: 143 /* SNORLAX */, level: 100, moves: [MoveId.TACKLE] } },
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
    player: game.scene.getPlayerField().map(snapMon),
    enemy: game.scene.getEnemyField().map(snapMon),
  };
}

/** Command one player mon: scripted move (+ target), else `--move`, else its first usable move. */
function applyAction(
  game: GameManager,
  mon: Pokemon,
  idx: BattlerIndex.PLAYER | BattlerIndex.PLAYER_2,
  move?: number | string,
  target?: number,
): void {
  if (mon.isFainted()) {
    return;
  }
  const forced = resolveMove(move) ?? FORCED_MOVE;
  let moveId = forced;
  if (moveId == null) {
    const usable = mon.getMoveset().find(m => m.ppUsed < m.getMovePp());
    moveId = usable ? usable.moveId : MoveId.STRUGGLE;
  }
  game.move.use(moveId, idx, target == null ? undefined : (target as BattlerIndex));
}

/** Command every active player mon for the turn (lead + the 2nd in doubles). */
function doPlayerActions(game: GameManager, action: TurnAction | undefined): void {
  const field = game.scene.getPlayerField();
  applyAction(game, field[0], BattlerIndex.PLAYER, action?.move, action?.target);
  if (field.length > 1 && field[1]) {
    applyAction(game, field[1], BattlerIndex.PLAYER_2, action?.move2, action?.target2);
  }
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
  stage?: { stat: string; value: number } | undefined;
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
  if (c.stage) {
    const st = STAT_BY_NAME[c.stage.stat.toUpperCase()];
    const v = st == null ? Number.NaN : (mon?.getStatStage(st) ?? 0);
    if (v !== c.stage.value) {
      fails.push(`${label} ${c.stage.stat} stage ${v} != ${c.stage.value}`);
    }
  }
}

/** One side's checks: fainted / status / ability / hp / stat-stage. */
function expectSide(label: string, mon: Pokemon | undefined, c: SideCheck, fails: string[]): void {
  expectSideStatus(label, mon, c, fails);
  expectSideStats(label, mon, c, fails);
}

/** Evaluate the optional `expect` block; returns a list of human-readable mismatches. */
function evaluateExpect(
  exp: ExpectSpec,
  ctx: { game: GameManager; player?: Pokemon; enemy?: Pokemon; outcome: string; maxHits: number; log: string },
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
      stage: exp.playerStage,
    },
    fails,
  );
  expectSide(
    "enemy",
    ctx.enemy,
    {
      fainted: exp.enemyFainted,
      status: exp.enemyStatus,
      ability: exp.enemyAbility,
      hp: exp.enemyHp,
      stage: exp.enemyStage,
    },
    fails,
  );
  expectArena(exp, ctx.game, fails);
  if (exp.maxHits != null) {
    checkNum("maxHits", ctx.maxHits, exp.maxHits, fails);
  }
  expectLog(exp, ctx.log.toLowerCase(), fails);
  return fails;
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

/** Boot a fresh game and launch the scenario on the in-game dev rails; returns the GameManager at the first CommandPhase. */
async function launchScenario(phaserGame: Phaser.Game, spec: ScenarioSpec): Promise<GameManager> {
  const game = new GameManager(phaserGame);
  // Determinism knobs: force every move to hit / never crit.
  if (NO_MISS) {
    vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
  }
  if (NO_CRIT) {
    game.override.criticalHits(false);
  }
  const { scenario, postLaunch } = buildDevScenario(spec);
  await game.runToTitle();
  const starters = scenario.setup();
  game.override.battleStyle(spec.run?.double ? "double" : "single");
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const ssp = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    ssp.initBattle(starters);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  scenario.onBattleStart?.();
  return game;
}

/** Play up to MAX_TURNS, printing per-turn state + capturing the message log; returns the run summary. */
async function playBattle(
  game: GameManager,
): Promise<{ outcome: string; turnsPlayed: number; maxHits: number; log: string }> {
  // The full battle message log (the game's own event stream) incl. on-entry text.
  const fullLog: string[] = [...game.textInterceptor.logs];
  game.textInterceptor.clearLogs();
  console.log("=== TURN 0 (battle start) ===");
  console.log("STATE", JSON.stringify(snapshot(game)));

  let outcome = "max-turns-reached";
  let turnsPlayed = 0;
  let maxHits = 0;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    turnsPlayed = turn;
    console.log(`\n=== TURN ${turn} ===`);
    doPlayerActions(game, SCRIPT?.[turn - 1]);

    await game.toEndOfTurn();
    fullLog.push(...game.textInterceptor.logs); // this turn's messages
    game.textInterceptor.clearLogs();
    for (const m of [...game.scene.getPlayerField(), ...game.scene.getEnemyField()]) {
      maxHits = Math.max(maxHits, m.turnData?.hitCount ?? 0);
    }
    console.log("STATE", JSON.stringify(snapshot(game)));

    if (game.isVictory()) {
      outcome = "victory";
      break;
    }
    if (game.scene.getPlayerParty().every(p => p.isFainted())) {
      outcome = "player-wiped";
      break;
    }
    if (turn < MAX_TURNS) {
      await game.toNextTurn(); // advance to the next turn's CommandPhase
    }
  }
  return { outcome, turnsPlayed, maxHits, log: fullLog.join("\n") };
}

const RUN = !!SPEC && process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("headless scenario runner", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it(`plays scenario: ${SPEC?.name || RAW}`, async () => {
    const spec = SPEC as ScenarioSpec;
    console.log(`\n===== SCENARIO: ${spec.name || "(unnamed)"} =====`);
    console.log(describeScenarioSpec(spec));
    console.log(
      SCRIPT
        ? `player action: scripted (${SCRIPT.length} turns)`
        : FORCED_MOVE
          ? `player action: force ${MoveId[FORCED_MOVE]} every turn`
          : "player action: first usable move",
    );

    const game = await launchScenario(phaserGame, spec);
    const { outcome, turnsPlayed, maxHits, log } = await playBattle(game);
    console.log(`\nRESULT ${JSON.stringify({ outcome, turnsPlayed, maxHits })}`);

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
      });
      console.log(
        failures.length > 0 ? `\nEXPECT FAILURES:\n - ${failures.join("\n - ")}` : "\nEXPECT: all checks passed",
      );
      expect(failures, `expect mismatches:\n${failures.join("\n")}`).toEqual([]);
    } else {
      expect(SPEC).toBeTruthy();
    }
  }, 180_000);
});
