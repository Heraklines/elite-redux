/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER World Map overlay (#439 / #486 Phase D, increment 3). A read-only modal that
// lists the map nodes a SCOUT-style event has revealed this run (upcoming biomes,
// landmarks, treasure sites) plus the player's Treasure-Map fragment count. It is
// purely informational right now - it reads the run-scoped substrate
// (er-map-nodes.ts) and never mutates it. Travel selection (jumping the next
// biome choice to a node) and fragment payout arrive in later increments.
//
// Modeled on ErQuizUiHandler: a full-screen dim with a centred card. The node
// list is a fixed viewport (VISIBLE rows) that scrolls when there are more nodes
// than fit. ACTION or CANCEL closes it (reverting to whatever opened it).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { ErMapNode } from "#data/elite-redux/er-map-nodes";
import {
  getRevealedMapNodes,
  getTreasureFragments,
  TREASURE_FRAGMENTS_FOR_REWARD,
} from "#data/elite-redux/er-map-nodes";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getBiomeName } from "#utils/common";

/** Optional callback fired when the overlay is dismissed. */
export type ErMapCloseCallback = () => void;

const PANEL_W = 210;
const PANEL_H = 168;
const GOLD = 0xf8d030;
const INK = 0xe8ecf8;
const DIM = 0x90a0c0;

/** Short tag shown after each node, by kind. */
const KIND_LABEL: Record<ErMapNode["kind"], string> = {
  biome: "Route",
  landmark: "Landmark",
  treasure: "Treasure",
};

