/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Fetch (er move 969) — "The user retrieves its lost item and switches to an
// ally." (#55)
//
// Previously only the most-recently consumed BERRY was retrievable. The
// consumed-item ledger (PokemonBattleData.lostItems) now also records NON-BERRY
// items lost in battle (knocked-off items, consumed one-time items, shattered
// Gems) via Pokemon.loseHeldItem + the Gem shatter site, so Fetch can retrieve
// them too (a non-berry lost item is preferred over the berry fallback).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const byName = (name: string): Move => {
  const m = allMoves.find(mv => mv?.name === name);
  if (!m) {
    throw new Error(`move not found: ${name}`);
  }
  return m;
};

describe.skipIf(!RUN)("ER Fetch — non-berry consumed-item ledger (#55)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingHeldItems([{ name: "LEFTOVERS" }])
      .criticalHits(false);
  });

  const heldItemsFor = (pokemonId: number) =>
    game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId,
      true,
    ) as PokemonHeldItemModifier[];

  it("loseHeldItem records a lost NON-BERRY item into the ledger", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);
    const user = game.scene.getPlayerParty()[0];

    const leftovers = heldItemsFor(user.id).find(m => m.type?.id === "LEFTOVERS")!;
    expect(leftovers, "the user starts holding Leftovers").toBeDefined();
    expect(user.battleData.lostItems, "ledger starts empty").toHaveLength(0);

    // Simulate an in-battle loss (knock off / consumed one-time item).
    user.loseHeldItem(leftovers);

    expect(
      user.battleData.lostItems.map(r => r.typeId),
      "the lost Leftovers is ledgered",
    ).toContain("LEFTOVERS");
  }, 120_000);

  it("Fetch retrieves a lost non-berry item, then switches to an ally", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MUNCHLAX);
    const [user, bench] = game.scene.getPlayerParty();

    // Model a lost non-berry item this battle (e.g. a knocked-off Leftovers).
    const startingLeftovers = heldItemsFor(user.id).find(m => m.type?.id === "LEFTOVERS")!;
    user.loseHeldItem(startingLeftovers);
    // After the loss, the user is no longer holding it and it is ledgered.
    expect(
      heldItemsFor(user.id).some(m => m.type?.id === "LEFTOVERS"),
      "Leftovers gone after loss",
    ).toBe(false);
    expect(user.battleData.lostItems.map(r => r.typeId)).toContain("LEFTOVERS");

    game.move.use(byName("Fetch").id, 0);
    game.doSelectPartyPokemon(1); // switch to the ally
    await game.toEndOfTurn();

    // The lost Leftovers is retrieved as a fresh held item on the user...
    expect(
      heldItemsFor(user.id).some(m => m.type?.id === "LEFTOVERS"),
      "the lost Leftovers was retrieved by Fetch",
    ).toBe(true);
    expect(user.battleData.lostItems, "the retrieved item left the ledger").toHaveLength(0);

    // ...and the user switched to its ally.
    expect(game.field.getPlayerPokemon(), "user switched to the ally").toBe(bench);
    expect(user.isOnField(), "the user left the field").toBe(false);
  }, 120_000);
});
