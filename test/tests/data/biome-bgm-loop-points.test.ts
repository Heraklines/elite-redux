import { assignBiomeBgmLoopPoints, getBiomeBgmLoopPoint } from "#data/biome-bgm-loop-points";
import { beforeEach, describe, expect, it } from "vitest";

describe("biome BGM loop points", () => {
  beforeEach(() => assignBiomeBgmLoopPoints({}));

  it("falls back to the start of the track while optional metadata is unavailable", () => {
    expect(getBiomeBgmLoopPoint("town")).toBe(0);

    assignBiomeBgmLoopPoints(undefined);
    expect(getBiomeBgmLoopPoint("town")).toBe(0);
  });

  it("uses a valid loaded loop point and rejects malformed values", () => {
    assignBiomeBgmLoopPoints({ town: 7.288, forest: Number.NaN, cave: -1 });

    expect(getBiomeBgmLoopPoint("town")).toBe(7.288);
    expect(getBiomeBgmLoopPoint("forest")).toBe(0);
    expect(getBiomeBgmLoopPoint("cave")).toBe(0);
  });
});
