/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER audit batch — Corrupted Mind (Psychic resist/immunity bypass) + Hover
// (adds Psychic type + Ground immunity).

import { AttackTypeImmunityAbAttr } from "#abilities/ab-attrs";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER audit batch 1", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  test("Corrupted Mind — Psychic hits Dark (immune) for at least neutral (1x)", async () => {
    game.override.ability(ErAbilityId.CORRUPTED_MIND as unknown as AbilityId).enemySpecies(SpeciesId.UMBREON); // pure Dark
    await game.classicMode.startBattle(SpeciesId.MEWTWO);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getAttackTypeEffectiveness(PokemonType.PSYCHIC, { source: player })).toBe(1);
  });

  test("Hover — adds Psychic type on entry and is immune to Ground", async () => {
    game.override.ability(ErAbilityId.HOVER as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.RATTATA); // pure Normal -> becomes Normal/Psychic
    const player = game.field.getPlayerPokemon();
    expect(player.isOfType(PokemonType.PSYCHIC)).toBe(true);
    // Ground immunity via the Levitate-style AttackTypeImmunity primitive
    // (applied through the MoveImmunity path, same as vanilla Levitate).
    const immunity = player.getAbility().attrs.find(a => a instanceof AttackTypeImmunityAbAttr);
    expect(immunity).toBeDefined();
  });
});
