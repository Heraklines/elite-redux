/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex: Razor Wind is a no-charge FLYING move that gains "+1 priority in
// Tailwind" (community report 2026-06-2x). Mechanism mirrors Grassy Glide's
// terrain priority: IncrementMovePriorityAttr read in Move.getPriority with
// target=null, condition reads only `user`. Grant +1 while the user's side has
// the Tailwind arena tag.
//
// Verified two ways (the established #103 pattern + an in-battle turn-order
// proof): (1) Move.getPriority(holder) flips 0 -> 1 when Tailwind is up; (2) a
// SLOW holder under Tailwind moves BEFORE a faster foe's 0-priority move (the
// priority bracket dominates speed, so this isolates the bonus from Tailwind's
// own speed-doubling).
//
// Gated behind ER_SCENARIO=1 (ER move patches require ER init).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Razor Wind - +1 priority in Tailwind", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.WONDER_GUARD)
      .enemySpecies(SpeciesId.SHEDINJA)
      .enemyMoveset(MoveId.SPORE)
      .moveset([MoveId.RAZOR_WIND])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
  });

  it("getPriority flips 0 -> 1 only while the user's side has Tailwind", async () => {
    // Munchlax (base speed 5) is far slower than Shedinja even with Tailwind's
    // x2 (so the in-battle test below isolates the priority bonus from speed).
    await game.classicMode.startBattle(SpeciesId.MUNCHLAX);
    const player = game.field.getPlayerPokemon();
    const razorWind = allMoves[MoveId.RAZOR_WIND];

    expect(razorWind.getPriority(player)).toBe(0);

    game.scene.arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, player.id, ArenaTagSide.PLAYER);
    expect(razorWind.getPriority(player)).toBe(1);

    // Foe-side Tailwind must NOT grant the player the bonus.
    game.scene.arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    game.scene.arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, player.id, ArenaTagSide.ENEMY);
    expect(razorWind.getPriority(player)).toBe(0);
  });

  it("control: WITHOUT Tailwind the faster Shedinja Spores the slow holder first", async () => {
    await game.classicMode.startBattle(SpeciesId.MUNCHLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.RAZOR_WIND);
    await game.toEndOfTurn();

    // Shedinja (faster, 0-priority Spore) acted before Razor Wind -> holder asleep.
    expect(player.status?.effect).toBe(StatusEffect.SLEEP);
  });

  it("in battle: under Tailwind the slow holder's Razor Wind resolves BEFORE the faster foe", async () => {
    await game.classicMode.startBattle(SpeciesId.MUNCHLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Tailwind up on the player's side; Munchlax x2 speed (=10) is still far below
    // Shedinja's, so going first can ONLY be the +1 priority bracket.
    game.scene.arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, player.id, ArenaTagSide.PLAYER);

    game.move.use(MoveId.RAZOR_WIND);
    await game.toEndOfTurn();

    // Razor Wind (Flying, SE vs Bug -> bypasses Wonder Guard) KOs the 1-HP Shedinja
    // before it can Spore -> holder is NOT asleep.
    expect(enemy.isFainted()).toBe(true);
    expect(player.status?.effect).not.toBe(StatusEffect.SLEEP);
  });
});
