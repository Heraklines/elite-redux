/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Musical Notes — "Status moves become sound-based." Injects SOUND_BASED onto
// the holder's status moves; consumers on the user-aware doesFlagEffectApply
// path (e.g. Substitute-bypass) then treat them as sound.
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Musical Notes", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH);
  });

  // A non-sound status move and a damaging move, resolved by category/flag.
  const statusMove = () =>
    allMoves.find(m => m && m.category === MoveCategory.STATUS && !m.hasFlag(MoveFlags.SOUND_BASED))!;
  const damagingMove = () =>
    allMoves.find(m => m && m.category !== MoveCategory.STATUS && !m.hasFlag(MoveFlags.SOUND_BASED))!;

  test("the holder's status moves are treated as sound (user-aware flag)", async () => {
    game.override.ability(ErAbilityId.MUSICAL_NOTES as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    // Status move → injected sound.
    expect(statusMove().doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: player })).toBe(true);
    // Damaging move → NOT injected (status-moves scope only).
    expect(damagingMove().doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: player })).toBe(false);
  });

  test("without Musical Notes, status moves are not sound", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    expect(statusMove().doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: player })).toBe(false);
  });
});
