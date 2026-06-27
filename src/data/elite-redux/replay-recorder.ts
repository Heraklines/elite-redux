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
  type ReplayCommandEvent,
  type ReplayInteractionEvent,
  type ReplayTrace,
} from "#data/elite-redux/replay-trace";
import type { GameModes } from "#enums/game-modes";
import type { PokemonData } from "#system/pokemon-data";

/** Keep events from at most the last N waves so a captured trace stays small (the bug-report bound). */
export const REPLAY_RECORDER_WAVE_WINDOW = 6;

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
}

/** STOP recording + drop the buffered trace (call on run end / new run / title return). */
export function clearReplayRecording(): void {
  header = null;
  buffer = [];
  highestWave = 0;
}

/** Drop buffered events older than the last {@linkcode REPLAY_RECORDER_WAVE_WINDOW} waves. */
function pruneOldWaves(): void {
  const cutoff = highestWave - REPLAY_RECORDER_WAVE_WINDOW + 1;
  if (cutoff <= 0) {
    return;
  }
  buffer = buffer.filter(b => b.wave >= cutoff);
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
  return makeReplayTrace({
    seed: header.seed,
    gameModeId: header.gameModeId,
    roster: header.roster,
    events: buffer.map(b => b.event),
    ...(header.coopRunConfig == null ? {} : { coopRunConfig: header.coopRunConfig }),
  });
}
