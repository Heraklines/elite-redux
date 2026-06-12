/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#425): a player's Zekrom with the Overwhelm innate ("Hits Fairies
// with Dragon moves") STILL LOCKED could hit Fairy types with Dragon moves.
// The "registration-free" name-scan sites (OffensiveTypeChartOverrideAbAttr
// and friends) read getAbility().attrs + getPassiveAbilities() RAW, bypassing
// the per-slot candy-unlock gating in canApplyAbility. The fix routes every
// such site through Pokemon.getAllActiveAbilityAttrs(), which mirrors
// getAbilityAttrs' gating (slot unlocks, enemy level slot-limit, id dedup).
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
import { AbilityId as Ability } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Overwhelm is ER ability 328; resolve its registered PokeRogue ability id
// LAZILY (the id-map is populated during game init, not at module load).
const overwhelm = () => ER_ID_MAP.abilities[328] as AbilityId;

describe("ER #425 - locked innates must not leak into the type chart", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Pin the ACTIVE abilities to something inert on both sides so only the
    // innate-slot gating decides the outcome.
    game.override.enemySpecies(SpeciesId.CLEFABLE).enemyAbility(Ability.BALL_FETCH).ability(Ability.BALL_FETCH);
  });

  it("Overwhelm resolves to a registered ability id", () => {
    expect(overwhelm()).toBeDefined();
  });

  it("Dragon stays IMMUNE vs Fairy while the attacker's Overwhelm innate is locked", async () => {
    await game.classicMode.startBattle(SpeciesId.ZEKROM);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    // Fresh starter = no candy unlocks (starterData passiveAttr 0): every
    // innate slot, Overwhelm included, is locked. Dragon vs Fairy must be 0x.
    expect(enemy.getAttackTypeEffectiveness(PokemonType.DRAGON, { source: player })).toBe(0);
  });

  it("Dragon hits Fairy neutrally once Overwhelm is ACTIVE", async () => {
    game.override.passiveAbility(overwhelm());
    await game.classicMode.startBattle(SpeciesId.ZEKROM);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.getAttackTypeEffectiveness(PokemonType.DRAGON, { source: player })).toBe(1);
  });
});
