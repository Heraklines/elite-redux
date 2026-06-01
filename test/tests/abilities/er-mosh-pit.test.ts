/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Mosh Pit (er id 672 / pkrg 5376).
//
// ROM/dex: "Ally's attacks get a 1.25x boost. 1.5x if attack causes recoil."
//
// Previously mis-wired as a permanent +1 ATK self-buff (PostAllyFaintStat-
// Change), which is the wrong target AND the wrong mechanic. Now a faithful
// ally-damage aura (AllyAttackPowerBoostAbAttr) routed through the same
// move.ts path as Power Spot/Battery. These tests assert the EFFECT on an
// ally's move power, not just the wiring.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER Abilities - Mosh Pit", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .ability(ErAbilityId.MOSH_PIT as unknown as AbilityId)
      .moveset([MoveId.TACKLE, MoveId.DOUBLE_EDGE, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  it("boosts an ally's non-recoil attack by 1.25x", async () => {
    const moveToCheck = allMoves[MoveId.TACKLE];
    const basePower = moveToCheck.power;
    vi.spyOn(moveToCheck, "calculateBattlePower");

    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    game.move.select(MoveId.TACKLE, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(moveToCheck.calculateBattlePower).toHaveReturnedWith(basePower * 1.25);
  });

  it("boosts an ally's recoil attack by 1.5x instead", async () => {
    const moveToCheck = allMoves[MoveId.DOUBLE_EDGE];
    const basePower = moveToCheck.power;
    vi.spyOn(moveToCheck, "calculateBattlePower");

    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    game.move.select(MoveId.DOUBLE_EDGE, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(moveToCheck.calculateBattlePower).toHaveReturnedWith(basePower * 1.5);
  });
});
