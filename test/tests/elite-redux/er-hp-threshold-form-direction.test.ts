/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Locust Swarm (Hivemind) was INVERTED — it transformed INTO Hivemind below 1/4
// HP. "Hivemind until 1/4 HP or less" means the holder is in Hivemind while
// ABOVE 1/4 and reverts at/below it (Wishiwashi School). The shared
// HpThresholdFormChangeAbAttr now takes a `formAboveThreshold` flag; Ape Shift
// (low-HP form) keeps the default. Gated behind ER_SCENARIO=1.

import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Minimal Pokemon stub — canApply only reads these. */
function mon(hpRatio: number, currentFormKey: string) {
  const forms = [{ formKey: "" }, { formKey: "hivemind" }, { formKey: "transformed" }];
  return {
    isFainted: () => false,
    hp: Math.round(hpRatio * 100),
    getMaxHp: () => 100,
    species: { forms },
    formIndex: forms.findIndex(f => f.formKey === currentFormKey),
  };
}
const canApply = (attr: HpThresholdFormChangeAbAttr, p: ReturnType<typeof mon>): boolean =>
  // canApply only touches `pokemon`; the rest of the params object is unused.
  attr.canApply({ pokemon: p } as never);

describe.skipIf(!RUN)("HpThresholdFormChange direction", () => {
  it("Locust Swarm (formAboveThreshold): Hivemind while ABOVE 1/4, revert at/below", () => {
    const a = new HpThresholdFormChangeAbAttr({
      hpThreshold: 0.25,
      targetFormKey: "hivemind",
      formAboveThreshold: true,
    });
    expect(canApply(a, mon(0.5, ""))).toBe(true); // healthy, not yet Hivemind -> transform UP
    expect(canApply(a, mon(0.5, "hivemind"))).toBe(false); // healthy + already Hivemind -> no-op
    expect(canApply(a, mon(0.2, "hivemind"))).toBe(true); // dropped to <=1/4 while Hivemind -> revert
    expect(canApply(a, mon(0.2, ""))).toBe(false); // low + base -> stay base
  });

  it("Ape Shift (default low-HP form): transform BELOW 1/2, revert above — unchanged", () => {
    const a = new HpThresholdFormChangeAbAttr({ hpThreshold: 0.5, targetFormKey: "transformed" });
    expect(canApply(a, mon(0.4, ""))).toBe(true); // hurt -> transform
    expect(canApply(a, mon(0.4, "transformed"))).toBe(false); // hurt + already transformed -> no-op
    expect(canApply(a, mon(0.6, "transformed"))).toBe(true); // healed above -> revert
    expect(canApply(a, mon(0.6, ""))).toBe(false); // healthy + base -> no-op
  });
});
