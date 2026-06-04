/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Hypnotic Trance 953 — "Hypnosis never misses and also causes Confusion."
//
// The fix wires two Hypnosis-gated riders: a ConditionalAlwaysHit(moveIds:
// [HYPNOSIS]) so the move can't miss, and a ChanceBattlerTagOnAttack(chance:100,
// moveIds:[HYPNOSIS], CONFUSED) so landing Hypnosis also confuses the target.
// The `moveIds` gate is what lets the post-attack proc fire on a STATUS move at
// all (the default PostAttack gate excludes status moves) — the previous wiring
// was a 30%-confuse-on-any-damaging-move attr that NEVER fired for Hypnosis.
//
// This test proves the novel behavior: using Hypnosis from a Hypnotic Trance
// holder applies BOTH sleep (Hypnosis' own effect) AND confusion (the rider).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Hypnotic Trance (953)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Hypnosis from a Hypnotic Trance holder inflicts BOTH sleep and confusion", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[953] as AbilityId) // Hypnotic Trance
      .moveset([MoveId.HYPNOSIS])
      .enemySpecies(SpeciesId.RATTATA) // Normal — can be slept and confused
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.ALAKAZAM]);

    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.HYPNOSIS);
    await game.move.forceHit();
    await game.toEndOfTurn();

    // Hypnosis' own effect: sleep.
    expect(enemy.status?.effect).toBe(StatusEffect.SLEEP);
    // The Hypnotic Trance rider: confusion, applied on top via the post-attack
    // proc (which only fires for a status move because of the moveIds gate).
    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });
});
