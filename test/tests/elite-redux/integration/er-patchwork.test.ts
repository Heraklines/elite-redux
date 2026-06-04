/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Patchwork 693 — "Disguise + curses the opponent when its Disguise breaks."
// Verifies the ER-specific rider: the vanilla Disguise block fires AND the
// attacker that broke the disguise gains the CURSED battler tag. (The fog-
// restore sub-effect is a separate mechanic, not covered here.)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Patchwork (693)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("curses the attacker when the disguise breaks, and blocks the breaking hit", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[693] as AbilityId) // Patchwork (Disguise + curse)
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Shadow Ball is Ghost-type — Mimikyu (Ghost/Fairy) is NOT immune to it
      // (unlike Normal moves), so the disguise actually takes the hit and breaks.
      .enemyMoveset([MoveId.SHADOW_BALL]);
    // Mimikyu has the disguised (formIndex 0) / busted forms, so the block fires.
    await game.classicMode.startBattle([SpeciesId.MIMIKYU]);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = player.hp;
    expect(enemy.getTag(BattlerTagType.CURSED)).toBeUndefined();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // The attacker that broke the disguise is now cursed.
    expect(enemy.getTag(BattlerTagType.CURSED)).toBeDefined();
    // The breaking hit was blocked: the player only lost the 1/8 disguise recoil,
    // far less than a full Shadow Ball would deal.
    const lost = hpBefore - player.hp;
    expect(lost).toBeLessThanOrEqual(Math.ceil(player.getMaxHp() / 8) + 1);
  });
});
