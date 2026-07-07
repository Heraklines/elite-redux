import { describe, expect, it } from "vitest";
// PURE worker-domain module (zero CF deps) imported by relative path — the D1 worker-test pattern.
import { type TelemetryMon, validateTelemetryPayload } from "../../../../workers/er-telemetry/src/telemetry-ingest";

const mon = (over: Partial<TelemetryMon> = {}): TelemetryMon => ({
  speciesId: 6,
  formIndex: 0,
  rootSpeciesId: 4,
  item: "LEFTOVERS",
  shiny: false,
  variant: 0,
  ...over,
});

const team = () => Array.from({ length: 6 }, (_, i) => mon({ speciesId: 100 + i }));

const validPayload = () => ({
  matchId: "m1",
  hostUid: "alice",
  guestUid: "bob",
  winner: "host",
  reason: "victory",
  turns: 12,
  durationMs: 45_000,
  createdAt: 1700,
  clientVersion: "1.11.19",
  seed: "abcdef",
  hostTeam: team(),
  guestTeam: team(),
});

describe("validateTelemetryPayload", () => {
  it("accepts a well-formed payload from a participant", () => {
    const r = validateTelemetryPayload(validPayload(), "alice");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.hostUid).toBe("alice");
      expect(r.row.winner).toBe("host");
      expect(r.row.turns).toBe(12);
      expect(JSON.parse(r.row.summaryJson).clientVersion).toBe("1.11.19");
    }
  });

  it("accepts a friendly (null matchId) + void (null winner)", () => {
    const r = validateTelemetryPayload({ ...validPayload(), matchId: null, winner: null }, "bob");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.matchId).toBeNull();
      expect(r.row.winner).toBeNull();
    }
  });

  it("rejects a poster who is not a participant", () => {
    const r = validateTelemetryPayload(validPayload(), "stranger");
    expect(r.ok).toBe(false);
  });

  it("rejects malformed teams / bad fields", () => {
    expect(validateTelemetryPayload({ ...validPayload(), hostTeam: [] }, "alice").ok).toBe(false);
    expect(validateTelemetryPayload({ ...validPayload(), turns: -1 }, "alice").ok).toBe(false);
    expect(validateTelemetryPayload({ ...validPayload(), winner: "nobody" }, "alice").ok).toBe(false);
    expect(validateTelemetryPayload({ ...validPayload(), hostUid: "" }, "alice").ok).toBe(false);
    expect(validateTelemetryPayload(null, "alice").ok).toBe(false);
  });
});
