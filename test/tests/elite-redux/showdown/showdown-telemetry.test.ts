import type { ShowdownMonManifest } from "#app/data/elite-redux/showdown/showdown-team";
import { buildShowdownTelemetryPayload, toTelemetryMon } from "#app/data/elite-redux/showdown/showdown-telemetry";
import { describe, expect, it } from "vitest";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: 6,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [1, 2, 3, 4],
  item: "LEFTOVERS",
  rootSpeciesId: 4,
  erBlackShiny: false,
  baseCost: 8,
  ...over,
});

const team = () => Array.from({ length: 6 }, (_, i) => mon({ speciesId: 100 + i, rootSpeciesId: 100 + i }));

const record = () => ({
  matchId: "m1",
  hostUid: "alice",
  guestUid: "bob",
  hostTeam: team(),
  guestTeam: team(),
  seed: "seed123",
  clientVersion: "1.11.19",
  startedAt: 1000,
});

describe("toTelemetryMon", () => {
  it("projects the fingerprint fields", () => {
    expect(toTelemetryMon(mon({ speciesId: 9, item: "SHELL_BELL", shiny: true, variant: 2 }))).toEqual({
      speciesId: 9,
      formIndex: 0,
      rootSpeciesId: 4,
      item: "SHELL_BELL",
      shiny: true,
      variant: 2,
    });
  });
});

describe("buildShowdownTelemetryPayload", () => {
  it("builds the sealed payload with duration + both team sixes", () => {
    const payload = buildShowdownTelemetryPayload(
      record(),
      { winner: "host", reason: "victory", voided: false, turns: 15 },
      1000 + 42_000,
      null,
    );
    expect(payload.matchId).toBe("m1");
    expect(payload.winner).toBe("host");
    expect(payload.turns).toBe(15);
    expect(payload.durationMs).toBe(42_000);
    expect(payload.hostTeam).toHaveLength(6);
    expect(payload.guestTeam).toHaveLength(6);
    expect(payload.seed).toBe("seed123");
  });

  it("nulls the winner on a void", () => {
    const payload = buildShowdownTelemetryPayload(
      record(),
      { winner: "host", reason: "checksum", voided: true, turns: 3 },
      2000,
      null,
    );
    expect(payload.winner).toBeNull();
    expect(payload.voided).toBe(true);
  });

  it("stays well under the 64KB body cap for a 30-turn match", () => {
    const payload = buildShowdownTelemetryPayload(
      record(),
      { winner: "guest", reason: "victory", voided: false, turns: 30 },
      1000 + 90_000,
      null,
    );
    const bytes = JSON.stringify(payload).length;
    expect(bytes).toBeLessThan(64 * 1024);
  });
});
