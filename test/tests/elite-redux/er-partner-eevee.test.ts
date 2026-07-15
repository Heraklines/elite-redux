/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER partner-Eevee family (er-newcomer-species.ts + composite-newcomers.ts).
//
// Partner Eevee is the VANILLA Eevee "partner" FORM (not a new species): its
// innate[0] is grafted with the [Fluffy + Omniform] composite. The 8 partner
// eeveelutions are standalone transform-target species (sprites aliased to their
// base eeveelution). Proven here on LIVE Pokemon (composite forced ACTIVE per the
// scenario innate rule):
//   - the PRODUCTION Omniform mappings chain the whole family: the Eevee partner
//     form using a mapped-type move adapts into the matching partner eeveelution,
//     and a second mapped move chains again (partner Eevee -> Vaporeon -> Flareon);
//   - the composite fires BOTH constituents: the Omniform half drives the
//     transform AND the original-innate half still applies (Partner Flareon's
//     Flash Fire absorbs an incoming Fire move).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import {
  ER_PARTNER_EEVEE_ABILITY_ID,
  ER_PARTNER_FLAREON_ABILITY_ID,
} from "#data/elite-redux/abilities/composite-newcomers";
import { erOmniformOnMoveStart } from "#data/elite-redux/abilities/omniform";
import { ER_PARTNER_FLAREON_SPECIES_ID, ER_PARTNER_VAPOREON_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form, not a new species). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

describe.skipIf(!RUN)("ER partner-Eevee family (Omniform composites)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER, MoveId.TACKLE, MoveId.SPLASH])
      // Spawn Eevee in the partner form and force the composite ACTIVE (a player
      // innate is inert until candy-unlocked).
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() })
      .ability(ER_PARTNER_EEVEE_ABILITY_ID as AbilityId);
  });

  it("the Eevee partner form carries the [Fluffy + Omniform] composite as innate[0]", () => {
    const partner = getPokemonSpecies(SpeciesId.EEVEE).forms[partnerFormIndex()];
    expect(partner.getPassiveAbilities()[0]).toBe(ER_PARTNER_EEVEE_ABILITY_ID);
  });

  it("chains across the family via the PRODUCTION Omniform mappings (Eevee partner form -> Vaporeon -> Flareon)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    // The head is the Eevee partner FORM (species EEVEE, partner formIndex).
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    expect(holder.formIndex).toBe(partnerFormIndex());

    // Water move -> Partner Vaporeon (production mapping, no test registration).
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    // Chained Fire move -> Partner Flareon (no lock; Omniform pinned across forms).
    erOmniformOnMoveStart(holder, allMoves[MoveId.EMBER]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_FLAREON_SPECIES_ID);
  });

  it("transforms through a real move turn (composite Omniform half drives it)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    game.move.select(MoveId.WATER_GUN);
    await game.toEndOfTurn();

    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
  });

  it("the composite fires the OTHER constituent too: Partner Flareon's Flash Fire absorbs a Fire move", async () => {
    // Partner Flareon composite = [Flash Fire + Omniform]. The enemy's Fire move is
    // absorbed (Flash Fire), proving the base-innate constituent is live alongside
    // Omniform. Flareon uses Tackle (Normal, unmapped) so it does NOT transform
    // (ER reworks Splash into a Water-typed move, which WOULD map -> Vaporeon).
    game.override
      .ability(ER_PARTNER_FLAREON_ABILITY_ID as AbilityId)
      .enemyMoveset(MoveId.EMBER)
      .moveset([MoveId.TACKLE, MoveId.TACKLE, MoveId.TACKLE, MoveId.TACKLE]);
    await game.classicMode.startBattle(ER_PARTNER_FLAREON_SPECIES_ID as SpeciesId);
    const holder = game.field.getPlayerPokemon();
    const maxHp = holder.getMaxHp();

    game.move.select(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Still the Fire partner form (no transform on an unmapped move) AND unscathed.
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_FLAREON_SPECIES_ID);
    expect(holder.hp).toBe(maxHp);
  });
});
