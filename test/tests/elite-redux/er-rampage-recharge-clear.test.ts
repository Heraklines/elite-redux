/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — on-KO recharge clear (275 Rampage + 480 Berserker Rage).
//
// DEX (2.65):
//   - Rampage (275): "Rampage eliminates recharge turns when the user
//     successfully KOs an opponent with a direct attack."
//   - Berserker Rage (480): "...When the user knocks out an opponent, it
//     instantly recovers from recharge status, allowing immediate use of moves
//     like Hyper Beam without waiting." (composite: Tipping Point + Rampage)
//
// A recharge move (Hyper Beam / Giga Impact) applies the RECHARGING tag to its
// user, locking it into a recharge turn. PostVictoryClearRechargeAbAttr removes
// that tag (and the placeholder move it queued) when the holder scores a KO, so
// the holder acts freely next turn. Verified in a DOUBLE battle so the holder
// KOs ONE foe with Hyper Beam while the other foe survives and the battle
// continues (a single wild KO would end the wave).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import type { AbAttr } from "#data/abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { PostVictoryClearRechargeAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-recharge";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER Rampage / Berserker Rage — recharge clears on KO", () => {
  it("275 Rampage wires PostVictoryClearRechargeAbAttr", () => {
    const attrs: readonly AbAttr[] = dispatchArchetype("bespoke", null, 275).attrs;
    expect(attrs.some(a => a instanceof PostVictoryClearRechargeAbAttr)).toBe(true);
  });

  it("480 Berserker Rage (composite Tipping Point + Rampage) inherits the recharge clear", () => {
    const attrs: readonly AbAttr[] = dispatchArchetype("composite-vanilla-mashup", null, 480).attrs;
    expect(
      attrs.some(a => a instanceof PostVictoryClearRechargeAbAttr),
      "Berserker Rage's Rampage part should carry the recharge clear",
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
        .battleStyle("double")
        .criticalHits(false)
        .moveset([MoveId.HYPER_BEAM, MoveId.SPLASH])
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .enemyLevel(1)
        .startingLevel(100);
      // The test framework does NOT force accuracy rolls to hit; pin Hyper Beam
      // to 100% so the KO (and thus the recharge lock) is deterministic.
      vi.spyOn(allMoves[MoveId.HYPER_BEAM], "accuracy", "get").mockReturnValue(100);
    });

    it("WITH Rampage: a Hyper Beam KO leaves the holder recharge-free", async () => {
      game.override.ability(ErAbilityId.RAMPAGE as unknown as AbilityId);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
      const holder = game.scene.getPlayerField()[0];

      // Slot 0 Hyper Beams enemy slot 0 (a frail lv-1 Magikarp → KO); slot 1 idles.
      game.move.select(MoveId.HYPER_BEAM, 0, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, 1);
      await game.toEndOfTurn();

      expect(game.scene.getEnemyField()[0].isFainted(), "the targeted foe was KO'd").toBe(true);
      expect(
        holder.getTag(BattlerTagType.RECHARGING),
        "Rampage cleared the recharge lock after the KO",
      ).toBeUndefined();
      expect(
        holder.getMoveQueue().some(m => m.move === MoveId.NONE),
        "the recharge placeholder move was dropped from the queue",
      ).toBe(false);
    }, 40000);

    it("WITHOUT Rampage (control): a Hyper Beam KO still locks the holder into recharge", async () => {
      game.override.ability(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
      const holder = game.scene.getPlayerField()[0];

      game.move.select(MoveId.HYPER_BEAM, 0, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, 1);
      await game.toEndOfTurn();

      expect(game.scene.getEnemyField()[0].isFainted()).toBe(true);
      expect(holder.getTag(BattlerTagType.RECHARGING), "without Rampage the holder is recharge-locked").toBeDefined();
    }, 40000);
  });
});
