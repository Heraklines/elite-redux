/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet choice screen.
//
// Shown BETWEEN gauntlet battles by the Colosseum mystery encounter. Full-screen
// tournament-arena backdrop (BW2-derived stone hall) + the current reward GRADE
// (D, D+, C ... SS, SSS, SSS+, EX), a 15-segment progress bar, and two buttons:
// CONTINUE (risk it for the next grade) or CASH OUT (bank the current grade's
// reward shop and leave). Pure presentation + a 2-way callback; the encounter
// owns all battle/reward logic. Staging-gated upstream.
//
// Modeled on BiomeShopUiHandler (#440) for the container/asset conventions.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** Player chose to fight on for a higher grade. */
export const COLOSSEUM_CONTINUE = 0;
/** Player chose to bank the current grade's reward and leave. */
export const COLOSSEUM_CASH_OUT = 1;

/** Data the encounter passes in to render the current state of the run. */
export interface ColosseumViewData {
  /** Rounds won so far (1..totalRounds). */
  round: number;
  /** Total rounds in the gauntlet. */
  totalRounds: number;
  /** Display grade banked at the current round (e.g. "SS"). */
  tierLabel: string;
  /** Display grade you'd reach by winning the next round. */
  nextTierLabel: string;
}

/** continue (0) / cash out (1). */
export type ColosseumChoiceCallback = (choice: number) => void;

