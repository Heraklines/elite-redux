/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TEAM PRESET MENU - the cursor model + confirm routing (addendum).
//
// Contract asserted here:
//   - Cursor defaults to the FIRST mon of the FIRST team box.
//   - LEFT/RIGHT cycle mons WITHIN the hovered team (wrapping among its real mons).
//   - UP/DOWN switch teams, INCLUDING onto the trailing create box, resetting the mon cursor.
//   - CONFIRM: create box -> onCreate; valid team -> onEnterLobby; INVALID team -> explains
//     (notice set) and NEVER enters the lobby.
//   - E -> onEdit; N -> onDelete (updates the local view); R -> opens the rename overlay.
// Gated ER_SCENARIO (needs the real GameManager for the registered handler + balance tables).
// =============================================================================

import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { ShowdownEditorTextInput } from "#ui/showdown-set-editor-ui-handler";
import {
  buildShowdownTeamMenuDemoConfig,
  type ShowdownTeamMenuConfig,
  type ShowdownTeamMenuUiHandler,
} from "#ui/showdown-team-menu-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

type MenuInternals = {
  teamCursor: number;
  monCursor: number;
  renaming: boolean;
  renameBuffer: string;
  notice: string | null;
  config: ShowdownTeamMenuConfig;
  processInput(button: Button): boolean;
  hoveredMon(): { speciesId: number } | null;
};

/**
 * Models the real DOM text-capture the rename overlay uses live: the browser's focused hidden input
 * natively edits the buffer (typing / Backspace) and fires the change back, WHILE the same physical
 * Backspace ALSO reaches the game as Button.CANCEL. `backspace()` reproduces the native half; the test
 * then sends the game half separately - exactly the two-path situation the fix has to survive.
 */
class FakeTextInput implements ShowdownEditorTextInput {
  isOpen = false;
  value = "";
  private onChange: ((v: string) => void) | null = null;
  open(initial: string, onChange: (v: string) => void): void {
    this.isOpen = true;
    this.value = initial;
    this.onChange = onChange;
  }
  close(): void {
    this.isOpen = false;
    this.onChange = null;
  }
  /** The browser natively deleting a character from the focused input + firing its change event. */
  backspace(): void {
    this.value = this.value.slice(0, -1);
    this.onChange?.(this.value);
  }
}

/** Stub the shared ui so confirm prompts resolve synchronously to their YES branch. */
function stubPrompts(game: GameManager): void {
  const ui = game.scene.ui as unknown as Record<string, unknown>;
  ui.showText = (_t: string, _d: unknown, cb?: () => void) => cb?.();
  ui.setOverlayMode = (_m: unknown, yes?: () => void) => {
    yes?.();
    return Promise.resolve(true);
  };
  ui.revertMode = () => Promise.resolve(true);
  ui.playSelect = () => {};
  ui.playError = () => {};
}

function buildMenu(
  game: GameManager,
  overrides: Partial<ShowdownTeamMenuConfig> = {},
): { handler: ShowdownTeamMenuUiHandler; internals: MenuInternals; config: ShowdownTeamMenuConfig } {
  const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as ShowdownTeamMenuUiHandler;
  const handler = new (registered.constructor as new () => ShowdownTeamMenuUiHandler)();
  handler.setup();
  const config = buildShowdownTeamMenuDemoConfig(overrides);
  handler.show([config]);
  return { handler, internals: handler as unknown as MenuInternals, config };
}

