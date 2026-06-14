/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet choice screen.
//
// Shown BETWEEN gauntlet battles by the Colosseum mystery encounter. Full-screen
// tournament-arena backdrop (BW2-derived stone hall) + a D->C->B->A->S->EX reward
// tier ladder (cleared tiers lit, the current banked tier highlighted, future
// tiers dim) + two buttons: CONTINUE (risk it for the next tier) or CASH OUT
// (bank the current tier's reward and leave). Pure presentation + a 2-way
// callback; the encounter owns all battle/reward logic. Staging-gated upstream.
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

/** Player chose to fight on for a higher tier. */
export const COLOSSEUM_CONTINUE = 0;
/** Player chose to bank the current tier's reward and leave. */
export const COLOSSEUM_CASH_OUT = 1;

/** Data the encounter passes in to render the current state of the run. */
export interface ColosseumViewData {
  /** Battles won so far (1..maxRounds). The banked tier is ladder[wins - 1]. */
  wins: number;
  /** Total number of tiers / rounds in the gauntlet. */
  maxRounds: number;
  /** Display tier labels, lowest first, e.g. ["D","C","B","A","S","EX"]. */
  ladder: string[];
}

/** continue (0) / cash out (1). */
export type ColosseumChoiceCallback = (choice: number) => void;

const LADDER_GOLD = 0xf8d030; // a cleared/banked tier
const LADDER_NOW = 0x40c0f8; // the current banked tier (highlighted)
const LADDER_DIM = 0x70708c; // a not-yet-earned tier

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private bgOverlay: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private subtitleText: Phaser.GameObjects.Text;
  private rewardText: Phaser.GameObjects.Text;
  private ladderCells: { box: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.Text }[] = [];
  private buttons: { window: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.Text }[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private onChoice: ColosseumChoiceCallback | null = null;
  private data: ColosseumViewData | null = null;
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

    // Arena backdrop (BW2 stone hall) + a fairly heavy dim so the ladder/buttons
    // read clearly and the backdrop's baked sprites recede. Falls back to the
    // game's default_bg panel if the custom art isn't present.
    const bgKey = globalScene.textures.exists("er_colosseum_bg") ? "er_colosseum_bg" : "default_bg";
    this.bg = globalScene.add.image(0, 0, bgKey).setOrigin(0);
    this.bg.setDisplaySize(w, h);
    this.container.add(this.bg);

    this.bgOverlay = globalScene.add.rectangle(0, 0, w, h, 0x080a14, 0.5).setOrigin(0);
    this.container.add(this.bgOverlay);

    this.titleText = addTextObject(w / 2, 8, "COLOSSEUM", TextStyle.WINDOW, { fontSize: "96px" });
    this.titleText.setOrigin(0.5, 0);
    this.container.add(this.titleText);

    this.subtitleText = addTextObject(w / 2, 30, "", TextStyle.PARTY, { fontSize: "54px" });
    this.subtitleText.setOrigin(0.5, 0);
    this.container.add(this.subtitleText);

    // Tier ladder built once (cells positioned in layoutLadder() from the data).
    this.ladderCells = [];

    this.rewardText = addTextObject(w / 2, 96, "", TextStyle.MONEY, { fontSize: "54px" });
    this.rewardText.setOrigin(0.5, 0);
    this.container.add(this.rewardText);

    // Two buttons, side by side near the bottom.
    const btnW = 120;
    const btnH = 22;
    const gap = 8;
    const totalW = btnW * 2 + gap;
    const startX = (w - totalW) / 2;
    const btnY = h - 40;
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
    this.cursorObj.setStrokeStyle(2, LADDER_GOLD);
    this.cursorObj.setOrigin(0.5);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (!(args.length >= 2 && typeof args[1] === "function")) {
      return false;
    }
    this.data = args[0] as ColosseumViewData;
    this.onChoice = args[1] as ColosseumChoiceCallback;
    this.resolved = false;

    const { wins, maxRounds, ladder } = this.data;
    const banked = ladder[Math.min(wins, maxRounds) - 1] ?? ladder[0];
    const nextTier = ladder[Math.min(wins, maxRounds - 1)] ?? banked;

    this.subtitleText.setText(`Round ${wins} cleared!`);
    this.rewardText.setText(`Banked reward tier:  ${banked}`);
    this.buttons[0].label.setText(`CONTINUE\n(risk for ${nextTier})`);
    this.buttons[1].label.setText(`CASH OUT\n(claim ${banked})`);

    this.layoutLadder();

    // Default the cursor to CONTINUE (the exciting choice).
    this.cursor = COLOSSEUM_CONTINUE;
    this.moveCursorTo(this.cursor);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /** Build/refresh the D..EX tier chips, coloured by progress. */
  private layoutLadder(): void {
    for (const cell of this.ladderCells) {
      cell.box.destroy();
      cell.label.destroy();
    }
    this.ladderCells = [];
    if (!this.data) {
      return;
    }
    const { wins, maxRounds, ladder } = this.data;
    const w = globalScene.scaledCanvas.width;
    const cellW = 30;
    const cellH = 26;
    const gap = 4;
    const totalW = ladder.length * cellW + (ladder.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const y = 52;
    for (let i = 0; i < ladder.length; i++) {
      const cx = startX + i * (cellW + gap);
      const box = addWindow(cx, y, cellW, cellH);
      // i is 0-based; banked tier index is wins-1.
      const earned = i < wins;
      const isCurrent = i === Math.min(wins, maxRounds) - 1;
      const tint = isCurrent ? LADDER_NOW : earned ? LADDER_GOLD : LADDER_DIM;
      box.setAlpha(earned || isCurrent ? 1 : 0.5);
      this.container.add(box);
      const label = addTextObject(cx + cellW / 2, y + cellH / 2, ladder[i], TextStyle.WINDOW, {
        fontSize: "70px",
        align: "center",
      });
      label.setOrigin(0.5, 0.5);
      label.setTint(tint);
      label.setAlpha(earned || isCurrent ? 1 : 0.6);
      this.container.add(label);
      this.ladderCells.push({ box, label });
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
    for (const cell of this.ladderCells) {
      cell.box.destroy();
      cell.label.destroy();
    }
    this.ladderCells = [];
    this.onChoice = null;
    this.data = null;
  }
}
