/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression suite for the contact-status ability bugs:
//
//  (a) Static / Poison Point / Flame Body procing off NON-contact moves.
//      Per the ER ROM descriptions:
//        - Static     — 30% paralyze on contact + 10% on non-contact ATTACKS.
//        - Flame Body — 30% burn on contact + 20% on non-contact ATTACKS.
//        - Poison Point — 30% poison on CONTACT MOVES only (NO non-contact tier).
//      A non-contact STATUS move (Growl/Leer) must never proc the non-contact
//      tier, and Poison Point must never proc on any non-contact move.
//
//  (b) Flame Body burning at the START of battle / on switch-in. A contact-
//      status ability must only proc when the holder is HIT by a damaging
//      attack — never on switch-in / battle start / a status move landing.
//
// RNG is pinned to its minimum so every proc roll succeeds; this makes the
// "should proc" cases deterministic and the "should NOT proc" cases meaningful
// (a failure to gate would deterministically status the holder under min-RNG).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

describe.skipIf(!RUN_SCENARIOS)("ER contact-status ability gating", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // ===========================================================================
  // (b) Switch-in / start-of-battle must never proc a contact-status ability.
  // ===========================================================================
  it("(b) Flame Body — NOT burned on switch-in / battle start (no move used)", async () => {
    const restoreRng = mockRngMin(); // even with max proc chance, entry must not burn
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.FLAME_BODY)
      .enemySpecies(SpeciesId.CHARMANDER)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.FROAKIE);
    restoreRng();
    const player = game.field.getPlayerPokemon();
    expect(player.status?.effect).not.toBe(StatusEffect.BURN);
  });

  // ===========================================================================
  // (b) A non-contact STATUS move must not proc the non-contact tier.
  // This is the real-world "burned before making any move" cause: the foe (or
  // the holder) uses a non-contact status move, which previously rolled the
  // burn/paralysis because the non-contact tier fired on any non-contact "hit".
  // NOTE: Leer (power 0) stays a STATUS move in ER. Growl is NOT used here — ER
  // rebalances Growl into a damaging Special move, so it legitimately attacks.
  // ===========================================================================
  it("(b) Flame Body — NOT burned by a non-contact STATUS move (Leer)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.FLAME_BODY)
      .enemySpecies(SpeciesId.MAGCARGO)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.LEER) // non-contact, STATUS category (power 0 in ER)
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.LEER);
    await game.toEndOfTurn();
    restoreRng();
    // Player used Leer (non-contact, status, no damage) on the Flame Body holder
    // → player must NOT be burned: a status move is not an attack.
    expect(player.status?.effect).not.toBe(StatusEffect.BURN);
  });

  it("(b) Static — NOT paralyzed by a non-contact STATUS move (Leer)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.STATIC)
      .enemySpecies(SpeciesId.PIKACHU)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.LEER) // non-contact, STATUS category
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.LEER);
    await game.toEndOfTurn();
    restoreRng();
    // Player used Leer (status) on the Static holder → player must not be paralyzed.
    expect(player.status?.effect).not.toBe(StatusEffect.PARALYSIS);
  });

  // ===========================================================================
  // (a) Poison Point is CONTACT-ONLY — a non-contact damaging move (Water Gun)
  // must NOT poison even at min-RNG.
  // ===========================================================================
  it("(a) Poison Point — NOT poisoned by a non-contact DAMAGING move (Water Gun)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.POISON_POINT)
      .enemySpecies(SpeciesId.NIDOKING)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.WATER_GUN) // non-contact, damaging
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.WATER_GUN);
    await game.toEndOfTurn();
    restoreRng();
    expect(player.status?.effect).not.toBe(StatusEffect.POISON);
  });

  // ===========================================================================
  // (a)/positive — the intended non-contact ATTACK tier still fires:
  // Flame Body burns off a non-contact DAMAGING move (Ember) at min-RNG.
  // ===========================================================================
  it("positive — Flame Body DOES burn off a non-contact DAMAGING move (Ember)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.FLAME_BODY)
      .enemyHasPassiveAbility(false)
      .enemySpecies(SpeciesId.MAGCARGO)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EMBER) // non-contact, damaging
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.EMBER);
    await game.toEndOfTurn();
    restoreRng();
    // Magcargo is Fire/Rock — Ember won't faint it; the player attacker burns
    // off the 20% non-contact attack tier (forced at min-RNG).
    expect(player.status?.effect).toBe(StatusEffect.BURN);
  });

  // ===========================================================================
  // positive — contact tier still fires for all three.
  // ===========================================================================
  it("positive — Poison Point DOES poison off a CONTACT move (Tackle)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.POISON_POINT)
      .enemySpecies(SpeciesId.NIDOKING)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE) // contact
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    expect(player.status?.effect).toBe(StatusEffect.POISON);
  });

  it("positive — Static DOES paralyze off a CONTACT move (Tackle)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.STATIC)
      .enemySpecies(SpeciesId.PIKACHU)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE) // contact
      .enemyLevel(50)
      .startingLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    expect(player.status?.effect).toBe(StatusEffect.PARALYSIS);
  });
});
