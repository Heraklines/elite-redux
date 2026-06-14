/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet choice screen.
//
// Shown BETWEEN gauntlet battles by ColosseumChoicePhase. A BW2 PWT-style
// standings board: a full 15-challenger bracket (cleared / next-up / upcoming),
// the current reward GRADE, and two buttons - CONTINUE (risk it for the next
// grade) or CASH OUT (bank the current grade's reward shop and leave). Pure
// presentation + a 2-way callback; the phase owns all battle/reward logic.
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
  /** Human labels for every challenger in the ladder (length === totalRounds). */
  challengers: string[];
}

/** continue (0) / cash out (1). */
export type ColosseumChoiceCallback = (choice: number) => void;

const GRADE_GOLD = 0xf8d030; // cleared / banked
const COLOR_NEXT = 0x40c0f8; // the next challenger (CONTINUE target)
const COLOR_TODO = 0x9098b0; // not yet faced

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private bgOverlay: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;
  private gradeText: Phaser.GameObjects.Text;
  private bracketRows: Phaser.GameObjects.Text[] = [];
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

    // Arena backdrop (BW2 stone hall) + a dim so the board reads clearly. Falls
    // back to the game's default_bg panel if the custom art isn't present.
    const bgKey = globalScene.textures.exists("er_colosseum_bg") ? "er_colosseum_bg" : "default_bg";
    this.bg = globalScene.add.image(0, 0, bgKey).setOrigin(0);
    this.bg.setDisplaySize(w, h);
    this.container.add(this.bg);

    this.bgOverlay = globalScene.add.rectangle(0, 0, w, h, 0x080a14, 0.5).setOrigin(0);
    this.container.add(this.bgOverlay);

    this.titleText = addTextObject(w / 2, 6, "COLOSSEUM", TextStyle.WINDOW, { fontSize: "84px" });
    this.titleText.setOrigin(0.5, 0);
    this.container.add(this.titleText);

    this.statusText = addTextObject(w / 2, 24, "", TextStyle.PARTY, { fontSize: "44px" });
    this.statusText.setOrigin(0.5, 0);
    this.container.add(this.statusText);

    // Banked grade, big + gold, top-right.
    this.gradeText = addTextObject(w - 8, 6, "", TextStyle.WINDOW, { fontSize: "90px" });
    this.gradeText.setOrigin(1, 0);
    this.gradeText.setTint(GRADE_GOLD);
    this.container.add(this.gradeText);

    // The 15-challenger bracket is (re)built per show in layoutBracket().
    this.bracketRows = [];

    // Two buttons near the bottom.
    const btnW = 124;
    const btnH = 22;
    const gap = 8;
    const totalW = btnW * 2 + gap;
    const startX = (w - totalW) / 2;
    const btnY = h - 30;
    const captions = ["CONTINUE", "CASH OUT"];
    this.buttons = [];
    for (let i = 0; i < 2; i++) {
      const bx = startX + i * (btnW + gap);
      const window = addWindow(bx, btnY, btnW, btnH);
      this.container.add(window);
      const label = addTextObject(bx + btnW / 2, btnY + btnH / 2, captions[i], TextStyle.WINDOW, {
        fontSize: "54px",
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

    this.statusText.setText(`Round ${data.round} of ${data.totalRounds} cleared`);
    this.gradeText.setText(data.tierLabel);
    this.buttons[0].label.setText(`CONTINUE\n(risk for ${data.nextTierLabel})`);
    this.buttons[1].label.setText(`CASH OUT\n(claim ${data.tierLabel})`);

    this.layoutBracket(data);

    // Default the cursor to CONTINUE (the exciting choice).
    this.cursor = COLOSSEUM_CONTINUE;
    this.moveCursorTo(this.cursor);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /** Build the 15-challenger bracket in two columns: cleared / next / upcoming. */
  private layoutBracket(data: ColosseumViewData): void {
    for (const row of this.bracketRows) {
      row.destroy();
    }
    this.bracketRows = [];

    const w = globalScene.scaledCanvas.width;
    const colX = [10, w / 2 + 4];
    const rowY0 = 42;
    const rowH = 13;
    const perCol = Math.ceil(data.challengers.length / 2);

    for (let i = 0; i < data.challengers.length; i++) {
      const col = i < perCol ? 0 : 1;
      const row = i < perCol ? i : i - perCol;
      const x = colX[col];
      const y = rowY0 + row * rowH;

      const cleared = i < data.round;
      const isNext = i === data.round; // the CONTINUE target
      // Cleared rows get a check; the next challenger a chevron; rest a dot.
      const marker = cleared ? "*" : isNext ? ">" : "-";
      const label = `${marker} ${i + 1}. ${data.challengers[i]}`;
      const t = addTextObject(x, y, label, TextStyle.WINDOW, { fontSize: "42px" });
      t.setOrigin(0, 0);
      t.setTint(cleared ? GRADE_GOLD : isNext ? COLOR_NEXT : COLOR_TODO);
      t.setAlpha(cleared || isNext ? 1 : 0.75);
      this.container.add(t);
      this.bracketRows.push(t);
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
    for (const row of this.bracketRows) {
      row.destroy();
    }
    this.bracketRows = [];
    this.onChoice = null;
  }
}
