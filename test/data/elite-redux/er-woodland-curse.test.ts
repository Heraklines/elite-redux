import { AddTypeToAttackerOnContactAbAttr } from "#data/elite-redux/archetypes/add-type-to-attacker-on-contact";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

/**
 * Woodland Curse — "Adds Grass type on contact." The Forest's-Curse-on-entry
 * half is the scripted-move entry effect; here we verify the post-defend rider
 * that grants a contact attacker an extra Grass type.
 */
describe("ER ability - Woodland Curse (add Grass on contact)", () => {
  const makeAttacker = ({ tera, grass }: { tera: boolean; grass: boolean }) => {
    const summonData: any = {};
    return {
      attacker: {
        isTerastallized: tera,
        isOfType: (t: PokemonType) => grass && t === PokemonType.GRASS,
        summonData,
        updateInfo: () => {},
      } as any,
      summonData,
    };
  };

  const contactMove = { doesFlagEffectApply: () => true } as any;
  const nonContactMove = { doesFlagEffectApply: () => false } as any;

  it("adds Grass to a contact attacker that isn't already Grass / tera", () => {
    const attr = new AddTypeToAttackerOnContactAbAttr(PokemonType.GRASS);
    const { attacker, summonData } = makeAttacker({ tera: false, grass: false });
    const params = { pokemon: {} as any, opponent: attacker, move: contactMove } as any;
    expect(attr.canApply(params)).toBe(true);
    // The type mutation runs before the (scene-dependent) flavor message; that
    // message call may throw in a bare unit context, so guard it — the mutation
    // is what we assert.
    try {
      attr.apply({ ...params, simulated: false });
    } catch {
      /* flavor-message side effect needs a live scene; irrelevant here */
    }
    expect(summonData.addedType).toBe(PokemonType.GRASS);
  });

  it("does not apply on a non-contact move", () => {
    const attr = new AddTypeToAttackerOnContactAbAttr(PokemonType.GRASS);
    const { attacker } = makeAttacker({ tera: false, grass: false });
    expect(attr.canApply({ pokemon: {} as any, opponent: attacker, move: nonContactMove } as any)).toBe(false);
  });

  it("does not apply if the attacker is already Grass or terastallized", () => {
    const attr = new AddTypeToAttackerOnContactAbAttr(PokemonType.GRASS);
    const alreadyGrass = makeAttacker({ tera: false, grass: true });
    const tera = makeAttacker({ tera: true, grass: false });
    expect(attr.canApply({ pokemon: {} as any, opponent: alreadyGrass.attacker, move: contactMove } as any)).toBe(
      false,
    );
    expect(attr.canApply({ pokemon: {} as any, opponent: tera.attacker, move: contactMove } as any)).toBe(false);
  });
});
