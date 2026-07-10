/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Illusion (149): "Appears as the last alive party member. Boosts the holder's
// damage by 30% until the illusion breaks."
//
// The ability was orphaned in this fork (all attrs commented out, builder ended
// in .unimplemented()). Restored the vanilla Illusion attrs and added the ER
// +30% damage delta (MovePowerBoost gated on the illusion being intact).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Illusion — disguise + 30% damage until it breaks", () => {
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
      .ability(AbilityId.ILLUSION)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("summons disguised as the last party member and does not crash", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FERALIGATR);
    const player = game.field.getPlayerPokemon();

    // The illusion is active and mirrors the last alive party member (Feraligatr).
    expect(player.summonData.illusion, "illusion is active on summon").not.toBeNull();
    expect(player.summonData.illusion?.species).toBe(SpeciesId.FERALIGATR);
  });

  it("boosts the holder's move power by 30% while the illusion is intact, then not after it breaks", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FERALIGATR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const darkPulse = allMoves[MoveId.DARK_PULSE];
    const ratio = () =>
      darkPulse.calculateBattlePower(player, enemy, true, false)
      / darkPulse.calculateBattlePower(player, enemy, true, true);

    // Illusion intact -> +30%.
    expect(player.summonData.illusion).not.toBeNull();
    expect(ratio()).toBeCloseTo(1.3, 2);

    // Break the illusion -> the boost is gone.
    player.breakIllusion();
    expect(player.summonData.illusion ?? null).toBeNull();
    expect(ratio()).toBeCloseTo(1.0, 2);
  });
});
