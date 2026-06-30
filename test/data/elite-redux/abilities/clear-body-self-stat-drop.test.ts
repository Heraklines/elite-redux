/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Clear Body (29) and Full Metal Body (230) per the 2.65 dex give
// "immunity to all stat reductions from moves and abilities. Includes self stat
// drops from moves like Overheat." The vanilla port only wired ProtectStatAbAttr,
// which blocks INCOMING drops (Growl, Intimidate) but never the holder's OWN
// drops - so a Clear Body user still lost SpAtk to its own Draco Meteor / Overheat
// (the reported Flygon Redux + Draco Meteor bug). The ER rebalance now also wires
// SelfStatDropImmunityAbAttr onto both. This pins:
//   - Clear Body / Full Metal Body block the holder's OWN Draco Meteor SpAtk drop.
//   - They STILL block an incoming Growl (ProtectStat path is untouched).
//   - A mon WITHOUT either ability still takes Draco Meteor's normal -2 self-drop.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Clear Body / Full Metal Body - block self-inflicted stat drops", () => {
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
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("Clear Body blocks the holder's own Draco Meteor SpAtk drop", async () => {
    game.override.ability(AbilityId.CLEAR_BODY).moveset(MoveId.DRACO_METEOR);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.SPATK)).toBe(0);

    game.move.select(MoveId.DRACO_METEOR);
    await game.move.forceHit();
    await game.phaseInterceptor.to("BerryPhase");

    // Draco Meteor normally drops the user's SpAtk by 2; ER Clear Body cancels it.
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("Full Metal Body also blocks the holder's own Draco Meteor SpAtk drop", async () => {
    game.override.ability(AbilityId.FULL_METAL_BODY).moveset(MoveId.DRACO_METEOR);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.DRACO_METEOR);
    await game.move.forceHit();
    await game.phaseInterceptor.to("BerryPhase");

    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("Clear Body STILL blocks an INCOMING drop (Growl), proving the ProtectStat path is intact", async () => {
    // ER Growl is a damaging Special move; a weak enemy can't KO before we read the (blocked) ATK stage.
    game.override
      .ability(AbilityId.CLEAR_BODY)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyMoveset(MoveId.GROWL);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    // Clear Body's incoming-drop immunity (ProtectStatAbAttr) keeps ATK at 0.
    expect(player.getStatStage(Stat.ATK)).toBe(0);
  });

  it("control: WITHOUT either ability, Draco Meteor's own -2 SpAtk self-drop still applies", async () => {
    game.override.ability(AbilityId.BALL_FETCH).moveset(MoveId.DRACO_METEOR);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.DRACO_METEOR);
    await game.move.forceHit();
    await game.phaseInterceptor.to("BerryPhase");

    // Unprotected: the self-inflicted -2 SpAtk lands as normal (fix is ability-scoped).
    expect(player.getStatStage(Stat.SPATK)).toBe(-2);
  });
});