describe.runIf(RUN)("showdown team menu - cursor model + routing", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
    stubPrompts(game);
  });

  afterAll(() => {
    phaserGame?.destroy(true);
  });

  it("defaults to the first mon of the first team box", () => {
    const { internals, config } = buildMenu(game);
    expect(internals.teamCursor).toBe(0);
    expect(internals.monCursor).toBe(0);
    expect(internals.hoveredMon()?.speciesId).toBe(config.presets[0].mons[0].speciesId);
  });

  it("LEFT/RIGHT cycle mons WITHIN the hovered team (wrapping among real mons)", () => {
    const { internals, config } = buildMenu(game);
    const teamSize = config.presets[0].mons.length; // Sand Rush = 4
    internals.processInput(Button.RIGHT);
    expect(internals.monCursor).toBe(1);
    internals.processInput(Button.LEFT);
    internals.processInput(Button.LEFT);
    expect(internals.monCursor).toBe(teamSize - 1); // wrapped past 0
  });

  it("UP/DOWN switch teams and reset the mon cursor, incl. onto the create box", () => {
    const { internals, config } = buildMenu(game);
    internals.processInput(Button.RIGHT); // monCursor = 1 on team 0
    internals.processInput(Button.DOWN); // team 1
    expect(internals.teamCursor).toBe(1);
    expect(internals.monCursor).toBe(0); // reset on team switch
    // Walk down to the trailing create box (presets.length rows in, index === presets.length).
    internals.processInput(Button.DOWN); // team 2
    internals.processInput(Button.DOWN); // create box
    expect(internals.teamCursor).toBe(config.presets.length);
    expect(internals.hoveredMon()).toBeNull();
  });

  /** Flush the prompt's revertMode().then(onYes) microtask chain. */
  const flush = () => new Promise(r => setTimeout(r, 0));

  it("CONFIRM on the create box calls onCreate", async () => {
    const onCreate = vi.fn();
    const { internals, config } = buildMenu(game, { onCreate });
    for (const _ of config.presets) {
      internals.processInput(Button.DOWN);
    }
    internals.processInput(Button.ACTION);
    await flush();
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("CONFIRM on a valid team calls onEnterLobby with its index", async () => {
    const onEnterLobby = vi.fn();
    const { internals } = buildMenu(game, { onEnterLobby });
    internals.processInput(Button.ACTION); // team 0 is valid
    await flush();
    expect(onEnterLobby).toHaveBeenCalledWith(0);
  });

  it("CONFIRM on an INVALID team explains and never enters the lobby", () => {
    const onEnterLobby = vi.fn();
    const { internals } = buildMenu(game, { initialTeam: 2, onEnterLobby }); // Legacy Squad = invalid
    internals.processInput(Button.ACTION);
    expect(onEnterLobby).not.toHaveBeenCalled();
    expect(internals.notice).not.toBeNull();
  });

  it("E edits, N deletes (updating the local view), R opens the rename overlay", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const { internals, config } = buildMenu(game, { onEdit, onDelete, onRename });
    const startCount = config.presets.length;

    internals.processInput(Button.CYCLE_ABILITY); // E
    expect(onEdit).toHaveBeenCalledWith(0);

    internals.processInput(Button.CYCLE_SHINY); // R
    expect(internals.renaming).toBe(true);
    internals.processInput(Button.MENU); // Esc cancels rename
    expect(internals.renaming).toBe(false);

    internals.processInput(Button.CYCLE_NATURE); // N -> delete (prompt YES)
    await flush();
    expect(onDelete).toHaveBeenCalledWith(0);
    expect(config.presets.length).toBe(startCount - 1); // local view updated
  });

  // ---------------------------------------------------------------------------------------------
  // RENAME OVERLAY - Backspace deletes a character, it NEVER yanks the player out to the title.
  //
  // Live bug (maintainer): "when you try to rename and press back it doesnt delete characters but
  // instead completely yanks you out of the menu to the title screen." Backspace maps to the default
  // CANCEL binding; the DOM input natively edits the buffer, but the SAME press ALSO reached the menu's
  // CANCEL -> onExit -> title. The fix mirrors the Set Editor search: while renaming, CANCEL with text
  // present is CONSUMED (the DOM input handles the delete) and never leaves; Esc closes just the overlay.
  // ---------------------------------------------------------------------------------------------

  /** Build the menu with a fake DOM capture injected + an onExit spy, focused on a real preset. */
  function buildRenameMenu(g: GameManager): {
    internals: MenuInternals;
    input: FakeTextInput;
    onExit: ReturnType<typeof vi.fn>;
  } {
    const registered = g.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as ShowdownTeamMenuUiHandler;
    const handler = new (registered.constructor as new () => ShowdownTeamMenuUiHandler)();
    handler.setup();
    const input = new FakeTextInput();
    handler.setTextInput(input);
    const onExit = vi.fn();
    handler.show([buildShowdownTeamMenuDemoConfig({ initialTeam: 0, onExit })]);
    return { internals: handler as unknown as MenuInternals, input, onExit };
  }

  it("renaming + Backspace (CANCEL) deletes a character and stays in the menu - NEVER exits to the title", () => {
    const { internals, input, onExit } = buildRenameMenu(game);
    internals.processInput(Button.CYCLE_SHINY); // R -> open the rename overlay
    expect(internals.renaming, "the rename overlay is up").toBe(true);
    const before = internals.renameBuffer.length;
    expect(before, "seeded with the team name").toBeGreaterThan(0);

    // A single physical Backspace: the focused DOM input natively deletes a char (fires the change),
    // and the SAME press also reaches the game as Button.CANCEL.
    input.backspace();
    internals.processInput(Button.CANCEL);

    // RED-PROOF: the buffer shrank by exactly one AND we are STILL renaming (the menu never closed the
    // overlay, never called onExit). Revert the fix (CANCEL -> cancelRename) and `renaming` flips false
    // here - the overlay is torn down and the next Backspace bubbles to onExit -> title.
    expect(internals.renameBuffer.length, "Backspace deleted one character").toBe(before - 1);
    expect(internals.renaming, "still renaming - Backspace must not close the overlay").toBe(true);
    expect(onExit, "Backspace must NEVER exit the menu to the title").not.toHaveBeenCalled();

    // A second Backspace behaves identically - it can never accumulate into an exit.
    input.backspace();
    internals.processInput(Button.CANCEL);
    expect(internals.renameBuffer.length).toBe(before - 2);
    expect(internals.renaming).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("renaming + Esc (MENU) closes JUST the rename overlay, leaving the menu intact (never the title)", () => {
    const { internals, onExit } = buildRenameMenu(game);
    internals.processInput(Button.CYCLE_SHINY); // R
    expect(internals.renaming).toBe(true);

    const handled = internals.processInput(Button.MENU); // Esc
    expect(handled, "Esc is consumed by the rename overlay").toBe(true);
    expect(internals.renaming, "Esc closes just the overlay").toBe(false);
    expect(onExit, "and it does NOT exit the menu to the title").not.toHaveBeenCalled();
    // The menu itself is intact - the presets are untouched and still browsable.
    expect(internals.config.presets.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// FOLDERS (P3): the cursor lands on collapsible folder headers, ACTION toggles collapse,
// and G assigns a folder (regrouping the team live). Byte-identical for a folderless account.
// =============================================================================
describe.runIf(RUN)("showdown team menu - folders (P3)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
    stubPrompts(game);
  });
  afterAll(() => phaserGame?.destroy(true));

  type FolderInternals = MenuInternals & {
    collapsedFolders: Set<string>;
    renameMode: "name" | "folder";
    rowsList(): { kind: string; folder?: string; presetIndex?: number }[];
  };

  const viewMon = () => ({
    speciesId: 3,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [33],
    item: "LEFTOVERS",
    rootSpeciesId: 3,
    erBlackShiny: false,
    baseCost: 4,
  });
  const view = (name: string, folder?: string) => ({
    name,
    mons: [viewMon()],
    invalidReason: null,
    ...(folder ? { folder } : {}),
  });

  /** A menu with one ungrouped team + two in the "Rain" folder. */
  function buildFolderMenu(overrides: Partial<ShowdownTeamMenuConfig> = {}) {
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as ShowdownTeamMenuUiHandler;
    const handler = new (registered.constructor as new () => ShowdownTeamMenuUiHandler)();
    handler.setup();
    handler.setTextInput(new FakeTextInput());
    const config = buildShowdownTeamMenuDemoConfig({
      presets: [view("Loose"), view("Rain A", "Rain"), view("Rain B", "Rain")],
      ...overrides,
    });
    handler.show([config]);
    return { handler, internals: handler as unknown as FolderInternals, config };
  }

  it("groups into rows: ungrouped preset, folder header, its two presets, then create", () => {
    const { internals } = buildFolderMenu();
    expect(internals.rowsList().map(r => r.kind)).toEqual(["preset", "header", "preset", "preset", "create"]);
  });

  it("UP/DOWN can land the cursor on the folder HEADER row", () => {
    const { internals } = buildFolderMenu();
    internals.processInput(Button.DOWN); // row 1 = the Rain header
    expect(internals.rowsList()[internals.teamCursor].kind).toBe("header");
    expect(internals.hoveredMon()).toBeNull(); // a header has no preview mon
  });

  it("CONFIRM on a folder header toggles collapse (hiding its presets), keeping the cursor on the header", () => {
    const { internals } = buildFolderMenu();
    internals.processInput(Button.DOWN); // onto the Rain header
    internals.processInput(Button.ACTION); // collapse
    expect(internals.collapsedFolders.has("Rain")).toBe(true);
    expect(internals.rowsList().map(r => r.kind)).toEqual(["preset", "header", "create"]);
    expect(internals.rowsList()[internals.teamCursor].kind, "cursor stays on the header").toBe("header");
    internals.processInput(Button.ACTION); // expand again
    expect(internals.collapsedFolders.has("Rain")).toBe(false);
  });

  it("G assigns a folder to the hovered team, regrouping it live (onSetFolder called with the index)", () => {
    const onSetFolder = vi.fn();
    const input = new FakeTextInput();
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as ShowdownTeamMenuUiHandler;
    const handler = new (registered.constructor as new () => ShowdownTeamMenuUiHandler)();
    handler.setup();
    handler.setTextInput(input);
    const config = buildShowdownTeamMenuDemoConfig({ presets: [view("Loose"), view("Rain A", "Rain")], onSetFolder });
    handler.show([config]);
    const internals = handler as unknown as FolderInternals;

    // Cursor on the ungrouped "Loose" (row 0). G opens the folder overlay in FOLDER mode.
    internals.processInput(Button.CYCLE_GENDER);
    expect(internals.renaming).toBe(true);
    expect(internals.renameMode).toBe("folder");

    // Type a folder name into the DOM capture, then Enter commits.
    input.value = "Rain";
    (input as unknown as { onChange?: (v: string) => void }).onChange?.("Rain");
    // drive the change handler the handler registered
    internals.renameBuffer = "Rain";
    internals.processInput(Button.ACTION);

    expect(onSetFolder).toHaveBeenCalledWith(0, "Rain");
    expect(config.presets[0].folder).toBe("Rain"); // local view updated
    expect(internals.renaming).toBe(false);
  });

  it("a folderless account is byte-identical: rows are just presets + create (no headers)", () => {
    const { internals } = buildFolderMenu({ presets: [view("A"), view("B")] });
    expect(internals.rowsList().map(r => r.kind)).toEqual(["preset", "preset", "create"]);
  });
});
