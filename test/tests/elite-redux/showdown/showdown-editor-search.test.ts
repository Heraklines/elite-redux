/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Set Editor - the search "autocomplete" the maintainer asked to "do properly": the ranking /
// normalization matrix, the highlight-reset-on-filter-change rule, and the printable-key SUPPRESSION that
// keeps typing a move name from ALSO firing game buttons (the regression the editor's CYCLE_* whitelist
// introduced: typing "earthquake" fired CYCLE_ABILITY (e) / CYCLE_SHINY (r) / CYCLE_NATURE (n) /
// CYCLE_FORM (f) mid-type).
// =============================================================================

import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownEditorDemoConfig,
  EditorField,
  rankByFilter,
  type ShowdownSetEditorUiHandler,
} from "#ui/showdown-set-editor-ui-handler";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Rank a list of move-ish NAMES and return them in ranked order (identity nameOf). */
const rankNames = (names: string[], filter: string): string[] => rankByFilter(names, n => n, filter);
const idxOf = (ranked: string[], name: string): number => ranked.indexOf(name);

describe.runIf(RUN)("showdown editor search - ranking + normalization matrix", () => {
  const POOL = [
    "Earthquake",
    "Blaze Kick",
    "Stone Edge",
    "Bleakwind Storm",
    "King's Shield",
    "U-turn",
    "Farfetch'd Special", // a name carrying an apostrophe mid-word
    "Outrage",
    "Overheat",
    "Aeroblast",
  ];

  it("one-char 'e': EXACT-PREFIX matches rank above word-prefix, which rank above substring", () => {
    const r = rankNames(POOL, "e");
    // Earthquake starts with 'e' (tier 0); Stone Edge's word "Edge" starts with 'e' (tier 1); Blaze Kick
    // only CONTAINS 'e' (tier 2). So Earthquake < Stone Edge < Blaze Kick in rank order.
    expect(idxOf(r, "Earthquake")).toBeGreaterThanOrEqual(0);
    expect(idxOf(r, "Earthquake")).toBeLessThan(idxOf(r, "Stone Edge"));
    expect(idxOf(r, "Stone Edge")).toBeLessThan(idxOf(r, "Blaze Kick"));
  });

  it("word-prefix 'sto': the whole-name prefix (Stone Edge) ranks above a later-word prefix (Bleakwind Storm)", () => {
    const r = rankNames(POOL, "sto");
    expect(idxOf(r, "Stone Edge")).toBeGreaterThanOrEqual(0);
    expect(idxOf(r, "Bleakwind Storm")).toBeGreaterThanOrEqual(0);
    expect(idxOf(r, "Stone Edge")).toBeLessThan(idxOf(r, "Bleakwind Storm"));
  });

  it("apostrophe-insensitive: 'kings' matches \"King's Shield\" at exact-prefix", () => {
    const r = rankNames(POOL, "kings");
    expect(r[0]).toBe("King's Shield"); // top match, apostrophe normalized on both sides
  });

  it("hyphen/space-insensitive: 'uturn' and 'u-turn' both match \"U-turn\" at exact-prefix", () => {
    expect(rankNames(POOL, "uturn")[0]).toBe("U-turn");
    expect(rankNames(POOL, "u-turn")[0]).toBe("U-turn");
  });

  it("mid-word apostrophe: 'farfetch' matches \"Farfetch'd Special\"", () => {
    expect(rankNames(POOL, "farfetch")[0]).toBe("Farfetch'd Special");
  });

  it("case-insensitive + alphabetical within a tier", () => {
    const r = rankNames(POOL, "O"); // Outrage + Overheat both tier-0, alphabetical
    expect(idxOf(r, "Outrage")).toBeLessThan(idxOf(r, "Overheat"));
  });

  it("empty filter passes the whole list through alphabetically", () => {
    const r = rankNames(["Zap Cannon", "Aeroblast", "Meteor Mash"], "");
    expect(r).toEqual(["Aeroblast", "Meteor Mash", "Zap Cannon"]);
  });

  it("a non-matching filter drops the row entirely", () => {
    expect(rankNames(POOL, "zzzz")).toEqual([]);
  });
});

type EditorInternals = {
  paneOpen: boolean;
  filter: string;
  paneCursor: number;
  setFilter(value: string): void;
  moveEntries(): { name: string }[];
  processInput(button: Button): boolean;
};

function buildEditor(game: GameManager, field: EditorField): EditorInternals {
  const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
  const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
  handler.setup();
  handler.show([buildShowdownEditorDemoConfig({ initialField: field })]);
  return handler as unknown as EditorInternals;
}

