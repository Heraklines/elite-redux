/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Set Editor - move-POOL correctness (Bug 1) + mega/rules BYPASS closure (Bug 2).
//
// Bug 1 (live report: "type bl on a mon that learns Bleakwind Storm, no candidates appear"):
// the editor's move dropdown must offer EXACTLY the current fielded stage's canonical legal pool -
// every level-up / TM / tutor move (with pre-evo inheritance) PLUS only the UNLOCKED egg moves,
// LOCKED egg moves excluded - and must RE-DERIVE when the fielded stage cycles. These tests pin the
// pool `collectShowdownLegalMoves` produces IS what the editor's `moveEntries()` dropdown shows.
//
// Bug 2 (live report: "if you already have a mega, the menu lets you bypass the 1 mega restriction"):
// with the team's one mega already spent, LEFT/RIGHT stage cycling must SKIP the locked mega and Done
// must REFUSE to commit a second mega with the specific message (red-proof: the load-bearing assertion
// is that onDone is NOT called on a second-mega Done).
//
// Gated ER_SCENARIO (needs the real GameManager + balance tables), mirroring showdown-editor-input.
// =============================================================================

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesTmMoves } from "#balance/tms";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import { collectShowdownFreeMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownEditorDemoConfig,
  EditorField,
  type ShowdownSetEditorConfig,
  type ShowdownSetEditorUiHandler,
} from "#ui/showdown-set-editor-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

type EditorInternals = {
  config: ShowdownSetEditorConfig;
  validationError: string | null;
  setFilter(v: string): void;
  moveEntries(): { moveId: MoveId; name: string; locked: boolean }[];
  allStages(): { speciesId: number; formIndex: number }[];
  processInput(b: Button): boolean;
};

function buildEditor(game: GameManager, config: ShowdownSetEditorConfig): EditorInternals {
  const registered = game.scene.ui.handlers[UiMode.SHOWDOWN_SET_EDITOR] as ShowdownSetEditorUiHandler;
  const handler = new (registered.constructor as new () => ShowdownSetEditorUiHandler)();
  handler.setup();
  handler.show([config]);
  return handler as unknown as EditorInternals;
}

const poolIds = (e: EditorInternals): Set<MoveId> => new Set(e.moveEntries().map(m => m.moveId));

