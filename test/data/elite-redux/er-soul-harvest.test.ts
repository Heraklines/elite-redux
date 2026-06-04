import {
  FaintCountTriggerAbAttr,
  PerFaintStatMultiplierAbAttr,
  soulHarvestFaintCount,
} from "#data/elite-redux/archetypes/stat-multiplier-per-faint";
import { Stat } from "#enums/stat";
import { describe, expect, it } from "vitest";

/**
 * Soul Harvest — "Fainted Pokemon increase your offenses and spdef by 5%."
 * Unit-level: faints accumulate a counter; ATK/SPATK/SPDEF scale by
 * (1 + 0.05 × count).
 */
describe("ER ability - Soul Harvest (per-faint stat multiplier)", () => {
  const makeHolder = () => ({ id: 1 }) as any;

  it("counts every faint except the holder's own", () => {
    const trigger = new FaintCountTriggerAbAttr();
    const holder = makeHolder();

    expect(trigger.canApply({ pokemon: holder, victim: { id: 1 } } as any)).toBe(false); // self
    expect(trigger.canApply({ pokemon: holder, victim: { id: 7 } } as any)).toBe(true); // foe
    expect(trigger.canApply({ pokemon: holder, victim: { id: 2 } } as any)).toBe(true); // ally
  });

  it("multiplies ATK by 1 + 0.05 per faint, compounding the counter", () => {
    const trigger = new FaintCountTriggerAbAttr();
    const atk = new PerFaintStatMultiplierAbAttr(Stat.ATK, 0.05);
    const holder = makeHolder();

    // No faints yet: x1.0
    let statVal = { value: 200 };
    expect(atk.canApply({ pokemon: holder, stat: Stat.ATK, statVal } as any)).toBe(true);
    atk.apply({ pokemon: holder, statVal } as any);
    expect(statVal.value).toBe(200);

    // 3 faints -> x1.15
    for (let i = 0; i < 3; i++) {
      trigger.apply({ pokemon: holder, victim: { id: 10 + i }, simulated: false } as any);
    }
    expect(soulHarvestFaintCount(holder)).toBe(3);
    statVal = { value: 200 };
    atk.apply({ pokemon: holder, statVal } as any);
    expect(statVal.value).toBeCloseTo(230, 5); // 200 * 1.15
  });

  it("only applies to its configured stat", () => {
    const spdef = new PerFaintStatMultiplierAbAttr(Stat.SPDEF, 0.05);
    expect(spdef.canApply({ pokemon: makeHolder(), stat: Stat.SPATK, statVal: { value: 1 } } as any)).toBe(false);
    expect(spdef.canApply({ pokemon: makeHolder(), stat: Stat.SPDEF, statVal: { value: 1 } } as any)).toBe(true);
  });
});
