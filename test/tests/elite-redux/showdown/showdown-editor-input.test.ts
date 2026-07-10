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
  type ShowdownSetEditorUiHandler,
} from "#ui/showdown-set-editor-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
});
