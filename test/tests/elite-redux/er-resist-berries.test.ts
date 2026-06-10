/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#357) — ER resistance berries (Occa/Passho/…/Chilan):
//  - halve ONE incoming super-effective hit of their type, BEFORE the damage
//    lands (pre-hit, inside the damage calc), then are CONSUMED;
//  - Chilan halves ANY Normal-type hit;
//  - work on BOTH sides (enemy trainer mons hold them; players steal them);
//  - simulated calcs (AI / damage-calc overlay) never consume the berry;
//  - trainer assignment: per-mon roll, berry always matches a weakness;
//  - the player's (stolen) berries persist via the session-save side channel;
//  - they are transferable (the steal path uses tryTransferHeldItemModifier).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  applyErResistBerry,
  ER_RESIST_BERRY_BY_TYPE,
  ErResistBerryModifier,
  erResistBerryModifierType,
  getErResistBerryEntries,
  maybeAssignErResistBerry,
  pickErResistBerryType,
  restoreErResistBerries,
} from "#data/elite-redux/er-resist-berries";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function giveBerry(holder: Pokemon, resistType: PokemonType): ErResistBerryModifier {
  const mod = erResistBerryModifierType(resistType).newModifier(holder) as ErResistBerryModifier;
  if (holder.isPlayer()) {
    globalScene.addModifier(mod, true);
  } else {
    void globalScene.addEnemyModifier(mod as PokemonHeldItemModifier, true, true);
  }
  return mod;
}

function findBerry(holder: Pokemon, resistType: PokemonType): ErResistBerryModifier | undefined {
  return globalScene.findModifier(
    m => m instanceof ErResistBerryModifier && m.pokemonId === holder.id && m.resistType === resistType,
    holder.isPlayer(),
  ) as ErResistBerryModifier | undefined;
}

