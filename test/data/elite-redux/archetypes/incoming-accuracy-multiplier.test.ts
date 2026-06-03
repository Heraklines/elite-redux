/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Tests for `incoming-accuracy-multiplier` (Bad Luck -5%, Ol single-target -20%).
// Subclasses WonderSkinAbAttr so it rides the existing accuracy hook; here we
// exercise canApply/apply directly against a stubbed accuracy holder + move.

import { IncomingAccuracyMultiplierAbAttr } from "#data/elite-redux/archetypes/incoming-accuracy-multiplier";
import { MoveTarget } from "#enums/move-target";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function run(opts: { attr: IncomingAccuracyMultiplierAbAttr; accuracy: number; target?: MoveTarget }): {
  fired: boolean;
  finalAccuracy: number;
} {
  const accuracy = new NumberHolder(opts.accuracy);
  const move = { moveTarget: opts.target ?? MoveTarget.NEAR_OTHER } as unknown as Move;
  const params = { accuracy, move } as unknown as Parameters<IncomingAccuracyMultiplierAbAttr["apply"]>[0];
  const fired = opts.attr.canApply(params);
  if (fired) {
    opts.attr.apply(params);
  }
  return { fired, finalAccuracy: accuracy.value };
}

describe("IncomingAccuracyMultiplierAbAttr", () => {
  it("Bad Luck: multiplies incoming accuracy by 0.95", () => {
    const attr = new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.95 });
    const r = run({ attr, accuracy: 100 });
    expect(r.fired).toBe(true);
    expect(r.finalAccuracy).toBeCloseTo(95);
  });

  it("does NOT touch never-miss moves (accuracy = -1 sentinel)", () => {
    const attr = new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.95 });
    const r = run({ attr, accuracy: -1 });
    expect(r.fired).toBe(false);
    expect(r.finalAccuracy).toBe(-1);
  });

  it("Ol: -20% only for single-target moves", () => {
    const attr = new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.8, singleTargetOnly: true });
    expect(run({ attr, accuracy: 100, target: MoveTarget.NEAR_OTHER }).finalAccuracy).toBeCloseTo(80);
    // spread move → untouched
    const spread = run({ attr, accuracy: 100, target: MoveTarget.ALL_NEAR_OTHERS });
    expect(spread.fired).toBe(false);
    expect(spread.finalAccuracy).toBe(100);
  });

  it("rejects a non-positive multiplier at construction", () => {
    expect(() => new IncomingAccuracyMultiplierAbAttr({ multiplier: 0 })).toThrow(/must be > 0/);
  });
});
