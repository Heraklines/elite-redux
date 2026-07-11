/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Mental Pollution (816) — "Applies ability suppression to OTHER Pokémon when
// the user becomes enraged. Suppression lasts while those Pokémon remain on the
// field." (#53)
//
// The old wire used a PostDefend SuppressAttackerAbilityAbAttr, which fired ONLY
// when a foe LANDED an attack on the enraged holder — a foe that never attacked
// kept its ability. The fix broadcasts a FIELD-WIDE suppression keyed on the
// holder's ER_ENRAGE state (read in Pokemon.canApplyAbility), self-exempt.
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
const MENTAL_POLLUTION = (ER_ID_MAP.abilities[816] ?? 816) as AbilityId;

describe.skipIf(!RUN)("ER Mental Pollution — on-enrage field ability suppression (#53)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.EARTHQUAKE])
      .criticalHits(false);
  });

  it("suppresses a non-attacking foe's ability the instant the holder is enraged, and lifts when it ends", async () => {
    // The foe holds Levitate and NEVER attacks — the exact case the old
    // PostDefend wire missed.
    game.override.ability(MENTAL_POLLUTION).enemyAbility(AbilityId.LEVITATE);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Before enrage: the foe's ability is active.
    expect(enemy.hasAbility(AbilityId.LEVITATE), "foe keeps Levitate before enrage").toBe(true);

    // The holder becomes enraged (ER_ENRAGE, lasts until switch-out).
    player.addTag(BattlerTagType.ER_ENRAGE, 1, undefined, player.id);

    // The foe's ability is now suppressed even though it never attacked.
    expect(enemy.hasAbility(AbilityId.LEVITATE), "foe's Levitate suppressed once holder enraged").toBe(false);
    // The enraged holder is self-exempt — it keeps its own ability.
    expect(
      player.hasAbility(MENTAL_POLLUTION),
      "the enraged Mental Pollution holder keeps its own ability (self-exempt)",
    ).toBe(true);

    // Suppression lifts when the holder is no longer enraged.
    player.removeTag(BattlerTagType.ER_ENRAGE);
    expect(enemy.hasAbility(AbilityId.LEVITATE), "foe's Levitate active again once enrage ends").toBe(true);
  }, 120_000);

  it("live: with the foe's Levitate suppressed, the holder's Ground move connects", async () => {
    game.override.ability(MENTAL_POLLUTION).enemyAbility(AbilityId.LEVITATE);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Enrage the holder, then hit the (non-attacking) Levitate foe with Earthquake.
    player.addTag(BattlerTagType.ER_ENRAGE, 1, undefined, player.id);
    game.move.select(MoveId.EARTHQUAKE);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(enemy.hp, "Earthquake damaged the foe — Levitate immunity was suppressed").toBeLessThan(enemy.getMaxHp());
  }, 120_000);
});
