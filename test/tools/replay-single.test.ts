/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// SINGLE-ENGINE REPLAY LOADER + closed-loop proof (#record-replay, single-player).
//
// `replaySingleTrace(game, trace, opts)` re-drives a single-player {@linkcode ReplayTrace} through ONE
// real headless `GameManager`: it rebuilds the run from the header (seed pinned via `setSeed`, roster
// rehydrated from the trace's serialized `PokemonData` through the starter path) and then walks the
// ordered events - COMMANDS via `game.move.select` / `doSwitchPokemon` / `doThrowPokeball`, INTERACTIONS
// (reward-shop pick/skip, learn-move accept/decline) by registering `game.onNextPrompt` handlers that
// apply each recorded choice IN ORDER. Deterministic: it asserts the replay's final `waveIndex` / party /
// money match the trace's recorded `endState`, and every divergence (a phase stall, an unexpected prompt,
// a state mismatch) is surfaced by index + expected-vs-actual so it FAILS LOUDLY.
//
// THE CLOSED LOOP (the proof + the recipe): the `RUN` test drives a REAL multi-wave single-player run with
// the production recorder ON (the EncounterPhase enable + the command/reward/learn-move taps fire), reads
// the CAPTURED trace via `getReplayTrace()`, replays it via `replaySingleTrace`, and asserts an identical
// outcome (same final wave, same party species/levels/hp, same money). This mirrors the co-op duo
// closed-loop (`coop-duo-replay.test.ts`) for the single-engine path.
//
// HOW TO RUN:
//   ER_SCENARIO=1 npx vitest run test/tools/replay-single.test.ts               # the closed-loop self-check
//   ER_SCENARIO=1 ER_REPLAY_TRACE=<file> npx vitest run test/tools/replay-single.test.ts   # replay a captured trace (the CLI path)
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// The CLI wrapper `scripts/replay-run.mjs` sets the env for you and can EXTRACT the trace from a bug-report
// `.log` capture.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { DEVLOG_REPLAY_TRACE_MARKER } from "#data/elite-redux/er-bug-report";
import { clearReplayRecording, getReplayTrace, isReplayRecording } from "#data/elite-redux/replay-recorder";
import type {
  ReplayCommandEvent,
  ReplayEndState,
  ReplayInteractionEvent,
  ReplayTrace,
} from "#data/elite-redux/replay-trace";
import {
  isReplayCommandEvent,
  isReplayInteractionEvent,
  REPLAY_TRACE_VERSION,
  validateReplayTrace,
} from "#data/elite-redux/replay-trace";
import { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { Variant } from "#sprites/variant";
import { GameManager } from "#test/framework/game-manager";
import type { Starter, StarterMoveset } from "#types/save-data";
import type { AbstractOptionSelectUiHandler } from "#ui/handlers/abstract-option-select-ui-handler";
import type { ErMapUiHandler } from "#ui/handlers/er-map-ui-handler";
import type { LearnMoveBatchUiHandler } from "#ui/handlers/learn-move-batch-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { readFileSync, writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Loader public surface.
// ---------------------------------------------------------------------------

/** Options for {@linkcode replaySingleTrace}. */
export interface ReplaySingleOpts {
  /** Per-event progress logger (the CLI wires console.log); default silent. */
  onProgress?: (line: string) => void;
  /** Stop after this many waves (the CLI `--turns-limit` guard against a runaway trace). */
  maxWaves?: number;
}

/** The outcome of replaying a single-player {@linkcode ReplayTrace} (a test / the CLI asserts off this). */
export interface ReplaySingleResult {
  /** Number of waves replayed to a win. */
  wavesReplayed: number;
  /** Number of command events fed. */
  commandsFed: number;
  /** Number of interaction events applied (reward/skip/learn-move). */
  interactionsApplied: number;
  /** Divergences observed (empty for a clean 1:1 reproduction), each naming index + expected vs actual. */
  divergences: string[];
  /** The replay's own final end-state (waveIndex / money / party). */
  endState: ReplayEndState;
}

// ---------------------------------------------------------------------------
// Roster rehydration + launch.
// ---------------------------------------------------------------------------

/** A minimal view of a roster entry that survives a JSON round-trip (the CLI feeds parsed JSON). */
interface RosterEntryLike {
  species: number;
  shiny?: boolean;
  variant?: number;
  formIndex?: number;
  gender?: number;
  abilityIndex?: number;
  nature?: number;
  pokerus?: boolean;
  ivs?: number[];
  moveset?: { moveId: number }[];
}

/** Rebuild the run's starting party as engine {@linkcode Starter}s from the trace's serialized roster. */
export function buildStartersFromRoster(roster: unknown[]): Starter[] {
  return (roster as RosterEntryLike[]).map(d => {
    const moves = (d.moveset ?? []).map(m => m.moveId).filter((id): id is number => typeof id === "number");
    const starter: Starter = {
      speciesId: d.species as SpeciesId,
      shiny: !!d.shiny,
      variant: (d.variant ?? 0) as Variant,
      formIndex: d.formIndex ?? 0,
      female: d.gender === Gender.FEMALE,
      abilityIndex: d.abilityIndex ?? 0,
      passive: false,
      nature: (d.nature ?? Nature.HARDY) as Nature,
      pokerus: !!d.pokerus,
      ivs: d.ivs ?? [31, 31, 31, 31, 31, 31],
    };
    if (moves.length > 0) {
      starter.moveset = moves as StarterMoveset;
    }
    return starter;
  });
}

/**
 * Launch a fresh classic SOLO run from explicit `starters`, pinned to `seed` (the trace's seed - the
 * production run rode it via `Overrides.SEED_OVERRIDE`; here we `setSeed` it into the run before the first
 * EncounterPhase generates enemies, exactly where the framework's `generateStarters` pins its own seed).
 * `ignoreMovesetValidation` keeps the rehydrated moveset verbatim (no re-roll). Returns at the first
 * CommandPhase. Shared by the record run + the loader so both launch byte-identically.
 */
async function launchSoloRun(game: GameManager, starters: Starter[], seed: string): Promise<void> {
  // Trainer/boss intro dialogue would open a MESSAGE prompt + hang the headless drive; treat as seen.
  vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  await game.runToTitle();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const ssp = new SelectStarterPhase();
    // Pin the run's RNG seed (the deterministic reproduction input) BEFORE the battle is built.
    game.scene.setSeed(seed);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    ssp.initBattle(starters, true);
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
}

// ---------------------------------------------------------------------------
// Command + interaction driving (shared by the record run + the loader).
// ---------------------------------------------------------------------------

/** Resolve a captured move SLOT to the live active mon's `MoveId` at that slot (the trace stays slot-based). */
function resolveMoveIdForSlot(mon: Pokemon, moveIndex: number): number | null {
  const pm = mon.getMoveset()[moveIndex];
  return pm?.moveId ?? null;
}

/** Feed one recorded COMMAND for its field slot into the live run (move/switch/ball/run). */
function feedCommand(game: GameManager, cmd: ReplayCommandEvent, divergences: string[], eventIndex: number): void {
  const fieldIndex = cmd.slotFieldIndex;
  const mon = game.scene.getPlayerField()[fieldIndex];
  const c = cmd.command;
  if (c.kind === "move") {
    const moveId = mon == null ? null : resolveMoveIdForSlot(mon, c.moveIndex);
    if (moveId == null) {
      divergences.push(
        `event[${eventIndex}] command: move slot ${c.moveIndex} out of range at wave ${cmd.wave} turn ${cmd.turn}`,
      );
      return;
    }
    game.move.select(moveId, fieldIndex, c.target ?? BattlerIndex.ENEMY);
  } else if (c.kind === "switch") {
    game.doSwitchPokemon(c.partyIndex);
  } else if (c.kind === "ball") {
    // Ensure the recorded ball is in stock (ball counts are not in the trace); a real trace had it.
    if ((game.scene.pokeballCounts[c.ballIndex as PokeballType] ?? 0) <= 0) {
      game.scene.pokeballCounts[c.ballIndex as PokeballType] = 10;
    }
    game.doThrowPokeball(c.ballIndex as PokeballType);
  } else {
    // RUN: flee via the real Command path (mirrors run-scenario's run handler).
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const phase = game.scene.phaseManager.getCurrentPhase() as unknown as {
        handleCommand(command: number, cursor: number): boolean;
        getFieldIndex(): number;
      };
      phase.handleCommand(3 /* Command.RUN */, phase.getFieldIndex());
    });
  }
}

