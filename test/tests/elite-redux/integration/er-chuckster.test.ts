/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Chuckster 864 — "Once per entry when receiving a contact move, gain 50% damage
// reduction (and force out the attacker)." Verifies the once-per-entry contact
// 50% reduction via getAttackDamage A/B on the charge state (same move, only the
// summonData charge differs — avoids consuming it during simulation).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Chuckster (864)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("halves an incoming CONTACT hit once per entry (no reduction once the charge is spent)", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(ER_ID_MAP.abilities[864] as AbilityId); // Chuckster on the defender
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);

    const attacker = game.field.getPlayerPokemon();
    const defender = game.field.getEnemyPokemon(); // Chuckster holder
    const contactMove = allMoves[MoveId.TACKLE]; // makes contact

    // Charge available → contact hit is halved.
    defender.summonData.chuckusterReductionUsed = false;
    const reduced = defender.getAttackDamage({ source: attacker, move: contactMove, simulated: true }).damage;

    // Charge spent → no reduction.
    defender.summonData.chuckusterReductionUsed = true;
    const full = defender.getAttackDamage({ source: attacker, move: contactMove, simulated: true }).damage;

    expect(full).toBeGreaterThan(0);
    // Reduced ≈ half of full (×0.5). Allow rounding slack.
    expect(reduced).toBeLessThan(full * 0.6);
  });
});
