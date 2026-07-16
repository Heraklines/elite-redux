/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// VISUAL verification for the ER Library (5928) in-battle CAST panel
// (`src/ui/library-panel.ts`). Renders the REAL FightUiHandler over the live
// battlefield and opens the REAL LibraryPanel via the REAL input path
// (Button.CYCLE_FORM) so the maintainer can eyeball how the panel LOOKS and
// whether navigation works, across every state:
//   - fight menu with the panel CLOSED (baseline),
//   - panel open with 3 recorded moves + cursor on each entry (nav ordering),
//   - the shared-PP counter after one cast (2 -> 1),
//   - the exhausted (0 PP) and empty (0 recorded) states,
//   - a partial list (1 recorded move).
//
// Reuses the Tier-2b render-harness core (real CANVAS scene + battlefield +
// two-pass asset injection + universal input driving). PNGs land in the
// scratchpad so they are easy to open and never clutter the repo.
//
// Run:
//   ER_SCENARIO=1 npx vitest run test/tools/render-library-panel.test.ts
// =============================================================================

import { allMoves } from "#data/data-lists";
import {
  commitLibraryCast,
  ER_LIBRARY_ABILITY_ID,
  erLibraryRecordFoeMove,
  getLibraryCastPp,
  getRecordedMoves,
  resetLibraryState,
} from "#data/elite-redux/abilities/library";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { GameManager as GameManagerClass } from "#test/framework/game-manager";
import {
  createRenderScene,
  freezeAnimations,
  injectMissing,
  type RenderContext,
  renderBattlefield,
  renderTwoPass,
  repointGlobalScene,
  restoreGlobalScene,
} from "#test/tools/render-harness";
import type { LibraryPanel } from "#ui/library-panel";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const LIBRARY = ER_LIBRARY_ABILITY_ID as AbilityId;

// Captures land in the session scratchpad (easy to open; out of the repo).
const OUT_DIR = join(
  "C:",
  "Users",
  "Hafida",
  "AppData",
  "Local",
  "Temp",
  "claude",
  "C--Users-Hafida",
  "91d7b1e2-397d-47d4-8fce-1ca7a5d1369d",
  "scratchpad",
  "library-ui-captures",
);

/**
 * Whitebox view of the panel's private members, so the exhausted / empty states
 * (which the public `open()` gate deliberately refuses to open — see below) can
 * still be FORCE-rendered for layout inspection. Typed double-cast, not `as any`
 * (the sanctioned pattern, mirrors test/tools/render-ui-page.test.ts #349).
 */
