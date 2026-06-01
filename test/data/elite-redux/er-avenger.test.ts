import {
  AllyFaintPowerBoostAbAttr,
  AllyFaintPowerBoostExpireAbAttr,
  AllyFaintPowerBoostTriggerAbAttr,
  isAvengerBoostActive,
} from "#data/elite-redux/archetypes/power-boost-on-ally-faint";
import { describe, expect, it } from "vitest";

/**
 * Avenger — "Boosts the power of all moves by 50% for one turn after any party
 * Pokemon faints." Unit-level: drive the three cooperating attrs through an
 * ally-faint → boosted-turn → expiry cycle.
 */
describe("ER ability - Avenger (one-turn ×1.5 power after ally faint)", () => {
  const makeHolder = () => ({ id: 1, isPlayer: () => true }) as any;

  it("arms only when an ALLY (same side, not self) is KO'd", () => {
    const trigger = new AllyFaintPowerBoostTriggerAbAttr();
    const holder = makeHolder();

    expect(trigger.canApply({ pokemon: holder, victim: { id: 1, isPlayer: () => true } } as any)).toBe(false); // self
    expect(trigger.canApply({ pokemon: holder, victim: { id: 9, isPlayer: () => false } } as any)).toBe(false); // foe
    expect(trigger.canApply({ pokemon: holder, victim: { id: 2, isPlayer: () => true } } as any)).toBe(true); // ally
  });

  it("boosts move power by 1.5 while active, then expires after the next turn", () => {
    const trigger = new AllyFaintPowerBoostTriggerAbAttr();
    const boost = new AllyFaintPowerBoostAbAttr(1.5);
    const expire = new AllyFaintPowerBoostExpireAbAttr();
    const holder = makeHolder();

    // Ally faints -> boost armed.
    trigger.apply({ pokemon: holder, victim: { id: 2, isPlayer: () => true }, simulated: false } as any);
    expect(isAvengerBoostActive(holder)).toBe(true);
    expect(expire.turnsRemaining(holder)).toBe(2);

    // Move used the same turn is boosted.
    const power = { value: 100 };
    expect(boost.canApply({ pokemon: holder, opponent: {}, move: {}, power } as any)).toBe(true);
    boost.apply({ pokemon: holder, opponent: {}, move: {}, power } as any);
    expect(power.value).toBe(150);

    // End of faint turn: still active for the following turn.
    expire.apply({ pokemon: holder, simulated: false } as any);
    expect(isAvengerBoostActive(holder)).toBe(true);

    // End of following turn: expires.
    expire.apply({ pokemon: holder, simulated: false } as any);
    expect(isAvengerBoostActive(holder)).toBe(false);

    // No boost once expired.
    const power2 = { value: 100 };
    expect(boost.canApply({ pokemon: holder, opponent: {}, move: {}, power: power2 } as any)).toBe(false);
  });
});
