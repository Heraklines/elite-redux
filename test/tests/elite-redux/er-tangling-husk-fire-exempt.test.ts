/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Tangling Husk (2.65 dex id 955): "Protects against non-Fire-type moves.
// Slows attackers on contact." i.e. a Silk-Trap-style protect (blocks the move
// AND drops a CONTACT attacker's Speed by 1) EXCEPT that Fire-type moves are
// exempt — they bypass the protection entirely and hit normally (and, since a
// Fire move is never blocked here, it does NOT trigger the -1 Speed on-contact
// reaction).
//
// Previously wired as a plain SILK_TRAP protect, which blocked ALL types
// including Fire. This is the Fire-exempt variant (ER_TANGLING_HUSK tag /
// ErTanglingHuskProtectedTag).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** ER move id 955 (Tangling Husk) -> its PokeRogue MoveId. */
const TANGLING_HUSK = ER_ID_MAP.moves[955] as MoveId;

describe.skipIf(!RUN)("ER Tangling Husk — Fire-exempt protect (dex 955)", () => {
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
      .ability(AbilityId.BALL_FETCH) // neutral player ability (no move-type munging)
      .enemySpecies(SpeciesId.SNORLAX) // bulky: survives a single hit so damage is observable
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(TANGLING_HUSK) // the enemy raises Tangling Husk every turn
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("a Fire-type move BYPASSES Tangling Husk and hits normally", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    expect(enemy.hp).toBe(enemy.getMaxHp());

    game.move.use(MoveId.FLAMETHROWER); // Fire, non-contact
    await game.toEndOfTurn();

    // Fire is exempt: the protect is up (enemy used Tangling Husk) but the move lands.
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    // A Fire move is never blocked here, so no on-contact Speed drop and no "protected itself".
    expect(player.getStatStage(Stat.SPD)).toBe(0);
  });

  it("a non-Fire move is BLOCKED by Tangling Husk", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.SURF); // Water, non-contact
    await game.toEndOfTurn();

    // Non-Fire: blocked, no damage dealt.
    expect(enemy.hp).toBe(enemy.getMaxHp());
  });

  it("a non-Fire CONTACT move is blocked AND drops the attacker's Speed by 1", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.SPD)).toBe(0);

    game.move.use(MoveId.TACKLE); // Normal, contact
    await game.toEndOfTurn();

    // Non-Fire contact: blocked (no damage) AND the SILK_TRAP-style -1 Speed reaction fires.
    expect(enemy.hp).toBe(enemy.getMaxHp());
    expect(player.getStatStage(Stat.SPD)).toBe(-1);
  });

  it("regression: vanilla Silk Trap still blocks Fire-type moves (Fire is NOT exempt)", async () => {
    game.override.enemyMoveset(MoveId.SILK_TRAP);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.FLAMETHROWER); // Fire
    await game.toEndOfTurn();

    // Vanilla Silk Trap has no Fire exemption: the Fire move is blocked (no damage),
    // and since Flamethrower is non-contact there is no Speed drop.
    expect(enemy.hp).toBe(enemy.getMaxHp());
    expect(player.getStatStage(Stat.SPD)).toBe(0);
  });
});
