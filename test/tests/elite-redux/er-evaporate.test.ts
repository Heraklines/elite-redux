/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Evaporate (ability 444): "Negates all Water-move damage AND sets Mist for
// 5 turns on the holder's side when hit by a Water move. Mist protects the whole
// team from stat reductions, INCLUDING self-drops."
//
// Vanilla Mist (stat-stage-change-phase) only blocks OTHER-source drops
// (!selfTarget); the holder's OWN drops (Overheat / Close Combat / Draco Meteor)
// slipped through. This proves the Evaporate-set Mist also blocks self-drops.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const EVAPORATE = ErAbilityId.EVAPORATE as unknown as AbilityId;

describe.skipIf(!RUN)("ER Evaporate — Mist blocks self-inflicted stat drops", () => {
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
      .ability(EVAPORATE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50);
  });

  it("does NOT lose Sp.Atk from Overheat while its Mist is up", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    // Mist on the holder's own side (as Evaporate sets when hit by Water).
    game.scene.arena.addTag(ArenaTagType.MIST, 5, undefined, player.id, ArenaTagSide.PLAYER);
    expect(player.getStatStage(Stat.SPATK)).toBe(0);

    game.move.use(MoveId.OVERHEAT); // -2 Sp.Atk self-drop
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.SPATK), "self-drop blocked by Mist").toBe(0);
  });

  it("control: WITHOUT Mist, Overheat drops the holder's Sp.Atk by 2", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.OVERHEAT);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.SPATK)).toBe(-2);
  });

  it("real path: a Water hit sets Mist (no damage), then Overheat causes no drop", async () => {
    game.override.enemyMoveset(MoveId.WATER_GUN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const hp0 = player.hp;

    // Turn 1: enemy Water Gun — negated (no damage) and sets Mist on our side.
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.hp, "Water damage negated").toBe(hp0);
    expect(
      game.scene.arena.getTagOnSide(ArenaTagType.MIST, ArenaTagSide.PLAYER),
      "Mist set on the holder's side",
    ).toBeDefined();

    // Turn 2: Overheat — Mist blocks the self Sp.Atk drop.
    game.move.use(MoveId.OVERHEAT);
    await game.toEndOfTurn();
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });
});
