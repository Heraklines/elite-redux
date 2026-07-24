/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Set Editor - the round-3 TYPE-TO-SEARCH input model (no "press A to browse" ceremony).
//
// The interaction contract: when a searchable field is FOCUSED, alphanumeric input IMMEDIATELY starts
// filtering - a dropdown opens with NO prior "browse"/A action, ranked prefix-first so the closest
// match sits at the top ready to pick. A on a focused field opens the same dropdown unfiltered
// (controller path). B/pick closes it.
//
// RED-PROOF (the load-bearing assertion): typing on a focused MOVE field opens + filters the dropdown
// with no prior open action. Before this round `setFilter` only mutated the filter string and NEVER
// set `paneOpen`, so this test was red; it is the proof the ceremony is gone.
// Gated ER_SCENARIO (needs the real GameManager + balance tables), mirroring showdown-editor-flow.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { Button } from "#enums/buttons";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownEditorDemoConfig,
  EditorField,
  type ShowdownEditorTextInput,
  type ShowdownSetEditorUiHandler,
} from "#ui/showdown-set-editor-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** White-box access to the handler's private search state (mirrors the other showdown UI tests). */
type EditorInternals = {
  paneOpen: boolean;
  filter: string;
  field: EditorField;
  paneCursor: number;
  config: { set: { abilityIndex: number }; unlocks: { unlockedAbilityIndices: number[] } };
  setFilter(value: string): void;
  moveEntries(): { moveId: MoveId; name: string; locked: boolean }[];
  selectPaneRow(): boolean;
  selectableAbilityIndices(): number[];
  processInput(button: Button): boolean;
};

function buildEditor(
  game: GameManager,
  field: EditorField,
): {
  handler: ShowdownSetEditorUiHandler;
  internals: EditorInternals;
} {
  const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
  const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
  handler.setup();
  handler.show([buildShowdownEditorDemoConfig({ initialField: field })]);
  return { handler, internals: handler as unknown as EditorInternals };
}