describe.skipIf(!RUN)("Showdown Set Editor - move pool + rules", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame.destroy(true));

  // ---- Bug 1: pool correctness -------------------------------------------------------------------

  it("repro: typing 'bl' on a Bleakwind Storm learner (Tornadus) surfaces Bleakwind Storm", () => {
    const game = new GameManager(phaserGame);
    const editor = buildEditor(
      game,
      buildShowdownEditorDemoConfig({
        initialField: EditorField.MOVE0,
        rootSpeciesId: SpeciesId.TORNADUS,
        stage: { speciesId: SpeciesId.TORNADUS, formIndex: 0 },
      }),
    );
    editor.setFilter("bl");
    const filtered = editor.moveEntries();
    expect(filtered.length, "'bl' yields candidates").toBeGreaterThan(0);
    expect(
      filtered.some(m => m.moveId === MoveId.BLEAKWIND_STORM),
      "Bleakwind Storm is offered for 'bl'",
    ).toBe(true);
  });

  it("pool = level + TM/tutor + UNLOCKED egg present; LOCKED egg absent", () => {
    const game = new GameManager(phaserGame);
    // Demo: Gible -> Garchomp, fielded Garchomp, unlockedEggMoveBits 0b0011 (egg slots 0,1 unlocked; 2,3 locked).
    const editor = buildEditor(game, buildShowdownEditorDemoConfig({ initialField: EditorField.MOVE0 }));
    const pool = poolIds(editor);

    // a real level-up move of the fielded Garchomp
    const levelMove = pokemonSpeciesLevelMoves[SpeciesId.GARCHOMP]?.find(([lvl]) => lvl > 0)?.[1];
    expect(levelMove, "Garchomp has a level-up move").toBeDefined();
    expect(pool.has(levelMove as MoveId), "a level-up move is offered").toBe(true);

    // a TM/tutor move (ER folds the universal tutor pool into speciesTmMoves)
    const tmEntry = speciesTmMoves[SpeciesId.GARCHOMP]?.[0];
    const tmMove = Array.isArray(tmEntry) ? tmEntry[1] : tmEntry;
    expect(tmMove, "Garchomp has a TM/tutor move").toBeDefined();
    expect(pool.has(tmMove as MoveId), "a TM/tutor move is offered").toBe(true);

    // UNLOCKED egg move (Gible line, slot 0) is offered
    const eggs = speciesEggMoves[SpeciesId.GIBLE] as MoveId[];
    expect(pool.has(eggs[0]), "the unlocked egg move is offered").toBe(true);

    // a LOCKED egg move (slot 2 or 3) that is NOT otherwise a free move must be ABSENT
    const free = collectShowdownFreeMoves(SpeciesId.GIBLE, SpeciesId.GARCHOMP);
    const lockedEgg = [eggs[2], eggs[3]].find(m => !free.has(m));
    expect(lockedEgg, "a locked egg move outside the free pool exists in the fixture").toBeDefined();
    expect(pool.has(lockedEgg as MoveId), "a locked (un-unlocked) egg move is NOT offered").toBe(false);
  });

  it("the pool RE-DERIVES when the fielded stage cycles to a different learnset", () => {
    const game = new GameManager(phaserGame);
    const editor = buildEditor(game, buildShowdownEditorDemoConfig({ initialField: EditorField.MOVE0 }));
    const garchompPool = poolIds(editor); // starts fielding Garchomp

    // Cycle the fielded stage down to Gible.
    for (let i = 0; i < editor.allStages().length && editor.config.stage.speciesId !== SpeciesId.GIBLE; i++) {
      editor.processInput(Button.RIGHT);
    }
    expect(editor.config.stage.speciesId, "cycled to the Gible stage").toBe(SpeciesId.GIBLE);
    const giblePool = poolIds(editor);

    expect(giblePool.size, "Gible's pool differs from Garchomp's").not.toBe(garchompPool.size);
    expect(
      [...garchompPool].some(m => !giblePool.has(m)),
      "Garchomp offers moves Gible cannot",
    ).toBe(true);
  });

  // ---- Bug 2: mega / rules bypass closure --------------------------------------------------------

  it("RED-PROOF: Done REFUSES a second mega - onDone is NOT called and the mega message shows", () => {
    const game = new GameManager(phaserGame);
    let doneCalls = 0;
    const base = buildShowdownEditorDemoConfig();
    const config: ShowdownSetEditorConfig = {
      ...base,
      // Field a Garchomp MEGA (formIndex 1) while the team's one mega budget is already spent elsewhere.
      stage: { speciesId: SpeciesId.GARCHOMP, formIndex: 1 },
      unlocks: { ...base.unlocks, megaBudgetSpent: true, megaBudgetSpentBy: "Blastoise" },
      onDone: () => {
        doneCalls += 1;
      },
    };
    expect(isMegaStage(config.stage.speciesId, config.stage.formIndex), "fixture stage is a mega").toBe(true);
    const editor = buildEditor(game, config);

    const handled = editor.processInput(Button.SUBMIT);
    expect(handled, "SUBMIT is consumed").toBe(true);
    expect(doneCalls, "a second-mega Done must NOT commit").toBe(0);
    expect(editor.validationError, "the refusal message is surfaced").not.toBeNull();
    expect(editor.validationError, "the message names the mega rule").toContain("Mega");
  });

  it("LEFT/RIGHT stage cycling SKIPS the locked mega when the budget is spent", () => {
    const game = new GameManager(phaserGame);
    const base = buildShowdownEditorDemoConfig();
    const config: ShowdownSetEditorConfig = {
      ...base,
      stage: { speciesId: SpeciesId.GIBLE, formIndex: 0 },
      unlocks: { ...base.unlocks, megaBudgetSpent: true, megaBudgetSpentBy: "Blastoise" },
    };
    const editor = buildEditor(game, config);
    const stages = editor.allStages();
    const hasMega = stages.some(s => isMegaStage(s.speciesId, s.formIndex));
    expect(hasMega, "the Garchomp line has at least one mega stage").toBe(true);

    // A full lap of RIGHT presses must never land the fielded stage on a mega.
    for (let i = 0; i < stages.length + 2; i++) {
      editor.processInput(Button.RIGHT);
      expect(
        isMegaStage(editor.config.stage.speciesId, editor.config.stage.formIndex),
        "cycling never lands on a locked mega",
      ).toBe(false);
    }
  });
});
