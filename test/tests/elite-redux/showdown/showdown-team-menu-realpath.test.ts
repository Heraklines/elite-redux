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
import { EditorField } from "#ui/showdown-set-editor-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
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

  it("FREEZE BUG: cancel from a mon's Set Editor visibly returns to the grid (offline build)", async () => {
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    press(Button.ACTION); // create -> straight into the build grid
    await wait(500);
    await confirmYesIfPrompted();
    expect(mode()).toBe(UiMode.STARTER_SELECT);

    const grid: any = game.scene.ui.handlers[UiMode.STARTER_SELECT];
    // Highlight a caught species + populate the detail cursors (mirrors the render recipe), then open the
    // Set Editor for a NEW slot - the exact "creating a mon's set" path the tester backed out of.
    const bulbasaur = getPokemonSpecies(SpeciesId.BULBASAUR);
    grid.lastSpecies = bulbasaur;
    grid.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.BULBASAUR];
    grid.setSpeciesDetails(bulbasaur, {}, false);
    grid.openShowdownEditor(-1);
    await wait(300);
    expect(mode(), "the Set Editor opened").toBe(UiMode.SHOWDOWN_SET_EDITOR);
    const editor: any = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR];
    expect(editor.container.visible, "editor container is up").toBe(true);

    // Back out of the set (CANCEL / B).
    game.scene.ui.getHandler().processInput(Button.CANCEL);
    await wait(600);

    // fix-#4 lesson: assert VISIBILITY, not just mode - the freeze is the grid active (input) under a
    // container that never repaints.
    expect(mode(), "returns to the grid mode").toBe(UiMode.STARTER_SELECT);
    expect(editor.container.visible, "the editor container is HIDDEN after cancel").toBe(false);
    expect(grid.starterSelectContainer.visible, "the grid container is VISIBLE after cancel").toBe(true);
  });

  it("submitting an edited in-party set returns to the grid and can reopen the editor", async () => {
    await openMenuWithPreset();
    cycle(Button.CYCLE_ABILITY); // E -> seeded EDIT build
    await wait(700);
    expect(mode()).toBe(UiMode.STARTER_SELECT);

    const grid: any = game.scene.ui.handlers[UiMode.STARTER_SELECT];
    await grid.showdownSeedInFlight;
    expect(grid.starterSpecies.length, "the preset mon is present in the grid party").toBe(1);

    // Confirming a line that is already in the party opens the Edit Set / Remove menu.
    grid.handleShowdownGridConfirm(true, 0, true);
    await wait(100);
    expect(mode()).toBe(UiMode.OPTION_SELECT);
    press(Button.ACTION); // Edit Set
    await wait(300);
    expect(mode(), "the first edit opens").toBe(UiMode.SHOWDOWN_SET_EDITOR);

    const editor: any = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR];
    // The headless rex InputText mock has no setFocus(); move selection itself remains the real handler path.
    editor.setTextInput(null);
    editor.field = EditorField.MOVE0;
    expect(editor.processInput(Button.ACTION), "ACTION opens the first move dropdown").toBe(true);
    const originalMove = editor.config.set.moves[0];
    const entries = editor.moveEntries();
    const targetIndex = entries.findIndex((entry: any) => !entry.locked && entry.moveId !== originalMove);
    expect(targetIndex, "the seeded mon has another legal move").toBeGreaterThanOrEqual(0);
    editor.paneCursor = targetIndex;
    const editedMove = entries[targetIndex].moveId;
    press(Button.SUBMIT); // select the highlighted move with Enter
    expect(editor.config.set.moves[0], "Enter writes the selected move into the editor draft").toBe(editedMove);

    press(Button.SUBMIT); // Done
    await wait(600);
    expect(mode(), "Done returns to the live grid, not the consumed option menu").toBe(UiMode.STARTER_SELECT);
    expect(editor.container.visible, "the completed editor is hidden").toBe(false);
    expect(grid.starterSelectContainer.visible, "the grid is visible after Done").toBe(true);
    expect(grid.starters[0].moveset[0], "Done writes the edited move into the team slot").toBe(editedMove);

    // Back from the in-party menu is a real cancel; it must not remove the mon or strand the menu.
    grid.handleShowdownGridConfirm(true, 0, true);
    await wait(100);
    press(Button.CANCEL);
    await wait(100);
    expect(mode(), "Back from the in-party menu returns to the grid").toBe(UiMode.STARTER_SELECT);
    expect(grid.starterSpecies.length, "Back does not remove the team mon").toBe(1);

    // The same team slot can immediately be edited again and still accepts navigation input.
    grid.handleShowdownGridConfirm(true, 0, true);
    await wait(100);
    press(Button.ACTION);
    await wait(300);
    expect(mode(), "the second edit opens instead of dead-ending").toBe(UiMode.SHOWDOWN_SET_EDITOR);
    expect(editor.config.set.moves[0], "reopening the same set preserves the edited move").toBe(editedMove);
    const before = editor.field;
    press(Button.DOWN);
    expect(editor.field, "the reopened editor accepts movement input").not.toBe(before);

    press(Button.CANCEL);
    await wait(600);
    expect(mode(), "the regression leaves the real UI stack settled on the grid").toBe(UiMode.STARTER_SELECT);
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
    // "stuck getting out of the custom starter select" red-proof: mode flipping to the menu is NOT
    // enough - the GRID container must be HIDDEN, or it stays painted (and input-live under the menu),
    // which is exactly what the player saw. The confirmExit CONFIRM is an unchained overlay, so the old
    // `revertMode()` was a no-op and the grid was never cleared. Assert the source is gone + dest shown.
    const grid: any = game.scene.ui.handlers[UiMode.STARTER_SELECT];
    const menuHandler: any = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU];
    expect(grid.starterSelectContainer.visible, "the grid must be HIDDEN once we exit to the menu").toBe(false);
    expect(menuHandler.container.visible, "the Team Menu container is shown after the grid exit").toBe(true);
    // Live fix #5 net: settle must restore the LIVE gameMode OBJECT (the old code restored
    // getGameMode(phase.gameMode) where phase.gameMode is undefined at the title -> every
    // subsequent setMode crashed on gameMode.isCoop, live "naming doesn't advance").
    expect(game.scene.gameMode, "gameMode restored to a real object after settle").toBeDefined();
    expect(game.scene.gameMode.isShowdown).toBeFalsy(); // borrowed gameMode cleanly restored
    expect(game.scene.gameData.showdownTeamPresets.length).toBe(0); // nothing saved on cancel
  });

  // ---- P2: IMPORT -> save -> the menu shows it (the real dispatch loop) --------------------------

  it("import (F): a clean paste saves a new preset and the menu shows it", async () => {
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    const menu: any = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU];
    menu.setPasteInput(null); // no headless DOM bridge; we set the buffer directly
    const before = game.scene.gameData.showdownTeamPresets.length;

    // F routes through the REAL buttonCycleOption dispatch (whitelist) -> beginImport.
    cycle(Button.CYCLE_FORM);
    await wait(30);
    expect(menu.importing, "F opened the import paste modal via the real dispatch").toBe(true);

    // A clean Garchomp set (cost 4, everything.prsv unlocks it) -> validates -> saved straight away.
    menu.importBuffer = ["Garchomp @ Leftovers", "Nature: Jolly", "- Earthquake", "- Outrage"].join("\n");
    press(Button.ACTION); // -> submitImport
    await wait(30);

    // The import -> save -> menu-shows-it LOOP: persisted to the account save AND appended to the live view.
    expect(game.scene.gameData.showdownTeamPresets.length, "a new preset was saved to the account data").toBe(
      before + 1,
    );
    const saved = game.scene.gameData.showdownTeamPresets.at(-1)!;
    expect(saved.mons[0].speciesId).toBe(SpeciesId.GARCHOMP);
    expect(saved.mons[0].moveset).toEqual([MoveId.EARTHQUAKE, MoveId.OUTRAGE]);
    expect(menu.config.presets.at(-1).name, "the menu view shows the imported team").toBe("Imported Team");
    expect(menu.teamCursor, "the cursor hovers the new team").toBe(menu.config.presets.length - 1);
    expect(mode()).toBe(UiMode.SHOWDOWN_TEAM_MENU);
  });

  it("import (F): a broken paste raises the per-mon error list, then drop-invalid saves the rest", async () => {
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    const menu: any = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU];
    menu.setPasteInput(null);
    const before = game.scene.gameData.showdownTeamPresets.length;

    cycle(Button.CYCLE_FORM);
    await wait(30);
    // One valid mon + one unknown-species block.
    menu.importBuffer = ["Garchomp @ Leftovers", "- Earthquake", "", "Notamon @ Leftovers", "- Tackle"].join("\n");
    press(Button.ACTION); // submitImport -> some errors -> the error list is raised
    await wait(30);
    expect(menu.importErrors, "the per-mon error list is shown").not.toBeNull();
    expect(menu.importErrors.some((m: string) => m.includes("unknown species 'Notamon'"))).toBe(true);
    expect(menu.importValidMons.length, "the one valid mon is kept for the fix-up").toBe(1);
    expect(game.scene.gameData.showdownTeamPresets.length, "nothing saved yet").toBe(before);

    // Drop invalid & save the valid remainder (Enter).
    press(Button.ACTION);
    await wait(30);
    expect(game.scene.gameData.showdownTeamPresets.length, "the valid mon was saved").toBe(before + 1);
    expect(game.scene.gameData.showdownTeamPresets.at(-1)!.mons).toHaveLength(1);
    expect(menu.importErrors, "the error list is dismissed after saving").toBeNull();
  });

  // ---- P2: AUTO-REMEMBER prefill (confirm a set -> the next pick of that species pre-fills it) -----

  it("auto-remember: confirming a set stores it and the next CREATE of that species pre-fills it", async () => {
    // Enter the offline build so the real grid handler exists with live dex state.
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    press(Button.ACTION);
    await wait(500);
    await confirmYesIfPrompted();
    expect(mode()).toBe(UiMode.STARTER_SELECT);
    const grid: any = game.scene.ui.handlers[UiMode.STARTER_SELECT];

    // Highlight a caught species + populate the detail cursors (mirrors the freeze-bug recipe).
    const sp = getPokemonSpecies(SpeciesId.BULBASAUR);
    grid.lastSpecies = sp;
    grid.speciesStarterDexEntry = game.scene.gameData.dexData[SpeciesId.BULBASAUR];
    grid.setSpeciesDetails(sp, {}, false);

    // Build a fresh CREATE config, shape a set, and REMEMBER it through the real commit-time helper (the
    // exact call commitShowdownEditor makes) - which exports codec text into localStorage.
    const cfg0 = grid.buildShowdownEditorConfig(sp, SpeciesId.BULBASAUR, -1);
    cfg0.set.moves = [MoveId.TACKLE, MoveId.VINE_WHIP, null, null];
    cfg0.set.nature = 3; // an arbitrary distinct nature
    grid.rememberShowdownSet(sp, SpeciesId.BULBASAUR, { stage: cfg0.stage, set: cfg0.set });

    // A subsequent FRESH create config for the SAME species (no in-session selection) pre-fills from the
    // remembered set. RED-PROOF (auto-remember prefill): drop the prefill fallbacks in buildShowdownEditorConfig
    // (or the rememberShowdownSet write) and these go back to the grid defaults.
    grid.showdownSelections.delete(SpeciesId.BULBASAUR);
    const cfg1 = grid.buildShowdownEditorConfig(sp, SpeciesId.BULBASAUR, -1);
    expect(cfg1.set.moves.slice(0, 2), "moves pre-filled from last-used").toEqual([MoveId.TACKLE, MoveId.VINE_WHIP]);
    expect(cfg1.set.nature, "nature pre-filled from last-used").toBe(3);
  });

  it("G/V team-cycle: the editor RELOADS onto the sibling team mon (offline edit, dead-cycle red-proof)", async () => {
    // A 2-mon preset -> EDIT seeds BOTH mons into the grid, so the editor has siblings to cycle between.
    const mon = (root: SpeciesId, fielded: SpeciesId, move: MoveId) => ({
      speciesId: fielded,
      formIndex: 0,
      level: 100,
      shiny: false,
      variant: 0,
      abilityIndex: 0,
      nature: 0,
      ivs: [31, 31, 31, 31, 31, 31] as number[],
      moveset: [move],
      item: "LEFTOVERS",
      rootSpeciesId: root,
      erBlackShiny: false,
      baseCost: 4,
    });
    game.scene.gameData.saveShowdownTeamPreset("Duo", [
      mon(SpeciesId.GIBLE, SpeciesId.GARCHOMP, MoveId.EARTHQUAKE),
      mon(SpeciesId.LARVITAR, SpeciesId.TYRANITAR, MoveId.CRUNCH),
    ]);
    const phase = new TitlePhase();
    (phase as any).openShowdownTeamMenu(() => {});
    await wait(400);
    cycle(Button.CYCLE_ABILITY); // E -> seeded EDIT build
    await wait(700);
    expect(mode()).toBe(UiMode.STARTER_SELECT);
    const grid: any = game.scene.ui.handlers[UiMode.STARTER_SELECT];
    await grid.showdownSeedInFlight; // the seeded party loads its icons asynchronously
    await wait(100);
    expect(grid.starterSpecies.length, "both preset mons seeded into the grid").toBe(2);

    // Open the Set Editor on slot 0, then cycle with V (next) and G (prev).
    grid.openShowdownEditor(0);
    await wait(200);
    expect(mode(), "the Set Editor opened on slot 0").toBe(UiMode.SHOWDOWN_SET_EDITOR);
    const editor: any = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR];
    const slot0Root = editor.config.rootSpeciesId;

    // V (CYCLE_TERA) = NEXT team mon. With the dead-cycle bug, openShowdownEditor's setOverlayMode
    // no-ops (this.mode === SHOWDOWN_SET_EDITOR) and the editor keeps rendering slot 0; the fix
    // re-renders in place so the config root actually changes to the sibling.
    game.scene.ui.getHandler().processInput(Button.CYCLE_TERA);
    await wait(200);
    expect(mode(), "still in the editor after V").toBe(UiMode.SHOWDOWN_SET_EDITOR);
    expect(editor.container.visible, "editor stays visible after cycling").toBe(true);
    const slot1Root = editor.config.rootSpeciesId;
    expect(slot1Root, "V reloaded the editor onto the OTHER team mon").not.toBe(slot0Root);

    // G (CYCLE_GENDER) = PREV -> back to slot 0.
    game.scene.ui.getHandler().processInput(Button.CYCLE_GENDER);
    await wait(200);
    expect(editor.config.rootSpeciesId, "G cycled back to the first mon").toBe(slot0Root);
  });
});
