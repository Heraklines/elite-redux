import { ConditionalCritAbAttr } from "#abilities/ab-attrs";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { describe, expect, it } from "vitest";

/**
 * Fatal Precision — "Super-effective damaging moves never miss and always land
 * critical hits." Verifies both halves: the SE-gated always-hit predicate and
 * the SE-gated guaranteed crit.
 */
describe("ER ability - Fatal Precision (SE never-miss + always-crit)", () => {
  const move = { hasFlag: () => false, category: 1, id: 1 } as any;
  const makeTarget = (eff: number) => ({ getMoveEffectiveness: () => eff }) as any;
  const user = {} as any;

  it("always-hit fires only when the move is super-effective", () => {
    const attr = new ConditionalAlwaysHitAbAttr({ superEffective: true });
    expect(attr.matches(move, user, makeTarget(2))).toBe(true); // 2x
    expect(attr.matches(move, user, makeTarget(4))).toBe(true); // 4x
    expect(attr.matches(move, user, makeTarget(1))).toBe(false); // neutral
    expect(attr.matches(move, user, makeTarget(0.5))).toBe(false); // resisted
  });

  it("guarantees a crit on a super-effective hit and not otherwise", () => {
    const crit = new ConditionalCritAbAttr((u, t, m) => t.getMoveEffectiveness(u, m) > 1);

    const seParams = { pokemon: user, target: makeTarget(2), move, isCritical: { value: false } } as any;
    expect(crit.canApply(seParams)).toBe(true);
    crit.apply(seParams);
    expect(seParams.isCritical.value).toBe(true);

    const neutralParams = { pokemon: user, target: makeTarget(1), move, isCritical: { value: false } } as any;
    expect(crit.canApply(neutralParams)).toBe(false);
  });
});
