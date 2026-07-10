/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-3 fix: Assassin's Tools (ER ability id 691) — "Contact moves have a 30%
// chance to poison, paralyze, OR bleed."
//
// The port previously wired TWO independent 30% rolls (one PostAttack status
// attr for POISON/PARALYSIS + one PostAttack ER_BLEED tag attr), so a single
// contact hit rolled ~51% total and could inflict a status AND bleed at once.
// The dex is ONE 30% roll that then picks a SINGLE outcome from the three.
//
// These tests pin the RNG so the proc always fires and assert that exactly ONE
// of {poison, paralysis, bleed} lands per hit — never two. The MIN-roll case is
// the discriminator: the old two-roll wiring would have applied poison AND
// ER_BLEED together.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const ASSASSINS_TOOLS = ER_ID_MAP.abilities[691] as AbilityId;

describe.skipIf(!RUN)("ER Assassin's Tools is a single pooled 30% proc (poison/paralyze/bleed)", () => {
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
      .startingLevel(50) // weak Tackle so it can't faint the tanky foe
      .enemyLevel(50)
      .ability(ASSASSINS_TOOLS)
      .enemyAbility(AbilityId.BALL_FETCH)
      // Chansey is Normal (poison-eligible, not Poison/Steel; bleed-eligible,
      // not Rock/Ghost), has enormous HP so Tackle can't faint it, and its
      // feeble attack can't faint the player Snorlax — so the turn completes.
      .enemySpecies(SpeciesId.CHANSEY)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH);
  });

  test("MIN roll picks a single status and does NOT also bleed (old two-roll regression)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    // Every roll returns its MIN: chance roll 0 (< 30 -> procs), outcome pick 0
    // -> the first pooled outcome (POISON). The bleed tag is index 2, so it must
    // NOT be applied. The old wiring rolled bleed separately and would apply it.
    const savedRng = BattleScene.prototype.randBattleSeedInt;
    BattleScene.prototype.randBattleSeedInt = (_range: number, min = 0) => min;
    try {
      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(enemy.status?.effect).toBe(StatusEffect.POISON);
      // The discriminator: a SINGLE outcome was picked, so no simultaneous bleed.
      expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    } finally {
      BattleScene.prototype.randBattleSeedInt = savedRng;
    }
  });

  test("pick index 2 inflicts ONLY ER_BLEED (no status)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    // Force the outcome pick (a range-3 draw) to 2 -> ER_BLEED; the chance roll
    // (range 100) falls to its min (0) and procs. Bleed lands, no status.
    const savedRng = BattleScene.prototype.randBattleSeedInt;
    BattleScene.prototype.randBattleSeedInt = (range: number, min = 0) => (range === 3 ? 2 : min);
    try {
      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
      expect(enemy.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
    } finally {
      BattleScene.prototype.randBattleSeedInt = savedRng;
    }
  });
});
