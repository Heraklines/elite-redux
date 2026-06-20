import { AddSecondStrikeAbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { HitMultiplierAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { ErMultiHeadedAbAttr } from "#data/elite-redux/archetypes/multi-headed";
import {
  bypassesOpponentMultiHitSuppression,
  PostDefendSuppressOpponentDamageBoostAbAttr,
} from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

describe("Abilities - Wonder Skin", () => {
  it("uses the ER damage-boost suppression behavior", () => {
    const attrs = allAbilities[AbilityId.WONDER_SKIN].attrs;
    expect(attrs.some(attr => attr.constructor.name === "WonderSkinAbAttr")).toBe(false);
    expect(attrs.some(attr => attr instanceof PostDefendSuppressOpponentDamageBoostAbAttr)).toBe(true);
    expect(attrs.some(attr => attr.constructor.name === "ReceivedMoveDamageMultiplierAbAttr")).toBe(false);
  });

  it("uses the same suppression marker for Fort Knox", () => {
    const result = dispatchArchetype("bespoke", null, 341);
    expect(result.skipReason).toBeNull();
    expect(result.attrs).toHaveLength(1);
    expect(result.attrs[0]).toBeInstanceOf(PostDefendSuppressOpponentDamageBoostAbAttr);
  });

  it("only lets Parental Bond and Multi-Headed bypass multihit suppression", () => {
    expect(bypassesOpponentMultiHitSuppression(new AddSecondStrikeAbAttr())).toBe(true);
    expect(bypassesOpponentMultiHitSuppression(new ErMultiHeadedAbAttr())).toBe(true);
    expect(bypassesOpponentMultiHitSuppression(new HitMultiplierAbAttr({ extraStrikes: 1 }))).toBe(false);
  });
});
