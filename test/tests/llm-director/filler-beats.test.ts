import { validateBeat } from "#data/llm-director/beat-schema";
import { FILLER_BEATS, pickFillerBeat } from "#data/llm-director/filler-beats";
import { describe, expect, it } from "vitest";

describe("FILLER_BEATS", () => {
  it("contains at least 5 prefab beats", () => {
    expect(FILLER_BEATS.length).toBeGreaterThanOrEqual(5);
  });

  it("each prefab passes the schema validator", () => {
    for (const beat of FILLER_BEATS) {
      const r = validateBeat(beat);
      expect(r.ok, `beat ${beat.beatId} failed: ${r.ok ? "" : r.error}`).toBe(true);
    }
  });

  it("all prefab beat IDs are unique", () => {
    const ids = new Set(FILLER_BEATS.map(b => b.beatId));
    expect(ids.size).toBe(FILLER_BEATS.length);
  });
});

describe("pickFillerBeat", () => {
  it("returns one of the prefab beats", () => {
    const picked = pickFillerBeat();
    expect(FILLER_BEATS).toContain(picked);
  });
});
