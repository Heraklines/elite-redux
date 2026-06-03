/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability-override resolution across forms + the Ability Randomizer source.
//
// Two related fixes:
//   1. Per-Pokémon ability overrides (`customPokemonData.ability/passive2/...`,
//      written by the Ability Randomizer / custom-starter / mystery encounters)
//      apply on the BASE form but must NOT shadow a Mega/Gigantamax form's own
//      ability set. Mega/G-Max are permanent in PokeRogue, so on transform the
//      Pokémon must take the form's abilities; reverting to base restores the
//      override (the override is never cleared — `usesFormDerivedAbilities()`).
//   2. The summary + Battle Info ability screens now read innate slots via the
//      POKEMON-level `getPassiveAbilities()` (honors the randomizer override),
//      not the species-level method. This test pins the data source they use.
//
// Uses Charizard: form 0 = Normal (Blaze), form 1 = Mega X (Tough Claws),
// form 3 = G-Max (Berserk).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const CHARIZARD_FORM_NORMAL = 0;
const CHARIZARD_FORM_MEGA_X = 1;
const CHARIZARD_FORM_GMAX = 3;

describe.skipIf(!RUN)("ER ability override across Mega/G-Max forms", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("active ability: override applies on base form, form ability wins on Mega/G-Max, override restored on revert", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const mon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARIZARD), 50);
    mon.abilityIndex = 0;

    // Simulate the Ability Randomizer rerolling the active ability.
    mon.setAbilityOverrideForSlot(0, AbilityId.LEVITATE);

    // Base form: the override is in effect.
    mon.formIndex = CHARIZARD_FORM_NORMAL;
    expect(mon.getAbility(true).id).toBe(AbilityId.LEVITATE);

    // Mega X: the form's OWN ability wins over the override (compare against the
    // form's species ability rather than a hardcoded id — ER remaps abilities).
    mon.formIndex = CHARIZARD_FORM_MEGA_X;
    const megaXAbility = mon.getSpeciesForm(true).getAbility(mon.abilityIndex);
    expect(mon.getAbility(true).id).toBe(megaXAbility);
    expect(mon.getAbility(true).id).not.toBe(AbilityId.LEVITATE);

    // G-Max: the form's own ability wins.
    mon.formIndex = CHARIZARD_FORM_GMAX;
    const gmaxAbility = mon.getSpeciesForm(true).getAbility(mon.abilityIndex);
    expect(mon.getAbility(true).id).toBe(gmaxAbility);
    expect(mon.getAbility(true).id).not.toBe(AbilityId.LEVITATE);

    // Revert to base: the override is restored (never cleared).
    mon.formIndex = CHARIZARD_FORM_NORMAL;
    expect(mon.getAbility(true).id).toBe(AbilityId.LEVITATE);
  });

  it("innate slot override: reflected on base form (screen data source), skipped on G-Max", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const mon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARIZARD), 50);
    mon.abilityIndex = 0;

    // Simulate the randomizer rerolling innate slot 1 (customPokemonData.passive2).
    mon.setAbilityOverrideForSlot(2, AbilityId.MOXIE);

    // Base form: getPassiveAbilities()[1] reflects the override — this is the
    // method the summary + Battle Info screens read, so they now update.
    mon.formIndex = CHARIZARD_FORM_NORMAL;
    expect(mon.getPassiveAbilities()[1]?.id).toBe(AbilityId.MOXIE);

    // G-Max: the per-Pokémon innate override is skipped (form-derived innates).
    mon.formIndex = CHARIZARD_FORM_GMAX;
    expect(mon.getPassiveAbilities()[1]?.id).not.toBe(AbilityId.MOXIE);
  });
});
