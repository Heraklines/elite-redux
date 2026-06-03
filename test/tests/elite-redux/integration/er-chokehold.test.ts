/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Chokehold 837 — "When the user traps a target, they inflict paralysis and drop
// their speed by one stage once every turn while trapped." Verifies the per-turn
// (PostTurn) paralysis + -1 SPD against a currently-TRAPPED foe.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Chokehold (837)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("paralyzes and drops Speed of a TRAPPED foe at end of turn", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[837] as AbilityId) // Chokehold
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);

    const enemy = game.field.getEnemyPokemon();
    // Simulate the foe being trapped by a binding move.
    enemy.addTag(BattlerTagType.TRAPPED, 5, MoveId.NONE, game.field.getPlayerPokemon().id);
    expect(enemy.getStatStage(Stat.SPD)).toBe(0);
    expect(enemy.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);

    game.move.use(MoveId.SPLASH);
    // Advance fully into the next turn so the post-turn-queued StatStageChange /
    // status phases resolve (they're unshifted during TurnEndPhase).
    await game.toNextTurn();

    // End-of-turn Chokehold tick: trapped foe loses a Speed stage and is paralyzed.
    expect(enemy.getStatStage(Stat.SPD)).toBe(-1);
    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });
});
