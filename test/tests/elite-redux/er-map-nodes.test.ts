import {
  addTreasureFragments,
  consumeMapTravelTarget,
  consumeTreasureFragmentsForReward,
  getRevealedMapNodes,
  getTreasureFragments,
  hasRevealedMapNodes,
  resetErMapNodes,
  revealMapNodes,
  setMapTravelTarget,
  TREASURE_FRAGMENTS_FOR_REWARD,
} from "#data/elite-redux/er-map-nodes";
import { BiomeId } from "#enums/biome-id";
import { beforeEach, describe, expect, it } from "vitest";

describe("ER #486 - Phase D map-node substrate", () => {
  beforeEach(() => {
    resetErMapNodes();
  });

  it("starts empty", () => {
    expect(hasRevealedMapNodes()).toBe(false);
    expect(getRevealedMapNodes()).toHaveLength(0);
    expect(getTreasureFragments()).toBe(0);
    expect(consumeMapTravelTarget()).toBeNull();
  });

  it("reveals nodes and de-duplicates by biome + label", () => {
    const added1 = revealMapNodes([
      { biome: BiomeId.SEA, label: "Distant Isle", kind: "biome" },
      { biome: BiomeId.LAKE, label: "Quiet Lake", kind: "biome" },
    ]);
    expect(added1).toBe(2);
    expect(getRevealedMapNodes()).toHaveLength(2);
    expect(hasRevealedMapNodes()).toBe(true);

    // Re-revealing the same nodes adds nothing; a genuinely new one adds 1.
    const added2 = revealMapNodes([
      { biome: BiomeId.SEA, label: "Distant Isle", kind: "biome" },
      { biome: BiomeId.SPACE, label: "The Observatory", kind: "landmark" },
    ]);
    expect(added2).toBe(1);
    expect(getRevealedMapNodes()).toHaveLength(3);
  });

  it("stores and consumes a single travel target", () => {
    setMapTravelTarget(BiomeId.SPACE);
    expect(consumeMapTravelTarget()).toBe(BiomeId.SPACE);
    // Consuming clears it.
    expect(consumeMapTravelTarget()).toBeNull();
  });

  it("accumulates treasure fragments, clamps at 0, and pays out at the threshold", () => {
    expect(addTreasureFragments(1)).toBe(1);
    expect(addTreasureFragments(1)).toBe(2);
    // Not enough yet.
    expect(consumeTreasureFragmentsForReward()).toBe(false);
    expect(getTreasureFragments()).toBe(2);

    addTreasureFragments(1);
    expect(getTreasureFragments()).toBe(TREASURE_FRAGMENTS_FOR_REWARD);
    // Now it pays out and spends exactly the threshold.
    expect(consumeTreasureFragmentsForReward()).toBe(true);
    expect(getTreasureFragments()).toBe(0);

    // Spending below 0 is clamped.
    expect(addTreasureFragments(-5)).toBe(0);
  });

  it("reset clears nodes, travel target, and fragments", () => {
    revealMapNodes([{ biome: BiomeId.CAVE, label: "Deep Cave", kind: "biome" }]);
    setMapTravelTarget(BiomeId.CAVE);
    addTreasureFragments(2);

    resetErMapNodes();

    expect(getRevealedMapNodes()).toHaveLength(0);
    expect(getTreasureFragments()).toBe(0);
    expect(consumeMapTravelTarget()).toBeNull();
  });
});
