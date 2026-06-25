/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op host TURN RECORDER (#633, TRACK-2 Phase B). The host is the sole battle
// engine; as it resolves a turn it RECORDS the ordered visible events (the battle-log
// narration) so it can STREAM them to the guest, which renders them and computes
// nothing. This module is the tiny, engine-free recorder buffer:
//
//   - The host's TurnStartPhase calls `beginCoopRecording(turn)` (stamping the turn
//     NUMBER at start, so the later emit uses the same number even though TurnEndPhase
//     increments `currentBattle.turn` before the host emits - avoiding an off-by-one
//     desync between the host's emit and the guest's await).
//   - The phase manager's `queueMessage` tap calls `recordCoopMessage(text)` while a
//     recording is open, capturing each narration line in resolution order.
//   - The host's TurnEndPhase calls `endCoopRecording()` to take + clear the buffer and
//     stream it via the battle streamer.
//
// MVP scope: only `message` events are recorded (narration). Correctness ("same moves,
// same damage, same mon faints") comes from the streamed CHECKPOINT, not per-move events;
// the richer per-move/hp/faint animation events are a clean follow-on that populates the
// already-declared CoopBattleEvent kinds without changing this model.
// =============================================================================

import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";

/** The open recording: the turn number stamped at start + the ordered events so far. */
interface CoopRecording {
  turn: number;
  events: CoopBattleEvent[];
}

let recording: CoopRecording | null = null;

/**
 * HOST: open a recording for `turn` (stamped now, at TurnStart). A recording already
 * open is replaced (defensive - a turn never overlaps another). No-op semantics are the
 * caller's job (only the host, in a live co-op run, begins recording).
 */
export function beginCoopRecording(turn: number): void {
  recording = { turn, events: [] };
}

/** Whether a recording is currently open (the queueMessage tap checks this - inert otherwise). */
export function isCoopRecording(): boolean {
  return recording != null;
}

/** HOST: record one narration line as a `message` event (no-op when not recording). */
export function recordCoopMessage(text: string): void {
  recording?.events.push({ k: "message", text });
}

/** HOST: record an arbitrary ordered event (no-op when not recording). For richer kinds. */
export function recordCoopEvent(event: CoopBattleEvent): void {
  recording?.events.push(event);
}

/**
 * HOST: take + clear the open recording. Returns the stamped turn + the ordered events
 * (empty + turn -1 when nothing was recorded, so the caller can decide whether to emit).
 */
export function endCoopRecording(): CoopRecording {
  const done = recording ?? { turn: -1, events: [] };
  recording = null;
  return done;
}
