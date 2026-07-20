/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Colosseum (#439) - the press-your-luck gauntlet standings board.
//
// BW2 Pokemon World Tournament entry screen: a deep-navy board framed entirely in
// the ripped/derived BW2 PWT navy+gold 9-slice chrome (NOT PokeRogue's default
// window theme), crowned by the authentic gold PWT crest + "WORLD TOURNAMENT"
// wordmark. A framed two-column roster of all 15 entrants - the ones you've
// cleared (and the one you face next) reveal a cropped trainer-class head + name
// (ghosts show the source player's account name); everyone ahead is a dark
// SILHOUETTE of the real challenger tagged only with their tier. A gold PWT
// trophy marks the Champion. Pure presentation + a 2-way callback.
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
  /** Exact authority-authored button labels when the replica does not own the full challenger roster. */
  choiceLabels?: readonly [string, string];
}

/** continue (0) / cash out (1). */
export type ColosseumChoiceCallback = (choice: number) => void;

const GOLD = 0xf8d030; // cleared / banked / champion
const NEXT = 0x48c8f8; // the next challenger (CONTINUE target)
const TODO = 0x8a93b4; // not yet faced (tier tag)
const BOARD = 0x0b1838; // deep-navy board base

/**
 * A BW2 PWT navy/gold 9-slice panel (or raised button). Falls back to the engine
 * window if the CDN chrome hasn't loaded. Origin top-left.
 */
function pwtPanel(x: number, y: number, w: number, h: number, button = false): Phaser.GameObjects.NineSlice {
  const key = button ? "er_pwt_button" : "er_pwt_panel";
  if (globalScene.textures.exists(key)) {
    const n = globalScene.add.nineslice(x, y, key, undefined, w, h, 4, 4, 4, 4);
    n.setOrigin(0, 0);
    return n;
  }
  return addWindow(x, y, w, h);
}

/**
 * A trainer-class figure from a loaded "trainer" atlas, scaled to a target
 * on-screen height, origin top-CENTRE (caller sets the centre x). We render the
 * WHOLE standing pose (no crop): in-engine setCrop on trimmed atlas frames was
 * unreliable and mis-clipped. `silhouette` renders it as a flat dark shadow (for
 * not-yet-faced challengers). Returns null if the atlas isn't loaded. Shared by
 * the standings board + the VS splash.
 */
export function colosseumHeadSprite(
  spriteKey: string,
  displayH: number,
  opts: { silhouette?: boolean } = {},
): Phaser.GameObjects.Sprite | null {
  if (!spriteKey || !globalScene.textures.exists(spriteKey)) {
    return null;
  }
  const s = globalScene.add.sprite(0, 0, spriteKey);
  s.setFrame(0);
  const fh = s.height || 64;
  s.setOrigin(0.5, 0);
  s.setScale(displayH / fh);
  if (opts.silhouette) {
    s.setTintFill(0x070c1a);
    s.setAlpha(0.9);
  }
  return s;
}

