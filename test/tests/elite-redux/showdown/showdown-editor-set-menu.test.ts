/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Set Editor - the SET MENU (Export / Import / Save / Load one set, P2). Drives the real
// handler state machine: STATS opens the menu, Export copies the codec text, Import parses + applies a
// same-line set (and rejects a wrong-line paste), Load reads a named set list. Boots a GameManager so
// the codec's name tables are populated (like the search-matrix test).
// =============================================================================

import { exportShowdownSet } from "#data/elite-redux/showdown/showdown-set-codec";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { buildShowdownEditorDemoConfig, type ShowdownSetEditorUiHandler } from "#ui/showdown-set-editor-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A permissive view of the handler's internals (standalone, not the class, so private access is fine). */
type Internals = {
  config: any;
  setMenu: string;
  setMenuBuffer: string;
  setMenuNotice: string | null;
  setPasteInput(input: null): void;
  processInput(b: Button): boolean;
};

function buildEditor(game: GameManager, over: Record<string, unknown> = {}): Internals {
  const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
  const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
  handler.setup();
  handler.show([buildShowdownEditorDemoConfig(over)]);
  return handler as unknown as Internals;
}

describe.runIf(RUN)("showdown set editor - Set Menu (export / import / save / load)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  it("STATS opens the Set Menu; Esc closes it", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game);
    expect(ed.setMenu).toBe("closed");
    ed.processInput(Button.STATS);
    expect(ed.setMenu).toBe("menu");
    ed.processInput(Button.MENU);
    expect(ed.setMenu).toBe("closed");
  });

  it("Export set copies the current set's codec text to the clipboard seam", () => {
    const game = new GameManager(phaserGame);
    let copied: string | null = null;
    const ed = buildEditor(game, { copyToClipboard: (t: string) => (copied = t) });
    ed.processInput(Button.STATS); // open menu (cursor on "Export set")
    ed.processInput(Button.ACTION); // Export set
    expect(copied).not.toBeNull();
    // It is exactly what exportShowdownSet would write for the current (Garchomp) demo set.
    expect(copied).toContain("Garchomp @ Leftovers");
    expect(copied).toContain("[Stage: Base]");
    expect(ed.setMenuNotice).toContain("clipboard");
  });

  it("Import set applies a same-line paste to the editor's stage + set", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game);
    ed.setPasteInput(null); // headless: no DOM bridge, drive the buffer directly
    ed.processInput(Button.STATS);
    ed.processInput(Button.DOWN); // menu cursor -> Import set
    ed.processInput(Button.ACTION); // open the paste modal
    expect(ed.setMenu).toBe("import");
    // A Garchomp-line set with different moves + item.
    (ed as any).setMenuBuffer = ["Garchomp @ Life Orb", "- Dragon Claw", "- Fire Fang"].join("\n");
    ed.processInput(Button.ACTION); // submit -> applies + closes
    expect(ed.setMenu).toBe("closed");
    expect(ed.config.set.item).toBe("ER_LIFE_ORB");
    expect(ed.config.set.moves.slice(0, 2)).toEqual([MoveId.DRAGON_CLAW, MoveId.FIRE_FANG]);
  });

  it("Import set REJECTS a paste for a different line (explains, does not apply)", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game);
    ed.setPasteInput(null);
    const originalItem = ed.config.set.item;
    ed.processInput(Button.STATS);
    ed.processInput(Button.DOWN);
    ed.processInput(Button.ACTION);
    (ed as any).setMenuBuffer = "Pikachu @ Light Ball\n- Thunderbolt";
    ed.processInput(Button.ACTION);
    // Bounced back to the menu with an explanation; the set is untouched.
    expect(ed.setMenu).toBe("menu");
    expect(ed.setMenuNotice).toContain("Pikachu");
    expect(ed.config.set.item).toBe(originalItem);
  });

  it("Load set lists this species' saved sets (injected demo list) and applies a pick", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game, {
      demoNamedSets: [{ name: "LO set", text: exportShowdownSet(pikaProofGarchomp()) }],
    });
    ed.processInput(Button.STATS);
    ed.processInput(Button.DOWN);
    ed.processInput(Button.DOWN);
    ed.processInput(Button.DOWN); // menu cursor -> Load set
    ed.processInput(Button.ACTION); // open load list
    expect(ed.setMenu).toBe("load");
    ed.processInput(Button.ACTION); // load the only entry
    expect(ed.setMenu).toBe("closed");
    expect(ed.config.set.item).toBe("ER_LIFE_ORB");
  });
});

