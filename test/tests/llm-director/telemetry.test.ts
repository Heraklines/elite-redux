import { clearTelemetry, getTelemetrySnapshot, recordTelemetry } from "#system/llm-director/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("telemetry ring buffer", () => {
  beforeEach(() => clearTelemetry());
  afterEach(() => clearTelemetry());

  it("records appended entries", () => {
    recordTelemetry({
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 3,
      status: "ok",
      timestampMs: 100,
    });
    expect(getTelemetrySnapshot()).toHaveLength(1);
  });

  it("caps at the ring limit (drops oldest)", () => {
    for (let i = 0; i < 50; i++) {
      recordTelemetry({
        model: `m${i}`,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "ok",
        timestampMs: i,
      });
    }
    const snap = getTelemetrySnapshot();
    expect(snap.length).toBeLessThanOrEqual(25);
    // Oldest entries should have been dropped — the first surviving entry's
    // timestampMs is greater than zero.
    expect(snap[0].timestampMs).toBeGreaterThan(0);
  });

  it("snapshot is detached from the buffer (writes don't mutate prior snapshots)", () => {
    recordTelemetry({
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "ok",
      timestampMs: 1,
    });
    const before = getTelemetrySnapshot();
    recordTelemetry({
      model: "m2",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "ok",
      timestampMs: 2,
    });
    expect(before).toHaveLength(1);
  });
});
