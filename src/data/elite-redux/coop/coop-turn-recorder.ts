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
// The event stream now covers narration, move/HP/faint/stat/status/ability/Tera/switch,
// weather/terrain, and ordinary shared VFX presentation. Correctness still comes from the
// globally ordered authoritative state image; these events are immutable presentation cues
// and their exact renderer outcomes are proved separately by the two-browser oracle.
// =============================================================================

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopPresentationOutcome } from "#data/elite-redux/coop/coop-presentation-outcome";
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
  /**
   * `NewBattlePhase` opens before `newBattle()` so post-battle cleanup is captured at the destination
   * address. A non-battle Mystery surface has no replay pump or command seal, so those events must remain
   * unpublished until an adjacent real battle can own them durably instead of leaking as best-effort live
   * packets at an address the renderer cannot consume.
   */
  publicationDeferred: boolean;
  /** Number of prefix events already exposed to the observer/live stream. */
  publishedLength: number;
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

export interface CoopPresentationObservation {
  /** The authority assigned the immutable event, or the renderer finished its presentation subtree. */
  readonly stage: "authority-recorded" | "renderer-completed" | "renderer-skipped" | "renderer-failed";
  readonly turn: number;
  readonly seq: number;
  /** Always the authority's canonical event, before any Showdown guest-side battler-index reflection. */
  readonly event: CoopBattleEvent;
  readonly reason?: string;
  readonly actorFingerprint?: string;
}

type CoopPresentationObserver = (observation: CoopPresentationObservation) => void;
let presentationObserver: CoopPresentationObserver | null = null;

function publishRecordedEvent(active: CoopRecording, seq: number, event: CoopBattleEvent): void {
  if (presentationObserver != null) {
    try {
      presentationObserver({ stage: "authority-recorded", turn: active.turn, seq, event });
    } catch {
      // The observer is diagnostic only. The authority event and its durable batch remain valid.
      coopWarn("turn", `presentation observer threw at authority turn=${active.turn} seq=${seq} k=${event.k}`);
    }
  }
  if (liveEmitter != null) {
    try {
      liveEmitter(active.turn, seq, event);
    } catch {
      // A live-emit failure must never break the host's turn. The retained entry/batch remains authoritative.
      coopWarn(
        "turn",
        `host recorder: live emit threw turn=${active.turn} seq=${seq} k=${event.k} (handled, batch still sent)`,
      );
    }
  }
}

function publishDeferredPrefix(active: CoopRecording): void {
  while (active.publishedLength < active.events.length) {
    const seq = active.publishedLength;
    const event = active.events[seq];
    if (event == null) {
      break;
    }
    publishRecordedEvent(active, seq, event);
    active.publishedLength++;
  }
}

function adjacentRecordingScopes(source: string | undefined, destination: string | undefined): boolean {
  const parse = (scope: string | undefined): { session: string; wave: number } | null => {
    const match = scope?.match(/^(.+):(-?\d+)$/u);
    if (match == null) {
      return null;
    }
    const wave = Number(match[2]);
    return Number.isSafeInteger(wave) ? { session: match[1], wave } : null;
  };
  const from = parse(source);
  const to = parse(destination);
  return from != null && to != null && from.session === to.session && to.wave === from.wave + 1;
}

/**
 * Install a read-only presentation observer. The normal application never registers one; the exact-SHA
 * browser build uses it to prove that every authority-recorded event reaches a completed renderer phase.
 */
export function setCoopPresentationObserver(observer: CoopPresentationObserver | null): void {
  presentationObserver = observer;
}

/** Whether replay should queue completion receipts. False in staged/production builds. */
export function hasCoopPresentationObserver(): boolean {
  return presentationObserver != null;
}

/** Renderer receipt seam, called only after the event's presentation phase subtree has drained. */
export function observeCoopRenderedPresentation(turn: number, seq: number, event: CoopBattleEvent): void {
  if (presentationObserver == null) {
    return;
  }
  try {
    presentationObserver({ stage: "renderer-completed", turn, seq, event });
  } catch {
    // CI telemetry must never become a production progression dependency.
    coopWarn("turn", `presentation observer threw at renderer turn=${turn} seq=${seq} k=${event.k}`);
  }
}

/** Outcome-driven renderer evidence; a drained-but-failed phase can never report completion. */
export function observeCoopPresentationOutcome(
  turn: number,
  seq: number,
  event: CoopBattleEvent,
  outcome: CoopPresentationOutcome,
): void {
  if (presentationObserver == null) {
    return;
  }
  const stage =
    outcome.kind === "rendered"
      ? "renderer-completed"
      : outcome.kind === "intentionally-skipped"
        ? "renderer-skipped"
        : "renderer-failed";
  try {
    presentationObserver({
      stage,
      turn,
      seq,
      event,
      ...(outcome.kind === "rendered" ? {} : { reason: outcome.reason }),
      ...(outcome.actorFingerprint == null ? {} : { actorFingerprint: outcome.actorFingerprint }),
    });
  } catch {
    coopWarn("turn", `presentation observer threw at renderer turn=${turn} seq=${seq} k=${event.k}`);
  }
}

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
  recording = {
    turn,
    scope,
    entryPresentationLength: undefined,
    events: [],
    seq: 0,
    publicationDeferred: false,
    publishedLength: 0,
    faintOccurrences: new Map(),
  };
}

