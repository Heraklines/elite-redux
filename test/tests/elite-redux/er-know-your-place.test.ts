/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Tier-3 fix: Know Your Place (ER ability id 735) — "Contact attacks make foes
// move last for 5 turns." The ROM text is explicit: the target "always moves
// last regardless of priority, speed, or other effects." The port modelled it
// as a one-turn -6 SPD stat-stage; this is a TRUE Quash (the ER_QUASHED battler
// tag), enforced in the move-priority queue's timing-modifier sort so it beats
// even a positive-priority move.
//
// Test A: a mon carrying ER_QUASHED using a +1-priority move (Quick Attack) acts
// AFTER an un-quashed foe's 0-priority move — proving priority is overridden.
// Test B: the tag is applied to the ATTACKER when it lands a contact move on a
// Know Your Place holder, and persists (survives past a single turn).
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
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const KNOW_YOUR_PLACE = ER_ID_MAP.abilities[735] as AbilityId;

describe.skipIf(!RUN)("ER Know Your Place is a true Quash (move last regardless of priority)", () => {
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
      .startingLevel(60)
      .enemyLevel(30)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  test("a quashed +1-priority move acts AFTER an un-quashed 0-priority move", async () => {
    // Player Greninja (fast) will use Quick Attack (+1). The enemy Charmander
    // will use Surf (0). Normally the +1 move goes first; with the player quashed
    // it must go LAST, so the enemy's Surf resolves first.
    game.override
      .moveset([MoveId.QUICK_ATTACK, MoveId.SPLASH])
      .enemySpecies(SpeciesId.CHARMANDER)
      .enemyMoveset(MoveId.SURF);
    await game.classicMode.startBattle(SpeciesId.GRENINJA);

    const player = game.field.getPlayerPokemon();
    // Directly quash the player (isolates the ordering rule from the contact path).
    player.addTag(BattlerTagType.ER_QUASHED, 5);

    game.move.select(MoveId.QUICK_ATTACK);
    await game.phaseInterceptor.to("MoveEndPhase"); // first move of the turn resolves

    // The FIRST move to resolve must be the enemy's Surf, not the player's +1
    // Quick Attack — the enemy has acted (its Surf hit the player) before the
    // player's turn. If Quash were ignored, Quick Attack (+1) would go first and
    // the enemy would not yet have moved.
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getLastXMoves(1)[0]?.move).toBe(MoveId.SURF);
  });

  test("a contact move against a Know Your Place holder quashes the attacker", async () => {
    // The player (tanky Snorlax) holds Know Your Place; the enemy Chansey Tackles
    // it (contact) -> the ENEMY (attacker) gains ER_QUASHED for 5 turns. Snorlax
    // survives the feeble hit, so the PostDefend proc has a live target.
    // HARDEN (self-target, no damage) keeps the frail foe alive so it can land
    // its contact Tackle — ER Splash is a damaging move and would KO it first.
    game.override
      .ability(KNOW_YOUR_PLACE)
      .moveset([MoveId.HARDEN])
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getTag(BattlerTagType.ER_QUASHED)).toBeUndefined();

    game.move.select(MoveId.HARDEN);
    await game.phaseInterceptor.to("TurnEndPhase");

    const quash = enemy.getTag(BattlerTagType.ER_QUASHED);
    expect(quash).toBeDefined();
    // Persists beyond a single turn (it is a 5-turn tag, not a one-turn stat drop).
    expect(quash!.turnCount).toBeGreaterThan(1);
  });
});
