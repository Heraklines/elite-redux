/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - World Map core, the branching NODE PICKER shown when LEAVING a biome.
//
// Replaces the plain OPTION_SELECT list SelectBiomePhase used for the ER node set
// with an actual branching MAP screen: the biome you are LEAVING sits on the left
// as the origin node, and the rolled destination nodes branch off to the right,
// each connected by a route line. Revealed nodes show the biome name and are
// selectable; hidden nodes (gated by Map Upgrade tier) render as dim "???"
// silhouettes and cannot be chosen.
//
// Modeled on the read-only ErMapUiHandler card, but interactive: UP/DOWN moves
// between the REVEALED destination nodes, ACTION confirms (fires the onSelect
// callback with the chosen biome). There is no cancel - the player must pick a
// route (the run cannot continue without a next biome).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { ErRouteNode } from "#data/elite-redux/er-biome-routing";
import type { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getBiomeName } from "#utils/common";

/** Fired with the chosen destination biome when the player confirms a route. */
export type ErMapPickerSelectCallback = (biome: BiomeId) => void;

const PANEL_W = 252;
const PANEL_H = 180;
const GOLD = 0xf8d030;
const INK = 0xe8ecf8;
const DIM = 0x90a0c0;
const LINE = 0x6878a0;
const LINE_SEL = 0xf8d030;

/** Vertical span the destination column is laid out within. */
const NODE_COL_X = PANEL_W - 78;
const ORIGIN_X = 40;
const COL_TOP = 44;
const COL_BOTTOM = PANEL_H - 30;

