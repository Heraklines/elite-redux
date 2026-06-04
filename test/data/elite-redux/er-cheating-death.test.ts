import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import { describe, expect, it } from "vitest";

/**
 * Cheating Death — "Negates the first two instances of damage received." The
 * first 2 damaging hits are zeroed; the 3rd onward pass through unchanged.
 */
describe("ER ability - Cheating Death (nullify first 2 hits)", () => {
  const hit = (attr: NullifyFirstNHitsAbAttr, pokemon: any, dmg: number, simulated = false) => {
    const damage = { value: dmg };
    const params = { pokemon, opponent: {}, move: {}, damage, simulated } as any;
    if (attr.canApply(params)) {
      attr.apply(params);
    }
    return damage.value;
  };

  it("zeroes the first two damaging hits, then lets the third through", () => {
    const attr = new NullifyFirstNHitsAbAttr(2);
    const pokemon = { id: 1 } as any;
    expect(hit(attr, pokemon, 50)).toBe(0); // hit 1 negated
    expect(hit(attr, pokemon, 80)).toBe(0); // hit 2 negated
    expect(attr.used(pokemon)).toBe(2);
    expect(hit(attr, pokemon, 70)).toBe(70); // hit 3 passes through
  });

  it("ignores zero-damage instances (doesn't consume a charge)", () => {
    const attr = new NullifyFirstNHitsAbAttr(2);
    const pokemon = { id: 2 } as any;
    expect(hit(attr, pokemon, 0)).toBe(0); // no damage -> not counted
    expect(attr.used(pokemon)).toBe(0);
    expect(hit(attr, pokemon, 40)).toBe(0); // still the first real hit
    expect(attr.used(pokemon)).toBe(1);
  });

  it("does not consume a charge on a simulated preview", () => {
    const attr = new NullifyFirstNHitsAbAttr(2);
    const pokemon = { id: 3 } as any;
    expect(hit(attr, pokemon, 30, true)).toBe(0); // simulated -> shows 0
    expect(attr.used(pokemon)).toBe(0); // but charge not spent
  });
});
