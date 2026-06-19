/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { PlayerPokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

function makeFusion(
  basePassives: readonly [AbilityId, AbilityId, AbilityId] = [
    AbilityId.OVERGROW,
    AbilityId.CHLOROPHYLL,
    AbilityId.LEAF_GUARD,
  ],
  fusionPassives: readonly [AbilityId, AbilityId, AbilityId] = [
    AbilityId.BLAZE,
    AbilityId.SOLAR_POWER,
    AbilityId.FLAME_BODY,
  ],
): PlayerPokemon {
  const player = Object.create(PlayerPokemon.prototype) as PlayerPokemon;
  Object.assign(player, {
    summonData: { ability: 0 },
    customPokemonData: new CustomPokemonData(),
    fusionCustomPokemonData: new CustomPokemonData(),
    species: {
      ability1: AbilityId.OVERGROW,
      getPassiveAbilities: () => basePassives,
    },
    fusionSpecies: {
      getPassiveAbilities: () => fusionPassives,
    },
    formIndex: 0,
    fusionFormIndex: 0,
    abilityIndex: 0,
    getSpeciesForm: () => ({ getAbility: () => AbilityId.OVERGROW }),
    getFormKey: () => "",
    getFusionFormKey: () => "",
    isPlayer: () => false,
    isEnemy: () => false,
    isBoss: () => false,
    isOnField: () => false,
  });
  return player;
}

describe("ER fusion ability slots", () => {
  it("inherits slots 1 and 3 from the base and slots 2 and 4 from the absorbed Pokemon", () => {
    const player = makeFusion();

    expect(player.getAbility().id).toBe(AbilityId.OVERGROW);
    expect(
      player
        .getPassiveAbilities()
        .slice(0, 3)
        .map(ability => ability?.id),
    ).toEqual([AbilityId.BLAZE, AbilityId.CHLOROPHYLL, AbilityId.FLAME_BODY]);
    expect(player.getPassiveAbility().id).toBe(AbilityId.BLAZE);
  });

  it("preserves duplicate abilities inherited from different slots", () => {
    const player = makeFusion(
      [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD],
      [AbilityId.CHLOROPHYLL, AbilityId.SOLAR_POWER, AbilityId.FLAME_BODY],
    );

    expect(
      player
        .getPassiveAbilities()
        .slice(0, 3)
        .map(ability => ability?.id),
    ).toEqual([AbilityId.CHLOROPHYLL, AbilityId.CHLOROPHYLL, AbilityId.FLAME_BODY]);
  });

  it("routes final slot overrides to the parent that owns them", () => {
    const player = makeFusion();

    player.setAbilityOverrideForSlot(0, AbilityId.STURDY);
    player.setAbilityOverrideForSlot(1, AbilityId.DRIZZLE);
    player.setAbilityOverrideForSlot(2, AbilityId.MOXIE);
    player.setAbilityOverrideForSlot(3, AbilityId.SAND_STREAM);

    expect(player.customPokemonData.ability).toBe(AbilityId.STURDY);
    expect(player.fusionCustomPokemonData?.passive).toBe(AbilityId.DRIZZLE);
    expect(player.customPokemonData.passive2).toBe(AbilityId.MOXIE);
    expect(player.fusionCustomPokemonData?.passive3).toBe(AbilityId.SAND_STREAM);
    expect(player.getAbility().id).toBe(AbilityId.STURDY);
    expect(
      player
        .getPassiveAbilities()
        .slice(0, 3)
        .map(ability => ability?.id),
    ).toEqual([AbilityId.DRIZZLE, AbilityId.MOXIE, AbilityId.SAND_STREAM]);
  });
});
