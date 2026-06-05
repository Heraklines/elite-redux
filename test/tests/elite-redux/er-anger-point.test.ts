/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Anger Point (ability 83): "Getting hit raises Atk by +1. Critical hits
// maximize Attack." i.e. +1 on EVERY connected damaging hit (any category, not
// physical-only, not crit-only), and a full maximize on crits. A prior rider was
// removed under #224 ("triggers when it shouldn't"), which left non-crit hits
// doing nothing — the reported "I was at +0 and it didn't activate". This re-adds
// the +1-on-any-hit via StatTriggerOnHitAbAttr; the crit-maximize lives in the
// base ability.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Anger Point — +1 Atk on any hit, max on crit", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false) // a plain, NON-crit hit
      .ability(AbilityId.ANGER_POINT) // on the player (the one getting hit)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("a non-crit physical hit raises the holder's Attack by +1", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    game.move.use(MoveId.SPLASH); // player does nothing; enemy Tackles it
    await game.toEndOfTurn();

    // ER: +1 on any connected damaging hit (here a non-crit physical Tackle).
    expect(player.getStatStage(Stat.ATK)).toBe(1);
  });

  it("a non-crit SPECIAL hit also raises Attack (not physical-only)", async () => {
    game.override.enemyMoveset(MoveId.SWIFT); // special, never-miss
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.ATK)).toBe(1);
  });

  it("a CRITICAL hit maximizes Attack", async () => {
    game.override.criticalHits(true);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.ATK)).toBe(6); // clamped maximize
  });
});
