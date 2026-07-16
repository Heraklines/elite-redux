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
//   - CoopTurnCommitPhase runs after TurnEndPhase's delayed child mutations, calls
//     `endCoopRecording()`, and streams the settled carrier via the battle streamer.
//
// MVP scope: only `message` events are recorded (narration). Correctness ("same moves,
// same damage, same mon faints") comes from the streamed CHECKPOINT, not per-move events;
// the richer per-move/hp/faint animation events are a clean follow-on that populates the
// already-declared CoopBattleEvent kinds without changing this model.
// =============================================================================

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";

/** The open recording: the turn number stamped at start + the ordered events + the per-turn live seq. */
interface CoopRecording {
  turn: number;
  events: CoopBattleEvent[];
  /** Per-turn monotonic index stamped on each event as it is recorded (the LIVE emit ordering). */
  seq: number;
}

let recording: CoopRecording | null = null;

/**
 * Co-op host MESSAGE-RECORDING SUPPRESSION (#691, host-language leak). The guest REGENERATES the two
 * dominant battle lines ("X used Y!" + "X fainted!") in its OWN language from the structured `moveUsed`
 * / `faint` events; so the host must NOT also stream the host-language `message` line for those, or the
 * guest would double-render (host-language + guest-language). When this flag is set, `recordCoopMessage`
 * is a no-op BEFORE building the event (so `recording.seq` is NOT advanced for a suppressed line - the
 * seq==batch-index invariant the merge in coop-replay-turn-phase.ts relies on is preserved). The host
 * still SHOWS its own message locally; suppression only stops RECORDING/streaming it. Inert outside a
 * recording (solo / non-host) and never touches any non-`message` event.
 */
let suppressMessageRecording = false;

/**
 * HOST: run `fn` with `message`-event RECORDING suppressed (the queued/shown message is unaffected; only
 * the recorder tap is gated). try/finally restores the prior flag even if `fn` throws, so a throwing
 * narrate can never leave recording permanently suppressed. Reentrant-safe (restores the PREVIOUS value,
 * not a hardcoded false).
 */
export function withCoopMessageRecordingSuppressed<T>(fn: () => T): T {
  const prev = suppressMessageRecording;
  suppressMessageRecording = true;
  try {
    return fn();
  } finally {
    suppressMessageRecording = prev;
  }
}

/**
 * HOST live-event emitter (#633, animation layer LIVE): a callback the runtime registers so each event
 * is streamed the INSTANT it is recorded (per-turn monotonic `seq`), not only batched at turn-end. Kept
 * as an injected hook so this recorder stays engine-free (it imports only the transport TYPE); the
 * runtime gates the actual send on host + authoritative role. Null (the default) = no live emit, so the
 * recorder behaves exactly as before (Phase 1: batch the events, emit at turn-end). Cleared on teardown.
 */
type CoopLiveEmitter = (turn: number, seq: number, event: CoopBattleEvent) => void;
let liveEmitter: CoopLiveEmitter | null = null;

/** HOST: register (or clear with null) the live-event emitter the runtime wires to the battle stream. */
export function setCoopLiveEmitter(emitter: CoopLiveEmitter | null): void {
  coopLog(
    "turn",
    `host recorder: ${emitter == null ? "CLEAR (null-out)" : "REGISTER"} live emitter (was=${liveEmitter != null})`,
  );
  liveEmitter = emitter;
}

/**
 * HOST: open a recording for `turn` (stamped now, at TurnStart). A recording already
 * open is replaced (defensive - a turn never overlaps another). No-op semantics are the
 * caller's job (only the host, in a live co-op run, begins recording). The per-turn live
 * `seq` resets to 0 so each turn's events number from the start.
 */
export function beginCoopRecording(turn: number): void {
  if (recording == null) {
    coopLog("turn", `host recorder: begin turn=${turn} (no prior open recording)`);
  } else {
    // A turn should never overlap another; an open recording at begin means the prior turn never
    // finalized (endCoopRecording was missed) - its buffered events are discarded by the replace.
    coopWarn(
      "turn",
      `host recorder: begin turn=${turn} REPLACES open recording turn=${recording.turn} events=${recording.events.length} (prior turn never finalized)`,
    );
  }
  recording = { turn, events: [], seq: 0 };
}

/** Whether a recording is currently open (the queueMessage tap checks this - inert otherwise). */
export function isCoopRecording(): boolean {
  return recording != null;
}

/**
 * HOST: record one narration line as a `message` event (no-op when not recording). When message
 * recording is SUPPRESSED (#691, inside {@linkcode withCoopMessageRecordingSuppressed}), return BEFORE
 * building the event so `recording.seq` is not advanced for the skipped line - keeping the seq==batch-index
 * invariant intact. The guest regenerates that line in its own language from the structured event instead.
 */
export function recordCoopMessage(text: string): void {
  if (suppressMessageRecording) {
    return;
  }
  recordCoopEvent({ k: "message", text });
}

/**
 * HOST: record an arbitrary ordered event (no-op when not recording). Buffers it into the turn
 * recording (the turn-end `turnResolution` batch) AND emits it LIVE with a per-turn monotonic `seq`
 * (#633, animation layer) so the guest can watch the fight unfold with minimal lag. The live emit is
 * a best-effort cosmetic stream; the turn-end checkpoint stays the source of truth, so a guarded emit
 * failure never breaks the host's turn. INVARIANT: seq N == the index of this event in the batch (one
 * seq stamped per recorded event), so the guest de-dupes the batch against the live seqs exactly-once.
 */
export function recordCoopEvent(event: CoopBattleEvent): void {
  if (recording == null) {
    return;
  }
  const seq = recording.seq++;
  recording.events.push(event);
  // HOT PATH (per recorded battle event): build the trace string only when debug is on.
  if (isCoopDebug()) {
    coopLog(
      "turn",
      `host recorder: append turn=${recording.turn} seq=${seq} k=${event.k} total=${recording.events.length} live=${liveEmitter != null}`,
    );
  }
  if (liveEmitter != null) {
    try {
      liveEmitter(recording.turn, seq, event);
    } catch {
      // a live-emit failure must never break the host's turn - the turn-end batch + checkpoint still go
      coopWarn(
        "turn",
        `host recorder: live emit threw turn=${recording.turn} seq=${seq} k=${event.k} (handled, batch still sent)`,
      );
    }
  }
}

/**
 * HOST: take + clear the open recording. Returns the stamped turn + the ordered events
 * (empty + turn -1 when nothing was recorded, so the caller can decide whether to emit).
 */
export function endCoopRecording(): CoopRecording {
  const done = recording ?? { turn: -1, events: [], seq: 0 };
  if (recording == null) {
    coopWarn("turn", "host recorder: finalize with NO open recording -> turn=-1 events=0 (caller decides not to emit)");
  } else {
    coopLog("turn", `host recorder: finalize turn=${done.turn} events=${done.events.length} seq=${done.seq}`);
  }
  recording = null;
  return done;
}