/** The decline sentinel used by the learn-move forget SUMMARY (the "new move" row = the mon's move cap). */
function declineSlot(game: GameManager): number {
  return game.scene.getPlayerField()[0]?.getMaxMoveCount() ?? 4;
}

/**
 * Register the LEARN-MOVE decision handlers for the imminent between-wave transition, SELF-RE-ARMING so an
 * arbitrary number of level-up move-learns in one transition are each handled in order. `decideSlot` yields
 * the forget slot to select (the decline sentinel = keep current moves; a real slot < cap = forget it).
 * `onFired(slot)` runs after each decision. The chain mirrors the canonical CONFIRM -> SUMMARY -> CONFIRM
 * input the LearnMovePhase drives (see learn-move-phase.ts / run-scenario.test.ts).
 */
function armLearnMoveHandlers(
  game: GameManager,
  expire: () => boolean,
  decideSlot: () => number,
  onFired: (slot: number) => void,
): void {
  // "Should a move be forgotten?" -> ACTION (Yes, open the forget menu).
  game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => game.scene.ui.processInput(Button.ACTION), expire);
  // The forget SUMMARY: select the recorded slot (the cap = decline / "new move" row).
  game.onNextPrompt(
    "LearnMovePhase",
    UiMode.SUMMARY,
    () => {
      const slot = decideSlot();
      game.scene.ui.setCursor(slot);
      game.scene.ui.processInput(Button.ACTION);
      onFired(slot);
      // Re-arm for a possible subsequent learn-move within the same transition (big xp jumps learn many).
      armLearnMoveHandlers(game, expire, decideSlot, onFired);
    },
    expire,
  );
  // Only reached on decline: "Stop trying to teach?" -> ACTION (Yes).
  game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => game.scene.ui.processInput(Button.ACTION), expire);
}

/**
 * Decline the ER custom BATCH level-up Move Learn panel (LEARN_MOVE_BATCH). ER routes EVERY level-up
 * move-learn through this ONE panel (see LearnMoveBatchPhase), NOT the per-move LearnMovePhase - so THIS,
 * not armLearnMoveHandlers, is what a solo level-up run needs driven. Declines via the real input path
 * (CANCEL -> the "Skip learning?" confirm -> move the cursor to Yes -> ACTION), leaving the moveset intact
 * (mirrors the per-move decline, so the one-shot attack survives). The batch phase's own tap records the
 * "learnMove" decline as this resolves.
 */
function declineLearnMoveBatch(game: GameManager): void {
  const handler = game.scene.ui.getHandler() as LearnMoveBatchUiHandler;
  handler.processInput(Button.CANCEL); // nothing learned -> opens the "Skip learning any new moves?" confirm
  handler.processInput(Button.RIGHT); // move the confirm cursor No(0) -> Yes(1)
  handler.processInput(Button.ACTION); // Yes: leave the panel without learning
}

/**
 * Register the ER BATCH level-up Move Learn handler for the imminent transition, SELF-RE-ARMING so any
 * number of panels (one per mon that levels + crosses a new-move level) are each declined in turn.
 * `onDeclined` runs after each panel is dismissed (the loader consumes the recorded "learnMove" there; the
 * record run's tap already fired). The `expire` clears it once past the learn window (the shop / next wave)
 * and includes LearnMovePhase so it never wedges the FIFO queue if a per-move learn interleaves.
 */