const GRADE_GOLD = 0xf8d030; // banked / cleared
const SEG_DONE = 0xf8d030;
const SEG_NOW = 0x40c0f8;
const SEG_TODO = 0x40445c;

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private bgOverlay: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private subtitleText: Phaser.GameObjects.Text;
  private tierText: Phaser.GameObjects.Text;
  private rewardText: Phaser.GameObjects.Text;
  private progressSegs: Phaser.GameObjects.Rectangle[] = [];
  private buttons: { window: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.Text }[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private onChoice: ColosseumChoiceCallback | null = null;
  /** Guards against a double input firing the callback twice. */
  private resolved = false;

  constructor() {
    super(UiMode.COLOSSEUM);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Arena backdrop (BW2 stone hall) + a fairly heavy dim. Falls back to the
    // game's default_bg panel if the custom art isn't present.
    const bgKey = globalScene.textures.exists("er_colosseum_bg") ? "er_colosseum_bg" : "default_bg";
    this.bg = globalScene.add.image(0, 0, bgKey).setOrigin(0);
    this.bg.setDisplaySize(w, h);
    this.container.add(this.bg);

    this.bgOverlay = globalScene.add.rectangle(0, 0, w, h, 0x080a14, 0.55).setOrigin(0);
    this.container.add(this.bgOverlay);

    this.titleText = addTextObject(w / 2, 8, "COLOSSEUM", TextStyle.WINDOW, { fontSize: "96px" });
    this.titleText.setOrigin(0.5, 0);
    this.container.add(this.titleText);

    this.subtitleText = addTextObject(w / 2, 30, "", TextStyle.PARTY, { fontSize: "50px" });
    this.subtitleText.setOrigin(0.5, 0);
    this.container.add(this.subtitleText);

    // Big banked-grade readout.
    this.tierText = addTextObject(w / 2, 46, "", TextStyle.WINDOW, { fontSize: "160px" });
    this.tierText.setOrigin(0.5, 0);
    this.tierText.setTint(GRADE_GOLD);
    this.container.add(this.tierText);

    // Progress segments are (re)built per show in layoutProgress().
    this.progressSegs = [];

    this.rewardText = addTextObject(w / 2, 100, "Cash out claims a full reward shop of this grade.", TextStyle.PARTY, {
      fontSize: "42px",
      align: "center",
    });
    this.rewardText.setOrigin(0.5, 0);
    this.container.add(this.rewardText);

    // Two buttons, side by side near the bottom.
    const btnW = 124;
    const btnH = 24;
    const gap = 8;
    const totalW = btnW * 2 + gap;
    const startX = (w - totalW) / 2;
    const btnY = h - 42;
    const captions = ["CONTINUE", "CASH OUT"];
    this.buttons = [];
    for (let i = 0; i < 2; i++) {
      const bx = startX + i * (btnW + gap);
      const window = addWindow(bx, btnY, btnW, btnH);
      this.container.add(window);
      const label = addTextObject(bx + btnW / 2, btnY + btnH / 2, captions[i], TextStyle.WINDOW, {
        fontSize: "60px",
        align: "center",
      });
      label.setOrigin(0.5, 0.5);
      this.container.add(label);
      this.buttons.push({ window, label });
    }

    this.cursorObj = globalScene.add.rectangle(0, 0, btnW + 4, btnH + 4, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(2, GRADE_GOLD);
    this.cursorObj.setOrigin(0.5);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (!(args.length >= 2 && typeof args[1] === "function")) {
      return false;
    }
    const data = args[0] as ColosseumViewData;
    this.onChoice = args[1] as ColosseumChoiceCallback;
    this.resolved = false;

    this.subtitleText.setText(`Round ${data.round} of ${data.totalRounds} cleared!`);
    this.tierText.setText(data.tierLabel);
    this.buttons[0].label.setText(`CONTINUE\n(risk for ${data.nextTierLabel})`);
    this.buttons[1].label.setText(`CASH OUT\n(claim ${data.tierLabel})`);

    this.layoutProgress(data.round, data.totalRounds);

    // Default the cursor to CONTINUE (the exciting choice).
    this.cursor = COLOSSEUM_CONTINUE;
    this.moveCursorTo(this.cursor);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /** Build the N-segment progress bar: cleared rounds lit, the latest one cyan. */
  private layoutProgress(round: number, total: number): void {
    for (const seg of this.progressSegs) {
      seg.destroy();
    }
    this.progressSegs = [];
    const w = globalScene.scaledCanvas.width;
    const avail = w - 32;
    const gap = 2;
    const segW = (avail - (total - 1) * gap) / total;
    const segH = 8;
    const y = 88;
    const startX = 16;
    for (let i = 0; i < total; i++) {
      const done = i < round;
      const isLatest = i === round - 1;
      const color = isLatest ? SEG_NOW : done ? SEG_DONE : SEG_TODO;
      const seg = globalScene.add.rectangle(startX + i * (segW + gap), y, segW, segH, color, 1).setOrigin(0, 0.5);
      this.container.add(seg);
      this.progressSegs.push(seg);
    }
  }

  private moveCursorTo(index: number): void {
    const i = index === COLOSSEUM_CASH_OUT ? COLOSSEUM_CASH_OUT : COLOSSEUM_CONTINUE;
    const btn = this.buttons[i];
    this.cursorObj.setPosition(btn.window.x + btn.window.width / 2, btn.window.y + btn.window.height / 2);
    this.cursorObj.setVisible(true);
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  processInput(button: Button): boolean {
    if (this.resolved) {
      return false;
    }
    switch (button) {
      case Button.ACTION:
        this.choose(this.cursor === COLOSSEUM_CASH_OUT ? COLOSSEUM_CASH_OUT : COLOSSEUM_CONTINUE);
        return true;
      case Button.CANCEL:
        // Cancel = the SAFE default: bank what you have rather than risk it.
        this.choose(COLOSSEUM_CASH_OUT);
        return true;
      case Button.LEFT:
        if (this.cursor !== COLOSSEUM_CONTINUE) {
          this.setCursor(COLOSSEUM_CONTINUE);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (this.cursor !== COLOSSEUM_CASH_OUT) {
          this.setCursor(COLOSSEUM_CASH_OUT);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
    }
    return false;
  }

  private choose(choice: number): void {
    if (this.resolved || !this.onChoice) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onChoice;
    this.onChoice = null;
    cb(choice);
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const seg of this.progressSegs) {
      seg.destroy();
    }
    this.progressSegs = [];
    this.onChoice = null;
  }
}
