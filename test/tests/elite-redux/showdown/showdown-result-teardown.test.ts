/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 result -> title TEARDOWN (staging bug mrbo8q1a): "after a fight in showdown ends, the
// trainer and the menu often stay on top of the titlescreen." The ghost OPPONENT trainer is fielded as
// a Phaser container added to `globalScene.field`; `globalScene.reset()` destroys the party pokemon and
// nulls `currentBattle` but NEVER removes/destroys that trainer container, so it is orphaned on the
// field and survives into the incoming TitlePhase. ShowdownResultPhase's teardown must destroy the
// enemy trainer sprite BEFORE reset(), for every outcome (win / loss / void) and regardless of the UI
// mode the phase was entered from. This asserts the trainer is gone (not on the field, not visible) and
// the UI has left the battle COMMAND mode by the time we are back on the title.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownResultReason, ShowdownVoidReason } from "#data/elite-redux/showdown/showdown-outcome";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Trainer } from "#field/trainer";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: SpeciesId.SNORLAX,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [MoveId.TACKLE, MoveId.BODY_SLAM, MoveId.HEADBUTT, MoveId.LEER],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.SNORLAX,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

describe.skipIf(!RUN)("Showdown result -> title teardown (mrbo8q1a)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.moveset([MoveId.TACKLE]);
  });

  afterEach(() => {
    endShowdownBattle();
    clearCoopRuntime();
  });

  async function startShowdown(): Promise<Trainer> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle([mon()], [mon()]);
      const starters = generateStarters(game.scene, [SpeciesId.MILTANK]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
    const trainer = game.scene.currentBattle.trainer;
    expect(trainer, "showdown battle must field an opponent trainer").toBeTruthy();
    return trainer!;
  }

  /**
   * Route the live showdown battle to its ephemeral result phase for the given outcome and let it run
   * all the way back to the title. Mirrors the real forfeit trigger (clear the queue, unshift the
   * result phase, end the in-flight battle phase) so the teardown runs exactly as it does in-game.
   */
  async function driveToTitle(
    localWon: boolean,
    reason: ShowdownResultReason | ShowdownVoidReason,
    voided: boolean,
  ): Promise<void> {
    game.scene.phaseManager.clearPhaseQueue();
    game.scene.phaseManager.unshiftNew("ShowdownResultPhase", localWon, reason, voided, false);
    game.scene.phaseManager.getCurrentPhase()?.end();
    await game.phaseInterceptor.to("TitlePhase");
  }

  const cases: {
    name: string;
    localWon: boolean;
    reason: ShowdownResultReason | ShowdownVoidReason;
    voided: boolean;
  }[] = [
    { name: "a WIN", localWon: true, reason: "victory", voided: false },
    { name: "a LOSS", localWon: false, reason: "victory", voided: false },
    { name: "a VOID", localWon: false, reason: "checksum", voided: true },
  ];

  for (const c of cases) {
    it(`destroys the ghost opponent trainer sprite on ${c.name} return to title`, async () => {
      startLocalCoopSession({ kind: "versus" });
      const trainer = await startShowdown();

      // Repro precondition: the opponent trainer is fielded + visible while the battle is live.
      expect(game.scene.field.getAll(), "opponent trainer is on the field mid-battle").toContain(trainer);
      expect(trainer.visible, "opponent trainer is visible mid-battle").toBe(true);

      await driveToTitle(c.localWon, c.reason, c.voided);

      // Back on the title: the ghost trainer must be gone (destroyed + off the field), never lingering
      // over the title menu. Pre-fix reset() orphaned it here (still on the field, still visible).
      expect(game.scene.field.getAll(), "opponent trainer must be removed from the field").not.toContain(trainer);
      expect(trainer.visible, "opponent trainer must not be visible").toBe(false);

      // The UI has left the battle COMMAND menu (we are on the title), so no battle handler lingers.
      expect(game.scene.ui.getMode()).not.toBe(UiMode.COMMAND);
    });
  }
});
