/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Retriever (ability 515): "Retrieves its ORIGINAL HELD ITEM on switch-out
// if it is not currently holding one. Must not have fainted."
//
// The prior wire only un-marked eaten berries; it did NOT restore an item
// removed by Knock Off / Thief / Trick. This proves the real retrieval: an item
// stripped mid-battle is re-granted when the (living) holder switches out.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const RETRIEVER = ErAbilityId.RETRIEVER as unknown as AbilityId;

describe.skipIf(!RUN)("ER Retriever — restores a stripped original held item on switch-out", () => {
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
      .ability(RETRIEVER)
      .startingHeldItems([{ name: "LEFTOVERS" }])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50);
  });

  it("re-grants the original held item on switch-out after it was knocked off", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGCARGO);
    const retriever = game.scene.getPlayerParty()[0];
    expect(retriever.species.speciesId).toBe(SpeciesId.SNORLAX);
    // The Retriever holder enters holding its original item (snapshotted on summon).
    expect(retriever.getHeldItems().length).toBe(1);

    // Simulate a Knock Off / Thief / Trick stripping the held item mid-battle.
    retriever.loseHeldItem(retriever.getHeldItems()[0]);
    globalScene.updateModifiers(true);
    expect(retriever.getHeldItems().length).toBe(0);

    // Switch the (living) Retriever holder out — it should retrieve its item.
    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(game.scene.getPlayerPokemon()!.species.speciesId).toBe(SpeciesId.MAGCARGO);
    expect(retriever.getHeldItems().length, "original held item retrieved on switch-out").toBe(1);
  });

  it("does NOT duplicate the item when the holder already holds one on switch-out", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGCARGO);
    const retriever = game.scene.getPlayerParty()[0];
    expect(retriever.getHeldItems().length).toBe(1);

    // No strip — just switch out. The holder still has its item, so no re-grant.
    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(retriever.getHeldItems().length, "no duplication").toBe(1);
  });
});