interface LibraryPanelView {
  holder: Pokemon | null;
  cursor: number;
  render(): void;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!RUN)("render Library panel (5928)", () => {
  let phaserGame: Phaser.Game;
  let ctx: RenderContext;
  // The GameManager reuses globalScene across cases; restore its real render members
  // before each new construction (the prior case left them re-pointed at the mock).
  let lastScene: any = null;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    ctx = await createRenderScene();
    mkdirSync(OUT_DIR, { recursive: true });
  });

  /**
   * Boot a fresh single battle whose PLAYER lead holds Library (active ability
   * override), then seed `records` into that holder. Library records the FIRST
   * move of each DISTINCT opposing Pokemon, so we seed via the single foe with a
   * temporarily-distinct `id` per record (the id is the only thing keyed — the
   * WeakMap holder state is untouched; id is restored after). Mirrors the seeding
   * shape of er-library.test.ts.
   */
  async function bootHolder(records: MoveId[]): Promise<{ game: GameManagerClass; holder: Pokemon }> {
    if (lastScene) {
      restoreGlobalScene(lastScene);
    }
    const game = new GameManagerClass(phaserGame);
    lastScene = game.scene;
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(LIBRARY)
      .moveset([MoveId.TACKLE, MoveId.TAIL_WHIP, MoveId.QUICK_ATTACK, MoveId.HYPER_FANG]);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    if (!holder || !foe) {
      throw new Error("bootHolder: missing holder/foe after startBattle");
    }
    resetLibraryState(holder);
    const origId = foe.id;
    try {
      records.forEach((moveId, i) => {
        foe.id = origId + 9001 + i; // distinct foe identity per record
        erLibraryRecordFoeMove(foe, allMoves[moveId]);
      });
    } finally {
      foe.id = origId;
    }
    expect(getRecordedMoves(holder), "seeding must record the requested moves").toEqual(records);
    return { game, holder };
  }

  /** Build the battlefield + message bar + a fresh REAL FightUiHandler, active for input. */
  async function renderFightScene(game: GameManagerClass, ref: { h: any }): Promise<void> {
    await renderBattlefield(game.scene, ctx);
    try {
      const msgReg: any = (game.scene as any).ui.handlers[UiMode.MESSAGE];
      const msg: any = new msgReg.constructor();
      msg.setup();
      msg.show([]);
    } catch {
      /* no message bar - battlefield + handler still render */
    }
    const registered: any = (game.scene as any).ui.handlers[UiMode.FIGHT];
    let handler: any = registered;
    try {
      handler = new registered.constructor();
    } catch {
      handler = registered;
    }
    handler.setup();
    handler.show([0]); // fieldIndex 0 (the lead / holder); fromCommand defaults to FIGHT
    (game.scene as any).ui.setActiveHandler?.(handler);
    ref.h = handler;
  }

  /** Settle live frames + inject any freshly-requested textures, then freeze for a clean shot. */
  async function settle(): Promise<void> {
    ctx.step();
    await injectMissing(ctx);
    for (let s = 0; s < 3; s++) {
      ctx.step();
      await sleep(10);
    }
    freezeAnimations(ctx.uiInner);
    freezeAnimations(ctx.fieldRoot);
    ctx.step();
  }

  function snap(name: string): number {
    return ctx.snapshot(join(OUT_DIR, `${name}.png`)).nonBlankPx;
  }

  it("3 records: closed baseline, panel open, cursor on each entry (nav ordering)", async () => {
    const { game } = await bootHolder([MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]);
    repointGlobalScene(game.scene, ctx);
    await sleep(0);

    const ref: { h: any } = { h: null };
    await renderTwoPass(ctx, () => renderFightScene(game, ref));

    // (1) Fight menu, panel CLOSED — the baseline.
    await settle();
    expect(snap("01-fight-menu-closed")).toBeGreaterThan(0);

    const panel: LibraryPanel = ref.h.library;
    expect(panel.isOpen, "panel starts closed").toBe(false);

    // (2) Open the panel through the REAL input path (CYCLE_FORM). 3 records, cursor 0.
    await ref.h.processInput(Button.CYCLE_FORM);
    expect(panel.isOpen, "CYCLE_FORM opens the Library panel for a castable holder").toBe(true);
    expect(panel.getEntries()).toEqual([MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]);
    expect(panel.getCursor()).toBe(0);
    await settle();
    snap("02-open-3-cursor0");

    // (3) DOWN -> cursor 1 (visual second row). Proves keyboard/gamepad DOWN == visual order.
    await ref.h.processInput(Button.DOWN);
    expect(panel.getCursor()).toBe(1);
    await settle();
    snap("03-open-3-cursor1");

    // (4) DOWN -> cursor 2 (visual third row).
    await ref.h.processInput(Button.DOWN);
    expect(panel.getCursor()).toBe(2);
    await settle();
    snap("04-open-3-cursor2");

    // (5) DOWN wraps back to cursor 0 (list is circular).
    await ref.h.processInput(Button.DOWN);
    expect(panel.getCursor()).toBe(0);
  }, 180000);

  it("shared-PP counter after one cast (2 -> 1)", async () => {
    const { game, holder } = await bootHolder([MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]);
    // Spend one shared cast PP BEFORE opening, so the panel shows "Cast PP: 1".
    expect(getLibraryCastPp(holder)).toBe(2);
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(true);
    expect(getLibraryCastPp(holder)).toBe(1);

    repointGlobalScene(game.scene, ctx);
    await sleep(0);
    const ref: { h: any } = { h: null };
    await renderTwoPass(ctx, () => renderFightScene(game, ref));

    await ref.h.processInput(Button.CYCLE_FORM);
    const panel: LibraryPanel = ref.h.library;
    expect(panel.isOpen, "panel still opens with 1 PP left").toBe(true);
    await settle();
    snap("05-open-pp-1");
  }, 180000);

  it("exhausted state (0 PP): open() is refused; forced render shows the 0-PP layout", async () => {
    const { game, holder } = await bootHolder([MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]);
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(true);
    expect(commitLibraryCast(holder, MoveId.TACKLE)).toBe(true);
    expect(getLibraryCastPp(holder)).toBe(0);

    repointGlobalScene(game.scene, ctx);
    await sleep(0);
    const ref: { h: any } = { h: null };
    await renderTwoPass(ctx, () => renderFightScene(game, ref));

    const panel: LibraryPanel = ref.h.library;
    // FINDING: at 0 shared PP the public open() gate refuses (canCastLibrary false),
    // so CYCLE_FORM is a silent no-op in-game — the player sees only the fight menu.
    await ref.h.processInput(Button.CYCLE_FORM);
    expect(panel.isOpen, "at 0 PP the panel does NOT open (canCastLibrary is false)").toBe(false);
    await settle();
    snap("06-exhausted-no-panel");

    // Force-render the panel anyway to inspect the 0-PP layout the gate hides.
    const view = panel as unknown as LibraryPanelView;
    view.holder = holder;
    view.cursor = 0;
    view.render();
    await settle();
    snap("07-exhausted-forced-pp0");
  }, 180000);

  it("partial list (1 recorded move)", async () => {
    const { game } = await bootHolder([MoveId.THUNDERBOLT]);
    repointGlobalScene(game.scene, ctx);
    await sleep(0);
    const ref: { h: any } = { h: null };
    await renderTwoPass(ctx, () => renderFightScene(game, ref));

    await ref.h.processInput(Button.CYCLE_FORM);
    const panel: LibraryPanel = ref.h.library;
    expect(panel.isOpen, "opens with a single record").toBe(true);
    expect(panel.getEntries()).toEqual([MoveId.THUNDERBOLT]);
    await settle();
    snap("08-open-1-record");
  }, 180000);

  it("empty state (0 recorded): open() is refused; forced render shows the empty layout", async () => {
    const { game, holder } = await bootHolder([]);
    repointGlobalScene(game.scene, ctx);
    await sleep(0);
    const ref: { h: any } = { h: null };
    await renderTwoPass(ctx, () => renderFightScene(game, ref));

    const panel: LibraryPanel = ref.h.library;
    // FINDING: with no recorded moves open() is refused (entries.length === 0), so
    // CYCLE_FORM does nothing in-game — the player sees only the fight menu.
    await ref.h.processInput(Button.CYCLE_FORM);
    expect(panel.isOpen, "with 0 records the panel does NOT open").toBe(false);
    await settle();
    snap("09-empty-no-panel");

    // Force-render the empty layout to inspect it (title + no rows + Cast PP).
    const view = panel as unknown as LibraryPanelView;
    view.holder = holder;
    view.cursor = 0;
    view.render();
    await settle();
    snap("10-empty-forced");
  }, 180000);
});