function armLearnMoveBatchHandler(game: GameManager, expire: () => boolean, onDeclined: () => void): void {
  game.onNextPrompt(
    "LearnMoveBatchPhase",
    UiMode.LEARN_MOVE_BATCH,
    () => {
      declineLearnMoveBatch(game);
      onDeclined();
      armLearnMoveBatchHandler(game, expire, onDeclined); // re-arm for another panel in the same transition
    },
    expire,
  );
}

/** Register the reward-shop handler for the imminent SelectModifierPhase (PICK a row-1 option, or SKIP). */
function armRewardHandler(game: GameManager, decision: RewardDecision, onFired: () => void): void {
  const expire = () => game.isCurrentPhase("CommandPhase", "NewBattlePhase", "CheckSwitchPhase", "TurnInitPhase");
  if (decision.kind === "skip") {
    game.doSelectModifier();
    onFired();
    return;
  }
  game.onNextPrompt(
    "SelectModifierPhase",
    UiMode.MODIFIER_SELECT,
    () => {
      const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
      handler.setRowCursor(1); // the rewards row
      handler.setCursor(decision.choice);
      handler.processInput(Button.ACTION);
      onFired();
    },
    expire,
    true,
  );
  // A party-target reward opens PARTY within the same phase; apply to the lead (safety net for a
  // party-target trace - the closed-loop test uses only non-party rewards).
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

/** A resolved reward-shop decision the loader / record run drives. */
type RewardDecision = { kind: "reward"; choice: number } | { kind: "skip" };

/**
 * Register the ER CROSSROADS handler for the imminent transition (#record-replay, biome boundary). After
 * the reward, a wave whose biome is mid-run raises the every-5-waves "Stay / Leave" choice
 * (ErCrossroadsPhase -> OPTION_SELECT). `resolveOption` yields the option index (0 = Stay, 1 = Leave -
 * exactly the value the crossroads tap records) at FIRE time, so the loader consumes the recorded pick in
 * trace order. Fires via the REAL handler input path (unblock -> setCursor -> ACTION), mirroring
 * run-scenario's `driveOptionSelect`. Expires the moment we are PAST the crossroads (biome pick / switch /
 * next battle) so a Stay run - which never opens the biome picker - can't wedge the FIFO prompt queue.
 */
function armCrossroadsHandler(game: GameManager, resolveOption: () => number, onFired: (opt: number) => void): void {
  const expire = () =>
    game.isCurrentPhase("SelectBiomePhase", "SwitchBiomePhase", "NewBattlePhase", "TurnInitPhase", "CommandPhase");
  game.onNextPrompt(
    "ErCrossroadsPhase",
    UiMode.OPTION_SELECT,
    () => {
      const handler = game.scene.ui.getHandler() as AbstractOptionSelectUiHandler;
      handler.unblockInput?.(); // the crossroads OPTION_SELECT opens with a delay-block; clear it headlessly
      const opt = resolveOption();
      handler.setCursor(opt);
      handler.processInput(Button.ACTION);
      onFired(opt);
    },
    expire,
  );
}

/**
 * Register the ER World-Map BIOME handler for the imminent transition (#record-replay, biome boundary).
 * When a biome ends (natural length, or a Crossroads "Leave") with more than one revealed onward node, the
 * run opens the World Map route picker (SelectBiomePhase -> ER_MAP). `resolveBiome` yields the recorded
 * `BiomeId` to travel to (or -1 = the record-run default: the leftmost node) at FIRE time, so the loader
 * consumes the recorded pick in trace order. The recorded BiomeId is mapped back to its revealed-node index
 * via the shared routing state (same seed -> the SAME node set the record run saw), then driven RIGHT ->
 * ACTION through the REAL handler input path, mirroring run-scenario's `driveBiomePick`. Expires once we are
 * past the picker so a wave with no biome change can't wedge the FIFO prompt queue.
 */
function armBiomeHandler(game: GameManager, resolveBiome: () => number, onFired: (biome: number) => void): void {
  const expire = () => game.isCurrentPhase("SwitchBiomePhase", "NewBattlePhase", "TurnInitPhase", "CommandPhase");
  game.onNextPrompt(
    "SelectBiomePhase",
    UiMode.ER_MAP,
    () => {
      const handler = game.scene.ui.getHandler() as ErMapUiHandler;
      const want = resolveBiome();
      const nodes = getErPendingNodes().filter(n => n.revealed);
      let idx = 0;
      if (want >= 0) {
        const found = nodes.findIndex(n => n.biome === want);
        idx = found >= 0 ? found : 0;
      }
      for (let i = 0; i < idx; i++) {
        handler.processInput(Button.RIGHT);
      }
      handler.processInput(Button.ACTION); // travel to the cursored onward node (er-map-ui-handler confirmPick)
      onFired(nodes[idx]?.biome ?? want);
    },
    expire,
  );
}

/**
 * Arm the LEVEL-UP learn handlers for the CURRENT turn (#record-replay). In ER the exp/level-up chain runs
 * INSIDE the victory turn (VictoryPhase -> applyPartyExp -> LevelUpPhase -> the learn UI), BEFORE
 * TurnEndPhase - so the learn UI appears during `toEndOfTurn`, NOT in the between-wave transition. This must
 * be armed just before each `toEndOfTurn`. It covers BOTH learn paths: the ER custom BATCH panel
 * (LearnMoveBatchPhase, the path a solo level-up actually uses) and the per-move LearnMovePhase (kept for
 * TM/relearner/evolution learns). Both DECLINE (keep the moveset intact) and self-re-arm for multiple
 * level-ups in one turn; their `expire`s include each other's phase (so they never wedge one another) and
 * TurnEndPhase (so a turn with no learn clears them). `consumeLearn` runs after each learn is dismissed -
 * the loader consumes the recorded "learnMove" there; the record run's taps already fired, so it is a no-op.
 */
function armTurnLearnHandlers(game: GameManager, consumeLearn: () => void): void {
  const batchExpire = () =>
    game.isCurrentPhase(
      "LearnMovePhase",
      "TurnEndPhase",
      "TurnInitPhase",
      "CommandPhase",
      "SelectModifierPhase",
      "NewBattlePhase",
    );
  const perMoveExpire = () =>
    game.isCurrentPhase(
      "LearnMoveBatchPhase",
      "TurnEndPhase",
      "TurnInitPhase",
      "CommandPhase",
      "SelectModifierPhase",
      "NewBattlePhase",
    );
  armLearnMoveBatchHandler(game, batchExpire, consumeLearn);
  armLearnMoveHandlers(
    game,
    perMoveExpire,
    () => declineSlot(game),
    () => consumeLearn(),
  );
}

/**
 * The per-decision resolvers/callbacks {@linkcode driveWaveTransition} drives for one between-wave
 * transition. The record run passes FIXED defaults (the wave-1 reward then skips, Stay at a crossroads, the
 * leftmost biome node); the loader passes CONSUMERS that apply each recorded pick in trace order. (Level-up
 * learns are handled per-turn by {@linkcode armTurnLearnHandlers}, not here - they fire inside the turn.)
 */
interface WaveTransitionHandlers {
  resolveReward: () => RewardDecision;
  onReward: (decision: RewardDecision) => void;
  /** ER Crossroads pick: the option index (0 = Stay, 1 = Leave). */
  resolveCrossroads: () => number;
  onCrossroads: (opt: number) => void;
  /** ER World-Map biome pick: the target `BiomeId`, or -1 for the leftmost node (the record-run default). */
  resolveBiome: () => number;
  onBiome: (biome: number) => void;
}

/**
 * Drive one BETWEEN-WAVE transition (after the wave is won, level-up learns already handled in-turn). Stage
 * 1 advances to the reward shop; Stage 2 resolves the reward, then arms the ER biome-boundary handlers
 * (Crossroads / World-Map biome pick) BEHIND it in the FIFO prompt queue - each fires only if its menu
 * appears (else its `expire` clears it) and consumes its recorded interaction at FIRE time, so the trace
 * order (reward, [crossroads], [biome]) is honored exactly. Then it advances into the next wave's
 * CommandPhase. Shared by the record run + the loader so their stopping points match exactly.
 */
async function driveWaveTransition(game: GameManager, h: WaveTransitionHandlers): Promise<void> {
  // Stage 1: reach the shop (level-up learns were already declined in the winning turn's toEndOfTurn).
  await game.phaseInterceptor.to("SelectModifierPhase", false);
  // Stage 2: resolve the reward, then arm the biome-boundary handlers behind it and cross into the next wave.
  const decision = h.resolveReward();
  armRewardHandler(game, decision, () => h.onReward(decision));
  armCrossroadsHandler(game, h.resolveCrossroads, h.onCrossroads);
  armBiomeHandler(game, h.resolveBiome, h.onBiome);
  await game.phaseInterceptor.to("CommandPhase");
}

/** Snapshot the run's current end-state (waveIndex / money / party) for the deterministic comparison. */
function captureEndState(game: GameManager): ReplayEndState {
  return {
    waveIndex: game.scene.currentBattle?.waveIndex ?? 0,
    money: game.scene.money ?? 0,
    party: game.scene.getPlayerParty().map(p => ({
      species: p.species.speciesId,
      level: p.level,
      hp: p.hp,
      maxHp: p.getMaxHp(),
    })),
  };
}

/** Compare a replayed end-state to the trace's recorded one, pushing a named divergence per mismatch. */
function diffEndState(actual: ReplayEndState, expected: ReplayEndState, divergences: string[]): void {
  if (actual.waveIndex !== expected.waveIndex) {
    divergences.push(`endState waveIndex: expected ${expected.waveIndex}, got ${actual.waveIndex}`);
  }
  if (actual.money !== expected.money) {
    divergences.push(`endState money: expected ${expected.money}, got ${actual.money}`);
  }
  if (actual.party.length !== expected.party.length) {
    divergences.push(`endState party size: expected ${expected.party.length}, got ${actual.party.length}`);
  }
  const n = Math.min(actual.party.length, expected.party.length);
  for (let i = 0; i < n; i++) {
    const a = actual.party[i];
    const e = expected.party[i];
    if (a.species !== e.species || a.level !== e.level || a.hp !== e.hp || a.maxHp !== e.maxHp) {
      divergences.push(
        `endState party[${i}]: expected {sp:${e.species},L${e.level},hp:${e.hp}/${e.maxHp}}, got {sp:${a.species},L${a.level},hp:${a.hp}/${a.maxHp}}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// THE LOADER.
// ---------------------------------------------------------------------------

/**
 * Replay a single-player {@linkcode ReplayTrace} through ONE headless {@linkcode GameManager}. Rebuilds the
 * run from the header (seed + roster) and drives the ordered events wave-by-wave, feeding commands +
 * applying interactions in order. Asserts the reproduced end-state matches the trace's recorded `endState`
 * (when present). Divergences are collected + named (never silently swallowed); a hard fault (bad trace,
 * phase stall) throws. `game` must be a freshly-constructed GameManager (with any determinism overrides -
 * e.g. `enemySpecies` / `xpMultiplier` - already staged by the caller for a synthetic trace).
 */
export async function replaySingleTrace(
  game: GameManager,
  trace: ReplayTrace,
  opts: ReplaySingleOpts = {},
): Promise<ReplaySingleResult> {
  const log = opts.onProgress ?? (() => {});
  const validation = validateReplayTrace(trace);
  if (!validation.ok) {
    throw new Error(`replaySingleTrace: invalid trace - ${validation.errors.join("; ")}`);
  }
  if (trace.coop != null) {
    throw new Error("replaySingleTrace: this loader is single-player only; a co-op trace replays via replayCoopTrace");
  }

  const divergences: string[] = [];
  const commandEvents = trace.events.filter(isReplayCommandEvent);
  const interactionEvents = trace.events.filter(isReplayInteractionEvent);
  if (commandEvents.length === 0) {
    throw new Error("replaySingleTrace: trace has no command events to replay");
  }

  // ===== Rebuild the run from the header. =====
  const starters = buildStartersFromRoster(trace.roster);
  log(`launching solo run: seed=${trace.seed} roster=[${starters.map(s => s.speciesId).join(",")}]`);
  await launchSoloRun(game, starters, trace.seed);

  const waves = [...new Set(commandEvents.map(c => c.wave))].sort((a, b) => a - b);
  const maxWaves = opts.maxWaves ?? waves.length;
  let commandsFed = 0;
  let interactionsApplied = 0;
  let wavesReplayed = 0;
  // The ordered interaction cursor: prompts consume the NEXT recorded interaction (kind-verified).
  let interactionIdx = 0;
  const consumeInteraction = (expected: string[], contextLabel: string): ReplayInteractionEvent | null => {
    if (interactionIdx >= interactionEvents.length) {
      divergences.push(
        `interaction[${interactionIdx}]: none left for ${contextLabel} (expected ${expected.join("/")})`,
      );
      return null;
    }
    const ev = interactionEvents[interactionIdx];
    if (!expected.includes(ev.kind)) {
      divergences.push(
        `interaction[${interactionIdx}] for ${contextLabel}: expected kind ${expected.join("/")}, got kind=${ev.kind} choice=${ev.choice}`,
      );
    }
    interactionIdx++;
    return ev;
  };

  for (let wi = 0; wi < waves.length && wi < maxWaves; wi++) {
    const wave = waves[wi];
    const isLast = wi === waves.length - 1 || wi === maxWaves - 1;
    const curWave = game.scene.currentBattle?.waveIndex;
    if (curWave !== wave) {
      divergences.push(`wave drift: trace expected wave ${wave}, replay is at wave ${curWave}`);
    }
    const waveCmds = commandEvents.filter(c => c.wave === wave);
    const turns = [...new Set(waveCmds.map(c => c.turn))].sort((a, b) => a - b);
    log(`wave ${wave}: ${turns.length} turn(s), ${waveCmds.length} command(s)`);

    let won = false;
    for (let ti = 0; ti < turns.length; ti++) {
      const turn = turns[ti];
      const turnCmds = waveCmds.filter(c => c.turn === turn);
      for (const cmd of turnCmds) {
        const evIndex = trace.events.indexOf(cmd);
        feedCommand(game, cmd, divergences, evIndex);
        commandsFed++;
        log(`  fed ${describeCommand(cmd)}`);
      }
      registerFaintSwitchSafetyNet(game);
      // ER runs the exp/level-up learn UI INSIDE the victory turn (before TurnEndPhase), so arm the learn
      // handlers here: on the winning turn they decline each level-up panel and consume its recorded
      // "learnMove" in trace order (before this transition's reward). Harmless on a non-winning turn.
      armTurnLearnHandlers(game, () => {
        const ev = consumeInteraction(["learnMove"], "level-up learn");
        interactionsApplied += ev == null ? 0 : 1;
        log(
          ev == null
            ? "  level-up learn: (no recorded event)"
            : `  level-up learn: ${ev.choice >= declineSlot(game) ? "declined" : `slot ${ev.choice}`}`,
        );
      });
      await game.toEndOfTurn();
      if (game.isVictory()) {
        won = true;
        break;
      }
      if (game.scene.getPlayerParty().every(p => p.isFainted())) {
        divergences.push(`wave ${wave}: player wiped at turn ${turn} (unexpected)`);
        break;
      }
      if (ti < turns.length - 1) {
        await game.toNextTurn();
      }
    }
    if (!won) {
      divergences.push(`wave ${wave}: not won after replaying its ${turns.length} recorded turn(s)`);
    }
    wavesReplayed++;

    if (!isLast) {
      // ===== Between-wave transition: the reward pick, then the ER biome-boundary picks (crossroads/biome).
      // Level-up learns were already consumed IN the winning turn above (ER fires them before TurnEndPhase),
      // so the trace order (level-up learn(s), reward, [crossroads], [biome]) is honored exactly. =====
      await driveWaveTransition(game, {
        resolveReward: () => {
          const rewardEv = consumeInteraction(["reward", "skip"], "reward-shop");
          interactionsApplied += rewardEv == null ? 0 : 1;
          return rewardEv != null && rewardEv.kind === "reward"
            ? { kind: "reward", choice: rewardEv.choice }
            : { kind: "skip" };
        },
        onReward: decision =>
          log(`  reward-shop: ${decision.kind === "reward" ? `picked row-1 #${decision.choice}` : "skipped"}`),
        // Crossroads / biome are consumed at FIRE time (only if their menu actually appears this transition),
        // so the shared interaction cursor stays in trace order across Stay / Leave / natural-biome-end waves.
        resolveCrossroads: () => {
          const ev = consumeInteraction(["crossroads"], "crossroads");
          interactionsApplied += ev == null ? 0 : 1;
          return ev?.choice ?? 0;
        },
        onCrossroads: opt => log(`  crossroads: option ${opt} (${opt === 1 ? "leave" : "stay"})`),
        resolveBiome: () => {
          const ev = consumeInteraction(["biome"], "biome");
          interactionsApplied += ev == null ? 0 : 1;
          return ev?.choice ?? -1;
        },
        onBiome: biome => log(`  biome-pick: BiomeId ${biome}`),
      });
    }
  }

  const endState = captureEndState(game);
  if (trace.endState != null) {
    diffEndState(endState, trace.endState, divergences);
  }
  log(
    divergences.length === 0
      ? "REPLAYED 1:1 (no divergences)"
      : `DIVERGENCES (${divergences.length}):\n - ${divergences.join("\n - ")}`,
  );

  return { wavesReplayed, commandsFed, interactionsApplied, divergences, endState };
}

/** One-shot faint-switch safety net (send the first legal bench mon) so an unexpected faint never hangs. */
function registerFaintSwitchSafetyNet(game: GameManager): void {
  game.onNextPrompt(
    "SwitchPhase",
    UiMode.PARTY,
    () => {
      const party = game.scene.getPlayerParty();
      const battlerCount = game.scene.currentBattle.getBattlerCount();
      const slot = party.findIndex((p, i) => i >= battlerCount && p.isAllowedInBattle());
      if (slot < 0) {
        return;
      }
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(slot);
      handler.processInput(Button.ACTION);
      handler.processInput(Button.ACTION);
    },
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

/** A short human-readable label for a recorded command (progress logging). */
function describeCommand(cmd: ReplayCommandEvent): string {
  const c = cmd.command;
  const base = `wave ${cmd.wave} turn ${cmd.turn} slot ${cmd.slotFieldIndex}: `;
  switch (c.kind) {
    case "move":
      return `${base}move slot ${c.moveIndex}${c.target == null ? "" : ` -> target ${c.target}`}`;
    case "switch":
      return `${base}switch -> party[${c.partyIndex}]`;
    case "ball":
      return `${base}throw ball ${c.ballIndex}`;
    default:
      return `${base}run`;
  }
}

// =============================================================================
// Env flags: the closed-loop self-check (RUN) vs a CLI-fed trace replay (CLI).
// =============================================================================
const ER_SCENARIO = process.env.ER_SCENARIO === "1";
const TRACE_INPUT = (process.env.ER_REPLAY_TRACE ?? "").trim();
const TURNS_LIMIT = Number(process.env.ER_REPLAY_TURNS_LIMIT);
const RUN = ER_SCENARIO && TRACE_INPUT.length === 0;
const CLI = ER_SCENARIO && TRACE_INPUT.length > 0;

// ---------------------------------------------------------------------------
// Closed-loop self-check: record a real run, then replay the captured trace.
// ---------------------------------------------------------------------------

/** Build a full-4-move starter (so any level-up move-learn triggers the forget prompt = a decline). */
function makeStarter(species: SpeciesId, moves: MoveId[]): Starter {
  return {
    speciesId: species,
    shiny: false,
    variant: 0 as Variant,
    formIndex: 0,
    female: false,
    abilityIndex: 0,
    passive: false,
    nature: Nature.HARDY,
    pokerus: false,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: moves as StarterMoveset,
  };
}

/** The frail-enemy / low-level / big-xp overrides staged IDENTICALLY on the record + replay games. */
function stageDeterminismOverrides(game: GameManager): void {
  game.override
    .battleStyle("single")
    // Lift the low early-wave level cap so the lv5 mon actually levels + crosses ER learnset levels: that is
    // what fires the ER custom BATCH level-up Move Learn panel (LearnMoveBatchPhase), which the record run
    // declines (recording a "learnMove" per panel) and the loader replays. Under the natural cap (~10) the
    // mon caps out before a learnable level registers, so no learn-move fires at all. 40 stays well under
    // Magikarp's lv20 evolution, so no bench mon evolves (a bench mon gains no exp anyway).
    .levelCap(40)
    .startingLevel(5)
    .xpMultiplier(64) // big xp so the level-5 mon levels + crosses learn-move levels (a decline per learn)
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyLevel(5)
    .enemyMoveset(MoveId.SPLASH) // 0 damage: the player never faints -> full-hp, deterministic end state
    .moveset([MoveId.THUNDERBOLT, MoveId.THUNDER_SHOCK, MoveId.QUICK_ATTACK, MoveId.TAIL_WHIP])
    // Force EVERY wave to be a WILD single Magikarp (disableTrainerWaves only skips STANDARD trainers -
    // a fixed trainer wave slipped through as a multi-mon switch battle that a one-shot can't clear).
    .battleType(BattleType.WILD)
    // A free, non-party reward guaranteed in every shop. AMULET_COIN (money multiplier) is chosen
    // deliberately: unlike LURE it does NOT boost the double-battle chance, so every wave stays a single
    // 1v1 the one-shot attack clears (LURE turned later waves into doubles a single-target move can't win).
    .itemRewards([{ name: "AMULET_COIN" }]);
}

describe.skipIf(!RUN)("single-player replay: record -> replay closed loop (#record-replay)", () => {
  let phaserGame: Phaser.Game;
  /** The trace captured by KILLER #1, replayed by KILLER #2 (split so each uses its own clean GameManager). */
  let capturedTrace: ReplayTrace | null = null;
  /** The record run's own final state (asserted equal to the replay's). */
  let recordedEndState: ReplayEndState | null = null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    // isolate:false hygiene - never let a live recording leak into the next file's runs.
    clearReplayRecording();
  });

  it("the schema accepts a v1 co-op trace (backward compatible) + rejects an unknown version", () => {
    const v1CoopTrace = {
      version: 1,
      seed: "legacy-coop-seed",
      gameModeId: GameModes.COOP,
      difficulty: "youngster",
      challenges: [],
      roster: [{ species: SpeciesId.SNORLAX }, { species: SpeciesId.GENGAR }],
      events: [
        { type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: 0, target: 2 } },
      ],
      coop: {
        runConfig: { difficulty: "youngster", challenges: [], seed: "legacy-coop-seed", netcodeMode: "authoritative" },
      },
    } as unknown as ReplayTrace;
    expect(validateReplayTrace(v1CoopTrace).ok, "a stored v1 co-op trace still validates").toBe(true);

    const badVersion = { ...v1CoopTrace, version: 999 } as unknown as ReplayTrace;
    expect(validateReplayTrace(badVersion).ok, "an unknown version is rejected").toBe(false);
    expect(REPLAY_TRACE_VERSION, "new captures stamp v2").toBe(2);
  });

  it("KILLER #1: a real single-player run is RECORDED by the production taps", async () => {
    const game = new GameManager(phaserGame);
    stageDeterminismOverrides(game);

    // ===== Launch a real solo run - the EncounterPhase single-player enable begins recording. =====
    const starters = [
      makeStarter(SpeciesId.PIKACHU, [MoveId.THUNDERBOLT, MoveId.THUNDER_SHOCK, MoveId.QUICK_ATTACK, MoveId.TAIL_WHIP]),
      makeStarter(SpeciesId.PIKACHU, [MoveId.THUNDERBOLT, MoveId.THUNDER_SHOCK, MoveId.QUICK_ATTACK, MoveId.TAIL_WHIP]),
    ];
    await launchSoloRun(game, starters, "test");
    expect(isReplayRecording(), "the single-player recorder began at the first EncounterPhase").toBe(true);
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 20; // stock balls for the wave-4 throw

    // ===== Drive 7 waves: attack (one-shot) with a switch (wave 3), a ball throw (wave 4), a reward pick
    // (wave 1) + skips, and learn-move DECLINES throughout (the big xp jump levels the lv5 Pikachu). =====
    const TOTAL_WAVES = 7;
    for (let wave = 1; wave <= TOTAL_WAVES; wave++) {
      const isLast = wave === TOTAL_WAVES;
      let won = false;
      console.log(
        `[record-diag] wave=${game.scene.currentBattle.waveIndex} double=${game.scene.currentBattle.double} enemies=${game.scene.getEnemyField().length} battleType=${game.scene.currentBattle.battleType} party=${game.scene.getPlayerParty().length} leadLvl=${game.scene.getPlayerField()[0]?.level}`,
      );
      // Scripted actions first, then keep attacking (rotating move slots, so a
      // type-immune wall - e.g. Thunderbolt into a ground type - can't wedge the
      // wave) until victory. Extra turns are recorded like any other command, so
      // the replay follows the exact same path.
      const turnActions: (() => void)[] = buildRecordWaveActions(game, wave);
      const MAX_WAVE_TURNS = 10;
      for (let t = 0; t < MAX_WAVE_TURNS; t++) {
        if (t < turnActions.length) {
          turnActions[t]();
        } else {
          const mon = game.scene.getPlayerField()[0];
          const slot = (t - turnActions.length + 1) % 4;
          const moveId = resolveMoveIdForSlot(mon, slot) ?? resolveMoveIdForSlot(mon, 0) ?? MoveId.THUNDERBOLT;
          game.move.select(moveId, 0, BattlerIndex.ENEMY);
        }
        registerFaintSwitchSafetyNet(game);
        // ER fires the exp/level-up learn UI INSIDE the victory turn (before TurnEndPhase). Decline each
        // level-up panel through the REAL menu so the batch-learn tap fires + lands in the captured trace,
        // while keeping the one-shot moveset intact. Harmless on a non-winning turn.
        armTurnLearnHandlers(game, () => {});
        await game.toEndOfTurn();
        if (game.isVictory()) {
          won = true;
          break;
        }
        await game.toNextTurn();
      }
      expect(won, `record run: wave ${wave} was won`).toBe(true);
      if (!isLast) {
        // Take the forced reward on wave 1, skip the rest. Same transition the loader uses so the record +
        // replay stopping points match exactly. The biome-boundary defaults (Stay at a crossroads, leftmost
        // node at the World-Map picker) are driven through the REAL menus so the crossroads / biome taps fire
        // and land in the captured trace. (Level-up learns were already declined in the turn loop above.)
        const decision: RewardDecision = wave === 1 ? { kind: "reward", choice: 0 } : { kind: "skip" };
        await driveWaveTransition(game, {
          resolveReward: () => decision,
          onReward: () => {},
          resolveCrossroads: () => 0, // Stay
          onCrossroads: () => {},
          resolveBiome: () => -1, // leftmost node
          onBiome: () => {},
        });
      }
    }

    // ===== Capture the recorded trace + the record run's own end state (before wave 7's shop). =====
    recordedEndState = captureEndState(game);
    const captured = getReplayTrace();
    expect(captured, "a trace was captured during the real solo run").not.toBeNull();
    capturedTrace = captured;
    const trace = captured!;
    expect(validateReplayTrace(trace).ok, "the captured trace validates").toBe(true);
    expect(trace.coop, "a single-player trace has NO coop layer").toBeUndefined();
    expect(trace.endState, "the single-player recorder stamped an end-state summary").toBeDefined();

    const commands = trace.events.filter(isReplayCommandEvent);
    const interactions = trace.events.filter(isReplayInteractionEvent);
    expect(
      commands.some(c => c.command.kind === "move"),
      "recorded a move command",
    ).toBe(true);
    expect(
      commands.some(c => c.command.kind === "switch"),
      "recorded the wave-3 switch",
    ).toBe(true);
    expect(
      commands.some(c => c.command.kind === "ball"),
      "recorded the wave-4 ball throw",
    ).toBe(true);
    expect(
      interactions.some(i => i.kind === "reward"),
      "recorded the wave-1 reward pick",
    ).toBe(true);
    expect(
      interactions.some(i => i.kind === "skip"),
      "recorded a reward-shop skip",
    ).toBe(true);
    expect(
      interactions.some(i => i.kind === "learnMove"),
      "recorded a learn-move decline",
    ).toBe(true);

    clearReplayRecording();
    expect(isReplayRecording(), "recording cleared at teardown").toBe(false);
  }, 300_000);

  it("KILLER #2: the CAPTURED trace REPLAYS 1:1 through the single-engine loader", async () => {
    expect(capturedTrace, "KILLER #1 captured a trace").not.toBeNull();
    expect(recordedEndState, "KILLER #1 captured the record run's end state").not.toBeNull();
    const trace = capturedTrace!;

    const game = new GameManager(phaserGame);
    stageDeterminismOverrides(game); // the SAME determinism overrides so the replay reproduces the run

    const result = await replaySingleTrace(game, trace, { onProgress: line => console.log(`[replay] ${line}`) });

    expect(
      result.divergences,
      `the captured trace reproduced with NO divergence:\n${result.divergences.join("\n")}`,
    ).toEqual([]);
    expect(result.wavesReplayed, "all recorded waves replayed").toBe(
      new Set(trace.events.filter(isReplayCommandEvent).map(c => c.wave)).size,
    );
    expect(result.commandsFed, "every recorded command was fed").toBe(trace.events.filter(isReplayCommandEvent).length);
    // The replay's end state matches BOTH the trace's recorded end state AND the record run's live state.
    expect(result.endState).toEqual(trace.endState);
    expect(result.endState).toEqual(recordedEndState);
    clearReplayRecording();
  }, 300_000);
});

/**
 * The per-wave action list for the RECORD run (each entry commits one turn's command). Wave 3 switches then
 * attacks; wave 4 throws a ball then (if not caught) attacks; every other wave attacks once. The victory
 * check in the drive loop skips any trailing action once the wave is already won (e.g. a successful catch).
 */
function buildRecordWaveActions(game: GameManager, wave: number): (() => void)[] {
  const attack = () => {
    const mon = game.scene.getPlayerField()[0];
    const moveId = resolveMoveIdForSlot(mon, 0) ?? MoveId.THUNDERBOLT;
    game.move.select(moveId, 0, BattlerIndex.ENEMY);
  };
  if (wave === 3) {
    return [() => game.doSwitchPokemon(1), attack];
  }
  if (wave === 4) {
    return [() => game.doThrowPokeball(PokeballType.POKEBALL), attack];
  }
  return [attack];
}

// ---------------------------------------------------------------------------
// CLI-fed replay: load a trace (raw JSON or a bug-report .log) and re-drive it.
// ---------------------------------------------------------------------------

/**
 * Extract a {@linkcode ReplayTrace} from CLI input: a raw trace JSON, a bug-report JSON (`{replayTrace}`),
 * or a plain devlog `.log` capture (the trace fenced by {@linkcode DEVLOG_REPLAY_TRACE_MARKER}). Throws a
 * precise error if no trace is present.
 */
export function extractTraceFromInput(raw: string): ReplayTrace {
  const text = raw.trim();
  // A devlog .log capture: pull the JSON line after the REPLAY TRACE marker.
  const markerIdx = text.indexOf(DEVLOG_REPLAY_TRACE_MARKER);
  if (markerIdx >= 0) {
    const after = text.slice(markerIdx + DEVLOG_REPLAY_TRACE_MARKER.length).trim();
    const firstLine =
      after
        .split(/\r?\n/)
        .find(l => l.trim().length > 0)
        ?.trim() ?? "";
    if (firstLine === "(none)" || firstLine.length === 0) {
      throw new Error("the .log capture has no replay trace (the run was not recording)");
    }
    return JSON.parse(firstLine) as ReplayTrace;
  }
  // Otherwise JSON: either a bug-report ({replayTrace: "..."}), or a raw ReplayTrace.
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.replayTrace === "string") {
    return JSON.parse(parsed.replayTrace) as ReplayTrace;
  }
  if (parsed.replayTrace === null) {
    throw new Error("the bug report has a null replayTrace (the run was not recording)");
  }
  if (typeof parsed.version === "number" && Array.isArray(parsed.events)) {
    return parsed as unknown as ReplayTrace;
  }
  throw new Error("input is neither a raw ReplayTrace, a bug-report JSON with replayTrace, nor a devlog capture");
}

describe.skipIf(!CLI)("single-player replay: re-drive a captured trace (CLI)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    clearReplayRecording();
  });

  it(`replays trace: ${TRACE_INPUT}`, async () => {
    const raw = readFileSync(TRACE_INPUT, "utf8");
    const trace = extractTraceFromInput(raw);
    console.log(`\n===== REPLAY: ${TRACE_INPUT} =====`);
    console.log(
      `header: seed=${trace.seed} mode=${trace.gameModeId} roster=${trace.roster.length} events=${trace.events.length}`,
    );

    const quiet = process.env.ER_REPLAY_QUIET === "1";
    const game = new GameManager(phaserGame);
    const replayOpts: ReplaySingleOpts = {};
    if (!quiet) {
      replayOpts.onProgress = line => console.log(`[replay] ${line}`);
    }
    if (Number.isFinite(TURNS_LIMIT) && TURNS_LIMIT > 0) {
      replayOpts.maxWaves = Math.floor(TURNS_LIMIT);
    }
    const result = await replaySingleTrace(game, trace, replayOpts);

    console.log(
      `\nRESULT ${JSON.stringify({
        wavesReplayed: result.wavesReplayed,
        commandsFed: result.commandsFed,
        interactionsApplied: result.interactionsApplied,
        divergences: result.divergences.length,
        finalWave: result.endState.waveIndex,
        money: result.endState.money,
      })}`,
    );
    if (result.divergences.length === 0) {
      console.log("\nREPLAYED 1:1");
    } else {
      console.log(`\nDIVERGENCE REPORT (${result.divergences.length}):\n - ${result.divergences.join("\n - ")}`);
    }
    const jsonOut = (process.env.ER_REPLAY_JSON_OUT ?? "").trim();
    if (jsonOut.length > 0) {
      writeFileSync(
        jsonOut,
        JSON.stringify(
          {
            input: TRACE_INPUT,
            seed: trace.seed,
            wavesReplayed: result.wavesReplayed,
            commandsFed: result.commandsFed,
            interactionsApplied: result.interactionsApplied,
            divergences: result.divergences,
            endState: result.endState,
            reproduced: result.divergences.length === 0,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`\nwrote result JSON -> ${jsonOut}`);
    }
    // Reaching here (no thrown fault / stall) is the pass; divergences are reported, not a hard failure
    // (a divergence can BE the reproduction of a reported bug).
    expect(Array.isArray(result.divergences)).toBe(true);
  }, 300_000);
});
