/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY RECORDER (#player-telemetry). The module-global capture gate + session state.
//
// Mirrors the replay recorder's design bars: a single `session != null` hot-path gate that every capture
// entry point reads FIRST, so a non-recording build is byte-identical + free. This module is engine-free:
// the hooks (`telemetry-hooks.ts`) do the globalScene reads + build the event, and call in here; the
// recorder just gates + hands the event to the durable {@link TelemetryQueue}. Recording being ON is the
// build-time flag decision (see `isTelemetryEnabled`), taken at the call site, not here.
// =============================================================================

import type { TelemetryQueue } from "#data/elite-redux/telemetry/telemetry-queue";
import type { TelemetryEvent, TelemetrySessionEnvelope } from "#data/elite-redux/telemetry/telemetry-schema";

let session: TelemetrySessionEnvelope | null = null;
let queue: TelemetryQueue | null = null;

/** The single hot-path gate. Every capture entry point (+ every hook) checks this before doing any work. */
export function isTelemetryRecording(): boolean {
  return session != null;
}

/** The active session envelope, or null. */
export function getTelemetrySession(): TelemetrySessionEnvelope | null {
  return session;
}

/**
 * BEGIN a telemetry session with its envelope + durable queue. Idempotent for the same sessionId (a
 * re-begin during the same session is a no-op, so a run-config re-broadcast never resets capture).
 */
export function beginTelemetrySession(envelope: TelemetrySessionEnvelope, q: TelemetryQueue): void {
  if (session != null && session.sessionId === envelope.sessionId) {
    return;
  }
  session = envelope;
  queue = q;
}

/**
 * END the session (run over / title return). Clears the in-memory gate but NOT the durable store - any
 * unflushed events stay on disk and are uploaded by the next session's recovery pass.
 */
export function endTelemetrySession(): void {
  session = null;
  queue = null;
}

/** Enqueue one already-built event. No-op unless recording. Cheap (buffer append in the queue). */
export function recordTelemetryEvent(event: TelemetryEvent): void {
  if (session == null || queue == null) {
    return;
  }
  queue.enqueue(event);
}

/** Fire the boundary-flush check for `wave` (fire-and-forget). No-op unless recording. */
export function maybeFlushTelemetry(wave: number): void {
  if (queue == null) {
    return;
  }
  void queue.maybeFlush(wave);
}

/** Session-end best-effort beacon (pagehide/visibilitychange). No-op unless recording. */
export function flushTelemetryBeacon(): void {
  if (queue == null) {
    return;
  }
  queue.flushBeacon();
}

/** Boot recovery: upload any previous session's leftover events. No-op unless a queue exists. */
export function recoverTelemetry(): Promise<void> {
  if (queue == null) {
    return Promise.resolve();
  }
  return queue.recover();
}
