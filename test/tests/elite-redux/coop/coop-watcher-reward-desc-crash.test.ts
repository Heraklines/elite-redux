/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Live P0 #852: the co-op GUEST client CRASHED (uncaught TypeError: Cannot read properties
// of undefined (reading 'displayHeight')) ~190ms after the reward-shop WATCHER mirror opened.
// Root cause mapped to ModifierSelectUiHandler.showItemDescription reading
// `this.itemDescText.displayHeight` off an UNBUILT (undefined) description pane: in the co-op
// watcher reward-shop mirror the screen is opened read-only and a relayed cursor button can
// drive showItemDescription before/without setup() having built that pane.
//
// This test drives the REAL ModifierSelectUiHandler headlessly (like the render harness recipe),
// SIMULATES the watcher-unbuilt state (itemDescText === undefined - MockText has no displayHeight,
// so the crash only reproduces when the object ITSELF is undefined, exactly the live case), and
// proves:
//   1) reading `.displayHeight` off the undefined pane throws (the mapped root crash), and
//   2) after the fix, showItemDescription rebuilds the pane on demand (ensureItemDescText) and
//      NEVER throws - the reader can no longer touch an unbuilt object.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-watcher-reward-desc-crash.test.ts
// =============================================================================

import { globalScene } from "#app/global-scene";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { ModifierSelectUiHandler } from "#ui/handlers/modifier-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Structural view onto the handler's #852-relevant internals (avoids `as any`). */
interface HandlerInternals {
  itemDescText: { displayHeight?: number } | undefined;
  showItemDescription(text: string): void;
  ensureItemDescText(): void;
}

describe.skipIf(!RUN)("co-op WATCHER reward-shop description crash (#852)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("showItemDescription rebuilds the pane when unbuilt (watcher launch order) instead of crashing", async () => {
    // A started battle gives the handler a real globalScene (add/make/scaledCanvas/getUi).
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    // Build the handler exactly like the render harness recipe (fresh instance + setup()).
    const handler = new ModifierSelectUiHandler();
    handler.setup();
    const internals = handler as unknown as HandlerInternals;

    // setup() built the description pane.
    expect(internals.itemDescText, "setup() builds the item-description pane").toBeDefined();

    // ===== SIMULATE the live watcher-unbuilt state (the mapped root of #852). =====
    const unbuilt = internals.itemDescText;
    internals.itemDescText = undefined;

    // (1) The mapped root crash: reading `.displayHeight` off the unbuilt pane throws the EXACT
    //     live TypeError. This is what the reward-shop watcher hit ~190ms after the mirror opened.
    expect(() => (internals.itemDescText as { displayHeight: number }).displayHeight).toThrowError(/displayHeight/);

    // (2) PASSES-AFTER: showItemDescription now builds the pane on demand and NEVER touches an
    //     unbuilt object - no throw, and the pane is rebuilt.
    expect(() => internals.showItemDescription("A long item description that the watcher mirror shows.")).not.toThrow();
    expect(internals.itemDescText, "showItemDescription rebuilt the pane on demand").toBeDefined();
    expect(internals.itemDescText).not.toBe(unbuilt); // a fresh pane was created

    // ensureItemDescText is idempotent: a second call keeps the same pane (no leak / no rebuild).
    const rebuilt = internals.itemDescText;
    internals.ensureItemDescText();
    expect(internals.itemDescText, "ensureItemDescText is idempotent").toBe(rebuilt);

    expect(globalScene).toBeDefined();
  }, 120_000);
});
