/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Systemic audit-fix: composite-vanilla-mashup parts that embed a CONDITION-
// gated vanilla ability (Swift Swim = rain, Chlorophyll = sun, etc.) must
// preserve that gate. Previously resolveCompositePartAttrs copied only `.attrs`
// and dropped the source ability's ability-level `.conditions`, so the part
// applied UNCONDITIONALLY (e.g. Way of Swiftness gave +50% Speed always, not
// just in rain). The fix attaches the source conditions as a per-attr
// extraCondition on a clone (apply-ab-attrs enforces getCondition() generically).
import { allAbilities } from "#data/data-lists";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("composite parts preserve the source ability's condition gate", () => {
  it("Way of Swiftness (680, …+Swift Swim) — the Speed multiplier carries a (rain) condition", () => {
    const res = dispatchArchetype("composite-vanilla-mashup", null, 680);
    expect(res.skipReason).toBeNull();
    const spd = res.attrs.find(a => a.constructor.name === "StatMultiplierAbAttr");
    expect(spd).toBeDefined();
    // Pre-fix this was null (unconditional). Now it's gated by Swift Swim's
    // rain condition copied from the source ability.
    expect(spd?.getCondition()).not.toBeNull();
  });

  it("does not mutate the shared source Swift Swim attr (its own StatMultiplier stays ungated)", () => {
    // Run the composite resolution (which clones + gates), then confirm the
    // REAL Swift Swim ability's attr is untouched (gate stays at ability level,
    // not on the attr).
    dispatchArchetype("composite-vanilla-mashup", null, 680);
    const swiftSwim = allAbilities[AbilityId.SWIFT_SWIM];
    const spd = swiftSwim.attrs.find(a => a.constructor.name === "StatMultiplierAbAttr");
    expect(spd).toBeDefined();
    // The source attr's per-attr condition must remain null — Swift Swim gates
    // via its ability-level .conditions, not the attr's extraCondition.
    expect(spd?.getCondition()).toBeNull();
  });
});