describe.skipIf(!RUN)("ER resistance berries (#357)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.CHARIZARD); // Fire/Flying: weak to Water/Electric/Rock
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });
  afterEach(() => {
    setErDifficulty("ace");
  });

  it("halves a super-effective hit DURING the damage calc, then is consumed (enemy holder)", () => {
    const enemy = game.scene.getEnemyPokemon()!;
    giveBerry(enemy, PokemonType.WATER);

    const dmg = new NumberHolder(100);
    const triggered = applyErResistBerry(enemy, PokemonType.WATER, 2, dmg, false);
    expect(triggered).toBe(true);
    expect(dmg.value).toBe(50); // halved BEFORE the hit lands
    expect(findBerry(enemy, PokemonType.WATER)).toBeUndefined(); // eaten

    // One use only: the next super-effective Water hit is full damage.
    const dmg2 = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.WATER, 2, dmg2, false)).toBe(false);
    expect(dmg2.value).toBe(100);
  });

  it("simulated calcs (AI / damage-calc overlay) halve but do NOT consume", () => {
    const enemy = game.scene.getEnemyPokemon()!;
    giveBerry(enemy, PokemonType.WATER);

    const dmg = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.WATER, 2, dmg, true)).toBe(true);
    expect(dmg.value).toBe(50);
    expect(findBerry(enemy, PokemonType.WATER)).toBeDefined(); // still held
  });

  it("requires the hit to be super-effective (except Chilan, which halves any Normal hit)", () => {
    const enemy = game.scene.getEnemyPokemon()!;
    giveBerry(enemy, PokemonType.WATER);
    giveBerry(enemy, PokemonType.NORMAL);

    // Neutral Water hit → Passho does not trigger.
    const neutral = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.WATER, 1, neutral, false)).toBe(false);
    expect(neutral.value).toBe(100);
    // Immune hit → nothing to weaken.
    const immune = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.WATER, 0, immune, false)).toBe(false);
    // Chilan triggers on a NEUTRAL Normal hit.
    const normal = new NumberHolder(100);
    expect(applyErResistBerry(enemy, PokemonType.NORMAL, 1, normal, false)).toBe(true);
    expect(normal.value).toBe(50);
    expect(findBerry(enemy, PokemonType.NORMAL)).toBeUndefined();
  });

  it("works for the PLAYER's mons too (stolen berries protect you)", () => {
    const player = game.scene.getPlayerPokemon()!;
    giveBerry(player, PokemonType.ELECTRIC);

    const dmg = new NumberHolder(80);
    expect(applyErResistBerry(player, PokemonType.ELECTRIC, 2, dmg, false)).toBe(true);
    expect(dmg.value).toBe(40);
    expect(findBerry(player, PokemonType.ELECTRIC)).toBeUndefined();
  });

  it("is transferable: the steal path moves it from the enemy to the player", () => {
    const enemy = game.scene.getEnemyPokemon()!;
    const player = game.scene.getPlayerPokemon()!;
    const berry = giveBerry(enemy, PokemonType.WATER);
    expect(berry.isTransferable).toBe(true);

    const moved = globalScene.tryTransferHeldItemModifier(
      berry as PokemonHeldItemModifier,
      player,
      false,
      1,
      undefined,
      undefined,
      false,
    );
    expect(moved).toBe(true);
    expect(findBerry(player, PokemonType.WATER)).toBeDefined();
    expect(findBerry(enemy, PokemonType.WATER)).toBeUndefined();
  });

  it("trainer assignment: the berry always matches one of the holder's weaknesses", () => {
    const enemy = game.scene.getEnemyPokemon()!;
    // Charizard (Fire/Flying) weaknesses among covered types: Water, Electric, Rock.
    const picked = pickErResistBerryType(enemy);
    expect(picked).not.toBeNull();
    expect([PokemonType.WATER, PokemonType.ELECTRIC, PokemonType.ROCK]).toContain(picked);

    setErDifficulty("hell"); // 10% per-mon roll
    vi.spyOn(enemy as EnemyPokemon, "randBattleSeedInt").mockReturnValue(0); // roll passes, picks first weakness

    // Wild mons never get one (trainer-only drops).
    maybeAssignErResistBerry(enemy as EnemyPokemon);
    expect(globalScene.findModifier(m => m instanceof ErResistBerryModifier, false)).toBeUndefined();

    // Same roll on a TRAINER battle assigns the berry.
    const battle = game.scene.currentBattle as unknown as { trainer: object | null };
    const prevTrainer = battle.trainer;
    battle.trainer = {};
    maybeAssignErResistBerry(enemy as EnemyPokemon);
    battle.trainer = prevTrainer;
    const held = globalScene.findModifier(m => m instanceof ErResistBerryModifier && m.pokemonId === enemy.id, false) as
      | ErResistBerryModifier
      | undefined;
    expect(held).toBeDefined();
    expect([PokemonType.WATER, PokemonType.ELECTRIC, PokemonType.ROCK]).toContain(held!.resistType);
    expect(ER_RESIST_BERRY_BY_TYPE.has(held!.resistType)).toBe(true);
  });

  it("the player's berries round-trip through the session-save side channel", () => {
    const player = game.scene.getPlayerPokemon()!;
    giveBerry(player, PokemonType.DRAGON);

    const saved = getErResistBerryEntries();
    expect(saved).toContainEqual([player.id, PokemonType.DRAGON]);

    // Simulate the post-load state: the vanilla registry dropped the modifier.
    const berry = findBerry(player, PokemonType.DRAGON)!;
    globalScene.removeModifier(berry, false);
    expect(findBerry(player, PokemonType.DRAGON)).toBeUndefined();

    restoreErResistBerries(saved);
    expect(findBerry(player, PokemonType.DRAGON)).toBeDefined();
    // Restoring twice must not duplicate.
    restoreErResistBerries(saved);
    const all = globalScene.findModifiers(m => m instanceof ErResistBerryModifier && m.pokemonId === player.id, true);
    expect(all).toHaveLength(1);
  });
});
