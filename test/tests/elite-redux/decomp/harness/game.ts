/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import type Phaser from "phaser";
import { vi } from "vitest";
import type { World } from "./world";

/**
 * A fresh GameManager inside a test that already used one. The framework allows exactly one prompt
 * handler interval per test, so the previous one is cleared first (what the global afterEach does).
 */
export function freshGame(phaserGame: Phaser.Game): GameManager {
  // The previous manager's prompt handler spies on the shared scene UI; a second spy on top recurses forever.
  vi.restoreAllMocks();
  clearInterval(PromptHandler.runInterval);
  PromptHandler.runInterval = undefined;
  return new GameManager(phaserGame);
}

export interface WorldSetup {
  readonly holder?: SpeciesId;
  readonly foe?: SpeciesId;
}

/** Starts one real battle (Blissey against a Magikarp that only Splashes) and returns its two Pokemon. */
export async function startWorld(phaserGame: Phaser.Game, setup: WorldSetup = {}): Promise<World> {
  const game = freshGame(phaserGame);
  game.override
    .battleStyle("single")
    .moveset([MoveId.SPLASH])
    .ability(AbilityId.BALL_FETCH)
    .startingLevel(100)
    .enemySpecies(setup.foe ?? SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset(MoveId.SPLASH)
    .criticalHits(false);
  await game.classicMode.startBattle(setup.holder ?? SpeciesId.BLISSEY);
  return { game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() };
}
