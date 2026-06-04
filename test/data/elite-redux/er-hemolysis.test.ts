import { PoisonedFoePurgeAbAttr } from "#data/elite-redux/archetypes/poisoned-foe-purge";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it, vi } from "vitest";

/**
 * Hemolysis — "Poisoned foes lose all stat buffs and can't heal." After the
 * holder attacks a poisoned target, its positive stat stages are zeroed and it
 * is given HEAL_BLOCK.
 */
describe("ER ability - Hemolysis (poisoned-foe purge)", () => {
  const makeOpponent = (status: StatusEffect | undefined, stages: Partial<Record<number, number>>) => {
    const cur: Record<number, number> = { ...stages };
    const setStatStage = vi.fn((stat: number, v: number) => {
      cur[stat] = v;
    });
    const addTag = vi.fn();
    const hasHealBlock = false;
    return {
      opponent: {
        status: status === undefined ? undefined : { effect: status },
        getStatStage: (s: number) => cur[s] ?? 0,
        setStatStage,
        getTag: (t: BattlerTagType) => (hasHealBlock && t === BattlerTagType.HEAL_BLOCK ? {} : undefined),
        addTag,
      } as any,
      setStatStage,
      addTag,
      cur,
    };
  };

  it("only applies when the target is poisoned/toxic", () => {
    const attr = new PoisonedFoePurgeAbAttr();
    expect(attr.canApply({ opponent: makeOpponent(undefined, {}).opponent } as any)).toBe(false);
    expect(attr.canApply({ opponent: makeOpponent(StatusEffect.POISON, {}).opponent } as any)).toBe(true);
    expect(attr.canApply({ opponent: makeOpponent(StatusEffect.TOXIC, {}).opponent } as any)).toBe(true);
    expect(attr.canApply({ opponent: makeOpponent(StatusEffect.BURN, {}).opponent } as any)).toBe(false);
  });

  it("zeroes positive stat stages and applies HEAL_BLOCK", () => {
    const attr = new PoisonedFoePurgeAbAttr();
    const { opponent, setStatStage, addTag } = makeOpponent(StatusEffect.POISON, {
      [Stat.ATK]: 2,
      [Stat.SPD]: 3,
      [Stat.DEF]: -1, // negative buff must be left alone
    });
    attr.apply({ opponent, simulated: false } as any);

    expect(setStatStage).toHaveBeenCalledWith(Stat.ATK, 0);
    expect(setStatStage).toHaveBeenCalledWith(Stat.SPD, 0);
    expect(setStatStage).not.toHaveBeenCalledWith(Stat.DEF, 0); // -1 left intact
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.HEAL_BLOCK);
  });

  it("is a no-op when simulated", () => {
    const attr = new PoisonedFoePurgeAbAttr();
    const { opponent, setStatStage, addTag } = makeOpponent(StatusEffect.POISON, { [Stat.ATK]: 2 });
    attr.apply({ opponent, simulated: true } as any);
    expect(setStatStage).not.toHaveBeenCalled();
    expect(addTag).not.toHaveBeenCalled();
  });
});
