/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet standings board.
//
// BW2 Pokemon World Tournament entry screen: a deep-navy board crowned by the
// authentic gold PWT crest + "WORLD TOURNAMENT" wordmark, a framed two-column
// roster of all 15 entrants, the reward GRADE, and CONTINUE / CASH OUT.
//
// The gauntlet is rolled per-mode and SECRET: only the challengers you've cleared
// (and the one you face next) are revealed - a cropped trainer-class head + name
// (ghosts show the source player's account name). Upcoming entrants are dark
// silhouettes tagged only with their tier (Ghost / Boss / Gym / Champion). A gold
// PWT trophy marks the final challenger. Pure presentation + a 2-way callback.
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

/** One row of the standings board. */
export interface ColosseumChallengerView {
  /** Display name (player name for ghosts); only meaningful when revealed. */
  name: string;
  /** Trainer-class atlas key for the portrait (loaded on demand by the phase). */
  spriteKey: string;
  /** Tier tag shown for unrevealed rows: "Normal" | "Ghost" | "Boss" | "Gym" | "Champion". */
  tier: string;
  /** Cleared or next-up -> portrait + name shown; else a silhouette + tier tag. */
  revealed: boolean;
}

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
  /** The full roster (length === totalRounds), revealed/secret per entry. */
  challengers: ColosseumChallengerView[];
}

/** continue (0) / cash out (1). */
export type ColosseumChoiceCallback = (choice: number) => void;

const GOLD = 0xf8d030; // cleared / banked / champion
const NEXT = 0x48c8f8; // the next challenger (CONTINUE target)
const TODO = 0x9098b0; // not yet faced
const BOARD = 0x0b1838; // deep-navy tournament board base (BW2 PWT)
const BOARD_TOP = 0x16284f; // lighter navy top band
const PANEL = 0x122146; // column panels
const SILHOUETTE = 0x05070e; // unrevealed portrait box

/**
 * A cropped trainer-class head from a loaded "trainer" atlas, scaled to a target
 * on-screen height. Returns null if the atlas isn't loaded (caller shows a
 * silhouette instead). Shared by the standings board + the VS splash.
 */
