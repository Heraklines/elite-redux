/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPLAY RECORDER (#record-replay, Phase 2 - the PRODUCTION recorder). Captures a deterministic
// {@linkcode ReplayTrace} during a LIVE run so a reported bug ships with a replayable trace (the
// duo harness / a future single-engine loader re-runs it to REPRODUCE the bug + verify a fix).
//
// DESIGN BARS (production hot path):
//  - ZERO behavior change. Every `record*` entry point starts with `if (!isReplayRecording()) return;`
//    so a non-recording run is byte-identical + free (one boolean read). The recorder is a PASSIVE
//    OBSERVER: it never mutates engine state, RNG, command resolution, or run-start.
//  - HOT-PATH CHEAP. Recording is a shallow-field copy + an array push; no allocation beyond the small
//    event object; no await; no network.
//  - RING-BUFFERED. The event log is bounded to the last {@linkcode REPLAY_RECORDER_WAVE_WINDOW} waves
//    so a bug report stays small (the header's seed + roster are kept always). Events are tagged with
//    the live wave at record time (in-memory only, OFF the wire schema) and pruned by wave window.
//  - MODE-AGNOSTIC. The recorder knows nothing about co-op; the ENABLE decision (who begins recording,
//    behind isCoop + role) lives at the call sites. The taps are universally guarded by the boolean.
//
// ENABLE POLICY (documented): begin recording at the first {@linkcode EncounterPhase} of a CO-OP run
// on the HOST (the sole authoritative engine - it sees both slots' resolved commands + every committed
// interaction). The guest never begins recording, so its taps are no-ops. The ring buffer makes
// always-on capture for co-op cheap; single-player capture is a thin future add (the same taps, begun
// from the classic launch) - left OFF for now so single-player is provably free.
// =============================================================================

import type { CoopRunConfig } from "#data/elite-redux/coop/coop-session-controller";
import {
  makeReplayTrace,
  type ReplayCheckpoint,
  type ReplayCommandEvent,
  type ReplayEndState,
  type ReplayInteractionEvent,
  type ReplayTrace,
} from "#data/elite-redux/replay-trace";
import type { GameModes } from "#enums/game-modes";
import type { PokemonData } from "#system/pokemon-data";

/**
 * Keep events from at most the last N waves so a captured trace stays small (the bug-report bound).
 *
 * Widened 6 -> 10 for the single-player add: a single-player bug report is usually filed a few waves
 * AFTER the wave that went wrong (the player finishes the wave, then reports), so a slightly deeper
 * window makes the offending wave much more likely to still be on the ring buffer + replayable. Memory
 * cost is trivial: each buffered event is a tiny shallow object (a command is ~4 numbers; an interaction
 * ~4 fields), so ~10 waves x a handful of decisions/wave is well under a kilobyte - the header's seed +
 * serialized roster dwarf it. Raise further only if reports routinely reference a wave older than this.
 */
export const REPLAY_RECORDER_WAVE_WINDOW = 10;

/** The run header captured once at run-start (seed + roster + mode + the optional co-op layer). */
export interface ReplayRecorderHeader {
  seed: string;
  gameModeId: GameModes;
  roster: PokemonData[];
  /** Present for a co-op run; absent for single-player. */
  coopRunConfig?: CoopRunConfig | undefined;
  /**
   * Live current-wave provider (reads `globalScene.currentBattle.waveIndex` at the call site). Injected
   * so the ENGINE-FREE taps (the interaction relay) can record an interaction WITHOUT the recorder
   * importing globalScene - the recorder calls this to tag the interaction's wave for ring-buffer
   * pruning. Commands carry their own wave already, so they don't need it.
   */
  currentWave: () => number;
  /**
   * OPTIONAL end-state provider (#record-replay single-player). Injected by the single-player enable so the
   * recorder can stamp a {@linkcode ReplayEndState} summary onto the emitted trace WITHOUT importing
   * globalScene: {@linkcode getReplayTrace} calls this closure (which reads globalScene at the call site) to
   * snapshot the run's CURRENT `waveIndex` / `money` / party, giving the single-engine loader a deterministic
   * end-state to assert reproduction against. Omitted for co-op (the duo harness asserts convergence instead).
   */
  endState?: () => ReplayEndState;
}

/** A buffered event tagged with the live wave (for ring-buffer pruning; the wave is dropped on emit). */
interface BufferedEvent {
  wave: number;
  event: ReplayCommandEvent | ReplayInteractionEvent;
}

/** Module-global recorder state. `null` header == not recording (the single hot-path gate). */
let header: ReplayRecorderHeader | null = null;
let buffer: BufferedEvent[] = [];
/** The highest wave seen, so pruning keeps the last REPLAY_RECORDER_WAVE_WINDOW waves. */
let highestWave = 0;
/**
 * wave -> the session-save-grade CHECKPOINT captured at the START of that wave (#record-replay checkpoint).
 * One entry per wave boundary; pruned to the same window as the event buffer so it never grows unbounded.
 * At emit the checkpoint for the window-START wave is stamped onto the trace, so a loader can boot from the
 * run's ACTUAL state at the oldest retained wave (not the original header roster) and replay events forward.
 */
let checkpoints = new Map<number, ReplayCheckpoint>();

/** Whether a replay trace is currently being recorded (the hot-path gate every `record*` reads first). */
export function isReplayRecording(): boolean {
  return header != null;
}

/**
 * BEGIN recording a run's replay trace (call once per run, at run-start, where seed + roster are
 * established). Idempotent for the SAME seed: a re-call with the same seed (e.g. a run-config self-heal
 * re-broadcast) is a no-op so the header + events are not reset mid-run. A call with a DIFFERENT seed
 * starts a fresh recording (a new run). The ENABLE gate (isCoop + role==="host") lives at the call site;
 * this only records what it is handed.
 */
export function beginReplayRecording(h: ReplayRecorderHeader): void {
  if (header != null && header.seed === h.seed) {
    return; // same run already recording - do not reset (idempotent re-call)
  }
  header = h;
  buffer = [];
  highestWave = 0;
  checkpoints = new Map();
}

/** STOP recording + drop the buffered trace (call on run end / new run / title return). */
export function clearReplayRecording(): void {
  header = null;
  buffer = [];
  highestWave = 0;
  checkpoints = new Map();
}

/** Drop buffered events + checkpoints older than the last {@linkcode REPLAY_RECORDER_WAVE_WINDOW} waves. */
function pruneOldWaves(): void {
  const cutoff = highestWave - REPLAY_RECORDER_WAVE_WINDOW + 1;
  if (cutoff <= 0) {
    return;
  }
  buffer = buffer.filter(b => b.wave >= cutoff);
  for (const wave of checkpoints.keys()) {
    if (wave < cutoff) {
      checkpoints.delete(wave);
    }
  }
}

/**
 * RECORD a session-save-grade CHECKPOINT for the START of `cp.wave` (#record-replay checkpoint). No-op
 * unless recording. Called ONCE per wave boundary (from the EncounterPhase tap); idempotent per wave (a
 * re-call for a wave already captured is ignored, so it never overwrites the true window-start snapshot).
 * The checkpoint is built by the caller (which reads globalScene) so the recorder stays engine-free; this
 * only stores + prunes it to the ring-buffer window.
 */
export function recordReplayCheckpoint(cp: ReplayCheckpoint): void {
  if (header == null) {
    return;
  }
  if (cp.wave > highestWave) {
    highestWave = cp.wave;
  }
  if (!checkpoints.has(cp.wave)) {
    checkpoints.set(cp.wave, cp);
  }
  pruneOldWaves();
}

/**
 * The checkpoint to boot a replay from: the one captured at the WINDOW-START wave (the oldest wave that
 * still has retained events, or the highest wave when the buffer is empty). Picks the checkpoint whose
 * wave is the greatest that is still <= the window start, so a boot restores the state that PRECEDES every
 * retained event. Returns undefined when no checkpoint was captured (a mid-flow recording start).
 */
function windowStartCheckpoint(): ReplayCheckpoint | undefined {
  if (checkpoints.size === 0) {
    return;
  }
  const windowStart = buffer.length > 0 ? Math.min(...buffer.map(b => b.wave)) : highestWave;
  let best: ReplayCheckpoint | undefined;
  let bestWave = -1;
  for (const [wave, cp] of checkpoints) {
    if (wave <= windowStart && wave > bestWave) {
      bestWave = wave;
      best = cp;
    }
  }
  return best;
}

/**
 * RECORD one battle command for `wave`/`turn`/`slotFieldIndex` (#record-replay). No-op unless recording.
 * The caller passes the RESOLVED command (the same one the engine committed) as a {@linkcode
 * ReplayCommandEvent}; this only buffers + prunes. Shallow + synchronous.
 */
export function recordReplayCommand(event: ReplayCommandEvent): void {
  if (header == null) {
    return;
  }
  if (event.wave > highestWave) {
    highestWave = event.wave;
  }
  buffer.push({ wave: event.wave, event });
  pruneOldWaves();
}

/**
 * RECORD one interaction pick (reward / ME option / leave) (#record-replay). No-op unless recording.
 * The interaction event carries `seq`/`kind`/`choice`/`data` (the wire shape); the live wave (read via
 * the header's injected `currentWave` provider) tags it for ring-buffer pruning ONLY (it is NOT on the
 * wire schema). Engine-free for the relay taps. Shallow + synchronous.
 */
export function recordReplayInteraction(event: ReplayInteractionEvent): void {
  if (header == null) {
    return;
  }
  const wave = header.currentWave();
  if (wave > highestWave) {
    highestWave = wave;
  }
  buffer.push({ wave, event });
  pruneOldWaves();
}

/**
 * Build the captured {@linkcode ReplayTrace} from the live recording, or `null` when not recording.
 * Strips the in-memory wave tags so the emitted events are exactly the wire schema. Used by the
 * bug-report attach (serialize the result) + tests (round-trip it back through the loader).
 */
export function getReplayTrace(): ReplayTrace | null {
  if (header == null) {
    return null;
  }
  // Stamp the OPTIONAL end-state summary from the injected provider (single-player), guarded so a provider
  // failure never breaks the trace emit (the report still ships, just without an end-state to assert on).
  let endState: ReplayEndState | undefined;
  if (header.endState != null) {
    try {
      endState = header.endState();
    } catch {
      endState = undefined;
    }
  }
  const checkpoint = windowStartCheckpoint();
  return makeReplayTrace({
    seed: header.seed,
    gameModeId: header.gameModeId,
    roster: header.roster,
    events: buffer.map(b => b.event),
    ...(header.coopRunConfig == null ? {} : { coopRunConfig: header.coopRunConfig }),
    ...(endState == null ? {} : { endState }),
    ...(checkpoint == null ? {} : { checkpoint }),
  });
}
