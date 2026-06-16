import {
  addTreasureFragments,
  consumeMapTravelTarget,
  consumeTreasureFragmentsForReward,
  getErMapSaveData,
  getRevealedMapNodes,
  getTreasureFragments,
  hasRevealedMapNodes,
  resetErMapNodes,
  restoreErMapState,
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

  it("round-trips through the session save snapshot (#486 increment 2)", () => {
    revealMapNodes([
      { biome: BiomeId.SEA, label: "Distant Isle", kind: "biome" },
      { biome: BiomeId.SPACE, label: "The Observatory", kind: "landmark" },
    ]);
    setMapTravelTarget(BiomeId.SEA);
    addTreasureFragments(2);

    const saved = getErMapSaveData();
    // Snapshot must be a plain detached copy, not a live reference.
    expect(saved.nodes).toHaveLength(2);
    expect(saved.travelTarget).toBe(BiomeId.SEA);
    expect(saved.fragments).toBe(2);

    // A fresh run wipes everything...
    resetErMapNodes();
    expect(hasRevealedMapNodes()).toBe(false);

    // ...and loading the save brings it all back.
    restoreErMapState(saved);
    expect(getRevealedMapNodes()).toHaveLength(2);
    expect(getTreasureFragments()).toBe(2);
    // Travel target survives the round-trip (consume returns it once).
    expect(consumeMapTravelTarget()).toBe(BiomeId.SEA);
  });

  it("restore tolerates undefined and malformed payloads", () => {
    revealMapNodes([{ biome: BiomeId.CAVE, label: "Deep Cave", kind: "biome" }]);
    // Undefined (a legacy save) restores a clean, empty map.
    restoreErMapState(undefined);
    expect(hasRevealedMapNodes()).toBe(false);
    expect(getTreasureFragments()).toBe(0);

    // A malformed payload drops unusable entries instead of throwing.
    restoreErMapState({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed test payload
      nodes: [{ biome: BiomeId.LAKE, label: "Quiet Lake", kind: "biome" }, null as any, { label: "x" } as any],
      travelTarget: null,
      fragments: -3,
    });
    expect(getRevealedMapNodes()).toHaveLength(1);
    expect(getTreasureFragments()).toBe(0);
  });
});
