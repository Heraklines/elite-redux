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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

describe.runIf(RUN)("showdown editor search - OPERATORS filter the real move pane (type:/bp>/acc=/cat:)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  type Internals = Omit<EditorInternals, "moveEntries"> & { moveEntries(): { name: string; moveId: number }[] };
  const buildMoveEditor = (game: GameManager): Internals => buildEditor(game, EditorField.MOVE0) as Internals;

  it("type:ground keeps ONLY ground moves (demo mon is Garchomp); a plain query is unaffected", async () => {
    const { allMoves } = await import("#data/data-lists");
    const { PokemonType } = await import("#enums/pokemon-type");
    const game = new GameManager(phaserGame);
    const ed = buildMoveEditor(game);

    // Baseline plain query: the whole legal pool, alphabetical - many moves of many types.
    ed.setFilter("");
    const plainCount = ed.moveEntries().length;
    expect(plainCount).toBeGreaterThan(4);

    ed.setFilter("type:ground");
    const ground = ed.moveEntries();
    expect(ground.length, "Garchomp knows at least one ground move").toBeGreaterThan(0);
    expect(ground.length, "the operator narrowed the pool").toBeLessThan(plainCount);
    for (const entry of ground) {
      expect(allMoves[entry.moveId].type, `${entry.name} is ground-typed`).toBe(PokemonType.GROUND);
    }
  });

  it("cat:phys keeps only physical moves; acc=100 only perfectly-accurate moves", async () => {
    const { allMoves } = await import("#data/data-lists");
    const { MoveCategory } = await import("#enums/move-category");
    const game = new GameManager(phaserGame);
    const ed = buildMoveEditor(game);

    ed.setFilter("cat:phys");
    const phys = ed.moveEntries();
    expect(phys.length).toBeGreaterThan(0);
    for (const entry of phys) {
      expect(allMoves[entry.moveId].category).toBe(MoveCategory.PHYSICAL);
    }

    ed.setFilter("acc=100");
    const acc = ed.moveEntries();
    expect(acc.length).toBeGreaterThan(0);
    for (const entry of acc) {
      expect(allMoves[entry.moveId].accuracy).toBe(100);
    }
  });

  it("RED-PROOF: an impossible bp>=400 yields ZERO moves while a plain '' yields the full pool", () => {
    const game = new GameManager(phaserGame);
    const ed = buildMoveEditor(game);
    ed.setFilter("");
    expect(ed.moveEntries().length).toBeGreaterThan(0);
    // Remove the operator branch in moveEntries() and this filter would be a plain name search for the
    // literal "bp>=400", still 0 - so pair it with the positive type: assertion above as the real proof.
    ed.setFilter("bp>=400");
    expect(ed.moveEntries().length, "no legal move has >= 400 BP").toBe(0);
  });

  it("a plain (operator-free) filter still ranks by name - operators are strictly additive", () => {
    const game = new GameManager(phaserGame);
    const ed = buildMoveEditor(game);
    ed.setFilter("earth");
    const r = ed.moveEntries();
    expect(r.length, "at least Earthquake surfaces").toBeGreaterThan(0);
    expect(r[0].name.toLowerCase().startsWith("earth"), "top match is the prefix hit").toBe(true);
  });
});

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

