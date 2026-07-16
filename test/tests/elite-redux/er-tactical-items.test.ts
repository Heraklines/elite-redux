/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tactical held items (er-tactical-items.ts) — engine behavior:
//
//   1. Expert Belt  — x1.2 damage on super-effective hits only. Passive.
//   2. Covert Cloak — the holder is immune to move secondaries (status/stat/
//                     flinch chances hit 0 at the getMoveChance chokepoint).
//   3. Red Card     — a struck surviving holder drags the ATTACKER out for a
//                     random replacement; single use.
//   4. Eject Button — a struck surviving holder switches ITSELF out (its side
//                     picks the replacement); single use.
//
// Gated behind ER_SCENARIO=1 (like every ER engine test).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ErTacticalItemModifier, erTacticalItemType } from "#data/elite-redux/er-tactical-items";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER tactical held items", () => {
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
      .enemySpecies(SpeciesId.ABRA) // Psychic: Shadow Ball is super effective, Tackle neutral
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false);
  });

  // ---------------------------------------------------------------------------
  // 1. Expert Belt — x1.2 super-effective only
  // ---------------------------------------------------------------------------
  it("Expert Belt boosts SUPER-EFFECTIVE damage x1.2 and leaves neutral hits alone", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const seBefore = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.SHADOW_BALL],
      isCritical: false,
      simulated: true,
    }).damage;
    const tackleBefore = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    const belt = new ErTacticalItemModifier(erTacticalItemType("expertBelt"), player.id, "expertBelt", 1);
    game.scene.addModifier(belt, true, false, false, false);

    const seAfter = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.SHADOW_BALL],
      isCritical: false,
      simulated: true,
    }).damage;
    const tackleAfter = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      isCritical: false,
      simulated: true,
    }).damage;

    expect(seBefore, "fixture sanity: the SE hit deals damage").toBeGreaterThan(0);
    expect(seAfter, "super-effective boosted x1.2").toBe(Math.floor(seBefore * 1.2));
    expect(tackleAfter, "neutral hit untouched").toBe(tackleBefore);
    expect(belt.getMaxHeldItemCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Covert Cloak — secondary-effect immunity for the holder
  // ---------------------------------------------------------------------------
  it("Covert Cloak zeroes an incoming move's secondary chance (holder-side Shield Dust)", async () => {
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const nuzzle = allMoves[MoveId.NUZZLE];
    const attr = nuzzle.attrs.find(a => a.constructor.name === "StatusEffectAttr");
    expect(attr, "Nuzzle carries a StatusEffectAttr secondary").toBeDefined();

    // Without the cloak: Nuzzle's paralysis chance is its full 100.
    expect(attr!.getMoveChance(enemy, player, nuzzle, false, false)).toBe(100);

    // With the cloak on the TARGET: the chance collapses to 0.
    const cloak = new ErTacticalItemModifier(erTacticalItemType("covertCloak"), player.id, "covertCloak", 1);
    game.scene.addModifier(cloak, true, false, false, false);
    expect(attr!.getMoveChance(enemy, player, nuzzle, false, false)).toBe(0);

    // But the holder's OWN outgoing secondaries (selfEffect) are untouched.
    expect(attr!.getMoveChance(player, enemy, nuzzle, false, false)).toBe(100);
  });

  it("Covert Cloak prevents paralysis from an enemy Nuzzle over a real turn", async () => {
    game.override
      .enemyMoveset(MoveId.NUZZLE)
      .moveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "ER_COVERT_CLOAK" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(player.status?.effect ?? StatusEffect.NONE, "no paralysis through the cloak").toBe(StatusEffect.NONE);
    expect(player.hp).toBeLessThan(player.getMaxHp()); // the damage itself still lands
  });

  // ---------------------------------------------------------------------------
  // 3. Red Card — drags the attacker out; single use
  // ---------------------------------------------------------------------------
  it("enemy-held Red Card drags the attacking player mon out for a random bench mon", async () => {
    game.override.moveset([MoveId.TACKLE]).enemyHeldItems([{ name: "ER_RED_CARD" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.MAGIKARP);
    const gengar = game.scene.getPlayerParty()[0];

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().species.speciesId, "Gengar was dragged out").toBe(SpeciesId.MAGIKARP);
    expect(gengar.isOnField()).toBe(false);
    // Single use: the card is gone from the enemy.
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "redCard",
      false,
    );
    expect(remaining, "Red Card consumed").toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Eject Button — the struck holder switches out; single use
  // ---------------------------------------------------------------------------
  it("player-held Eject Button switches the struck holder out (player picks)", async () => {
    game.override
      .moveset([MoveId.SPLASH])
      // Ember, not Tackle: Gengar is Ghost - a Normal move can't hit it, and an
      // unhit holder must never eject.
      .enemyMoveset(MoveId.EMBER)
      .startingHeldItems([{ name: "ER_EJECT_BUTTON" }]);
    await game.classicMode.startBattle(SpeciesId.GENGAR, SpeciesId.MAGIKARP);
    const gengar = game.scene.getPlayerParty()[0];

    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1); // answer the Eject Button's modal SwitchPhase
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().species.speciesId, "holder ejected to Magikarp").toBe(SpeciesId.MAGIKARP);
    expect(gengar.isOnField()).toBe(false);
    const remaining = game.scene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "ejectButton",
      true,
    );
    expect(remaining, "Eject Button consumed").toHaveLength(0);
  });
});
