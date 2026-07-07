/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 FORFEIT flow (D4), ER_SCENARIO / GameManager. In a live showdown battle the in-battle
// MENU offers "Forfeit" (and hides "Save and Quit" - a versus match is never saved); confirming it
// routes the duel to the ephemeral ShowdownResultPhase (the local player loses; the peer wins by
// forfeit). This proves (a) the menu shows the showdown-only entry and (b) the forfeit transition
// reaches the result phase from mid-battle.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
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

describe.skipIf(!RUN)("Showdown forfeit flow (D4)", () => {
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

  async function startShowdown(): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle([mon()], [mon()]);
      const starters = generateStarters(game.scene, [SpeciesId.MILTANK]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
  }

  it("the in-battle menu opens cleanly in a showdown battle (the Forfeit render path)", async () => {
    // The menu handler's render() builds the showdown-only Forfeit row (and hides Save and Quit) via
    // its excludedMenus conditions; opening it in a live showdown battle exercises that path without a
    // throw. (The rendered LABEL text is not readable via the headless text mock, which drops the
    // constructor content - the label is verified visually in the render harness / in-game.)
    startLocalCoopSession({ kind: "versus" });
    await startShowdown();

    await game.scene.ui.setMode(UiMode.MENU);
    expect(game.scene.ui.getMode()).toBe(UiMode.MENU);
  });

  it("confirming Forfeit (driven through the real MENU + CONFIRM) routes to the result and back to title", async () => {
    startLocalCoopSession({ kind: "versus" });
    await startShowdown();

    // Answer the forfeit CONFIRM overlay YES (cursor 0) the instant it opens. The overlay is set up by
    // the REAL MenuUiHandler.forfeitShowdown() (its confirm-prompt callback), so this drives the genuine
    // trigger end-to-end rather than inlining the phase-queue sequence by hand.
    game.onNextPrompt("CommandPhase", UiMode.CONFIRM, () => {
      const confirm = game.scene.ui.getHandler();
      confirm.setCursor(0);
      confirm.processInput(Button.ACTION);
    });

    // Open the in-battle MENU and drive the real Forfeit path: UP wraps the cursor to the enum-last
    // FORFEIT row (shown ONLY in a live showdown battle), ACTION invokes MenuUiHandler.forfeitShowdown().
    await game.scene.ui.setMode(UiMode.MENU);
    const menu = game.scene.ui.getHandler();
    menu.processInput(Button.UP);
    menu.processInput(Button.ACTION);

    // Reaching ShowdownResultPhase proves the real mid-battle forfeit transition; it then returns to the
    // title WITHOUT saving (a versus match is ephemeral), so we end on TitlePhase.
    await game.phaseInterceptor.to("ShowdownResultPhase");
    await game.phaseInterceptor.to("TitlePhase");
    expect(game.scene.phaseManager.getCurrentPhase()?.phaseName).toBe("TitlePhase");
  });
});