describe.runIf(RUN)("showdown editor search - highlight resets to the top match on every filter change", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  it("moving the cursor then re-filtering snaps the highlight back to row 0 (the top match)", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game, EditorField.MOVE0);

    ed.setFilter("e"); // opens + filters; top match highlighted
    expect(ed.paneCursor).toBe(0);

    ed.processInput(Button.DOWN); // browse down a couple rows
    ed.processInput(Button.DOWN);
    expect(ed.paneCursor).toBeGreaterThan(0);

    // RED-PROOF (highlight-reset rule): any filter EDIT snaps the highlight back to the new top match.
    // Remove the `paneCursor = 0` in setFilter and this fails (the stale cursor lingers off the top).
    ed.setFilter("ea");
    expect(ed.paneCursor, "the top match is re-highlighted on every filter change").toBe(0);
    expect(ed.moveEntries()[0].name.toLowerCase().startsWith("ea"), "and row 0 IS the closest match").toBe(true);
  });
});

describe.runIf(RUN)("showdown editor search - printable keys go to the FILTER, not game buttons (regression)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let input: HTMLInputElement | null = null;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
    await game.importData("./test/utils/saves/everything.prsv");
  });
  afterAll(() => phaserGame.destroy(true));
  afterEach(() => {
    input?.remove();
    input = null;
  });

  /** Collect the game Buttons the input controller emits for a synthetic keydown. */
  const emittedFor = (event: Partial<KeyboardEvent>): Button[] => {
    const ic = game.scene.inputController;
    const seen: Button[] = [];
    const listener = (payload: { button: Button }) => seen.push(payload.button);
    ic.events.on("input_down", listener);
    ic.keyboardKeyDown(event as KeyboardEvent);
    ic.keyboardKeyUp({ key: (event as KeyboardEvent).key, keyCode: (event as KeyboardEvent).keyCode } as KeyboardEvent);
    ic.events.off("input_down", listener);
    return seen;
  };

  const focusInput = () => {
    input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
  };

  it("pressing 'r' while a text field is FOCUSED does NOT emit CYCLE_SHINY (it types instead)", () => {
    focusInput();
    // 'r' -> keyCode 82 -> CYCLE_SHINY in the qwerty config.
    const emitted = emittedFor({ key: "r", keyCode: 82 });
    expect(emitted, "printable 'r' is suppressed as a game button while a DOM text field is focused").not.toContain(
      Button.CYCLE_SHINY,
    );
    expect(emitted, "no game button fires from a printable key during capture").toEqual([]);
  });

  it("the SAME 'r' DOES emit CYCLE_SHINY when no text field is focused (game input unaffected elsewhere)", () => {
    // No focused input this time.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const emitted = emittedFor({ key: "r", keyCode: 82 });
    expect(emitted, "outside a text field, 'r' is the normal CYCLE_SHINY game button").toContain(Button.CYCLE_SHINY);
  });

  it("a NON-printable key (ArrowUp) still reaches the game while a text field is focused (pane nav works)", () => {
    focusInput();
    const emitted = emittedFor({ key: "ArrowUp", keyCode: 38 });
    expect(emitted, "arrows are not printable, so pane navigation keeps working while typing").toContain(Button.UP);
  });

  // deltablazer12 (#2): the custom screens must honor the configured ACTION / CANCEL bindings, incl. the
  // classic Z (action) / X (cancel) keys. They route through buttonAb -> ui.processInput with NO whitelist
  // gate, so this proves the KEY -> Button mapping reaches the game (outside a text field). Inside a text
  // field they type (Showdown typeahead), and Enter/Esc remain the always-available confirm/back.
  it("Z is the ACTION button and X is CANCEL (bound + reaching the game) when no text field is focused", () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(emittedFor({ key: "z", keyCode: 90 }), "Z -> ACTION").toContain(Button.ACTION);
    expect(emittedFor({ key: "x", keyCode: 88 }), "X -> CANCEL").toContain(Button.CANCEL);
    // Enter (SUBMIT) + Escape (MENU) are non-printable -> always reach the game, even mid-typeahead.
    expect(emittedFor({ key: "Enter", keyCode: 13 }), "Enter -> SUBMIT").toContain(Button.SUBMIT);
  });
});

describe.runIf(RUN)("showdown editor - team-mon switch keys (G prev / V next)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  it("G (CYCLE_GENDER) switches to the PREVIOUS team mon; V (CYCLE_TERA) to the NEXT", () => {
    const game = new GameManager(phaserGame);
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
    const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
    handler.setup();
    const dirs: number[] = [];
    handler.show([buildShowdownEditorDemoConfig({ initialField: EditorField.MOVE0, onCycleTeam: d => dirs.push(d) })]);
    const internals = handler as unknown as { processInput(b: Button): boolean };

    expect(internals.processInput(Button.CYCLE_GENDER), "G is handled").toBe(true);
    expect(internals.processInput(Button.CYCLE_TERA), "V is handled").toBe(true);
    expect(dirs, "G -> prev (-1), V -> next (+1)").toEqual([-1, 1]);
  });
});
