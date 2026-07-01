/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Guards the "Primal Cascoon (Hell): a real winning Fire team" dev scenario -
// a mono-Fire roster pulled verbatim from a real Hell victory (D1 ghost pool).
// Confirms the real forms (Cinderace f2, Delphox f1, Infernape f1) spawn and
// recompute stats without crashing, and that every member is Fire-type (the
// super-effective edge over the Bug-based Primal Cascoon that wins the fight).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// Species -> the exact form index the winning run used (0 where unset).
const FORM: Partial<Record<SpeciesId, number>> = {
  [SpeciesId.CINDERACE]: 2,
  [SpeciesId.DELPHOX]: 1,
  [SpeciesId.INFERNAPE]: 1,
};

describe.skipIf(!RUN)("ER Primal Cascoon Fire team - real winning roster is valid", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(200)
      .enemyLevel(200)
      .enemySpecies(SpeciesId.CASCOON)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("all six mons spawn with their real forms, recompute stats, and are Fire-type", async () => {
    await game.classicMode.startBattle(
      SpeciesId.CINDERACE,
      SpeciesId.DELPHOX,
      SpeciesId.VOLCANION,
      SpeciesId.HOUNDOOM,
      SpeciesId.NINETALES,
      SpeciesId.INFERNAPE,
    );
    const party = game.scene.getPlayerParty();
    expect(party.length).toBe(6);

    for (const mon of party) {
      const formIndex = FORM[mon.species.speciesId] ?? 0;
      // Apply the winning run's exact form and recompute - must not throw (form is valid).
      mon.formIndex = formIndex;
      mon.calculateStats();
      // Mono-Fire roster: every member keeps a Fire type in its ER form. Fire is
      // super effective on the Bug-based Primal Cascoon - the edge that wins the fight.
      expect(mon.isOfType(PokemonType.FIRE), `${SpeciesId[mon.species.speciesId]} (form ${formIndex}) not Fire`).toBe(
        true,
      );
    }
  });
});
