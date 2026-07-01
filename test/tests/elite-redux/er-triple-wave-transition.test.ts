/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format: the PLAYER field must be reconciled across a wave transition in a
// TRIPLE battle. Reported bug: after a battle a lead's sprite briefly vanishes while
// the other two remain. Root cause: the wave-start reposition (ToggleDoublePositionPhase)
// used binary single/double logic that only repositioned ONE mon (and swapped
// party[0]/[1]), so once the field was scrambled (as a mid-wave faint + auto-shift
// leaves it) a lead could stay stacked on CENTER, hidden behind the middle mon. The fix
// repositions EVERY on-field lead to the slot its field index maps to. This drives a
// scrambled triple field through a wave transition and asserts all three land on their
// distinct slots. Gated ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple - player field reconcile across a wave transition", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("triple")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(5);
  });

  afterEach(() => {
    // Restore the battleStyle("triple") spy so the format override doesn't leak into
    // the next ER file's battles (isolate:false; mocks don't auto-reset).
    vi.restoreAllMocks();
  });

  it("the wave-start reconcile restores EVERY lead's slot in a triple (not just slot 0)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    const field = () => globalScene.getPlayerField();
    expect(globalScene.currentBattle.getBattlerCount()).toBe(3);

    // Simulate the scramble a mid-wave faint + auto-shift can leave behind: shove all three
    // leads onto CENTER so the next wave's reposition MUST restore LEFT/CENTER/RIGHT. (Set the
    // property directly - an animated setFieldPosition can't resolve while paused at CommandPhase.)
    for (const p of field()) {
      p.fieldPosition = FieldPosition.CENTER;
    }
    expect(field().every(p => p.fieldPosition === FieldPosition.CENTER)).toBe(true);

    // Win wave 1 with a real turn: each lead OHKOs an enemy (lvl50 vs lvl5).
    const enemyIdx = globalScene.getEnemyField().map(e => e.getBattlerIndex());
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    await game.toNextWave();

    // At the next wave the three leads are back on their distinct slots (no two stacked).
    expect(field()[0].fieldPosition).toBe(FieldPosition.LEFT);
    expect(field()[1].fieldPosition).toBe(FieldPosition.CENTER);
    expect(field()[2].fieldPosition).toBe(FieldPosition.RIGHT);
  }, 90_000);
});
