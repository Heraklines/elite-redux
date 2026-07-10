/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Ripen (247): "Doubles all beneficial berry effects." HP-heal + stat-stage
// doubling were already wired; this covers the two that were missing:
//   - ER resist berries reduce super-effective damage by 75% (÷4) not 50%.
//   - PP-restoring berries (Leppa) restore 20 PP not 10.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getBerryEffectFunc } from "#data/berry";
import {
  applyErResistBerry,
  type ErResistBerryModifier,
  erResistBerryModifierType,
} from "#data/elite-redux/er-resist-berries";
import { PokemonMove } from "#data/moves/pokemon-move";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function giveResistBerry(holder: Pokemon, resistType: PokemonType): ErResistBerryModifier {
  const mod = erResistBerryModifierType(resistType).newModifier(holder) as ErResistBerryModifier;
  if (holder.isPlayer()) {
    globalScene.addModifier(mod, true);
  } else {
    void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, true, true);
  }
  return mod;
}

describe.skipIf(!RUN)("ER Ripen — resist berry 75% + Leppa 20 PP", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.RIPEN) // player holds Ripen
      .enemySpecies(SpeciesId.CHARIZARD) // no Ripen — the control holder
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });

  it("a Ripen holder's resist berry cuts a super-effective hit by 75% (÷4), vs 50% without", async () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Ripen holder: 100 -> 25 (quartered).
    giveResistBerry(player, PokemonType.WATER);
    const ripenDmg = new NumberHolder(100);
    expect(applyErResistBerry(player, PokemonType.WATER, 2, ripenDmg, true)).toBe(true);
    expect(ripenDmg.value).toBe(25);

    // Control (no Ripen): 100 -> 50 (halved).
    giveResistBerry(enemy, PokemonType.WATER);
    const plainDmg = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.WATER, 2, plainDmg, true)).toBe(true);
    expect(plainDmg.value).toBe(50);
  });

  it("a Ripen holder's Leppa restores 20 PP, vs 10 without", async () => {
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Use SPLASH (40 PP) as a live moveset instance. getMoveset() reads
    // summonData.moveset during battle, so set it there (and avoid the
    // MOVESET_OVERRIDE path, which returns throwaway copies each call).
    player.summonData.moveset = [new PokemonMove(MoveId.SPLASH)];
    enemy.summonData.moveset = [new PokemonMove(MoveId.SPLASH)];
    const pMove = player.getMoveset()[0];
    const eMove = enemy.getMoveset()[0];

    // Ripen player: deplete a move by 25 PP; Leppa restores 20 -> ppUsed 5.
    pMove.ppUsed = 25;
    getBerryEffectFunc(BerryType.LEPPA)(player);
    expect(pMove.ppUsed).toBe(5);

    // Control (no Ripen): Leppa restores 10 -> ppUsed 15.
    eMove.ppUsed = 25;
    getBerryEffectFunc(BerryType.LEPPA)(enemy);
    expect(eMove.ppUsed).toBe(15);
  });
});
