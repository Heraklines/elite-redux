/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - the dedicated full-screen DEAL screen.
//
// An ominous, shop-like (but not a shop) interface shown in the Abyss every-10-
// waves slot: a dark void, the animated Giratina Origin battle sprite on the
// left with a small PMD talking-head portrait inset over it, his spoken line in
// a bottom dialogue box, and the list of bargains in a framed panel on the
// right. Modeled on BiomeShop/Colosseum (a full-screen UiHandler container the
// UI shows on top of the field; container sits at y = -h so child (0,0) is the
// screen top-left). Pure presentation + cursor + a select callback;
// TheBargainPhase owns all the deal logic.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Choose bargain `index`, or leave when `index < 0`. */
export type ErBargainSelectCallback = (index: number) => void;

/** Giratina Origin forme index (0 = Altered, 1 = Origin) for the battle sprite. */
const GIRATINA_ORIGIN_FORM = 1;

export class ErBargainUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  /** The real animated Giratina Origin battle sprite (main left visual). */
  private giratina: Phaser.GameObjects.Sprite;
  /** Small PMD talking-head portrait inset over the sprite. */
  private portrait: Phaser.GameObjects.Sprite;
  private portraitWindow: Phaser.GameObjects.NineSlice;
  private titleText: Phaser.GameObjects.Text;
  private dialogueWindow: Phaser.GameObjects.NineSlice;
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

  // Layout (logical 320x180 screen; container at y=-h so child (0,0) == top-left).
  private static readonly OPT_X = 150;
  private static readonly OPT_W = 162;
  private static readonly OPT_Y = 22;
  private static readonly ROW_Y0 = 38;
  private static readonly ROW_STEP = 18;

  constructor() {
    super(UiMode.ER_BARGAIN);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    // Full-screen handler containers sit at y = -h so a child at logical (0,0)
    // lands at the screen's top-left (the egg-gacha / biome-shop / colosseum
    // convention). At y = 0 everything renders one full height BELOW the viewport
    // - invisible - which is why this screen never appeared (#550).
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop.
    this.bg = globalScene.add.rectangle(0, 0, w, h, 0x07030e, 1).setOrigin(0);
    this.container.add(this.bg);

    // The actual animated Giratina Origin battle sprite, left side - the main
    // visual. Loaded on demand in show(); hidden until it lands (the small
    // portrait below stands in meanwhile).
    this.giratina = globalScene.add.sprite(82, 92, "er_bargain_giratina");
    this.giratina.setOrigin(0.5, 0.5);
    this.giratina.setVisible(false);
    this.container.add(this.giratina);

    // Small PMD talking-head portrait in a framed box, bottom-left, sitting just
    // above the dialogue box (the "speaker" headshot).
    this.portraitWindow = addWindow(6, h - 104, 52, 52);
    this.container.add(this.portraitWindow);
    this.portrait = globalScene.add.sprite(32, h - 78, "er_bargain_giratina");
    this.portrait.setOrigin(0.5, 0.5).setScale(0.28); // ~45px, fits the box
    this.container.add(this.portrait);

    this.titleText = addTextObject(w / 2, 3, "GIRATINA'S BARGAIN", TextStyle.WINDOW, { fontSize: "70px" });
    this.titleText.setOrigin(0.5, 0).setColor("#c8a8f0");
    this.container.add(this.titleText);

    // Framed panel for the bargain list (right side).
    this.optionsWindow = addWindow(ErBargainUiHandler.OPT_X, ErBargainUiHandler.OPT_Y, ErBargainUiHandler.OPT_W, 96);
    this.container.add(this.optionsWindow);

    // Focused bargain's cost -> payoff line, INSIDE the panel below the rows.
    this.descText = addTextObject(ErBargainUiHandler.OPT_X + ErBargainUiHandler.OPT_W / 2, 100, "", TextStyle.PARTY, {
      fontSize: "34px",
      align: "center",
      wordWrap: { width: (ErBargainUiHandler.OPT_W - 14) * 6 },
    });
    this.descText.setOrigin(0.5, 0);
    this.container.add(this.descText);

    // Cursor sized to sit INSIDE the options panel (never overflows the frame).
    this.cursorObj = globalScene.add.rectangle(
      0,
      0,
      ErBargainUiHandler.OPT_W - 14,
      ErBargainUiHandler.ROW_STEP,
      0xffffff,
      0,
    );
    this.cursorObj.setStrokeStyle(1, 0xc060f8);
    this.cursorObj.setOrigin(0, 0.5);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);

    // Giratina's spoken line, in a fitted dialogue box across the bottom.
    this.dialogueWindow = addWindow(4, h - 46, w - 8, 42);
    this.container.add(this.dialogueWindow);
    this.dialogueText = addTextObject(13, h - 40, "", TextStyle.WINDOW, {
      fontSize: "40px",
      wordWrap: { width: (w - 26) * 6 },
    });
    this.dialogueText.setOrigin(0, 0);
    this.container.add(this.dialogueText);
  }

  show(args: any[]): boolean {
    if (!(args.length >= 4 && Array.isArray(args[0]) && typeof args[3] === "function")) {
      return false;
    }
    this.labels = args[0] as string[];
    this.descs = args[1] as string[];
    this.dialogueText.setText((args[2] as string) ?? "");
    this.onSelect = args[3] as ErBargainSelectCallback;

    this.loadGiratina();
    this.buildRows();
    this.cursor = 0;
    this.moveCursorTo(0);

    this.openedAt = performance.now();
    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /**
   * Load + show the real animated Giratina Origin battle sprite behind the
   * portrait. Async (sprites load on demand); the small PMD portrait stands in
   * until it lands. No-ops if the screen has since closed or the sprite failed.
   */
  private loadGiratina(): void {
    const species = getPokemonSpecies(SpeciesId.GIRATINA);
    species
      // female=false, Origin forme, non-shiny, variant 0, startLoad, front, spriteOnly
      .loadAssets(false, GIRATINA_ORIGIN_FORM, false, 0, true, false, true)
      .then(() => {
        const key = species.getSpriteKey(false, GIRATINA_ORIGIN_FORM, false, 0);
        if (!this.active || !globalScene.textures.exists(key)) {
          return;
        }
        this.giratina.setTexture(key);
        if (globalScene.anims.exists(key)) {
          this.giratina.play(key);
        }
        // Fit the full sprite into the left visual area.
        this.giratina.setScale(1);
        const sh = this.giratina.height || 1;
        const maxH = 122;
        this.giratina.setScale(sh > maxH ? maxH / sh : 1);
        this.giratina.setVisible(true);
      })
      .catch(() => {});
  }

  private buildRows(): void {
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.labels.forEach((label, i) => {
      const row = addTextObject(
        ErBargainUiHandler.OPT_X + 12,
        ErBargainUiHandler.ROW_Y0 + i * ErBargainUiHandler.ROW_STEP,
        label,
        TextStyle.WINDOW,
        { fontSize: "56px" },
      );
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
    const y = ErBargainUiHandler.ROW_Y0 + i * ErBargainUiHandler.ROW_STEP;
    this.cursorObj.setPosition(ErBargainUiHandler.OPT_X + 7, y);
    this.cursorObj.setVisible(true);
    this.descText.setText(this.descs[i] ?? "");
    this.rows.forEach((row, r) => row.setAlpha(r === i ? 1 : 0.55));
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
    // the player ever sees this screen. Real-time gated so it can never hang.
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
    this.giratina.stop();
    this.giratina.setVisible(false);
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