export class ErMapUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private card: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.NineSlice;
  private headerText: Phaser.GameObjects.Text;
  private fragmentText: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private onClose: ErMapCloseCallback | null = null;
  private resolved = false;

  /** Snapshot of the nodes taken on show() (the overlay is read-only). */
  private nodes: readonly ErMapNode[] = [];
  /** Index of the top visible row in the scrolling list. */
  private scroll = 0;

  private static readonly VISIBLE = 6;
  private static readonly ROW_H = 15;
  private static readonly LIST_Y0 = 44;

  constructor() {
    super(UiMode.ER_MAP);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const px = (w - PANEL_W) / 2;
    const py = (h - PANEL_H) / 2;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    const dim = globalScene.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0, 0);
    this.container.add(dim);

    this.card = globalScene.add.container(px, py);
    this.container.add(this.card);

    this.panel = addWindow(0, 0, PANEL_W, PANEL_H);
    this.card.add(this.panel);

    this.headerText = addTextObject(PANEL_W / 2, 6, "World Map", TextStyle.WINDOW, {
      fontSize: "60px",
      align: "center",
    });
    this.headerText.setOrigin(0.5, 0);
    this.headerText.setTint(GOLD);
    this.card.add(this.headerText);

    this.fragmentText = addTextObject(8, 26, "", TextStyle.WINDOW, { fontSize: "42px" });
    this.fragmentText.setOrigin(0, 0);
    this.fragmentText.setTint(INK);
    this.card.add(this.fragmentText);

    this.emptyText = addTextObject(PANEL_W / 2, ErMapUiHandler.LIST_Y0 + 18, "", TextStyle.WINDOW, {
      fontSize: "42px",
      align: "center",
    });
    this.emptyText.setOrigin(0.5, 0);
    this.emptyText.setTint(DIM);
    this.emptyText.setVisible(false);
    this.card.add(this.emptyText);

    // The scrolling row viewport.
    this.rowTexts = [];
    for (let i = 0; i < ErMapUiHandler.VISIBLE; i++) {
      const ry = ErMapUiHandler.LIST_Y0 + i * ErMapUiHandler.ROW_H;
      const row = addTextObject(12, ry, "", TextStyle.WINDOW, { fontSize: "42px" });
      row.setOrigin(0, 0);
      row.setTint(INK);
      this.card.add(row);
      this.rowTexts.push(row);
    }

    this.cursorObj = globalScene.add.rectangle(
      8,
      ErMapUiHandler.LIST_Y0,
      PANEL_W - 16,
      ErMapUiHandler.ROW_H,
      0xffffff,
      0,
    );
    this.cursorObj.setStrokeStyle(1, GOLD);
    this.cursorObj.setOrigin(0, 0);
    this.cursorObj.setVisible(false);
    this.card.add(this.cursorObj);

    this.hintText = addTextObject(PANEL_W / 2, PANEL_H - 14, "B: Close", TextStyle.WINDOW, {
      fontSize: "38px",
      align: "center",
    });
    this.hintText.setOrigin(0.5, 0);
    this.hintText.setTint(DIM);
    this.card.add(this.hintText);

    // Wire the global "J" opens-the-map hotkey (registered once).
    installErMapHotkey();
  }

  show(args: any[]): boolean {
    super.show(args);
    this.onClose = args.length > 0 && typeof args[0] === "function" ? (args[0] as ErMapCloseCallback) : null;
    this.resolved = false;

    this.nodes = getRevealedMapNodes();
    this.scroll = 0;
    this.cursor = 0;

    const frags = getTreasureFragments();
    this.fragmentText.setText(`Treasure-Map Fragments: ${frags} / ${TREASURE_FRAGMENTS_FOR_REWARD}`);

    const hasNodes = this.nodes.length > 0;
    this.emptyText.setVisible(!hasNodes);
    if (!hasNodes) {
      this.emptyText.setText("No locations discovered yet.");
    }
    this.cursorObj.setVisible(hasNodes);

    this.refreshRows();

    this.container.setVisible(true);
    this.container.parentContainer?.bringToTop(this.container);
    this.active = true;
    return true;
  }

  /** Render the VISIBLE rows starting at the scroll offset, and place the cursor. */
  private refreshRows(): void {
    for (let i = 0; i < ErMapUiHandler.VISIBLE; i++) {
      const node = this.nodes[this.scroll + i];
      const row = this.rowTexts[i];
      if (node) {
        const tag = KIND_LABEL[node.kind] ?? "";
        row.setText(`${node.label}  -  ${getBiomeName(node.biome)} [${tag}]`);
        row.setVisible(true);
      } else {
        row.setVisible(false);
      }
    }
    if (this.nodes.length > 0) {
      const visibleRow = this.cursor - this.scroll;
      this.cursorObj.setPosition(8, ErMapUiHandler.LIST_Y0 + visibleRow * ErMapUiHandler.ROW_H - 1);
    }
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    // Keep the selected row inside the viewport, scrolling when it leaves.
    if (this.cursor < this.scroll) {
      this.scroll = this.cursor;
    } else if (this.cursor >= this.scroll + ErMapUiHandler.VISIBLE) {
      this.scroll = this.cursor - ErMapUiHandler.VISIBLE + 1;
    }
    this.refreshRows();
    return changed;
  }

  processInput(button: Button): boolean {
    if (this.resolved) {
      return false;
    }
    switch (button) {
      case Button.UP:
        if (this.nodes.length > 0 && this.cursor > 0) {
          this.setCursor(this.cursor - 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.nodes.length > 0 && this.cursor < this.nodes.length - 1) {
          this.setCursor(this.cursor + 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
      case Button.CANCEL:
        this.close();
        return true;
    }
    return false;
  }

  private close(): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onClose;
    this.onClose = null;
    globalScene.ui.revertMode();
    cb?.();
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    this.onClose = null;
    this.resolved = false;
    this.nodes = [];
  }
}

/** Open the World Map overlay over the current screen. Optional close callback. */
export function openErMapOverlay(onClose?: ErMapCloseCallback): void {
  globalScene.ui.setOverlayMode(UiMode.ER_MAP, onClose);
}

let mapHotkeyInstalled = false;

/**
 * Install the global "J" hotkey that opens the World Map during a run. Registered
 * once (idempotent). Deliberately conservative: it only fires from the in-battle
 * COMMAND screen (the "standing in the field" moment), never while typing in a
 * text field, never outside a run, and never when an overlay is already open - so
 * it can't stomp menus, forms, or the map itself.
 *
 * NOTE: "J" is an UNASSIGNED key in the keyboard config (cfg-keyboard-qwerty maps
 * it to -1), so it can't collide with a real binding. "M" was wrong - it's bound
 * to ALT_BUTTON_MENU (opens the pause menu / settings).
 */
export function installErMapHotkey(): void {
  if (mapHotkeyInstalled || typeof window === "undefined") {
    return;
  }
  mapHotkeyInstalled = true;
  window.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key !== "j" && ev.key !== "J") {
      return;
    }
    // Ignore the key while a text field has focus (rename/search/password forms).
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      return;
    }
    if (!globalScene?.currentBattle || globalScene.ui?.getMode() !== UiMode.COMMAND) {
      return;
    }
    ev.preventDefault();
    openErMapOverlay();
  });
}
