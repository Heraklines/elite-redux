import { SelfPersistentBleedAbAttr } from "#data/elite-redux/archetypes/self-persistent-bleed";
import { BattlerTagType } from "#enums/battler-tag-type";
import { describe, expect, it, vi } from "vitest";

/**
 * Blood Stain — "Is always bleeding if not immune." The contact-spread halves
 * are covered by the bleed-status suite; here we verify the turn-end re-apply
 * that keeps the holder perpetually bleeding (e.g. after a heal cured it).
 */
describe("ER ability - Blood Stain (self-persistent bleed)", () => {
  const makeHolder = ({ bleeding, immune }: { bleeding: boolean; immune: boolean }) => {
    const addTag = vi.fn();
    const pokemon = {
      getTag: (t: BattlerTagType) => (bleeding && t === BattlerTagType.ER_BLEED ? {} : undefined),
      canAddTag: () => !immune,
      addTag,
    } as any;
    return { pokemon, addTag };
  };

  it("re-applies ER_BLEED at turn end when not bleeding and not immune", () => {
    const attr = new SelfPersistentBleedAbAttr();
    const { pokemon, addTag } = makeHolder({ bleeding: false, immune: false });
    expect(attr.canApply({ pokemon } as any)).toBe(true);
    attr.apply({ pokemon, simulated: false } as any);
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.ER_BLEED);
  });

  it("does nothing if the holder is already bleeding", () => {
    const attr = new SelfPersistentBleedAbAttr();
    const { pokemon } = makeHolder({ bleeding: true, immune: false });
    expect(attr.canApply({ pokemon } as any)).toBe(false);
  });

  it("does nothing if the holder is immune (Rock/Ghost)", () => {
    const attr = new SelfPersistentBleedAbAttr();
    const { pokemon } = makeHolder({ bleeding: false, immune: true });
    expect(attr.canApply({ pokemon } as any)).toBe(false);
  });
});