export function colosseumHeadSprite(spriteKey: string, displayH: number): Phaser.GameObjects.Sprite | null {
  if (!spriteKey || !globalScene.textures.exists(spriteKey)) {
    return null;
  }
  const s = globalScene.add.sprite(0, 0, spriteKey);
  s.setFrame(0);
  const fh = s.height || 64;
  const fw = s.width || 64;
  // Show the top slice of the standing pose (head + shoulders) and scale it up.
  const frac = 0.52;
  s.setOrigin(0, 0);
  s.setCrop(0, 0, fw, Math.round(fh * frac));
  s.setScale(displayH / (fh * frac));
  return s;
}

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private boardTop: Phaser.GameObjects.Rectangle;
  private frame: Phaser.GameObjects.NineSlice;
  private leftPanel: Phaser.GameObjects.Rectangle;
  private rightPanel: Phaser.GameObjects.Rectangle;
  private trophy: Phaser.GameObjects.Image | null = null;
  private crest: Phaser.GameObjects.Image;
  private wordmark: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;
  private gradeWindow: Phaser.GameObjects.NineSlice;
  private gradeLabel: Phaser.GameObjects.Text;
  private gradeText: Phaser.GameObjects.Text;
  private rosterRows: Phaser.GameObjects.GameObject[] = [];
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

    // Deep-navy tournament board with a lighter top band + a framed border.
    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.container.add(this.board);
    this.boardTop = globalScene.add.rectangle(0, 0, w, 44, BOARD_TOP, 1).setOrigin(0);
    this.container.add(this.boardTop);
    this.frame = addWindow(2, 2, w - 4, h - 4);
    this.container.add(this.frame);

    // The authentic gold PWT crest is the hero of the board, centred at the top.
    if (globalScene.textures.exists("er_pwt_crest")) {
      this.crest = globalScene.add.image(w / 2, 3, "er_pwt_crest");
      this.crest.setOrigin(0.5, 0);
      this.crest.setScale(26 / 123);
      this.container.add(this.crest);
    }

    // Gold PWT trophy emblem, parked off-screen until layoutRoster() places it.
    if (globalScene.textures.exists("er_pwt_trophy")) {
      this.trophy = globalScene.add.image(0, 0, "er_pwt_trophy");
      this.trophy.setOrigin(0, 0);
      this.trophy.setScale(12 / 62);
      this.trophy.setVisible(false);
      this.container.add(this.trophy);
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
    const panelY = 46;
    const panelH = h - panelY - 36;
    const panelW = w / 2 - 14;
    this.leftPanel = globalScene.add.rectangle(8, panelY, panelW, panelH, PANEL, 0.92).setOrigin(0);
    this.leftPanel.setStrokeStyle(1, 0x39456a);
    this.container.add(this.leftPanel);
    this.rightPanel = globalScene.add.rectangle(w / 2 + 6, panelY, panelW, panelH, PANEL, 0.92).setOrigin(0);
    this.rightPanel.setStrokeStyle(1, 0x39456a);
    this.container.add(this.rightPanel);

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

  /**
   * Draw the two-column entrant roster. Revealed entries (cleared + next) show a
   * cropped portrait + name; secret upcoming ones show a silhouette + tier tag.
   * The gold trophy marks the final challenger (the Champion).
   */
  private layoutRoster(data: ColosseumViewData): void {
    for (const row of this.rosterRows) {
      row.destroy();
    }
    this.rosterRows = [];

    const w = globalScene.scaledCanvas.width;
    const n = data.challengers.length;
    const perCol = Math.ceil(n / 2);
    const colX = [12, w / 2 + 10];
    const rowY0 = 48;
    const rowH = 12;
    const PORTRAIT = 11;

    for (let i = 0; i < n; i++) {
      const col = i < perCol ? 0 : 1;
      const row = i < perCol ? i : i - perCol;
      const x = colX[col];
      const y = rowY0 + row * rowH;

      const entry = data.challengers[i];
      const cleared = i < data.round;
      const isNext = i === data.round;
      const isChampion = i === n - 1;
      const revealed = entry.revealed;

      // Portrait (revealed) or silhouette (secret).
      const head = revealed ? colosseumHeadSprite(entry.spriteKey, PORTRAIT) : null;
      if (head) {
        head.setPosition(x, y);
        if (!cleared && !isNext) {
          head.setAlpha(0.85);
        }
        this.container.add(head);
        this.rosterRows.push(head);
      } else {
        const sil = globalScene.add.rectangle(x, y, PORTRAIT, PORTRAIT, SILHOUETTE, 0.9).setOrigin(0, 0);
        sil.setStrokeStyle(1, 0x2a3656);
        this.container.add(sil);
        this.rosterRows.push(sil);
        const q = addTextObject(x + PORTRAIT / 2, y + 1, "?", TextStyle.WINDOW, { fontSize: "36px" });
        q.setOrigin(0.5, 0);
        q.setTint(TODO);
        this.container.add(q);
        this.rosterRows.push(q);
      }

      const labelTxt = revealed ? entry.name : entry.tier;
      const t = addTextObject(x + 13, y + 2, `${i + 1}. ${labelTxt}`, TextStyle.WINDOW, { fontSize: "36px" });
      t.setOrigin(0, 0);
      t.setTint(cleared || isChampion ? GOLD : isNext ? NEXT : TODO);
      t.setAlpha(cleared || isNext || isChampion ? 1 : 0.7);
      this.container.add(t);
      this.rosterRows.push(t);

      if (isChampion && this.trophy) {
        this.trophy.setVisible(true);
        this.trophy.setPosition(w - 26, y - 1);
      }
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
    this.trophy?.setVisible(false);
    for (const row of this.rosterRows) {
      row.destroy();
    }
    this.rosterRows = [];
    this.onChoice = null;
  }
}
