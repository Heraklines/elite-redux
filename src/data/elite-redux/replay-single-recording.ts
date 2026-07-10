/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// SINGLE-PLAYER replay recording: enable + PASSIVE decision taps (#record-replay).
//
// The mode-agnostic recorder (`replay-recorder.ts`) knows nothing about who begins recording or which
// decisions matter - the ENABLE decision + the per-decision taps live at the call sites, in the layer
// that can read `globalScene`. The CO-OP call sites (begin on the authoritative host, tap commands +
// relayed interactions) live in `coop/coop-runtime.ts`. THIS module is the SINGLE-PLAYER twin: it begins
// recording at the first classic solo EncounterPhase and maps each non-co-op interactive decision onto a
// `ReplayInteractionEvent`, so a live single-player bug report ships with a replayable trace the
// single-engine loader (`test/tools/replay-single.test.ts`) re-drives headlessly.
//
// DESIGN BARS (identical to the co-op taps):
//  - ZERO behavior change. Every record* here is a NO-OP unless `isReplayRecording()` (a single boolean
//    read) - a non-recording run is byte-identical + free. The taps only READ engine state + push to the
//    recorder's ring buffer; they NEVER mutate the engine / RNG / command flow. Every tap fires AFTER the
//    existing behavior has applied (behavior-preserving) and is guarded, so a recorder hiccup can never
//    break a run.
//  - CO-OP EXCLUSIVE. Every record* here bails on `globalScene.gameMode.isCoop` so it can NEVER
//    double-record with the co-op relay taps (which own the co-op path). The enable also gates on classic
//    solo, so it never begins for a co-op run (the co-op host begins that one).
//
// INTERACTION COVERAGE (the audit - "tap or document each" per the run's interactive decisions):
//  - TAPPED (a distinct `kind`, applied by the loader):
//      command  (move/switch/ball/run)              command-phase.ts    -> recordSinglePlayerCommand
//      reward-shop pick / leave                     select-modifier-phase.ts (reward/skip/reroll/lock)
//      learn-move accept-slot / decline             learn-move-phase.ts (learnMove)
//      biome / World-Map pick                       select-biome-phase.ts (biome)
//      crossroads Stay/Leave                        er-crossroads-phase.ts (crossroads)
//      mystery-encounter option                     mystery-encounter-phases.ts (me)
//  - DOCUMENTED REPLAY-GAP (recorded coverage not yet added; the loader FAILS LOUDLY on an unhandled
//    kind so a gap can never silently corrupt a replay):
//      reward-shop item BUY (paid shop row) + held-item TRANSFER target menu - money/party-target
//        sub-flows; the loader would need to drive the paid-shop / transfer party UI. Reroll/lock are
//        tapped (free), transfer/buy are the gap.
//      catch keep/release/replace (party-full after a capture)              AttemptCapturePhase party UI
//      evolution CANCEL (cancellable evolutions)                            EvolutionPhase
//      egg HATCH/skip                                                       EggHatchPhase
//      TM-case move pick + party management                                 party UI flows
//    Each is a genuine interactive decision; a run that hits one records no event for it, so the loader
//    treats it as a hole (a divergence if the replay reaches that prompt). Extend the taps here + a
//    loader handler in lockstep when a report needs one of these classes.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  beginReplayRecording,
  isReplayRecording,
  recordReplayCheckpoint,
  recordReplayCommand,
  recordReplayInteraction,
} from "#data/elite-redux/replay-recorder";
import type { ReplayCheckpoint, ReplayCommandKind, ReplayEndState } from "#data/elite-redux/replay-trace";
import { Command } from "#enums/command";
import { ModifierData as PersistentModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";

/**
 * The monotonic single-player interaction counter (the `seq` of each recorded {@linkcode
 * ReplayInteractionEvent}). For single-player the owner is always local, so parity is irrelevant - `seq`
 * only needs to be monotonic within a recording so the loader can consume interactions in the trace's
 * event ORDER. Reset to 0 whenever a fresh single-player recording begins.
 */
let singlePlayerInteractionSeq = 0;

/** The seed the live single-player recording began on (so a new-run begin resets the interaction seq). */
let singlePlayerRecordingSeed: string | null = null;

/** Snapshot the run's CURRENT end state (waveIndex / money / party) for the trace's {@linkcode ReplayEndState}. */
function captureSinglePlayerEndState(): ReplayEndState {
  return {
    waveIndex: globalScene.currentBattle?.waveIndex ?? 0,
    money: globalScene.money ?? 0,
    party: globalScene.getPlayerParty().map(p => ({
      species: p.species.speciesId,
      level: p.level,
      hp: p.hp,
      maxHp: p.getMaxHp(),
    })),
  };
}

/**
 * BEGIN replay recording for THIS classic SINGLE-PLAYER run if not already recording (#record-replay).
 * Called from the first {@linkcode EncounterPhase} (where seed + the starting party are established). Hard
 * no-op unless we are in a classic SOLO run (a co-op run is begun by the co-op host's own enable; daily /
 * challenge / endless are out of scope for now). Idempotent per run (the recorder no-ops a same-seed
 * re-call), so it is safe to call once per EncounterPhase. Captures the header: seed + gameMode + the
 * serialized starting party + a live-wave provider (interaction pruning) + an end-state provider (the
 * loader's deterministic reproduction target). Best-effort + fully guarded - a capture failure never
 * breaks the encounter.
 */
export function maybeBeginSinglePlayerReplayRecording(): void {
  const gameMode = globalScene.gameMode;
  // Co-op runs are begun by the co-op host's enable (coop-runtime.maybeBeginReplayRecording); daily /
  // challenge / endless are out of scope. Only a plain classic SOLO run records here.
  if (gameMode.isCoop || !gameMode.isClassic) {
    return;
  }
  const seed = globalScene.seed;
  // Idempotent: once THIS run is recording, re-calls at each later EncounterPhase are no-ops (the seed is
  // unchanged all run). A different seed means a NEW run, so reset the single-player interaction counter.
  if (isReplayRecording() && singlePlayerRecordingSeed === seed) {
    return;
  }
  try {
    singlePlayerRecordingSeed = seed;
    singlePlayerInteractionSeq = 0;
    beginReplayRecording({
      seed,
      gameModeId: gameMode.modeId,
      roster: globalScene.getPlayerParty().map(p => new PokemonData(p)),
      currentWave: () => globalScene.currentBattle?.waveIndex ?? 0,
      endState: captureSinglePlayerEndState,
    });
  } catch {
    /* a header/roster serialize failure must never break the encounter (recording just stays off) */
  }
}

/**
 * Snapshot the run's CURRENT state as a session-save-grade {@linkcode ReplayCheckpoint} (#record-replay
 * checkpoint). MODE-AGNOSTIC: it reads only `globalScene`, so it serves BOTH the co-op host and single-
 * player recording (the recorder itself stays engine-free). Mirrors `game-data.ts` `getSessionSaveData`'s
 * player-side fields (party + persistent modifiers + money + pokeballs + wave/seed cursor), so a loader can
 * boot the run from this point. Cheap enough to call once per wave boundary (the perf guard: wave-boundary-
 * only), which is where the window slides.
 */
export function captureReplayCheckpoint(): ReplayCheckpoint {
  return {
    wave: globalScene.currentBattle?.waveIndex ?? 0,
    seed: globalScene.seed,
    party: globalScene.getPlayerParty().map(p => new PokemonData(p)),
    modifiers: globalScene.findModifiers(() => true).map(m => new PersistentModifierData(m, true)),
    money: Math.floor(globalScene.money ?? 0),
    pokeballCounts: { ...globalScene.pokeballCounts },
  };
}

/**
 * CAPTURE a window-start checkpoint at THIS wave boundary if a recording is live (#record-replay checkpoint).
 * MODE-AGNOSTIC - called once from the {@linkcode EncounterPhase} for BOTH co-op (host-only, since only the
 * host records) and single-player. No-op unless recording (a single boolean read), and the recorder ignores
 * a re-capture for a wave it already has, so this only builds the snapshot once per new wave as the window
 * slides. Fully guarded: a capture failure never breaks the encounter (the recording just keeps its prior
 * checkpoint / boots from the header roster).
 */
export function maybeCaptureReplayCheckpoint(): void {
  if (!isReplayRecording()) {
    return;
  }
  try {
    recordReplayCheckpoint(captureReplayCheckpoint());
  } catch {
    /* a checkpoint capture must never break the encounter (recording keeps its prior state) */
  }
}

/** Map a committed player {@linkcode Command} + cursor to a replay {@linkcode ReplayCommandKind}. */
function playerCommandToReplayKind(
  command: Command,
  cursor: number,
  moveTarget: number | undefined,
): ReplayCommandKind {
  switch (command) {
    case Command.BALL:
      return { kind: "ball", ballIndex: cursor };
    case Command.RUN:
      return { kind: "run" };
    case Command.POKEMON:
      return { kind: "switch", partyIndex: cursor };
    default:
      // FIGHT / TERA: cursor is the move slot; carry the resolved target if one is already committed.
      return moveTarget == null
        ? { kind: "move", moveIndex: cursor }
        : { kind: "move", moveIndex: cursor, target: moveTarget };
  }
}

/**
 * RECORD one committed player COMMAND for `fieldIndex` on the current wave/turn (#record-replay). Called
 * from the command-phase AFTER the turn command has been committed (behavior-preserving). No-op unless
 * recording, and a hard no-op in co-op (the co-op relay taps own that path - never double-record). Reads
 * the resolved FIGHT target off the just-committed turn command; shallow + synchronous + guarded.
 */
export function recordSinglePlayerCommand(fieldIndex: number, command: Command, cursor: number): void {
  if (!isReplayRecording() || globalScene.gameMode.isCoop) {
    return;
  }
  try {
    // Only FIGHT/TERA/BALL/POKEMON/RUN are replay commands; SHIFT/RESET are not (triple-shift / dev reset).
    if (
      command !== Command.FIGHT
      && command !== Command.TERA
      && command !== Command.BALL
      && command !== Command.POKEMON
      && command !== Command.RUN
    ) {
      return;
    }
    const committed = globalScene.currentBattle?.turnCommands?.[fieldIndex];
    const moveTarget =
      (command === Command.FIGHT || command === Command.TERA)
      && committed?.move?.targets != null
      && committed.move.targets.length > 0
        ? committed.move.targets[0]
        : undefined;
    recordReplayCommand({
      type: "command",
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      turn: globalScene.currentBattle?.turn ?? 0,
      slotFieldIndex: fieldIndex,
      command: playerCommandToReplayKind(command, cursor, moveTarget),
    });
  } catch {
    /* a command tap must never break the command flow */
  }
}

/**
 * RECORD one committed single-player interactive DECISION as a {@linkcode ReplayInteractionEvent}
 * (#record-replay). Called from each decision phase AFTER the decision has applied (behavior-preserving).
 * `kind` is the routing tag ("reward" / "skip" / "learnMove" / "biome" / "crossroads" / "me" / ...);
 * `choice` is the chosen index or sentinel; `data` is any extra payload. No-op unless recording, and a
 * hard no-op in co-op (the co-op relay owns that path). The `seq` is the monotonic single-player counter
 * (owner parity is irrelevant solo). Guarded so a tap can never break the decision flow.
 */
export function recordSinglePlayerInteraction(kind: string, choice: number, data?: number[]): void {
  if (!isReplayRecording() || globalScene.gameMode.isCoop) {
    return;
  }
  try {
    recordReplayInteraction({
      type: "interaction",
      seq: singlePlayerInteractionSeq++,
      kind,
      choice,
      ...(data === undefined ? {} : { data: [...data] }),
    });
  } catch {
    /* an interaction tap must never break the decision flow */
  }
}
