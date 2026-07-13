/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER anti-vitamin-stacking: in every enemy TRAINER battle, the team's highest-BST
// mon mirrors the player's vitamin investment - it gets N base-stat boosters
// (vitamins) randomly distributed, where N = the MOST vitamins on any one player
// mon. Kills the "dump every vitamin on one lead" strategy. ER_SCENARIO=1 gated.

import { modifierTypes } from "#data/data-lists";
import { applyErTrainerVitaminCatchup } from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { BaseStatModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { BaseStatBoosterModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const vitaminTotalOn = (game: GameManager, pokemonId: number, isPlayer: boolean): number =>
  game.scene
    .findModifiers(
      m => m instanceof BaseStatModifier && (m as PokemonHeldItemModifier).pokemonId === pokemonId,
      isPlayer,
    )
    .reduce((s, m) => s + (m as BaseStatModifier).getStackCount(), 0);

describe.skipIf(!RUN)("ER trainer vitamin mirror (anti-stacking)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    // wave 5 = the fixed Youngster/Lass trainer battle (so currentBattle.trainer is set)
    game.override.battleStyle("single").startingWave(5).startingLevel(50).ability(AbilityId.BALL_FETCH);
  });

  it("the trainer's highest-BST mon mirrors the player's most-stacked mon's vitamin count", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);

    // Stack 12 ATK vitamins on the player lead - the strategy we want to punish.
    const lead = game.scene.getPlayerParty()[0];
    const vitaminType = new BaseStatBoosterModifierType(Stat.ATK);
    vitaminType.withIdFromFunc(modifierTypes.BASE_STAT_BOOSTER);
    const vit = vitaminType.newModifier(lead) as PokemonHeldItemModifier;
    vit.stackCount = 12;
    game.scene.addModifier(vit, true);

    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty.length).toBeGreaterThan(0);

    // The initial battle generation ran with 0 player vitamins (no-op). Re-run now.
    applyErTrainerVitaminCatchup(enemyParty);

    // Apex enemy mon by active-form BST (first max on ties), matching the feature.
    let apex = enemyParty[0];
    let best = apex.getSpeciesForm().baseTotal;
    for (const e of enemyParty) {
      const b = e.getSpeciesForm().baseTotal;
      if (b > best) {
        best = b;
        apex = e;
      }
    }

    // The apex mirrors the player's 12 vitamins (spread across stats, capped per stat).
    expect(vitaminTotalOn(game, apex.id, false)).toBe(12);
    expect(
      game.scene
        .findModifiers(m => m instanceof BaseStatModifier && m.pokemonId === apex.id, false)
        .every(m => m.type.id === "BASE_STAT_BOOSTER"),
      "hand-built enemy vitamins retain the registry id required by ModifierData",
    ).toBe(true);

    // A non-apex enemy mon gets none.
    const nonApex = enemyParty.find(e => e !== apex);
    if (nonApex) {
      expect(vitaminTotalOn(game, nonApex.id, false)).toBe(0);
    }

    // Idempotent: a second pipeline pass must NOT stack more (the WeakSet guard).
    applyErTrainerVitaminCatchup(enemyParty);
    expect(vitaminTotalOn(game, apex.id, false)).toBe(12);
  });

  it("no player vitamins => no enemy mirror", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const enemyParty = game.scene.getEnemyParty();
    applyErTrainerVitaminCatchup(enemyParty);
    for (const e of enemyParty) {
      expect(vitaminTotalOn(game, e.id, false)).toBe(0);
    }
  });
});
