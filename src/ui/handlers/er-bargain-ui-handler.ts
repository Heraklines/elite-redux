/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - the dedicated full-screen DEAL screen.
//
// An ominous, shop-like (but not a shop) interface shown in the Abyss every-10-
// waves slot: a dark backdrop, Giratina Origin's talking portrait on the left,
// his line of dialogue, and the list of bargains on the right. Modeled on
// BiomeShopUiHandler (a full-screen UiHandler container the UI system shows on
// top of the field, so the portrait always renders). Pure presentation + cursor
// + a select callback; TheBargainPhase owns all the deal logic.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** Choose bargain `index`, or leave when `index < 0`. */
export type ErBargainSelectCallback = (index: number) => void;

export class ErBargainUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private portrait: Phaser.GameObjects.Sprite;
  private titleText: Phaser.GameObjects.Text;
  private dialogueText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private optionsWindow: Phaser.GameObjects.NineSlice;
  private rows: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private labels: string[] = [];
  private descs: string[] = [];
  private onSelect: ErBargainSelectCallback | null = null;
  /** Wall-clock time (ms) the screen opened; input is swallowed briefly after. */
  private openedAt = 0;

  constructor() {
    super(UiMode.ER_BARGAIN);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    // Full-screen handler containers sit at y = -h so that a child at logical
    // (0,0) lands at the screen's top-left (the egg-gacha / biome-shop / colosseum
    // convention). At y = 0 the whole screen renders one full height BELOW the
    // viewport - invisible - which is why this screen never appeared (#550).
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Ominous near-opaque void backdrop (reads as a separate screen over the field).
    this.bg = globalScene.add.rectangle(0, 0, w, h, 0x0a0613, 0.94).setOrigin(0);
    this.container.add(this.bg);

    // Giratina Origin's talking portrait, left side.
    this.portrait = globalScene.add.sprite(64, 86, "er_bargain_giratina");
    this.portrait.setOrigin(0.5, 0.5).setScale(0.82);
    this.container.add(this.portrait);

    this.titleText = addTextObject(w / 2, 6, "GIRATINA'S BARGAIN", TextStyle.WINDOW, { fontSize: "80px" });
    this.titleText.setOrigin(0.5, 0).setColor("#c8a8f0");
    this.container.add(this.titleText);

    // Giratina's spoken line, under the portrait (wrapped).
    this.dialogueText = addTextObject(64, 150, "", TextStyle.PARTY, {
      fontSize: "42px",
      align: "center",
      wordWrap: { width: 122 * 6 },
    });
    this.dialogueText.setOrigin(0.5, 0);
    this.container.add(this.dialogueText);

    // Framed panel for the bargain list (right side).
    this.optionsWindow = addWindow(146, 28, w - 152, 110);
    this.container.add(this.optionsWindow);

    // Focused bargain's cost -> payoff line, under the panel.
    this.descText = addTextObject(228, 142, "", TextStyle.PARTY, {
      fontSize: "40px",
      align: "center",
      wordWrap: { width: (w - 152) * 6 },
    });
    this.descText.setOrigin(0.5, 0);
    this.container.add(this.descText);

    this.cursorObj = globalScene.add.rectangle(0, 0, w - 160, 16, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(1, 0xc060f8);
    this.cursorObj.setOrigin(0, 0.5);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (!(args.length >= 4 && Array.isArray(args[0]) && typeof args[3] === "function")) {
      return false;
    }
    this.labels = args[0] as string[];
    this.descs = args[1] as string[];
    this.dialogueText.setText((args[2] as string) ?? "");
    this.onSelect = args[3] as ErBargainSelectCallback;

    this.buildRows();
    this.cursor = 0;
    this.moveCursorTo(0);

    this.openedAt = performance.now();
    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  private buildRows(): void {
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.labels.forEach((label, i) => {
      const row = addTextObject(164, 40 + i * 18, label, TextStyle.WINDOW, { fontSize: "60px" });
      row.setOrigin(0, 0.5);
      this.container.add(row);
      this.rows.push(row);
    });
  }

  private moveCursorTo(index: number): void {
    if (this.rows.length === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    const i = Math.max(0, Math.min(index, this.rows.length - 1));
    const y = 40 + i * 18;
    this.cursorObj.setPosition(158, y);
    this.cursorObj.setVisible(true);
    this.descText.setText(this.descs[i] ?? "");
    this.rows.forEach((row, r) => row.setAlpha(r === i ? 1 : 0.6));
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  processInput(button: Button): boolean {
    // Swallow any input that arrives in the first moments after the screen opens.
    // Without this, a button press carried over from mashing through the post-
    // victory / reward messages instantly auto-selects the first bargain before
    // the player ever sees this screen (the reported "I only see the offer line"
    // bug). Real-time gated so it can never hang the handler.
    if (performance.now() - this.openedAt < 600) {
      return true;
    }
    const count = this.rows.length;
    let moved = false;
    switch (button) {
      case Button.ACTION:
        if (this.onSelect && count > 0) {
          this.onSelect(this.cursor);
        }
        return true;
      case Button.CANCEL:
        if (this.onSelect) {
          this.onSelect(-1);
        }
        return true;
      case Button.UP:
        if (this.cursor > 0) {
          moved = this.setCursor(this.cursor - 1);
        }
        break;
      case Button.DOWN:
        if (this.cursor < count - 1) {
          moved = this.setCursor(this.cursor + 1);
        }
        break;
    }
    if (moved) {
      globalScene.ui.playSelect();
    }
    return moved;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.labels = [];
    this.descs = [];
    this.onSelect = null;
  }
}
