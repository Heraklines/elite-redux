import { allAbilities } from "#data/data-lists";
import { DOCUMENTED_COMPOSITES } from "#data/elite-redux/abilities/documented-ability-definitions";
import {
  manualCompositeConstituents,
  wireEliteReduxManualComposites,
} from "#data/elite-redux/abilities/composite-newcomers";
import { isGatedNewPokemonAbilityId } from "#data/elite-redux/er-new-pokemon-gate";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

describe("documented composite ability registration", () => {
  it.each(DOCUMENTED_COMPOSITES)("resolves and wires $name without sharing mutable attributes", def => {
    const composite = allAbilities[def.id];
    expect(composite?.name).toBe(def.name);
    expect(isGatedNewPokemonAbilityId(def.id)).toBe(true);
    expect(manualCompositeConstituents(def.id)).toEqual(def.constituents);
    expect(composite.attrs.length).toBeGreaterThan(0);
    for (const id of def.constituents) {
      const part = allAbilities[id];
      expect(part, `constituent ${id}`).toBeDefined();
      for (const attr of part.attrs) {
        expect(composite.attrs.some(a => a.constructor === attr.constructor)).toBe(true);
        expect(composite.attrs).not.toContain(attr);
      }
      if (part.bypassFaint) expect(composite.bypassFaint).toBe(true);
    }
  });

  it("rewiring composites is idempotent", () => {
    const before = DOCUMENTED_COMPOSITES.map(def => allAbilities[def.id].attrs.map(a => a.constructor.name));
    wireEliteReduxManualComposites();
    expect(DOCUMENTED_COMPOSITES.map(def => allAbilities[def.id].attrs.map(a => a.constructor.name))).toEqual(before);
  });
});
