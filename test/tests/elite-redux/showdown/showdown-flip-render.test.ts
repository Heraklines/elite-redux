/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST perspective flip - RENDER wiring (C5v2d), ER_SCENARIO / GameManager.
// PRESENTATION ONLY: with the flip active (versus GUEST) the guest's OWN team (authoritatively the
// ENEMY side) renders on the BOTTOM (player base y) with BACK sprites, and the opponent (the host's
// team = the PLAYER side) renders on the TOP (enemy base y) with FRONT sprites. Off the versus-guest
// path the flip is IDENTITY, so solo / co-op / host construct byte-identically. The flip is driven
// through the cycle-free gate; the render sites live at construction (base x/y) + live sprite-key.
// =============================================================================

import { setShowdownGuestFlipPredicate } from "#data/elite-redux/coop/coop-authoritative-gate";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// The canonical per-class base container coordinates (player bottom-right area / enemy top).
const PLAYER_BASE_Y = 148;
const ENEMY_BASE_Y = 84;

describe.skipIf(!RUN)("Showdown guest perspective flip - render wiring (C5v2d)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });

  afterEach(() => {
    // Never leak the flip predicate into the next file (it would flip an unrelated run's render).
    setShowdownGuestFlipPredicate(null);
  });

  it("off the versus-guest path: base positions + sprite orientation are byte-identical", () => {
    const species = getPokemonSpecies(SpeciesId.PIKACHU);
    const player = game.scene.addPlayerPokemon(species, 50);
    const enemy = game.scene.addEnemyPokemon(species, 50, TrainerSlot.NONE);

    // No session -> no flip: player bottom, enemy top.
    expect(player.y).toBe(PLAYER_BASE_Y);
    expect(enemy.y).toBe(ENEMY_BASE_Y);
    // Default orientation: player faces away (back), enemy faces the player (front).
    expect(player.getBattleSpriteKey()).toBe(player.getBattleSpriteKey(true));
    expect(enemy.getBattleSpriteKey()).toBe(enemy.getBattleSpriteKey(false));
    expect(enemy.getBattleSpriteKey()).not.toBe(enemy.getBattleSpriteKey(true));
  });

  it("versus guest: the OWN team (enemy side) renders BOTTOM with BACK sprites", () => {
    const species = getPokemonSpecies(SpeciesId.PIKACHU);

    // Live sprite-key flip on a single instance (position is construction-time, key is live).
    const enemy = game.scene.addEnemyPokemon(species, 50, TrainerSlot.NONE);
    const frontKey = enemy.getBattleSpriteKey(); // off-path default: front
    setShowdownGuestFlipPredicate(() => true);
    const flippedKey = enemy.getBattleSpriteKey(); // flip default: back
    expect(flippedKey).toBe(enemy.getBattleSpriteKey(true)); // the explicit BACK key
    expect(flippedKey).not.toBe(frontKey);

    // Construction-time base swap: with the flip active, a fresh EnemyPokemon (the guest's own team)
    // sits at the PLAYER bottom, and a fresh PlayerPokemon (the opponent) sits at the ENEMY top.
    const ownMon = game.scene.addEnemyPokemon(species, 50, TrainerSlot.NONE);
    const opponentMon = game.scene.addPlayerPokemon(species, 50);
    expect(ownMon.y).toBe(PLAYER_BASE_Y);
    expect(opponentMon.y).toBe(ENEMY_BASE_Y);
    // The opponent (Player instance flipped to top) faces the guest: FRONT sprite.
    expect(opponentMon.getBattleSpriteKey()).toBe(opponentMon.getBattleSpriteKey(false));
  });

  it("clearing the flip predicate restores the identity render (no leak)", () => {
    const species = getPokemonSpecies(SpeciesId.PIKACHU);
    setShowdownGuestFlipPredicate(() => true);
    setShowdownGuestFlipPredicate(null);
    const enemy = game.scene.addEnemyPokemon(species, 50, TrainerSlot.NONE);
    expect(enemy.y).toBe(ENEMY_BASE_Y);
    expect(enemy.getBattleSpriteKey()).toBe(enemy.getBattleSpriteKey(false));
  });
});
