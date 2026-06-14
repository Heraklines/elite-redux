/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet standings board.
//
// Styled after the BW2 Pokemon World Tournament entry screen: a deep-navy
// tournament board (NOT a battle photo) crowned by the AUTHENTIC PWT crest
// (crown + shield + laurel wreath + star, ripped from the BW2 ROM and recoloured
// gold), a "WORLD TOURNAMENT" wordmark, a framed two-column roster of all 15
// entrants (cleared / next-up / upcoming), a gold champion crown over the final
// challenger, the current reward GRADE, and CONTINUE / CASH OUT buttons.
// Pure presentation + a 2-way callback; ColosseumChoicePhase owns the logic.
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

const GOLD = 0xf8d030; // cleared / banked / champion
const NEXT = 0x48c8f8; // the next challenger (CONTINUE target)
const TODO = 0x9098b0; // not yet faced
const BOARD = 0x0b1838; // deep-navy tournament board base (BW2 PWT)
const BOARD_TOP = 0x16284f; // lighter navy top band
const PANEL = 0x122146; // column panels

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private boardTop: Phaser.GameObjects.Rectangle;
  private frame: Phaser.GameObjects.NineSlice;
  private leftPanel: Phaser.GameObjects.Rectangle;
  private rightPanel: Phaser.GameObjects.Rectangle;
  private crown: Phaser.GameObjects.Graphics;
  private crest: Phaser.GameObjects.Image;
  private wordmark: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;
  private gradeWindow: Phaser.GameObjects.NineSlice;
  private gradeLabel: Phaser.GameObjects.Text;
  private gradeText: Phaser.GameObjects.Text;
  private rosterRows: Phaser.GameObjects.Text[] = [];
  private buttons: { window: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.Text }[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private onChoice: ColosseumChoiceCallback | null = null;
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

    // Deep-navy tournament board (no battle photo) with a lighter top band +
    // a framed border, the BW2 PWT look.
    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.container.add(this.board);
    this.boardTop = globalScene.add.rectangle(0, 0, w, 44, BOARD_TOP, 1).setOrigin(0);
    this.container.add(this.boardTop);
    this.frame = addWindow(2, 2, w - 4, h - 4);
    this.container.add(this.frame);

    // The authentic gold PWT crest is the hero of the board, centred at the top.
    // Guard against a first-load CDN miss so we never show the missing-texture box.
    if (globalScene.textures.exists("er_pwt_crest")) {
      this.crest = globalScene.add.image(w / 2, 3, "er_pwt_crest");
      this.crest.setOrigin(0.5, 0);
      this.crest.setScale(26 / 123); // ripped crest is 112x123; render ~26px tall
      this.container.add(this.crest);
    }

    this.wordmark = addTextObject(w / 2, 30, "POKEMON WORLD TOURNAMENT", TextStyle.WINDOW, { fontSize: "36px" });
    this.wordmark.setOrigin(0.5, 0);
    this.wordmark.setTint(GOLD);
    this.container.add(this.wordmark);

    this.statusText = addTextObject(w / 2, 39, "", TextStyle.PARTY, { fontSize: "38px" });
    this.statusText.setOrigin(0.5, 0);
    this.statusText.setTint(0xc0c8e0);
    this.container.add(this.statusText);

    // Grade badge, top-left, framed + gold.
    this.gradeWindow = addWindow(6, 6, 42, 26);
    this.container.add(this.gradeWindow);
    this.gradeLabel = addTextObject(27, 9, "GRADE", TextStyle.PARTY, { fontSize: "32px" });
    this.gradeLabel.setOrigin(0.5, 0);
    this.container.add(this.gradeLabel);
    this.gradeText = addTextObject(27, 16, "", TextStyle.WINDOW, { fontSize: "60px" });
    this.gradeText.setOrigin(0.5, 0);
    this.gradeText.setTint(GOLD);
    this.container.add(this.gradeText);

    // Two roster column panels.
    const panelY = 48;
    const panelH = h - panelY - 38;
    const panelW = w / 2 - 14;
    this.leftPanel = globalScene.add.rectangle(8, panelY, panelW, panelH, PANEL, 0.85).setOrigin(0);
    this.leftPanel.setStrokeStyle(1, 0x39456a);
    this.container.add(this.leftPanel);
    this.rightPanel = globalScene.add.rectangle(w / 2 + 6, panelY, panelW, panelH, PANEL, 0.85).setOrigin(0);
    this.rightPanel.setStrokeStyle(1, 0x39456a);
    this.container.add(this.rightPanel);

    // Champion crown, drawn centred above the board (re-pointed per show()).
    this.crown = globalScene.add.graphics();
    this.container.add(this.crown);

    this.rosterRows = [];

    // Two buttons near the bottom.
    const btnW = 122;
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
    this.cursorObj.setStrokeStyle(2, GOLD);
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

    this.layoutRoster(data);

    this.cursor = COLOSSEUM_CONTINUE;
    this.moveCursorTo(this.cursor);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /** Draw the two-column entrant roster + the champion crown. */
  private layoutRoster(data: ColosseumViewData): void {
    for (const row of this.rosterRows) {
      row.destroy();
    }
    this.rosterRows = [];

    const w = globalScene.scaledCanvas.width;
    const n = data.challengers.length;
    const perCol = Math.ceil(n / 2);
    const colX = [14, w / 2 + 12];
    const rowY0 = 51;
    const rowH = 12;

    let championPos: { x: number; y: number } | null = null;

    for (let i = 0; i < n; i++) {
      const col = i < perCol ? 0 : 1;
      const row = i < perCol ? i : i - perCol;
      const x = colX[col];
      const y = rowY0 + row * rowH;

      const cleared = i < data.round;
      const isNext = i === data.round;
      const isChampion = i === n - 1;
      const marker = cleared ? "*" : isNext ? ">" : "-";
      const label = `${marker} ${i + 1}. ${data.challengers[i]}`;
      const t = addTextObject(x, y, label, TextStyle.WINDOW, { fontSize: "42px" });
      t.setOrigin(0, 0);
      t.setTint(isChampion && !cleared ? GOLD : cleared ? GOLD : isNext ? NEXT : TODO);
      t.setAlpha(cleared || isNext || isChampion ? 1 : 0.7);
      this.container.add(t);
      this.rosterRows.push(t);

      if (isChampion) {
        championPos = { x, y };
      }
    }

    // Crown above the champion's row (the final challenger).
    this.crown.clear();
    if (championPos) {
      this.drawCrown(championPos.x - 2, championPos.y - 11);
    }
  }

  /** A small gold crown drawn from primitives (no glyph/asset risk). */
  private drawCrown(x: number, y: number): void {
    const g = this.crown;
    g.fillStyle(GOLD, 1);
    // base band
    g.fillRect(x, y + 6, 16, 3);
    // three spikes
    g.fillTriangle(x, y + 6, x + 4, y + 6, x + 2, y);
    g.fillTriangle(x + 6, y + 6, x + 10, y + 6, x + 8, y - 2);
    g.fillTriangle(x + 12, y + 6, x + 16, y + 6, x + 14, y);
    g.fillStyle(0xfff0a0, 1);
    g.fillRect(x + 1, y + 7, 14, 1);
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
    this.crown.clear();
    for (const row of this.rosterRows) {
      row.destroy();
    }
    this.rosterRows = [];
    this.onChoice = null;
  }
}
