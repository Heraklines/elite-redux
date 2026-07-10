/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Team Menu - REAL-PATH acceptance (addendum). Drives the ACTUAL TitlePhase ->
// team menu -> confirm chains through the REAL globalScene.ui stack (real setMode / showText /
// setOverlayMode / CONFIRM / revertMode), NOT the flow-test seams. This is the net that the
// stubbed menu-input + flow tests could not catch: the live "pressing Create doesn't take me to
// starter select" bug passed those because they stub ui.showText/setOverlayMode and inject onCreate
// directly. Here the create box is confirmed through the real prompt + CONFIRM overlay, and we
// assert the grid actually opens; cancel is driven back to the menu the same way.
//
// Async note: the real UI uses typewriter timers + fade transitions, so each step waits real
// wall-clock ms (Phaser HEADLESS runs a real RAF loop). Values are generous for CI.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.runIf(RUN)("showdown team menu - real-path acceptance", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
  });
  afterAll(() => phaserGame?.destroy(true));
  beforeEach(() => {
    game.scene.gameData.showdownTeamPresets = [];
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
  });

  const mode = () => game.scene.ui.getMode();
  const press = (b: Button) => game.scene.ui.getHandler().processInput(b);

  /** Confirm a live Yes/No CONFIRM overlay if one is currently up (real ConfirmUiHandler). */
  const confirmYesIfPrompted = async () => {
    if (mode() === UiMode.CONFIRM) {
      press(Button.ACTION); // cursor 0 = Yes
      await wait(700);
    }
  };

  it("item 1: opening Showdown routes to the TEAM MENU first (not the lobby)", async () => {
    const phase = new TitlePhase();
    (phase as any).gameMode = GameModes.CLASSIC;
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    expect(mode()).toBe(UiMode.SHOWDOWN_TEAM_MENU);
  });

  it("item 8: CONFIRM on the create box opens starter-select FOR REAL (the live-dead path)", async () => {
    const phase = new TitlePhase();
    (phase as any).gameMode = GameModes.CLASSIC;
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    expect(mode()).toBe(UiMode.SHOWDOWN_TEAM_MENU);

    // Zero presets -> the create box is the focused row. Confirm it through the REAL prompt chain.
    press(Button.ACTION); // -> menu.prompt("Create a new team?") -> showText -> CONFIRM overlay
    await wait(500);
    await confirmYesIfPrompted(); // Yes -> onCreate -> openShowdownPresetBuild -> starter-select

    expect(mode()).toBe(UiMode.STARTER_SELECT);
    // The build borrowed SHOWDOWN to drive the teambuild UI.
    expect(game.scene.gameMode.isShowdown).toBe(true);
  });

  it("Issue 2: backing out of the build returns to the Team Menu and restores the gameMode", async () => {
    const phase = new TitlePhase();
    (phase as any).gameMode = GameModes.CLASSIC;
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    press(Button.ACTION);
    await wait(500);
    await confirmYesIfPrompted();
    expect(mode()).toBe(UiMode.STARTER_SELECT); // in the offline build now

    // Empty party at the grid: CANCEL -> tryExit -> confirmExit text -> CONFIRM.
    press(Button.CANCEL);
    await wait(500);
    await confirmYesIfPrompted(); // Yes -> showdownBuildOnCancel -> settle -> reopen the menu

    expect(mode()).toBe(UiMode.SHOWDOWN_TEAM_MENU); // returned to the menu, NOT the title
    expect(game.scene.gameMode.isShowdown).toBeFalsy(); // borrowed gameMode cleanly restored (undefined for CLASSIC)
    expect(game.scene.gameData.showdownTeamPresets.length).toBe(0); // nothing saved on cancel
  });
});
