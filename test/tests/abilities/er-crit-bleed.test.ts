/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — crit-gated bleed abilities (previously approximated as a flat
// 20%-on-any-hit bleed, or the bleed piece deferred entirely):
//
//   - RAZOR_SHARP — landing a critical hit inflicts ER_BLEED
//   - TO_THE_BONE — crits get +1.5x AND inflict ER_BLEED
//
// Asserts the bleed lands ONLY on a crit (the critRequired gate).
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

describe("ER abilities — Razor Sharp / To The Bone (crit-bleed)", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE]);
  });

  test("Razor Sharp — a critical hit inflicts ER_BLEED on the target", async () => {
    game.override.ability(ErAbilityId.RAZOR_SHARP as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    vi.spyOn(enemy, "getCriticalHitResult").mockReturnValue(true);
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });

  test("Razor Sharp — a non-crit hit does NOT inflict bleed", async () => {
    game.override.ability(ErAbilityId.RAZOR_SHARP as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    // criticalHits(false) + no mock → never crits.
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
  });

  test("To The Bone — a critical hit inflicts ER_BLEED on the target", async () => {
    game.override.ability(ErAbilityId.TO_THE_BONE as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    vi.spyOn(enemy, "getCriticalHitResult").mockReturnValue(true);
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });
});
