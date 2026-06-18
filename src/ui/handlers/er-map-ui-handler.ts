/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER World Map overlay (#439 / #486 Phase D). A read-only modal that draws the
// run's JOURNEY as a visual chain of biome thumbnails (the biomes you've travelled
// through, oldest -> newest, the current one ringed gold), with the REVEALED
// onward routes shown as a branch row beneath it ("where you can go next"). Plus
// the Treasure-Map fragment count.
//
// Biome thumbnails reuse the boot-loaded `${biomeKey}_bg` arena backgrounds, so no
// extra asset load is needed. Left/Right scrub the journey when it is longer than
// the visible window; ACTION/CANCEL closes. Opened with the "J" hotkey from the
// in-battle command screen. Purely informational - it never mutates run state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { ErMapNode } from "#data/elite-redux/er-map-nodes";
import {
  getErBiomeHistory,
  getRevealedMapNodes,
  getTreasureFragments,
  TREASURE_FRAGMENTS_FOR_REWARD,
} from "#data/elite-redux/er-map-nodes";
import type { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getBiomeName } from "#utils/common";

/** Optional callback fired when the overlay is dismissed. */
export type ErMapCloseCallback = () => void;

const PANEL_W = 284;
const PANEL_H = 176;
const GOLD = 0xf8d030;
const INK = 0xe8ecf8;
const DIM = 0x90a0c0;
const LINE = 0x6878a0;

/** Thumbnail tile size (keeps the 320:180 arena aspect, scaled tiny). */
const TILE_W = 38;
const TILE_H = 22;
const TILE_GAP = 8;

export class ErMapUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private card: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.NineSlice;
  private headerText: Phaser.GameObjects.Text;
  private fragmentText: Phaser.GameObjects.Text;
  private journeyLabel: Phaser.GameObjects.Text;
  private routesLabel: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private graphics: Phaser.GameObjects.Graphics;
  /** Per-render tiles / labels destroyed on refresh + clear. */
  private transient: Phaser.GameObjects.GameObject[] = [];

  private onClose: ErMapCloseCallback | null = null;
  private resolved = false;

  private history: readonly BiomeId[] = [];
  private onward: readonly ErMapNode[] = [];
  /** Left index of the visible journey window (scrolls when history overflows). */
  private scroll = 0;

  /** How many journey tiles fit across the panel. */
  private static readonly VISIBLE = Math.floor((PANEL_W - 20) / (TILE_W + TILE_GAP));
  private static readonly JOURNEY_Y = 56;
  private static readonly ROUTES_Y = 116;

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

    this.headerText = addTextObject(PANEL_W / 2, 5, "World Map", TextStyle.WINDOW, {
      fontSize: "60px",
      align: "center",
    });
    this.headerText.setOrigin(0.5, 0);
    this.headerText.setTint(GOLD);
    this.card.add(this.headerText);

    this.fragmentText = addTextObject(PANEL_W / 2, 22, "", TextStyle.WINDOW, { fontSize: "38px", align: "center" });
    this.fragmentText.setOrigin(0.5, 0);
    this.fragmentText.setTint(INK);
    this.card.add(this.fragmentText);

    // Connector graphics sit UNDER the tiles (added before the transient sprites).
    this.graphics = globalScene.add.graphics();
    this.card.add(this.graphics);

    this.journeyLabel = addTextObject(10, 38, "Your journey", TextStyle.WINDOW, { fontSize: "38px" });
    this.journeyLabel.setOrigin(0, 0);
    this.journeyLabel.setTint(DIM);
    this.card.add(this.journeyLabel);

    this.routesLabel = addTextObject(10, 98, "Routes ahead", TextStyle.WINDOW, { fontSize: "38px" });
    this.routesLabel.setOrigin(0, 0);
    this.routesLabel.setTint(DIM);
    this.card.add(this.routesLabel);

    this.emptyText = addTextObject(PANEL_W / 2, ErMapUiHandler.ROUTES_Y, "", TextStyle.WINDOW, {
      fontSize: "38px",
      align: "center",
    });
    this.emptyText.setOrigin(0.5, 0.5);
    this.emptyText.setTint(DIM);
    this.emptyText.setVisible(false);
    this.card.add(this.emptyText);

    this.hintText = addTextObject(PANEL_W / 2, PANEL_H - 13, "< > Scroll    B: Close", TextStyle.WINDOW, {
      fontSize: "36px",
      align: "center",
    });
    this.hintText.setOrigin(0.5, 0);
    this.hintText.setTint(DIM);
    this.card.add(this.hintText);

    installErMapHotkey();
  }

  show(args: any[]): boolean {
    super.show(args);
    this.onClose = args.length > 0 && typeof args[0] === "function" ? (args[0] as ErMapCloseCallback) : null;
    this.resolved = false;

    this.history = getErBiomeHistory();
    this.onward = getRevealedMapNodes().filter(n => n.kind === "biome");

    const frags = getTreasureFragments();
    this.fragmentText.setText(`Treasure-Map Fragments: ${frags} / ${TREASURE_FRAGMENTS_FOR_REWARD}`);

    // Default the journey window to the most recent biomes (current at the end).
    this.scroll = Math.max(0, this.history.length - ErMapUiHandler.VISIBLE);

    this.refresh();

    this.container.setVisible(true);
    this.container.parentContainer?.bringToTop(this.container);
    this.active = true;
    return true;
  }

  /** Build one biome thumbnail tile (bg image if loaded, else a dim placeholder). */
  private makeTile(biome: BiomeId, cx: number, cy: number, highlight: boolean): void {
    const key = `${getBiomeKey(biome)}_bg`;
    if (globalScene.textures.exists(key)) {
      const tile = globalScene.add.sprite(cx, cy, key);
      tile.setOrigin(0.5, 0.5);
      tile.setDisplaySize(TILE_W, TILE_H);
      this.card.add(tile);
      this.transient.push(tile);
    } else {
      const ph = globalScene.add.rectangle(cx, cy, TILE_W, TILE_H, 0x33405c).setOrigin(0.5);
      this.card.add(ph);
      this.transient.push(ph);
    }
    // Border: gold + thicker for the current biome, thin grey otherwise.
    const border = globalScene.add.rectangle(cx, cy, TILE_W + 2, TILE_H + 2, 0xffffff, 0).setOrigin(0.5);
    border.setStrokeStyle(highlight ? 2 : 1, highlight ? GOLD : LINE);
    this.card.add(border);
    this.transient.push(border);

    const name = addTextObject(cx, cy + TILE_H / 2 + 1, getBiomeName(biome), TextStyle.WINDOW, {
      fontSize: "32px",
      align: "center",
    });
    name.setOrigin(0.5, 0);
    name.setTint(highlight ? GOLD : INK);
    this.card.add(name);
    this.transient.push(name);

    if (highlight) {
      const here = addTextObject(cx, cy - TILE_H / 2 - 9, "HERE", TextStyle.WINDOW, {
        fontSize: "30px",
        align: "center",
      });
      here.setOrigin(0.5, 0);
      here.setTint(GOLD);
      this.card.add(here);
      this.transient.push(here);
    }
  }

  /** Render the journey chain + onward routes for the current scroll position. */
  private refresh(): void {
    for (const o of this.transient) {
      o.destroy();
    }
    this.transient = [];
    this.graphics.clear();

    const total = this.history.length;
    const currentBiome = total > 0 ? this.history[total - 1] : globalScene.arena?.biomeId;

    // --- Journey row: the visible window of visited biomes, connected L->R. ---
    const count = Math.min(ErMapUiHandler.VISIBLE, total);
    const rowW = count * TILE_W + Math.max(0, count - 1) * TILE_GAP;
    const startX = (PANEL_W - rowW) / 2 + TILE_W / 2;
    const cy = ErMapUiHandler.JOURNEY_Y;
    const tileX: number[] = [];
    for (let i = 0; i < count; i++) {
      const cx = startX + i * (TILE_W + TILE_GAP);
      tileX.push(cx);
      const histIndex = this.scroll + i;
      const biome = this.history[histIndex];
      if (biome === undefined) {
        continue;
      }
      // Connector from the previous tile.
      if (i > 0) {
        this.graphics.lineStyle(2, LINE, 0.9);
        this.graphics.lineBetween(tileX[i - 1] + TILE_W / 2, cy, cx - TILE_W / 2, cy);
      }
      this.makeTile(biome, cx, cy, histIndex === total - 1);
    }
    // "older biomes" hint when the window is scrolled off the start.
    if (this.scroll > 0 && count > 0) {
      const more = addTextObject(4, cy, "<", TextStyle.WINDOW, { fontSize: "44px" });
      more.setOrigin(0, 0.5);
      more.setTint(DIM);
      this.card.add(more);
      this.transient.push(more);
    }

    // --- Routes-ahead row: the revealed onward biome routes (branch from now). ---
    const onwardCount = Math.min(5, this.onward.length);
    if (onwardCount > 0 && currentBiome !== undefined) {
      const oRowW = onwardCount * TILE_W + Math.max(0, onwardCount - 1) * TILE_GAP;
      const oStartX = (PANEL_W - oRowW) / 2 + TILE_W / 2;
      const oy = ErMapUiHandler.ROUTES_Y;
      // Branch line down from the current tile (last drawn journey tile) to the row.
      const fromX = tileX.at(-1) ?? PANEL_W / 2;
      this.graphics.lineStyle(2, GOLD, 0.7);
      this.graphics.lineBetween(fromX, cy + TILE_H / 2 + 9, PANEL_W / 2, oy - TILE_H / 2 - 2);
      for (let i = 0; i < onwardCount; i++) {
        const cx = oStartX + i * (TILE_W + TILE_GAP);
        const node = this.onward[i];
        const key = `${getBiomeKey(node.biome)}_bg`;
        if (globalScene.textures.exists(key)) {
          const tile = globalScene.add.sprite(cx, oy, key);
          tile.setOrigin(0.5, 0.5);
          tile.setDisplaySize(TILE_W, TILE_H);
          this.card.add(tile);
          this.transient.push(tile);
        } else {
          const ph = globalScene.add.rectangle(cx, oy, TILE_W, TILE_H, 0x33405c).setOrigin(0.5);
          this.card.add(ph);
          this.transient.push(ph);
        }
        const border = globalScene.add.rectangle(cx, oy, TILE_W + 2, TILE_H + 2, 0xffffff, 0).setOrigin(0.5);
        border.setStrokeStyle(1, GOLD);
        this.card.add(border);
        this.transient.push(border);
        const name = addTextObject(cx, oy + TILE_H / 2 + 1, getBiomeName(node.biome), TextStyle.WINDOW, {
          fontSize: "32px",
          align: "center",
        });
        name.setOrigin(0.5, 0);
        name.setTint(INK);
        this.card.add(name);
        this.transient.push(name);
      }
      this.routesLabel.setVisible(true);
    } else {
      this.routesLabel.setVisible(false);
    }

    // Empty state: a brand-new run with nothing to show yet.
    const nothing = total === 0 && onwardCount === 0;
    this.emptyText.setVisible(nothing);
    if (nothing) {
      this.emptyText.setText("Your journey begins...");
    }
  }

  processInput(button: Button): boolean {
    if (this.resolved) {
      return false;
    }
    switch (button) {
      case Button.LEFT:
        if (this.scroll > 0) {
          this.scroll--;
          this.refresh();
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (this.scroll + ErMapUiHandler.VISIBLE < this.history.length) {
          this.scroll++;
          this.refresh();
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
    for (const o of this.transient) {
      o.destroy();
    }
    this.transient = [];
    this.graphics.clear();
    this.onClose = null;
    this.resolved = false;
    this.history = [];
    this.onward = [];
  }
}

/** Open the World Map overlay over the current screen. Optional close callback. */
export function openErMapOverlay(onClose?: ErMapCloseCallback): void {
  globalScene.ui.setOverlayMode(UiMode.ER_MAP, onClose);
}

let mapHotkeyInstalled = false;

/**
 * Install the global "J" hotkey that opens the World Map during a run. Registered
 * once (idempotent). Conservative: only from the in-battle COMMAND screen, never
 * while a text field is focused, never outside a run, never over another overlay.
 *
 * "J" is UNASSIGNED in the keyboard config (maps to -1), so it can't collide.
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
