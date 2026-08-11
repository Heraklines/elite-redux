import {
  MOODY_RUNTIME_BLOCKED_IDS,
  MOODY_RUNTIME_EFFECT_BY_ID,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import { describe, expect, it } from "vitest";

describe("Moody release blocker: Set Collector remains content-blocked", () => {
  it("marks Set Collector blocked in both catalogue and runtime eligibility", () => {
    expect(MOODY_BOON_BY_ID.get("set-collector")?.implementationStatus).toBe("blocked");
    expect(MOODY_RUNTIME_EFFECT_BY_ID.get("set-collector")?.status).toBe("blocked");
    expect(MOODY_RUNTIME_BLOCKED_IDS).toContain("set-collector");
  });

  it("does not activate a set bonus while the boon is blocked", () => {
    const result = resolveMoodyRuntimeEffect("set-collector", "rank-two", {
      kind: "item-set-query",
      seed: 1,
      data: {
        ownedDistinctItemIds: ["QUICK_CLAW", "KINGS_ROCK", "WIDE_LENS"],
        chosenSetId: "tactician-tools",
      },
    });

    expect(result.commands.some(command => command.kind === "apply-item-set-bonuses")).toBe(false);
    expect(result.commands).toContainEqual({
      kind: "effect-blocked",
      data: expect.objectContaining({ effectId: "set-collector" }),
    });
  });
});
