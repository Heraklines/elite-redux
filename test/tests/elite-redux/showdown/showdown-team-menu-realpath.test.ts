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
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
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
    // Live fix #4 regression net: the mode switching is NOT enough - the menu's container must
    // actually be HIDDEN, or it keeps rendering over the (open, input-receiving) grid, which is
    // exactly what the player saw ("still the same issue" with both open-breadcrumbs logged).
    const menuHandler = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as any;
    expect(menuHandler?.container?.visible, "the Team Menu container is hidden once the grid opens").toBe(false);
  });

  // ---- hotkey bar: R (rename) / N (delete) / E (edit) --------------------------------------------
  // These keys are CYCLE_SHINY / CYCLE_NATURE / CYCLE_ABILITY, which route through ui-inputs'
  // `buttonCycleOption` - a HANDLER WHITELIST that SWALLOWED them for the Team Menu (not whitelisted),
  // so the keys did nothing live even though the handler's processInput handles them (why the existing
  // menu-input test, which feeds processInput DIRECTLY, was green). Driving through the REAL dispatch
  // (game.scene.uiInputs.buttonCycleOption) is the red-proof: revert the whitelist entry and each
  // assertion fails (the action never fires). Keyboard AND controller share this dispatch; mobile's
  // on-screen apad cycle buttons emit the same Button.CYCLE_*, so this one gate covers all three.
  const cycle = (b: Button) => game.scene.uiInputs.buttonCycleOption(b);
  const openMenuWithPreset = async () => {
    game.scene.gameData.saveShowdownTeamPreset("Sand", [
      {
        speciesId: SpeciesId.GARCHOMP,
        formIndex: 0,
        level: 100,
        shiny: false,
        variant: 0,
        abilityIndex: 0,
        nature: 0,
        ivs: [31, 31, 31, 31, 31, 31],
        moveset: [MoveId.EARTHQUAKE],
        item: "LEFTOVERS",
        rootSpeciesId: SpeciesId.GIBLE,
        erBlackShiny: false,
        baseCost: 4,
      },
    ]);
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    expect(mode()).toBe(UiMode.SHOWDOWN_TEAM_MENU);
    return game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as any;
  };

  it("hotkey R (CYCLE_SHINY) opens the RENAME overlay through the real input dispatch", async () => {
    const menuHandler = await openMenuWithPreset();
    // Drop the DOM keyboard bridge: the real rex InputText's setFocus() has no headless mock (a browser-
    // only concern, orthogonal to the whitelist fix under test). beginRename still flips `renaming`.
    menuHandler.setTextInput(null);
    expect(menuHandler.renaming).toBe(false);
    cycle(Button.CYCLE_SHINY);
    await wait(50);
    expect(menuHandler.renaming, "R must open the rename overlay (whitelist reached the handler)").toBe(true);
  });

  it("hotkey N (CYCLE_NATURE) opens the DELETE confirm through the real input dispatch", async () => {
    await openMenuWithPreset();
    cycle(Button.CYCLE_NATURE);
    await wait(400);
    expect(mode(), "N must open the delete Yes/No confirm").toBe(UiMode.CONFIRM);
  });

  it("hotkey E (CYCLE_ABILITY) enters the seeded EDIT build through the real input dispatch", async () => {
    await openMenuWithPreset();
    cycle(Button.CYCLE_ABILITY);
    await wait(600);
    expect(mode(), "E must enter the edit build (starter-select opens)").toBe(UiMode.STARTER_SELECT);
    expect(game.scene.gameMode.isShowdown).toBe(true);
  });

  it("Issue 2: backing out of the build returns to the Team Menu and restores the gameMode", async () => {
    const phase = new TitlePhase();
    // NO phase.gameMode stamp: at the live title it is undefined - the exact fix-#5 condition.
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
    // Live fix #5 net: settle must restore the LIVE gameMode OBJECT (the old code restored
    // getGameMode(phase.gameMode) where phase.gameMode is undefined at the title -> every
    // subsequent setMode crashed on gameMode.isCoop, live "naming doesn't advance").
    expect(game.scene.gameMode, "gameMode restored to a real object after settle").toBeDefined();
    expect(game.scene.gameMode.isShowdown).toBeFalsy(); // borrowed gameMode cleanly restored
    expect(game.scene.gameData.showdownTeamPresets.length).toBe(0); // nothing saved on cancel
  });
});
