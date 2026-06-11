/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#399) - Minion Control (ER 592): "+1 hit per healthy party
// member" hit up to 6 TIMES AT FULL POWER (big community report; Redux
// Alakazam). Like Parental Bond, every strike past the first now deals 25%
// damage (a full 6-hit volley totals ~200%, not 600%).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Minion Control extra strikes deal reduced damage (#399)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override.ability(ErAbilityId.MINION_CONTROL as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });

  it("strike 2+ of a Minion Control volley deals ~25% of strike 1", () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Simulate a 6-hit volley: first strike (hitsLeft === hitCount) ...
    player.turnData.hitCount = 6;
    player.turnData.hitsLeft = 6;
    const first = enemy.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE] }).damage;

    // ... then a later strike of the same volley.
    player.turnData.hitsLeft = 4;
    const later = enemy.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE] }).damage;

    expect(first).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(0);
    // 25% nominal; allow the 85-100% random damage roll spread on both sides.
    expect(later).toBeLessThan(first * 0.35);
  });
});
