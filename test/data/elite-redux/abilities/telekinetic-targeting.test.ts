/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { TelekineticStruggleOnEntryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import type { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

interface OpponentStub {
  readonly pokemon: Pokemon;
  readonly tempSummonData: { erTelekineticStruggle: boolean };
}

function makeOpponent(
  options: { fainted?: boolean; types?: PokemonType[]; abilities?: AbilityId[] } = {},
): OpponentStub {
  const tempSummonData = { erTelekineticStruggle: false };
  const types = options.types ?? [];
  const abilities = options.abilities ?? [];
  const pokemon = {
    tempSummonData,
    isFainted: () => options.fainted ?? false,
    isOfType: (type: PokemonType) => types.includes(type),
    hasAbility: (ability: AbilityId) => abilities.includes(ability),
  } as unknown as Pokemon;
  return { pokemon, tempSummonData };
}

function applyTelekinetic(opponents: Pokemon[]): boolean | undefined {
  let onFieldArgument: boolean | undefined;
  const holder = {
    getOpponents: (onField?: boolean) => {
      onFieldArgument = onField;
      return opponents;
    },
  } as unknown as Pokemon;

  new TelekineticStruggleOnEntryAbAttr().apply({ pokemon: holder, simulated: false } as never);
  return onFieldArgument;
}

describe("Telekinetic targeting", () => {
  it("affects only the first living opposing lead in doubles or triples", () => {
    const lead = makeOpponent();
    const partner = makeOpponent();
    const third = makeOpponent();

    const onFieldArgument = applyTelekinetic([lead.pokemon, partner.pokemon, third.pokemon]);

    expect(onFieldArgument).toBe(false);
    expect(lead.tempSummonData.erTelekineticStruggle).toBe(true);
    expect(partner.tempSummonData.erTelekineticStruggle).toBe(false);
    expect(third.tempSummonData.erTelekineticStruggle).toBe(false);
  });

  it("does not spill into a partner when the opposing lead is immune", () => {
    const immuneLead = makeOpponent({ types: [PokemonType.PSYCHIC] });
    const partner = makeOpponent();

    applyTelekinetic([immuneLead.pokemon, partner.pokemon]);

    expect(immuneLead.tempSummonData.erTelekineticStruggle).toBe(false);
    expect(partner.tempSummonData.erTelekineticStruggle).toBe(false);
  });

  it("uses the next living opposing slot when the former lead has fainted", () => {
    const faintedLead = makeOpponent({ fainted: true });
    const replacement = makeOpponent();
    const partner = makeOpponent();

    applyTelekinetic([faintedLead.pokemon, replacement.pokemon, partner.pokemon]);

    expect(faintedLead.tempSummonData.erTelekineticStruggle).toBe(false);
    expect(replacement.tempSummonData.erTelekineticStruggle).toBe(true);
    expect(partner.tempSummonData.erTelekineticStruggle).toBe(false);
  });
});
