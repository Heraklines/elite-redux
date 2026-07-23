import { ACHV_DISPLAY_DURATION, ACHV_TRANSITION_DURATION } from "#ui/achv-bar";
import { FixedInt } from "#utils/common";
import { describe, expect, it } from "vitest";

describe("achievement notification timing", () => {
  it("uses wall-clock durations that are not divided by game speed", () => {
    expect(ACHV_DISPLAY_DURATION).toBeInstanceOf(FixedInt);
    expect(Number(ACHV_DISPLAY_DURATION)).toBe(10000);
    expect(ACHV_TRANSITION_DURATION).toBeInstanceOf(FixedInt);
    expect(Number(ACHV_TRANSITION_DURATION)).toBe(500);
  });
});
