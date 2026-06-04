import type { TelemetryEntry } from "#system/llm-director/director-state";

/**
 * Tiny in-memory ring buffer for the last N LLM calls. Written to from
 * `DirectorClient.complete` (success path) and read by the debug overlay
 * (Task 23). Persisted state lives on `LLMDirectorState.latencyTelemetry`;
 * this module is the live append-only mirror so the overlay can render
 * without round-tripping through the save data.
 */

const RING_LIMIT = 25;

const buffer: TelemetryEntry[] = [];

export function recordTelemetry(entry: TelemetryEntry): void {
  buffer.push(entry);
  if (buffer.length > RING_LIMIT) {
    buffer.splice(0, buffer.length - RING_LIMIT);
  }
}

export function getTelemetrySnapshot(): readonly TelemetryEntry[] {
  return buffer.slice();
}

export function clearTelemetry(): void {
  buffer.length = 0;
}
