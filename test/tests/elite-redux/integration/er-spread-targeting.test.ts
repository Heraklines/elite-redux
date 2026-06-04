/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER spread-targeting abilities (Artillery 377 / Amplifier 378 / Sweeping Edge
// 421 and their composites Bass Boosted 524 / Blademaster 590): single-target
// moves carrying the matching flag are promoted to "hit both opposing Pokemon"
// in double battles, via the getMoveTargets hook. Multihit moves are excluded.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { getMoveTargets } from "#data/moves/move-utils";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER spread targeting (Sweeping Edge / Amplifier / Artillery)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Sweeping Edge promotes a single-target slicing move (CUT) to both foes in doubles", async () => {
    game.override
      .battleStyle("double")
      .ability(ER_ID_MAP.abilities[421] as AbilityId) // Sweeping Edge
      .moveset([MoveId.CUT, MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.GALLADE, SpeciesId.SNORLAX]);

    const user = game.scene.getPlayerField()[0];
    const enemyIndices = game.scene.getEnemyField().map(e => e.getBattlerIndex());
    // CUT is a slicing move → promoted to a spread move hitting BOTH foes
    // (multiple=true, targets are exactly the two enemies, ally excluded).
    const cutTargets = getMoveTargets(user, MoveId.CUT);
    expect(cutTargets.multiple).toBe(true);
    expect([...cutTargets.targets].sort()).toEqual([...enemyIndices].sort());

    // TACKLE is not slicing → stays a single-target (selectable) move.
    const tackleTargets = getMoveTargets(user, MoveId.TACKLE);
    expect(tackleTargets.multiple).toBe(false);
  });

  it("does NOT promote a single-target move for a user without a spread ability", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.CUT])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.GALLADE, SpeciesId.SNORLAX]);

    const user = game.scene.getPlayerField()[0];
    const cutTargets = getMoveTargets(user, MoveId.CUT);
    expect(cutTargets.multiple).toBe(false);
  });
});
