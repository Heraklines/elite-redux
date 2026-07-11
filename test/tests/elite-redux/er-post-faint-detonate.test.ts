/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — TRUE any-KO detonation (729 Victory Bomb + 614 Balloon Bomb).
//
// DEX (2.65):
//   - Victory Bomb (729): "When fainting, retaliate with a 100 BP Fire-type
//     Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless
//     of how the user was KOed."
//   - Balloon Bomb (614): "Uses a 100 BP Explosion or Outburst (whichever is
//     higher) when knocked out. Using explosion moves will always Flinch the
//     target. When hit by any Fire or Flying moves, boost Defense and Special
//     Defense by one stage each."
//
// The prior wiring used a PreDefend-endure clamp gated on a lethal DAMAGING
// hit, so a status / weather / recoil / hazard KO never detonated. Both now use
// the shared TRUE on-faint hook PostFaintSpreadDetonateAbAttr, which fires from
// FaintPhase on ANY KO cause. This test kills the holder with a NON-damaging
// cause (end-of-turn poison chip) and asserts the detonation still damages the
// adjacent foe.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import type { AbAttr } from "#data/abilities/ab-attrs";
import { PostAttackApplyBattlerTagAbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { PostFaintSpreadDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-spread-detonate";
import { StatTriggerOnHitAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER Victory/Balloon Bomb — TRUE any-KO detonation", () => {
  it("614 Balloon Bomb (bespoke) wires Inflatable stat-trigger + true detonate + explosion-flinch", () => {
    const attrs: readonly AbAttr[] = dispatchArchetype("bespoke", null, 614).attrs;
    expect(
      attrs.some(a => a instanceof StatTriggerOnHitAbAttr),
      "Inflatable Fire/Flying stat-trigger",
    ).toBe(true);
    const detonate = attrs.find(a => a instanceof PostFaintSpreadDetonateAbAttr) as
      | PostFaintSpreadDetonateAbAttr
      | undefined;
    expect(detonate, "true any-KO detonate primitive").toBeDefined();
    expect(detonate?.getPower()).toBe(100);
    expect(
      attrs.some(a => a instanceof PostAttackApplyBattlerTagAbAttr),
      "explosion-flinch rider",
    ).toBe(true);
  });

  describe.skipIf(!RUN)("behavior", () => {
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
        .moveset(MoveId.SPLASH)
        .ability(AbilityId.BALL_FETCH)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset(MoveId.SPLASH)
        .enemyStatusEffect(StatusEffect.POISON)
        .enemyLevel(100)
        .startingLevel(100);
    });

    it("729 Victory Bomb detonates on a NON-damaging (poison) KO and damages the adjacent foe", async () => {
      game.override.enemyAbility(ErAbilityId.VICTORY_BOMB as unknown as AbilityId);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // Force a non-damaging KO: the enemy dies to its own poison at end of turn.
      enemy.hp = 1;
      const playerHpBefore = player.hp;

      game.move.select(MoveId.SPLASH); // player does nothing; no damaging KO occurs
      await game.toEndOfTurn();

      expect(enemy.isFainted(), "enemy fainted to poison chip (a non-damaging cause)").toBe(true);
      expect(player.hp, "the detonation dealt a Fire spread hit to the adjacent player").toBeLessThan(playerHpBefore);
    }, 40000);

    it("614 Balloon Bomb detonates on a NON-damaging (poison) KO (shared primitive)", async () => {
      game.override.enemyAbility(ErAbilityId.BALLOON_BOMB as unknown as AbilityId);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      enemy.hp = 1;
      const playerHpBefore = player.hp;

      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(true);
      expect(player.hp, "Balloon Bomb detonation damaged the adjacent player").toBeLessThan(playerHpBefore);
    }, 40000);
  });
});