/**
 * HOST transition boundary: open the destination turn-one prefix without publishing it yet.
 *
 * `newBattle()` can synchronously narrate arena cleanup after it advances `currentBattle`. A real battle
 * releases this prefix as soon as its type is known. A non-battle Mystery surface deliberately leaves it
 * deferred; the next exact adjacent transition carries it forward and the next real command commit owns it.
 * Only an unpublished, unsealed, adjacent turn-one transition is eligible. An ordinary unfinished battle
 * recording therefore keeps the existing fail-closed discard behavior.
 */
export function beginCoopTransitionRecording(turn: number, scope?: string): void {
  if (recording != null && scope != null && recording.scope === scope && recording.turn === turn) {
    coopLog(
      "turn",
      `host recorder: preserve deferred transition scope=${scope} turn=${turn} events=${recording.events.length}`,
    );
    return;
  }
  const canCarryOpenTransition =
    recording != null
    && turn === 1
    && recording.turn === 1
    && recording.publicationDeferred
    && recording.publishedLength === 0
    && recording.entryPresentationLength === undefined
    && adjacentRecordingScopes(recording.scope, scope);
  const carriedEvents = canCarryOpenTransition && recording != null ? recording.events.slice() : [];
  if (recording == null) {
    coopLog("turn", `host recorder: begin deferred transition turn=${turn} scope=${scope ?? "none"}`);
  } else if (canCarryOpenTransition) {
    coopLog(
      "turn",
      `host recorder: carry ${carriedEvents.length} unpublished transition event(s) ${recording.scope} -> ${scope}`,
    );
  } else {
    coopWarn(
      "turn",
      `host recorder: deferred transition scope=${scope ?? "none"} turn=${turn} REPLACES open `
        + `scope=${recording.scope ?? "none"} turn=${recording.turn} events=${recording.events.length}`,
    );
  }
  recording = {
    turn,
    scope,
    entryPresentationLength: undefined,
    events: carriedEvents,
    seq: carriedEvents.length,
    publicationDeferred: true,
    publishedLength: 0,
    faintOccurrences: new Map(),
  };
}

/** Release the current transition prefix at the real battle address exactly once. */
export function releaseCoopTransitionPresentation(): void {
  if (recording == null || !recording.publicationDeferred) {
    return;
  }
  recording.publicationDeferred = false;
  publishDeferredPrefix(recording);
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
  if (!recording.publicationDeferred) {
    publishRecordedEvent(recording, seq, event);
    recording.publishedLength++;
  }
  return seq;
}

/**
 * HOST authority: freeze the complete summon/on-entry presentation prefix exactly once. The retained
 * wave-start carrier delivers this immutable copy before turn-1 command input; the ordinary turn batch
 * still contains the same positions and the renderer's shared watermark prevents duplicate display.
 */
export function sealCoopEntryPresentation(): CoopBattleEvent[] | null {
  if (recording == null) {
    return null;
  }
  // A command frontier is itself proof that this destination is a real battle. Publish any transition
  // prefix before constructing its immutable CONTROL_COMMIT, even if a future route forgot the eager release.
  releaseCoopTransitionPresentation();
  recording.entryPresentationLength ??= recording.events.length;
  return recording.events.slice(0, recording.entryPresentationLength);
}

/**
 * HOST replacement authority: snapshot every event recorded through the latest completed summon.
 *
 * Unlike {@link sealCoopEntryPresentation}, this deliberately does not freeze the first boundary. A
 * same-turn double or triple faint publishes one replacement commit after each summon; every later commit
 * must therefore contain the expanded cumulative prefix. The guest's shared per-turn proof watermark skips
 * the prefix already proved by an earlier replacement and renders only the new suffix.
 */
export function snapshotCoopRecordedPresentation(): CoopBattleEvent[] | null {
  return recording == null ? null : recording.events.slice();
}

export interface CoopRecordedFaintAddress {
  /** The immutable source turn stamped when the authority opened this recording. */
  readonly turn: number;
  /** The faint event's authority-issued sequence within that same turn. */
  readonly occurrence: number;
}

/**
 * Atomically bind the next recorded faint event to its real host FaintPhase. Both address fields
 * come from the same immutable recording: callers must never combine the recorded occurrence with
 * `currentBattle.turn`, which may already have advanced before delayed faint/replacement phases run.
 * A missing address is normal outside authoritative recording and falls back at the caller.
 */
export function consumeCoopRecordedFaintAddress(battlerIndex: number): CoopRecordedFaintAddress | null {
  const activeRecording = recording;
  if (activeRecording == null) {
    return null;
  }
  const normalizedBattlerIndex = Math.trunc(battlerIndex);
  const occurrences = activeRecording.faintOccurrences.get(normalizedBattlerIndex);
  if (occurrences == null || occurrences.length === 0) {
    return null;
  }
  const occurrence = occurrences.shift() ?? null;
  if (occurrences.length === 0) {
    activeRecording.faintOccurrences.delete(normalizedBattlerIndex);
  }
  return occurrence == null ? null : { turn: activeRecording.turn, occurrence };
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
    publicationDeferred: false,
    publishedLength: 0,
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
