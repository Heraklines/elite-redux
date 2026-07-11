/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Eternal Flower (ability 979): "Reduces the stats of OTHER Megas by 20%."
//
// The old wire used a SAME-SIDE PersistentFieldAura, so it could only ever
// debuff the holder's OWN allied Megas (and was inert in singles) — the opposite
// of the dex, which targets OPPOSING Megas. It also flagged every alt-form via a
// loose `formIndex > 0`. Fixed with a cross-side Ruin-style aura
// (OpposingMegaStatSuppressAbAttr) gated on the canonical Pokemon.isMega().
//
// Proven here: an OPPOSING Mega's effective stats drop 20% (x0.8); the reduction
// requires the ability (control) and only bites Megas (a non-mega foe is
// untouched).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const ETERNAL_FLOWER = ER_ID_MAP.abilities[979] as AbilityId; // 5678

const MEGA_FORM_KEYS = [SpeciesFormKey.MEGA, SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y] as string[];

/** Put the pokemon into its (first) Mega form; returns whether one was found. */
function forceMega(pokemon: Pokemon): boolean {
  const idx = pokemon.species.forms.findIndex(f => MEGA_FORM_KEYS.includes(f.formKey));
  if (idx < 0) {
    return false;
  }
  pokemon.formIndex = idx;
  return pokemon.isMega();
}

describe.skipIf(!RUN)("ER Eternal Flower — reduces OPPOSING Mega stats by 20%", () => {
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
      .enemySpecies(SpeciesId.GENGAR)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingWave(145) // past the #419 BST cap so the Mega-BST foe isn't devolved
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("halves-to-0.8x the effective stats of an OPPOSING Mega", async () => {
    game.override.ability(ETERNAL_FLOWER);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    expect(forceMega(enemy)).toBe(true); // opposing Mega Gengar is on the field

    for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
      const raw = enemy.getStat(stat, false);
      // -20% Ruin-style field multiplier on every effective stat of the opposing Mega.
      expect(enemy.getEffectiveStat(stat)).toBe(Math.floor(raw * 0.8));
    }
  });

  it("control: WITHOUT Eternal Flower the opposing Mega's stats are unchanged", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    expect(forceMega(enemy)).toBe(true);
    for (const stat of [Stat.ATK, Stat.SPATK, Stat.SPD] as const) {
      const raw = enemy.getStat(stat, false);
      expect(enemy.getEffectiveStat(stat)).toBe(raw);
    }
  });

  it("does NOT touch a NON-mega opponent (tightened past formIndex>0)", async () => {
    game.override.ability(ETERNAL_FLOWER);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();

    // Leave the enemy in its BASE form (non-mega).
    enemy.formIndex = 0;
    expect(enemy.isMega()).toBe(false);
    for (const stat of [Stat.ATK, Stat.SPATK, Stat.SPD] as const) {
      const raw = enemy.getStat(stat, false);
      expect(enemy.getEffectiveStat(stat)).toBe(raw);
    }
  });
});
