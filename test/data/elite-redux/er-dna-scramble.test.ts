/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// DNA Scramble — "Changes forms based on the move used." Damaging → Attack form,
// other status → Speed form (Recover → Defense). Data-driven via the Deoxys
// form-change table (Aegislash Stance-Change pattern), gated on the ability.
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - DNA Scramble", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(ErAbilityId.DNA_SCRAMBLE as unknown as AbilityId)
      .moveset([MoveId.TACKLE, MoveId.HARDEN]);
  });

  const formKey = (p: any): string => p.species.forms[p.formIndex]?.formKey ?? "";

  test("a damaging move shifts Deoxys into its Attack form", async () => {
    await game.classicMode.startBattle([SpeciesId.DEOXYS]);
    const deoxys = game.field.getPlayerPokemon();
    expect(formKey(deoxys)).toBe("normal"); // starts normal
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase");
    expect(formKey(deoxys)).toBe("attack");
  });

  test("a (non-Recover) status move shifts Deoxys into its Speed form", async () => {
    await game.classicMode.startBattle([SpeciesId.DEOXYS]);
    const deoxys = game.field.getPlayerPokemon();
    game.move.select(MoveId.HARDEN);
    await game.phaseInterceptor.to("BerryPhase");
    expect(formKey(deoxys)).toBe("speed");
  });
});