// =============================================================================
// SUGGESTED SETS (P3, the flagship): the editor lists your OWN winning full-sets (applied whole) and
// COMMUNITY popular item+form hints (overlaid onto the current set, KEEPING your moves). Telemetry only
// stores fingerprints, so the community half is honestly item+form; the full-set half is your own wins.
// =============================================================================
describe.runIf(RUN)("showdown set editor - Suggested sets (P3)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  /** Open the Set Menu and move the cursor onto "Suggested sets" (the 5th option). */
  const openSuggested = (ed: Internals) => {
    ed.processInput(Button.STATS);
    for (let i = 0; i < 4; i++) {
      ed.processInput(Button.DOWN);
    }
    ed.processInput(Button.ACTION);
  };

  it("lists YOUR winning sets + COMMUNITY popular items, with an honest empty state when neither exists", () => {
    const game = new GameManager(phaserGame);
    const emptyEd = buildEditor(game, { demoWinningSets: [], demoCommunitySuggestions: [] });
    openSuggested(emptyEd);
    expect(emptyEd.setMenu).toBe("suggested");
    expect((emptyEd as any).suggestedList.length).toBe(0);

    const ed = buildEditor(game, {
      demoWinningSets: [exportShowdownSet(pikaProofGarchomp())],
      demoCommunitySuggestions: [{ speciesId: SpeciesId.GARCHOMP, formIndex: 0, item: "ER_CHOICE_BAND", wins: 7 }],
    });
    openSuggested(ed);
    const list = (ed as any).suggestedList as { source: string }[];
    expect(list.length).toBe(2);
    expect(list[0].source).toBe("yours"); // your winning set ranks first
    expect(list[1].source).toBe("popular");
  });

  it("applying YOUR winning set applies it WHOLE (item + moves), same path as Load", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game, { demoWinningSets: [exportShowdownSet(pikaProofGarchomp())] });
    openSuggested(ed);
    ed.processInput(Button.ACTION); // apply the first (yours) entry
    expect(ed.setMenu).toBe("closed");
    expect(ed.config.set.item).toBe("ER_LIFE_ORB"); // the winning set's item
    expect(ed.config.set.moves[0]).toBe(MoveId.EARTHQUAKE); // and its moveset
  });

  it("applying a COMMUNITY hint overlays item + stage but KEEPS your current moves (honest partial)", () => {
    const game = new GameManager(phaserGame);
    const ed = buildEditor(game, {
      demoWinningSets: [],
      demoCommunitySuggestions: [{ speciesId: SpeciesId.GARCHOMP, formIndex: 0, item: "ER_CHOICE_BAND", wins: 5 }],
    });
    const movesBefore = [...ed.config.set.moves];
    openSuggested(ed);
    ed.processInput(Button.ACTION); // apply the only (community) entry
    expect(ed.setMenu).toBe("closed");
    expect(ed.config.set.item).toBe("ER_CHOICE_BAND"); // adopted the popular item
    expect(ed.config.stage.speciesId).toBe(SpeciesId.GARCHOMP); // fielded the popular stage
    expect(ed.config.set.moves).toEqual(movesBefore); // YOUR moves are untouched (telemetry has no moves)
  });
});

/** A Garchomp-line manifest with a distinctive item, to prove Load actually applied it. */
function pikaProofGarchomp() {
  return {
    speciesId: SpeciesId.GARCHOMP,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [MoveId.EARTHQUAKE],
    item: "ER_LIFE_ORB",
    rootSpeciesId: SpeciesId.GIBLE,
    erBlackShiny: false,
    baseCost: 4,
  };
}
