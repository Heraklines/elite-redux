/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Quiz/Minigame UI (#439 biome overhaul) - a COMPACT, non-invasive panel for
// one multiple-choice question. Deliberately small (a centred card, not a full-
// screen takeover): a header, either a Pokemon SILHOUETTE (sprite tinted flat
// black) or a wrapped Pokedex blurb, and four answer buttons. The scene behind
// it stays visible.
//
// It is a dumb primitive: it shows ONE question and reports the chosen option
// index (or -1 on cancel/forfeit) through a callback. All scoring / press-your-
// luck orchestration lives in ErQuizPhase.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** What the phase passes in to render one question. */
export interface ErQuizView {
  /** Small caption above the figure/blurb (e.g. "Who's that Pokémon?"). */
  header: string;
  /** Loaded footprint image key, rendered as-is and scaled up (footprint quiz).
   * Takes precedence over the silhouette/icon when present. */
  footprintKey?: string | undefined;
  /** Loaded battle-sprite atlas key, rendered as a black silhouette (preferred). */
  spriteKey?: string | undefined;
  /** Menu-icon atlas key + frame, used as a silhouette fallback when the battle
   * sprite atlas is unavailable (icons are preloaded at boot). */
  iconAtlas?: string | undefined;
  iconFrame?: string | undefined;
  /** Wrapped blurb shown instead of a silhouette (dex mode). */
  prompt?: string | undefined;
  /** Exactly four answer labels. */
  options: string[];
}

/** Reports the chosen option index, or -1 if the player cancelled/forfeited. */
export type ErQuizChoiceCallback = (index: number) => void;

const PANEL_W = 150;
const PANEL_H = 150;
const GOLD = 0xf8d030;
const INK = 0xe8ecf8;

export class ErQuizUiHandler extends UiHandler {
  /** Full-screen root (origin matches every other handler: (0, -canvasHeight)). */
  private container: Phaser.GameObjects.Container;
  /** Centred card sub-container; all card elements use local 0..PANEL coords. */
  private card: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.NineSlice;
  private headerText: Phaser.GameObjects.Text;
  private promptText: Phaser.GameObjects.Text;
  private optionButtons: { window: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.Text }[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;
  /** Per-question objects (silhouette sprite) destroyed on clear. */
  private transient: Phaser.GameObjects.GameObject[] = [];

  private onChoice: ErQuizChoiceCallback | null = null;
  private resolved = false;
  private optionCount = 4;

  /** Top of the option button stack and per-button geometry. */
  private static readonly OPT_H = 18;
  private static readonly OPT_GAP = 3;
  private static readonly OPT_Y0 = 66;

  constructor() {
    super(UiMode.ER_QUIZ);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const px = (w - PANEL_W) / 2;
    const py = (h - PANEL_H) / 2;

    // Full-screen root. The UI parent is offset by +canvasHeight, so every
    // handler anchors its full-screen container at (0, -h) to land at (0, 0).
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Full-screen dim so the quiz reads as a clear modal popup over the scene.
    const dim = globalScene.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0, 0);
    this.container.add(dim);

    // Centred card. All elements below use local card coords (0..PANEL_W/H).
    this.card = globalScene.add.container(px, py);
    this.container.add(this.card);

    this.panel = addWindow(0, 0, PANEL_W, PANEL_H);
    this.card.add(this.panel);

    this.headerText = addTextObject(PANEL_W / 2, 6, "", TextStyle.WINDOW, { fontSize: "44px", align: "center" });
    this.headerText.setOrigin(0.5, 0);
    this.headerText.setTint(GOLD);
    this.card.add(this.headerText);

    // The dex blurb (hidden in silhouette mode). Wrapped to the panel width.
    this.promptText = addTextObject(8, 20, "", TextStyle.WINDOW, { fontSize: "36px" });
    this.promptText.setOrigin(0, 0);
    this.promptText.setTint(INK);
    this.promptText.setWordWrapWidth((PANEL_W - 16) * 6, false);
    this.card.add(this.promptText);

    // Four answer buttons.
    this.optionButtons = [];
    const btnW = PANEL_W - 16;
    for (let i = 0; i < 4; i++) {
      const by = ErQuizUiHandler.OPT_Y0 + i * (ErQuizUiHandler.OPT_H + ErQuizUiHandler.OPT_GAP);
      const window = addWindow(8, by, btnW, ErQuizUiHandler.OPT_H);
      this.card.add(window);
      const label = addTextObject(8 + btnW / 2, by + ErQuizUiHandler.OPT_H / 2, "", TextStyle.WINDOW, {
        fontSize: "50px",
        align: "center",
      });
      label.setOrigin(0.5, 0.5);
      this.card.add(label);
      this.optionButtons.push({ window, label });
    }

    this.cursorObj = globalScene.add.rectangle(0, 0, btnW + 4, ErQuizUiHandler.OPT_H + 4, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(2, GOLD);
    this.cursorObj.setOrigin(0.5);
    this.cursorObj.setVisible(false);
    this.card.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (!(args.length >= 2 && typeof args[1] === "function")) {
      return false;
    }
    const data = args[0] as ErQuizView;
    this.onChoice = args[1] as ErQuizChoiceCallback;
    this.resolved = false;

    this.headerText.setText(data.header ?? "");

    // Footprint (shown as-is, scaled up) takes precedence: the player reads the
    // actual track shape, so it must NOT be silhouetted. Footprint sprites are
    // small flat line art, so blow them up to a readable size.
    if (data.footprintKey && globalScene.textures.exists(data.footprintKey)) {
      this.promptText.setVisible(false);
      const fp = globalScene.add.sprite(PANEL_W / 2, 42, data.footprintKey);
      const fh = fp.height || 16;
      fp.setOrigin(0.5, 0.5);
      fp.setScale(Math.max(1, Math.min(4, 44 / fh)));
      this.card.add(fp);
      this.transient.push(fp);
    } else if (data.spriteKey && globalScene.textures.exists(data.spriteKey)) {
      this.promptText.setVisible(false);
      const sil = globalScene.add.sprite(PANEL_W / 2, 42, data.spriteKey);
      sil.setFrame(0);
      const fh = sil.height || 64;
      sil.setOrigin(0.5, 0.5);
      sil.setScale(Math.min(1, 50 / fh));
      sil.setTintFill(0x101018);
      this.card.add(sil);
      this.transient.push(sil);
    } else if (data.iconAtlas && globalScene.textures.exists(data.iconAtlas)) {
      this.promptText.setVisible(false);
      const sil = globalScene.add.sprite(PANEL_W / 2, 40, data.iconAtlas, data.iconFrame);
      const fh = sil.height || 64;
      sil.setOrigin(0.5, 0.5);
      sil.setScale(Math.min(1.6, 56 / fh));
      sil.setTintFill(0x101018);
      this.card.add(sil);
      this.transient.push(sil);
    } else {
      this.promptText.setVisible(true);
      this.promptText.setText(data.prompt ?? "");
    }

    const opts = data.options ?? [];
    this.optionCount = Math.min(4, opts.length);
    for (let i = 0; i < 4; i++) {
      const btn = this.optionButtons[i];
      if (i < this.optionCount) {
        btn.label.setText(opts[i]);
        btn.label.setTint(INK);
        btn.window.setVisible(true);
        btn.label.setVisible(true);
      } else {
        btn.window.setVisible(false);
        btn.label.setVisible(false);
      }
    }

    this.cursor = 0;
    this.moveCursorTo(0);
    this.container.setVisible(true);
    this.container.parentContainer?.bringToTop(this.container);
    this.active = true;
    return true;
  }

  private moveCursorTo(index: number): void {
    const btn = this.optionButtons[index];
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
      case Button.UP:
        if (this.cursor > 0) {
          this.setCursor(this.cursor - 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.cursor < this.optionCount - 1) {
          this.setCursor(this.cursor + 1);
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
        this.choose(this.cursor);
        return true;
      case Button.CANCEL:
        this.choose(-1);
        return true;
    }
    return false;
  }

  private choose(index: number): void {
    if (this.resolved || !this.onChoice) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onChoice;
    this.onChoice = null;
    cb(index);
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const o of this.transient) {
      o.destroy();
    }
    this.transient = [];
    this.onChoice = null;
    this.resolved = false;
  }
}