export class ColosseumUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private frame: Phaser.GameObjects.NineSlice;
  private leftPanel: Phaser.GameObjects.NineSlice;
  private rightPanel: Phaser.GameObjects.NineSlice;
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

    // Deep-navy board, framed entirely in BW2 PWT navy/gold chrome.
    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.container.add(this.board);
    this.frame = pwtPanel(0, 0, w, h);
    this.container.add(this.frame);

    // Authentic gold PWT crest, centred at the top.
    if (globalScene.textures.exists("er_pwt_crest")) {
      this.crest = globalScene.add.image(w / 2, 2, "er_pwt_crest");
      this.crest.setOrigin(0.5, 0);
      this.crest.setScale(22 / 123);
      this.container.add(this.crest);
    }

    // Gold PWT trophy emblem, parked off-screen until layoutRoster() places it.
    if (globalScene.textures.exists("er_pwt_trophy")) {
      this.trophy = globalScene.add.image(0, 0, "er_pwt_trophy");
      this.trophy.setOrigin(0, 0);
      this.trophy.setScale(11 / 62);
      this.trophy.setVisible(false);
      this.container.add(this.trophy);
    }

    this.wordmark = addTextObject(w / 2, 25, "POKEMON WORLD TOURNAMENT", TextStyle.WINDOW, { fontSize: "34px" });
    this.wordmark.setOrigin(0.5, 0);
    this.wordmark.setTint(GOLD);
    this.container.add(this.wordmark);

    this.statusText = addTextObject(w / 2, 33, "", TextStyle.PARTY, { fontSize: "26px" });
    this.statusText.setOrigin(0.5, 0);
    this.statusText.setTint(0xc0c8e0);
    this.container.add(this.statusText);

    // Grade badge, top-left.
    this.gradeWindow = pwtPanel(6, 5, 44, 26);
    this.container.add(this.gradeWindow);
    this.gradeLabel = addTextObject(28, 7, "GRADE", TextStyle.PARTY, { fontSize: "28px" });
    this.gradeLabel.setOrigin(0.5, 0);
    this.gradeLabel.setTint(0xc0c8e0);
    this.container.add(this.gradeLabel);
    this.gradeText = addTextObject(28, 14, "", TextStyle.WINDOW, { fontSize: "56px" });
    this.gradeText.setOrigin(0.5, 0);
    this.gradeText.setTint(GOLD);
    this.container.add(this.gradeText);

    // Two roster column panels.
    const panelY = 44;
    const panelH = h - panelY - 33;
    const panelW = w / 2 - 12;
    this.leftPanel = pwtPanel(7, panelY, panelW, panelH);
    this.container.add(this.leftPanel);
    this.rightPanel = pwtPanel(w / 2 + 5, panelY, panelW, panelH);
    this.container.add(this.rightPanel);

    this.rosterRows = [];

    // Two buttons near the bottom.
    const btnW = 126;
    const btnH = 24;
    const gap = 8;
    const totalW = btnW * 2 + gap;
    const startX = (w - totalW) / 2;
    const btnY = h - 29;
    const captions = ["CONTINUE", "CASH OUT"];
    this.buttons = [];
    for (let i = 0; i < 2; i++) {
      const bx = startX + i * (btnW + gap);
      const window = pwtPanel(bx, btnY, btnW, btnH, true);
      this.container.add(window);
      const label = addTextObject(bx + btnW / 2, btnY + btnH / 2, captions[i], TextStyle.WINDOW, {
        fontSize: "52px",
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
    this.buttons[0].label.setText(data.choiceLabels?.[0] ?? `CONTINUE\n(risk for ${data.nextTierLabel})`);
    this.buttons[1].label.setText(data.choiceLabels?.[1] ?? `CASH OUT\n(claim ${data.tierLabel})`);

    this.layoutRoster(data);

    this.cursor = COLOSSEUM_CONTINUE;
    this.moveCursorTo(this.cursor);

    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /**
   * Draw the two-column entrant roster. Revealed entries show a cropped portrait
   * + name; secret upcoming ones show a dark silhouette of the real challenger +
   * its tier tag. The gold trophy marks the final challenger (the Champion).
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
    const rowY0 = 47;
    const rowH = 12;
    const SLOT = 14; // portrait gutter width
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

      const head = colosseumHeadSprite(entry.spriteKey, PORTRAIT, { silhouette: !entry.revealed });
      if (head) {
        head.setPosition(x + SLOT / 2, y);
        this.container.add(head);
        this.rosterRows.push(head);
      } else if (!entry.revealed) {
        // No atlas yet - a plain dark placeholder silhouette box.
        const sil = globalScene.add.rectangle(x + 1, y, PORTRAIT, PORTRAIT, 0x070c1a, 0.85).setOrigin(0, 0);
        this.container.add(sil);
        this.rosterRows.push(sil);
      }

      const labelTxt = entry.revealed ? entry.name : entry.tier;
      const t = addTextObject(x + SLOT + 2, y + 2, `${i + 1}. ${labelTxt}`, TextStyle.WINDOW, { fontSize: "34px" });
      t.setOrigin(0, 0);
      t.setTint(cleared || isChampion ? GOLD : isNext ? NEXT : TODO);
      t.setAlpha(cleared || isNext || isChampion ? 1 : 0.75);
      this.container.add(t);
      this.rosterRows.push(t);

      if (isChampion && this.trophy) {
        this.trophy.setVisible(true);
        this.trophy.setPosition(w - 24, y - 1);
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
