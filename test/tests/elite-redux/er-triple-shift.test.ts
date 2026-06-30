/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format battles - the triple-battle SHIFT (reposition) command. In a triple,
// a player Pokemon can SWAP its field slot with an ACTIVE ally (the party-menu route,
// PartyUiMode.SWITCH on an on-field ally). The swap is resolved during TurnStartPhase
// ordered like a switch (before moves): it reorders getPlayerParty()/getPlayerField()
// and repositions BOTH mons, brings in NO benched mon, and consumes the shifter's turn.
// Gated ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER multi-format - the TRIPLE SHIFT (reposition) command", () => {
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
      // Growl is a no-damage status move on both sides, so NOTHING faints this turn: the two
      // swapped mons are guaranteed to stay on the field and at least one enemy survives, so the
      // battle continues and the turn cleanly advances to 2 (ER "Splash" is a real 40-power attack).
      .enemyMoveset(MoveId.GROWL)
      .moveset(MoveId.GROWL)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(20)
      .enemyLevel(20);
  });

  afterEach(() => {
    // Restore the battleStyle("triple") spy so the "triple" format override doesn't leak
    // into the next ER file's battles (isolate:false; mocks don't auto-reset).
    vi.restoreAllMocks();
  });

  it("swaps two active allies' field slots, repositions both, and consumes the shifter's turn", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    expect(globalScene.currentBattle.getBattlerCount()).toBe(3);
    expect(globalScene.currentBattle.turn).toBe(1);

    // Capture the two mons currently in field slots 0 and 1.
    const slot0Mon = globalScene.getPlayerField()[0];
    const slot1Mon = globalScene.getPlayerField()[1];
    expect(slot0Mon.getBattlerIndex()).toBe(0);
    expect(slot1Mon.getBattlerIndex()).toBe(1);

    // Drive a SHIFT on the slot-0 mon swapping it with the active ally in slot 1, exactly as the
    // party UI does: handleCommand(Command.SHIFT, <ally field slot>). This consumes slot 0's turn.
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      expect(phase.getFieldIndex()).toBe(0);
      const accepted = phase.handleCommand(Command.SHIFT, 1);
      expect(accepted).toBe(true);
    });
    // The other two slots act normally (Growl). Slot 1 is the swapped-with ally - it still acts.
    game.move.select(MoveId.GROWL, 1);
    game.move.select(MoveId.GROWL, 2);

    // Advance to the start of turn resolution (commands now written, nothing resolved yet). The
    // shift turn command must be the one written for slot 0 (a SHIFT targeting slot 1), and NOT a
    // switch/fight - proving the command phase routed the party-menu pick to a SHIFT.
    await game.phaseInterceptor.to("TurnStartPhase", false);
    expect(globalScene.currentBattle.turnCommands[0]?.command).toBe(Command.SHIFT);
    expect(globalScene.currentBattle.turnCommands[0]?.cursor).toBe(1);

    // Resolve the turn. A soft-lock (gappy turnCommands / crash in the shift phase) would time out.
    await game.phaseInterceptor.to("TurnInitPhase");

    // (a) The two mons swapped field slots: getPlayerField() reflects the new party order and the
    //     mons' battler indices updated accordingly.
    expect(globalScene.getPlayerField()[0]).toBe(slot1Mon);
    expect(globalScene.getPlayerField()[1]).toBe(slot0Mon);
    expect(slot1Mon.getBattlerIndex()).toBe(0);
    expect(slot0Mon.getBattlerIndex()).toBe(1);

    // The shift brought in NO benched mon - it is still the SAME 3 mons on the field, just
    // repositioned (the third slot is untouched).
    expect(globalScene.getPlayerField(true).length).toBe(3);

    // (b) The turn was consumed and the battle advanced to the next turn.
    expect(globalScene.currentBattle.turn).toBe(2);
  });
});
