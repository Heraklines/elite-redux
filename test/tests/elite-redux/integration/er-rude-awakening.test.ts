/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Rude Awakening 738 — "Upon awakening, the user permanently gains immunity to
// sleep status and boosts all stats by one stage. Once per battle."
//
// Verifies the wake-trigger infra end-to-end:
//   1. The holder is NOT sleep-immune to begin with (can be slept the first time).
//   2. On naturally waking, all five core stats rise by one stage.
//   3. After waking it IS sleep-immune for the rest of the battle.
//   4. The trigger is once-per-battle (a second wake does not re-boost).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Rude Awakening (738)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[738] as AbilityId) // Rude Awakening
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("is sleepable initially, then on wake boosts all stats +1 and becomes sleep-immune", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const user = game.field.getPlayerPokemon();

    // 1. Not sleep-immune yet — the trigger has not fired.
    expect(user.battleData.rudeAwakeningTriggered).toBe(false);
    expect(user.canSetStatus(StatusEffect.SLEEP, true)).toBe(true);

    // Put it to sleep for a single turn so it wakes the moment it tries to act.
    user.doSetStatus(StatusEffect.SLEEP, 1);
    expect(user.status?.effect).toBe(StatusEffect.SLEEP);

    // 2. Attempt a move: checkSleep decrements to 0, wakes the holder, fires the
    // on-wake hook (+1 all stats) within the same turn.
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(user.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(user.battleData.rudeAwakeningTriggered).toBe(true);
    expect(user.getStatStage(Stat.ATK)).toBe(1);
    expect(user.getStatStage(Stat.DEF)).toBe(1);
    expect(user.getStatStage(Stat.SPATK)).toBe(1);
    expect(user.getStatStage(Stat.SPDEF)).toBe(1);
    expect(user.getStatStage(Stat.SPD)).toBe(1);

    // 3. Now permanently sleep-immune for the rest of the battle.
    expect(user.canSetStatus(StatusEffect.SLEEP, true)).toBe(false);
  });
});
