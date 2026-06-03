/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Twinkle Toes 756 — "Kicking moves +30%. Normal-type moves become Fairy-type
// and the user gains Fairy STAB (Pixilate). If the user is Fairy-type their
// Fairy-type moves get a 10% infatuate chance."
//
// Behavioral check of the Pixilate piece (the part the flag-damage-boost
// archetype dropped): a Normal-type move used by the holder is rewritten to
// Fairy. Tackle (Normal) cannot touch a Ghost-type at all — but as Fairy it is
// neutral, so the holder deals damage. This proves the type conversion fires.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Twinkle Toes (756)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("converts the holder's Normal moves to Fairy (Pixilate) — Tackle hits a Ghost", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[756] as AbilityId) // Twinkle Toes
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.GASTLY) // pure Ghost — immune to Normal, neutral to Fairy
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.HITMONLEE]);

    const enemy = game.field.getEnemyPokemon();
    const before = enemy.hp;

    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toEndOfTurn();

    // Normal → Fairy conversion means the Ghost takes damage (a real Normal
    // Tackle would deal zero against a Ghost-type).
    expect(enemy.hp).toBeLessThan(before);
  });
});
