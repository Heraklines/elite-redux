/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

describe("ER Sand Force", () => {
  it("replaces typed move boosts with the highest attacking stat multiplier", () => {
    const attrs = allAbilities[AbilityId.SAND_FORCE].attrs;
    expect(attrs.some(attr => attr.constructor.name === "MoveTypePowerBoostAbAttr")).toBe(false);
    expect(attrs.some(attr => attr instanceof SelfHighestStatMultiplierAbAttr)).toBe(true);
    expect(attrs.some(attr => attr.constructor.name === "BlockWeatherDamageAttr")).toBe(true);
  });
});