describe.skipIf(!RUN)("Showdown Set Editor type-to-search input model", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("typing on a focused move field opens AND filters the dropdown with NO prior open action", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildEditor(game, EditorField.MOVE0);

    // Freshly focused move field: the dropdown is CLOSED (no ceremony region, nothing browsing yet).
    expect(internals.paneOpen, "dropdown starts closed on a focused field").toBe(false);

    // Type a single character - this is the ONLY action. No A press, no mode switch.
    internals.setFilter("out");

    // The dropdown is now OPEN (typing opened it) and the results are filtered prefix-first.
    expect(internals.paneOpen, "typing opens the dropdown directly").toBe(true);
    expect(internals.filter).toBe("out");
    const entries = internals.moveEntries();
    expect(entries.length, "the pool is narrowed to matches").toBeGreaterThan(0);
    expect(entries[0].name.toLowerCase().startsWith("out"), "the closest prefix match ranks first").toBe(true);
  });

  it("A on a focused field opens the dropdown UNFILTERED (controller path)", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildEditor(game, EditorField.MOVE1);
    expect(internals.paneOpen).toBe(false);

    // A on a focused field (the controller path) opens the browse dropdown with an EMPTY query.
    (internals as unknown as { openPane(): boolean }).openPane();

    expect(internals.paneOpen, "A opens the dropdown").toBe(true);
    expect(internals.filter, "A opens it unfiltered").toBe("");
  });

  it("picking a typed result writes the move and closes the dropdown (no lingering search state)", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildEditor(game, EditorField.MOVE0);

    internals.setFilter("out");
    const top = internals.moveEntries()[internals.paneCursor];
    expect(top).toBeDefined();
    const chosen = top.moveId;

    // Enter/A on the highlighted row commits it.
    internals.selectPaneRow();

    expect(internals.paneOpen, "picking closes the dropdown").toBe(false);
    expect(internals.filter, "no lingering filter after a pick").toBe("");
    expect(allMoves[chosen], "the chosen move resolves").toBeDefined();
  });

  // RED-PROOF (round 4): the ability search DROPDOWN is gone - the ACTIVE ability is CYCLED in place.
  // Before this round the ability field opened a browse dropdown on A (paneOpen -> true); now A cycles
  // the active ability with NO pane. This test is the proof the dropdown was replaced by cycling.
  it("the ACTIVE ability field CYCLES in place - ACTION never opens a dropdown", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildEditor(game, EditorField.ABILITY);
    expect(internals.paneOpen, "ability field starts with no dropdown").toBe(false);

    // A on the ability field cycles the active ability - it does NOT open a search pane.
    internals.processInput(Button.ACTION);
    expect(internals.paneOpen, "ACTION on the ability field must NOT open a dropdown (cycling replaced it)").toBe(
      false,
    );
  });

  it("cycling the active ability lands only on UNLOCKED slots, skipping locked ones", () => {
    const game = new GameManager(phaserGame);
    const { internals } = buildEditor(game, EditorField.ABILITY);
    const unlocked = internals.config.unlocks.unlockedAbilityIndices;
    const selectable = internals.selectableAbilityIndices();

    // Cycle a full lap; every landed index must be an UNLOCKED, selectable active slot (never a locked one).
    for (let i = 0; i < selectable.length + 2; i++) {
      internals.processInput(Button.CYCLE_ABILITY);
      expect(unlocked, "cycling never lands on a locked ability slot").toContain(internals.config.set.abilityIndex);
      expect(selectable, "cycling stays within the selectable actives").toContain(internals.config.set.abilityIndex);
    }
  });

  // SOFTLOCK FIX (round 4): Escape (Button.MENU) must LEAVE the editor via onCancel. Before, MENU was
  // unhandled here, so the user's escape press fell through to the exposed StarterSelect where MENU maps
  // to Start -> an empty versus battle. The editor now CONSUMES MENU as a leave, from a field AND from
  // an open dropdown, so it can never bubble to a stray Start.
  function buildEditorWithCancel(
    game: GameManager,
    field: EditorField,
  ): { internals: EditorInternals; cancels: () => number } {
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
    const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
    handler.setup();
    let count = 0;
    handler.show([buildShowdownEditorDemoConfig({ initialField: field, onCancel: () => (count += 1) })]);
    return { internals: handler as unknown as EditorInternals, cancels: () => count };
  }

  it("Escape (MENU) on a field leaves the editor (never a fall-through Start)", () => {
    const game = new GameManager(phaserGame);
    const { internals, cancels } = buildEditorWithCancel(game, EditorField.ABILITY);
    const handled = internals.processInput(Button.MENU);
    expect(handled, "the editor consumes MENU so it can't bubble").toBe(true);
    expect(cancels(), "MENU leaves the editor via onCancel").toBe(1);
  });

  it("controller Start (MENU) commits the set because generic pads have no SUBMIT binding", () => {
    const game = new GameManager(phaserGame);
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
    const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
    handler.setup();
    const done = vi.fn();
    handler.show([buildShowdownEditorDemoConfig({ initialField: EditorField.ABILITY, onDone: done })]);
    game.scene.inputController.lastSource = "gamepad";
    try {
      expect((handler as unknown as EditorInternals).processInput(Button.MENU)).toBe(true);
      expect(done).toHaveBeenCalledOnce();
    } finally {
      game.scene.inputController.lastSource = "keyboard";
    }
  });

  it("Escape (MENU) from an OPEN move dropdown only CLOSES the dropdown (browse), it does NOT leave", () => {
    const game = new GameManager(phaserGame);
    const { internals, cancels } = buildEditorWithCancel(game, EditorField.MOVE0);
    internals.setFilter("o"); // opens the search dropdown
    expect(internals.paneOpen, "the dropdown is open").toBe(true);
    const handled = internals.processInput(Button.MENU);
    expect(handled, "MENU is consumed").toBe(true);
    expect(internals.paneOpen, "Esc closes the dropdown back to browsing the moves").toBe(false);
    expect(cancels(), "Esc from the dropdown must NOT leave the editor").toBe(0);
  });

  it("Back (CANCEL) with an empty query closes the dropdown to browsing (controller path)", () => {
    const game = new GameManager(phaserGame);
    const { internals, cancels } = buildEditorWithCancel(game, EditorField.MOVE0);
    (internals as unknown as { openPane(): boolean }).openPane(); // opens with an EMPTY query
    expect(internals.paneOpen).toBe(true);
    expect(internals.filter).toBe("");
    internals.processInput(Button.CANCEL);
    expect(internals.paneOpen, "back with nothing typed closes the dropdown").toBe(false);
    expect(cancels(), "and it does not leave the editor").toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // CAPTURE LIFECYCLE - the DOM text capture holds focus ONLY while a search dropdown is open, so the
  // printable letter HOTKEYS (G / V team-cycle, F/R/E/N) stay live while browsing.
  //
  // Live bug (maintainer): "cycling between the mons in your team inside the custom menu doesnt work!"
  // G (CYCLE_GENDER) / V (CYCLE_TERA) are printable, so while the DOM capture holds focus the input
  // controller suppresses EVERY printable key as a game button - killing the team-cycle hotkeys. The
  // round-4 build raised the capture whenever a searchable field was merely FOCUSED, so it lingered on
  // the move/item fields and swallowed G/V. The fix gates the capture to `paneOpen`.
  // ---------------------------------------------------------------------------------------------

  /** Models the DOM/native text capture: tracks whether the editor is currently holding keyboard focus. */
  class FakeTextInput implements ShowdownEditorTextInput {
    isOpen = false;
    open(_initial: string, _onChange: (v: string) => void): void {
      this.isOpen = true;
    }
    close(): void {
      this.isOpen = false;
    }
  }

  function buildEditorWithCapture(
    game: GameManager,
    field: EditorField,
  ): { internals: EditorInternals; input: FakeTextInput; cycles: ReturnType<typeof vi.fn> } {
    const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
    const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
    handler.setup();
    const input = new FakeTextInput();
    handler.setTextInput(input);
    const cycles = vi.fn();
    handler.show([buildShowdownEditorDemoConfig({ initialField: field, onCycleTeam: cycles })]);
    return { internals: handler as unknown as EditorInternals, input, cycles };
  }

  it("a focused searchable field with the dropdown CLOSED does NOT hold the capture (hotkeys stay live)", () => {
    const game = new GameManager(phaserGame);
    const { internals, input } = buildEditorWithCapture(game, EditorField.MOVE0);
    // RED-PROOF: on a freshly focused move field the dropdown is closed, so the capture must be RELEASED.
    // Revert the fix (capture gated to `fieldIsSearchable` instead of `paneOpen`) and this is OPEN here -
    // the capture lingers and the input controller eats every printable hotkey (G/V/F/R/E/N).
    expect(internals.paneOpen, "the dropdown starts closed").toBe(false);
    expect(input.isOpen, "no capture while merely browsing a searchable field").toBe(false);
  });

  it("the capture is raised ONLY while the dropdown is open, and released the instant it closes", () => {
    const game = new GameManager(phaserGame);
    const { internals, input } = buildEditorWithCapture(game, EditorField.MOVE0);
    expect(input.isOpen).toBe(false);

    internals.processInput(Button.ACTION); // open the search dropdown
    expect(internals.paneOpen, "ACTION opens the dropdown").toBe(true);
    expect(input.isOpen, "the capture is raised while the dropdown is open (so typing filters)").toBe(true);

    internals.processInput(Button.MENU); // Esc closes the dropdown
    expect(internals.paneOpen, "Esc closes the dropdown").toBe(false);
    expect(input.isOpen, "the capture is released the instant the dropdown closes").toBe(false);
  });

  it("after closing a search (Esc), G and V cycle the team mon; while the search is OPEN the capture holds", () => {
    const game = new GameManager(phaserGame);
    const { internals, input, cycles } = buildEditorWithCapture(game, EditorField.MOVE0);

    // Open then close a search - mirrors the live sequence the report came from.
    internals.processInput(Button.ACTION);
    expect(input.isOpen, "while the search IS open the capture holds - live, G/V type into the filter").toBe(true);
    internals.processInput(Button.MENU); // Esc -> browsing, capture released
    expect(input.isOpen).toBe(false);

    // With the capture released, the printable team-cycle hotkeys reach the handler and fire onCycleTeam.
    internals.processInput(Button.CYCLE_TERA); // V -> next
    internals.processInput(Button.CYCLE_GENDER); // G -> prev
    expect(cycles.mock.calls, "V cycles next (+1), G cycles prev (-1)").toEqual([[1], [-1]]);
  });
});
