import {
  MOODY_RUNTIME_BLOCKED_IDS,
  MOODY_RUNTIME_EFFECT_BY_ID,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import { describe, expect, it } from "vitest";

describe("Moody Set Collector release regression", () => {
  it("keeps Set Collector available in both catalogue and runtime eligibility", () => {
    expect(MOODY_BOON_BY_ID.get("set-collector")?.implementationStatus).not.toBe("blocked");
    expect(MOODY_RUNTIME_EFFECT_BY_ID.get("set-collector")?.status).toBe("ready");
    expect(MOODY_RUNTIME_BLOCKED_IDS).not.toContain("set-collector");
  });

  it("activates the selected rank-two set with one fewer required piece", () => {
    const result = resolveMoodyRuntimeEffect("set-collector", "rank-two", {
      kind: "item-set-query",
      seed: 1,
      data: {
        ownedDistinctItemIds: ["QUICK_CLAW", "KINGS_ROCK", "WIDE_LENS"],
        chosenSetId: "tacticians-tools",
      },
    });

    expect(result.commands).toContainEqual({
      kind: "apply-item-set-bonuses",
      data: {
        activeSets: [
          expect.objectContaining({
            setId: "tacticians-tools",
            pieceCount: 3,
            tier: 3,
            accuracyMultiplier: 1.1,
          }),
        ],
      },
    });
  });
});