export class ErMapPickerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private card: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.NineSlice;
  private headerText: Phaser.GameObjects.Text;
  private originText: Phaser.GameObjects.Text;
  private originDot: Phaser.GameObjects.Arc;
  private hintText: Phaser.GameObjects.Text;
  /** Base route lines (drawn once per node set). */
  private graphics: Phaser.GameObjects.Graphics;
  /** The single highlighted (selected) route line, redrawn on cursor move. */
  private selGraphics: Phaser.GameObjects.Graphics;

  /** One label + dot per node (revealed or silhouette). */
  private nodeTexts: Phaser.GameObjects.Text[] = [];
  private nodeDots: Phaser.GameObjects.Arc[] = [];
  private cursorRing: Phaser.GameObjects.Arc;

  private nodes: ErRouteNode[] = [];
  /** Indices into `nodes` that are revealed (selectable). */
  private selectable: number[] = [];
  private onSelect: ErMapPickerSelectCallback | null = null;
  private resolved = false;

  constructor() {
    super(UiMode.ER_MAP_PICKER);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const px = (w - PANEL_W) / 2;
    const py = (h - PANEL_H) / 2;

    // Full-screen root. The UI parent is offset by +canvasHeight, so EVERY
    // full-screen handler anchors its container at (0, -h) to land at (0, 0).
    // (This was (0, 0) and rendered one screen-height off - the invisible/"black"
    // map picker that still took input and shuffled the biome blind. #486 fix.)
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    const dim = globalScene.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0, 0);
    this.container.add(dim);

    this.card = globalScene.add.container(px, py);
    this.container.add(this.card);

    this.panel = addWindow(0, 0, PANEL_W, PANEL_H);
    this.card.add(this.panel);

    this.headerText = addTextObject(PANEL_W / 2, 6, "Choose your route", TextStyle.WINDOW, {
      fontSize: "60px",
      align: "center",
    });
    this.headerText.setOrigin(0.5, 0);
    this.headerText.setTint(GOLD);
    this.card.add(this.headerText);

    // The route lines (drawn fresh per show()) + the highlighted-route overlay.
    this.graphics = globalScene.add.graphics();
    this.card.add(this.graphics);
    this.selGraphics = globalScene.add.graphics();
    this.card.add(this.selGraphics);

    // Origin (the biome being left).
    this.originDot = globalScene.add.circle(ORIGIN_X, (COL_TOP + COL_BOTTOM) / 2, 4, INK);
    this.card.add(this.originDot);
    this.originText = addTextObject(ORIGIN_X, (COL_TOP + COL_BOTTOM) / 2 + 8, "", TextStyle.WINDOW, {
      fontSize: "38px",
      align: "center",
    });
    this.originText.setOrigin(0.5, 0);
    this.originText.setTint(DIM);
    this.card.add(this.originText);

    this.cursorRing = globalScene.add.circle(NODE_COL_X, COL_TOP, 7);
    this.cursorRing.setStrokeStyle(2, GOLD);
    this.cursorRing.setFillStyle(0, 0);
    this.cursorRing.setVisible(false);
    this.card.add(this.cursorRing);

    this.hintText = addTextObject(PANEL_W / 2, PANEL_H - 14, "Up/Down: Choose   A: Travel", TextStyle.WINDOW, {
      fontSize: "36px",
      align: "center",
    });
    this.hintText.setOrigin(0.5, 0);
    this.hintText.setTint(DIM);
    this.card.add(this.hintText);
  }

  show(args: any[]): boolean {
    super.show(args);

    const cfg = (args.length > 0 ? args[0] : null) as {
      nodes?: ErRouteNode[];
      origin?: BiomeId;
      onSelect?: ErMapPickerSelectCallback;
    } | null;
    this.nodes = cfg?.nodes ?? [];
    this.onSelect = typeof cfg?.onSelect === "function" ? cfg.onSelect : null;
    this.resolved = false;

    this.originText.setText(cfg?.origin == null ? "Here" : getBiomeName(cfg.origin));

    this.selectable = this.nodes.map((n, i) => (n.revealed ? i : -1)).filter(i => i >= 0);

    this.layoutNodes();

    // Start the cursor on the first selectable node.
    this.cursor = 0;
    this.placeCursor();

    this.container.setVisible(true);
    this.container.parentContainer?.bringToTop(this.container);
    this.active = true;
    return true;
  }

  /** Y position of each node's dot, indexed parallel to `this.nodes`. */
  private nodeY: number[] = [];

  /** Y of the origin node (vertical centre of the destination column). */
  private static readonly ORIGIN_Y = (COL_TOP + COL_BOTTOM) / 2;

  /** Build the destination dots/labels + base route lines for the node set. */
  private layoutNodes(): void {
    for (const t of this.nodeTexts) {
      t.destroy();
    }
    for (const d of this.nodeDots) {
      d.destroy();
    }
    this.nodeTexts = [];
    this.nodeDots = [];
    this.nodeY = [];
    this.graphics.clear();

    const count = this.nodes.length;
    const span = COL_BOTTOM - COL_TOP;
    for (let i = 0; i < count; i++) {
      const y = count <= 1 ? ErMapPickerUiHandler.ORIGIN_Y : COL_TOP + (span * i) / (count - 1);
      this.nodeY.push(y);
      this.drawNode(this.nodes[i], y);
    }
  }

  /** Draw a single node's base route line, dot and label. */
  private drawNode(node: ErRouteNode, y: number): void {
    this.graphics.lineStyle(1, LINE, node.revealed ? 0.9 : 0.4);
    this.graphics.beginPath();
    this.graphics.moveTo(ORIGIN_X + 4, ErMapPickerUiHandler.ORIGIN_Y);
    this.graphics.lineTo(NODE_COL_X - 6, y);
    this.graphics.strokePath();

    const dot = globalScene.add.circle(NODE_COL_X, y, 4, node.revealed ? GOLD : DIM);
    dot.setAlpha(node.revealed ? 1 : 0.6);
    this.card.add(dot);
    this.nodeDots.push(dot);

    const label = addTextObject(
      NODE_COL_X + 10,
      y - 6,
      node.revealed ? getBiomeName(node.biome) : "???",
      TextStyle.WINDOW,
      {
        fontSize: "42px",
      },
    );
    label.setOrigin(0, 0);
    label.setTint(node.revealed ? INK : DIM);
    label.setAlpha(node.revealed ? 1 : 0.6);
    this.card.add(label);
    this.nodeTexts.push(label);
  }

  /** Move the gold cursor ring to the selected node + highlight its route line. */
  private placeCursor(): void {
    if (this.selectable.length === 0) {
      this.cursorRing.setVisible(false);
      return;
    }
    const nodeIndex = this.selectable[Math.min(this.cursor, this.selectable.length - 1)];
    const y = this.nodeY[nodeIndex];
    this.cursorRing.setPosition(NODE_COL_X, y);
    this.cursorRing.setVisible(true);

    // Highlight the selected route line by drawing it gold over the base layer.
    this.selGraphics.clear();
    this.selGraphics.lineStyle(2, LINE_SEL, 1);
    this.selGraphics.beginPath();
    this.selGraphics.moveTo(ORIGIN_X + 4, ErMapPickerUiHandler.ORIGIN_Y);
    this.selGraphics.lineTo(NODE_COL_X - 6, y);
    this.selGraphics.strokePath();
  }

  processInput(button: Button): boolean {
    if (this.resolved || this.selectable.length === 0) {
      return false;
    }
    switch (button) {
      case Button.UP:
        if (this.cursor > 0) {
          this.cursor--;
          this.placeCursor();
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.cursor < this.selectable.length - 1) {
          this.cursor++;
          this.placeCursor();
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.ACTION: {
        const nodeIndex = this.selectable[this.cursor];
        const node = this.nodes[nodeIndex];
        if (node) {
          this.confirm(node.biome);
        }
        return true;
      }
    }
    return false;
  }

  private confirm(biome: BiomeId): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onSelect;
    this.onSelect = null;
    // Hand the UI back to MESSAGE before the biome-switch flow runs (it expects a
    // normal mode), then deliver the choice.
    globalScene.ui.setMode(UiMode.MESSAGE);
    cb?.(biome);
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorRing.setVisible(false);
    this.selGraphics.clear();
    this.onSelect = null;
    this.resolved = false;
    this.nodes = [];
    this.selectable = [];
  }
}