// =============================================================================
// LIVE BUG (maintainer): "when I click on open the moves it just opens, closes, opens, closes ...
// endlessly and it seems to be pressing E or space on repeat". Opening the MOVES dropdown in the Set
// Editor with the ACTION key (Space, or the classic Z - both PRINTABLE) enters an endless open/close
// oscillation.
//
// MECHANISM (event-order trace, reproduced below through the REAL inputs-controller):
//   1. Space is pressed on a browsing MOVE field. At keyDOWN time NO DOM text field is focused, so the
//      printable-key suppression (ae7356b92) does NOT fire. keyboardKeyDown emits ACTION once AND arms a
//      250ms auto-repeat setInterval + pushes ACTION onto buttonLock.
//   2. ACTION -> openPane() -> syncCapture() -> the hidden rex InputText grabs keyboard focus.
//   3. Space is RELEASED. Now a DOM text field IS focused, so keyboardKeyUp's SAME printable+focus guard
//      DOES fire and returns early - the armed interval is never cleared and buttonLock never released.
//   => the stranded interval keeps re-emitting ACTION every 250ms; each ACTION toggles the pane
//      (open -> select+close -> open ...) forever, even after the key is physically up. The asymmetry
//      (keydown NOT suppressed, keyup suppressed, because focus changed IN BETWEEN) is the regression.
//
// These drive the real InputsController with synthetic KeyboardEvents + a real focused <input> (the same
// harness the suppression tests above use) and fake ONLY setInterval/clearInterval so the auto-repeat is
// deterministic without disturbing Phaser's own clock.
// =============================================================================
describe.runIf(RUN)(
  "showdown editor - ACTION auto-repeat must not oscillate the search pane (endless open/close)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let domInput: HTMLInputElement | null = null;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
      game = new GameManager(phaserGame);
    });
    afterAll(() => phaserGame.destroy(true));
    afterEach(() => {
      // Blur, then release the key on the REAL clock so no stranded interval bleeds into the next test.
      (document.activeElement as HTMLElement | null)?.blur?.();
      try {
        game.scene.inputController.keyboardKeyUp({ key: " ", keyCode: 32 } as KeyboardEvent);
      } catch {
        /* best-effort cleanup */
      }
      vi.useRealTimers();
      domInput?.remove();
      domInput = null;
    });

    // KEY_SPACE -> Button.ACTION in the qwerty config, and " " is a single character -> a PRINTABLE key.
    const SPACE = { key: " ", keyCode: 32 } as KeyboardEvent;

    /** Count the "input_down" ACTION emissions produced while running `fn`. */
    const countActionDowns = (fn: () => void): number => {
      const ic = game.scene.inputController;
      let n = 0;
      const listener = (p: { button: Button }) => {
        if (p.button === Button.ACTION) {
          n += 1;
        }
      };
      ic.events.on("input_down", listener);
      try {
        fn();
      } finally {
        ic.events.off("input_down", listener);
      }
      return n;
    };

    /** Model openPane()'s hidden search capture grabbing keyboard focus (rex InputText.setFocus). */
    const raiseCapture = () => {
      domInput = document.createElement("input");
      document.body.appendChild(domInput);
      domInput.focus();
      expect(document.activeElement).toBe(domInput);
    };

    it("releasing the Space that opened the pane stops the auto-repeat - no endless open/close after release", () => {
      const ic = game.scene.inputController;
      ic.ensureKeyboardIsInit();
      // Fake ONLY the interval timers the auto-repeat uses; leave Phaser's own clock alone.
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

      // 1) Space DOWN while browsing a move field - NO DOM capture yet (the real order). ACTION fires once and
      //    the 250ms auto-repeat is armed.
      (document.activeElement as HTMLElement | null)?.blur?.();
      const downEmits = countActionDowns(() => ic.keyboardKeyDown(SPACE));
      expect(downEmits, "the opening Space emits ACTION exactly once").toBe(1);

      // 2) openPane() raises the hidden capture -> it grabs focus.
      raiseCapture();

      // 3) Space UP while the capture holds focus - the keyup where the regression strands the repeat timer.
      ic.keyboardKeyUp(SPACE);

      // 4) The pane picks/closes and focus returns; let real-world time pass.
      (document.activeElement as HTMLElement | null)?.blur?.();
      const repeatsAfterRelease = countActionDowns(() => vi.advanceTimersByTime(1500));

      // RED (bug): the stranded interval keeps firing ACTION every 250ms -> the pane oscillates forever.
      // GREEN (fixed): the keyup cleared the timer + buttonLock -> zero ACTION after the key is released.
      expect(repeatsAfterRelease, "a released ACTION key must not keep auto-firing (endless open/close)").toBe(0);
    });

    it("a held Space stops auto-repeating once the search capture grabs focus (no toggle-on-repeat while held)", () => {
      const ic = game.scene.inputController;
      ic.ensureKeyboardIsInit();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

      (document.activeElement as HTMLElement | null)?.blur?.();
      ic.keyboardKeyDown(SPACE); // opens the pane, arms the repeat timer

      raiseCapture(); // openPane raised the capture; the printable key now belongs to that text field

      // While Space is HELD and the capture holds focus, the auto-repeat must NOT re-drive ACTION as a game
      // button (that is what toggled the pane closed->open->closed several times a second).
      const repeatsWhileHeld = countActionDowns(() => vi.advanceTimersByTime(1000));
      expect(repeatsWhileHeld, "a held printable key does not auto-repeat while a text field is focused").toBe(0);
    });
  },
);
