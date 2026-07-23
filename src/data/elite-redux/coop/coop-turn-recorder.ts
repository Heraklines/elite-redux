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
  /** Explicit session+wave boundary that permits same-turn summon/TurnStart prefix preservation. */
  scope: string | undefined;
  /** Event count frozen at the Showdown pre-command boundary. */
  entryPresentationLength: number | undefined;
  events: CoopBattleEvent[];
  /** Per-turn monotonic index stamped on each event as it is recorded (the LIVE emit ordering). */
  seq: number;
  /** Recorded faint occurrences waiting for their corresponding host FaintPhase to bind. */
  faintOccurrences: Map<number, number[]>;
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
 * HOST: open a recording for `turn`. Showdown opens this at summon so entry presentation
 * is not lost before TurnStart; TurnStart calls this again for the same turn. That repeated
 * call is deliberately idempotent only when both callers provide the same explicit session+wave
 * `scope`, preserving the already-recorded prefix without conflating repeated turn numbers across
 * waves or sessions.
 * A different open turn is still replaced defensively. The per-turn live `seq` resets to 0
 * only for a genuinely new recording.
 */
export function beginCoopRecording(turn: number, scope?: string): void {
  if (recording == null) {
    coopLog("turn", `host recorder: begin turn=${turn} scope=${scope ?? "none"} (no prior open recording)`);
  } else if (scope != null && recording.scope === scope && recording.turn === turn) {
    coopLog(
      "turn",
      `host recorder: preserve recording scope=${scope} turn=${turn} events=${recording.events.length} seq=${recording.seq}`,
    );
    return;
  } else {
    // A turn should never overlap another; an open recording at begin means the prior turn never
    // finalized (endCoopRecording was missed) - its buffered events are discarded by the replace.
    coopWarn(
      "turn",
      `host recorder: begin scope=${scope ?? "none"} turn=${turn} REPLACES open scope=${recording.scope ?? "none"} turn=${recording.turn} events=${recording.events.length} (prior turn never finalized)`,
    );
  }
  recording = { turn, scope, entryPresentationLength: undefined, events: [], seq: 0, faintOccurrences: new Map() };
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
export function recordCoopEvent(event: CoopBattleEvent): number | null {
  if (recording == null) {
    return null;
  }
  const seq = recording.seq++;
  if (event.k === "faint") {
    // The existing battleEvent/turnResolution sequence is already a per-turn, authority-issued
    // occurrence identity. Queue it for the later host FaintPhase without extending the frozen P33
    // event union; the renderer derives the same value from the event's existing batch position.
    const occurrences = recording.faintOccurrences.get(event.bi) ?? [];
    occurrences.push(seq);
    recording.faintOccurrences.set(event.bi, occurrences);
  }
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
  return seq;
}

/**
 * HOST Showdown: freeze the complete summon/on-entry presentation prefix exactly once. The retained
 * wave-start carrier delivers this immutable copy before turn-1 command input; the ordinary turn batch
 * still contains the same positions and the renderer's shared watermark prevents duplicate display.
 */
export function sealCoopEntryPresentation(): CoopBattleEvent[] | null {
  if (recording == null) {
    return null;
  }
  recording.entryPresentationLength ??= recording.events.length;
  return recording.events.slice(0, recording.entryPresentationLength);
}

/**
 * Bind the next recorded faint occurrence for one battler to its real host FaintPhase. A missing
 * occurrence is normal outside authoritative recording and falls back to zero at the caller.
 */
export function consumeCoopRecordedFaintOccurrence(battlerIndex: number): number | null {
  const occurrences = recording?.faintOccurrences.get(Math.trunc(battlerIndex));
  if (occurrences == null || occurrences.length === 0) {
    return null;
  }
  const occurrence = occurrences.shift() ?? null;
  if (occurrences.length === 0) {
    recording?.faintOccurrences.delete(Math.trunc(battlerIndex));
  }
  return occurrence;
}

/**
 * HOST: take + clear the open recording. Returns the stamped turn + the ordered events
 * (empty + turn -1 when nothing was recorded, so the caller can decide whether to emit).
 */
export function endCoopRecording(): CoopRecording {
  const done = recording ?? {
    turn: -1,
    scope: undefined,
    entryPresentationLength: undefined,
    events: [],
    seq: 0,
    faintOccurrences: new Map(),
  };
  if (recording == null) {
    coopWarn("turn", "host recorder: finalize with NO open recording -> turn=-1 events=0 (caller decides not to emit)");
  } else {
    coopLog("turn", `host recorder: finalize turn=${done.turn} events=${done.events.length} seq=${done.seq}`);
  }
  recording = null;
  return done;
}
