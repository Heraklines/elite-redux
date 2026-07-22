/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { ER_NEWCOMER_SIGNATURE_ABILITIES } from "#data/elite-redux/abilities/newcomer-signature-abilities";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";
import "#test/framework/game-manager";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  initEliteReduxCustomAbilities();
});

function runtimeAbility(pokerogueId: number): Ability {
  const ability = allAbilities[pokerogueId];
  expect(ability, `runtime ability ${pokerogueId} must exist`).toBeDefined();
  return ability;
}

describe("newcomer signature ability registry", () => {
  it("registers all 24 abilities with unique ids and executable mechanics", () => {
    expect(ER_NEWCOMER_SIGNATURE_ABILITIES).toHaveLength(24);
    expect(new Set(ER_NEWCOMER_SIGNATURE_ABILITIES.map(definition => definition.pokerogueId)).size).toBe(24);

    for (const definition of ER_NEWCOMER_SIGNATURE_ABILITIES) {
      const ability = runtimeAbility(definition.pokerogueId);
      expect(ability.name).toBe(definition.draft.name);
      expect(ability.description.length).toBeGreaterThan(20);
      expect(ability.attrs.length, `${ability.name} must have executable attrs`).toBeGreaterThan(0);
    }
  });

  it("keeps Two-Faced Unleashed immutable while Skyhook and Two-Faced remain ordinary active abilities", () => {
    const twoFaced = runtimeAbility(5977);
    const skyhook = runtimeAbility(5978);
    expect(twoFaced.copiable).toBe(false);
    expect(twoFaced.suppressable).toBe(false);
    expect(twoFaced.replaceable).toBe(false);
    expect(skyhook.copiable).toBe(true);
  });

  it("wires Gillie Suit as the complete Predator plus Protean package", () => {
    const names = runtimeAbility(5986).attrs.map(attr => attr.constructor.name);
    expect(names).toContain("PokemonTypeChangeAbAttr");
    expect(names).toContain("LifestealOnKoAbAttr");
  });
});
