/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Limber is "immune to SELF stat drops" (Overheat / Close Combat),
// NOT incoming drops. A prior pass wired ProtectStatAbAttr (Clear Body), which
// is the inverse: it blocked Growl / Intimidate but never self-drops. This pins
// the corrected behaviour via SelfStatDropImmunityAbAttr:
//   - Growl / Intimidate STILL lower a Limber holder's stats.
//   - The holder's OWN Overheat no longer drops its SpAtk.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Limber — self-stat-drop immunity only", () => {
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
      .ability(AbilityId.LIMBER)
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyLevel(100);
  });

  it("does NOT block an incoming Growl (other-source drop still applies)", async () => {
    // ER Growl is a damaging Special move now; use a weak enemy so it can't KO
    // our Magikarp before we read the (other-source) ATK drop.
    game.override.moveset(MoveId.SPLASH).enemySpecies(SpeciesId.MAGIKARP).enemyLevel(5).enemyMoveset(MoveId.GROWL);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(-1);
  });

  it("DOES block the holder's own Overheat SpAtk drop (self-inflicted)", async () => {
    game.override.moveset(MoveId.OVERHEAT).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.OVERHEAT);
    await game.phaseInterceptor.to("BerryPhase");

    // Overheat normally drops the user's SpAtk by 2; Limber cancels that.
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });
});
