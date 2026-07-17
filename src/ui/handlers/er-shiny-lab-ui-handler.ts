/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Shiny Lab - the in-game special-form shiny designer.
//
// The in-game counterpart of the web Shiny Lab (shiny-lab.pages.dev). A stylish,
// fully DIRECTIONAL-KEY navigable (no mouse) full-screen designer reached from
// Starter Select. The player browses the three effect layers - Palette (T1-2),
// Surface FX (T3) and Aura (T4 black shiny) - for one species, sees a live mon
// preview, equips what they own, spends candy on what they can, and tunes
// per-layer intensity / texture / seed, saving up to 5 presets.
//
// Theme mirrors the web lab: a dark "void" backdrop with three neon accents -
// cyan (palette), pink (surface), gold (aura).
//
// NAVIGATION - four tabs, ONE simple model (no hidden zones):
//   PALETTE | SURFACE | AURA | TUNE
//   - In an EFFECT tab (Palette/Surface/Aura): Left/Right switch tab, Up/Down
//     browse the effect list, A equip/buy, B exit.
//   - In the TUNE tab: Up/Down pick a control row (the per-layer sliders, texture,
//     seed, and the load/save-preset rows), Left/Right adjust the selected control,
//     A does its action (reset a slider / reroll the seed / load or save a preset),
//     B returns to the effect tabs.
//   A context hint line at the bottom always teaches the active tab.
//
// Modeled on ErBargainUiHandler / BiomeShop: a full-screen container the UI shows
// on top of the field, placed at y = -h so a child at logical (0,0) lands at the
// screen top-left. Pure presentation + cursor + callbacks; the caller owns the
// real save data (driven by an {@linkcode ErShinyLabConfig}; a self-contained demo
// config is generated when none is supplied so the screen is renderable on its own).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ensureErSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import {
  ER_SHINY_LAB_AURA_SIZE_MAX,
  ER_SHINY_LAB_AURA_SIZE_MIN,
  ER_SHINY_LAB_DEFAULT_PARAMS,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  ER_SHINY_LAB_SPEED_MAX,
  ER_SHINY_LAB_SPEED_MIN,
  type ErShinyLabCategory,
  type ErShinyLabConfig,
  type ErShinyLabEffect,
  type ErShinyLabEffectDefinition,
  type ErShinyLabEffectState,
  type ErShinyLabLoadout,
  type ErShinyLabParams,
  type ErShinyLabPreset,
  type ErShinyLabRarity,
  getErShinyLabNameStyle,
  resolveErShinyLabEffectState,
  sanitizeErShinyLabPresetName,
} from "#data/elite-redux/er-shiny-lab-effects";
import {
  type ErShinyLabRenderedPixels,
  type ErShinyLabSourcePixels,
  renderErShinyLabLook,
} from "#data/elite-redux/er-shiny-lab-renderer";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { ErShinyLabNameFx } from "#sprites/er-shiny-lab-name-fx";
import { readErShinyLabSpriteSourcePixels } from "#sprites/er-shiny-lab-sprite-fx";
import { ensureErShinyLabPaletteVariantCache } from "#sprites/variant";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { decodeNickname, getPokemonSpecies } from "#utils/pokemon-utils";

export type {
  ErShinyLabCategory,
  ErShinyLabConfig,
  ErShinyLabEffect,
  ErShinyLabLoadout,
  ErShinyLabParams,
  ErShinyLabPreset,
  ErShinyLabRarity,
} from "#data/elite-redux/er-shiny-lab-effects";

/** The resolved gate state of an effect for the current species (the 3-gate resolver, visualized). */
type EffectState = ErShinyLabEffectState;

/** The active tab: one of the three effect layers, or the tuning panel. */
type Tab = ErShinyLabCategory | "tune";

/** A row in the TUNE panel. */
type TuneRow =
  | "palAmt"
  | "surfAmt"
  | "aroAmt"
  | "scale"
  | "speed"
  | "auraSize"
  | "matchPalette"
  | "protectBlack"
  | "protectWhite"
  | "nameFx"
  | "name"
  | "seed"
  | "load"
  | "save";
type PreviewPixels = ErShinyLabSourcePixels;

const CATEGORIES: ErShinyLabCategory[] = ["palette", "surface", "around"];
const TABS: Tab[] = ["palette", "surface", "around", "tune"];
const TAB_LABEL: Record<Tab, string> = {
  palette: "PALETTE",
  surface: "SURFACE",
  around: "AURA",
  tune: "TUNE",
};
/** Neon accent per tab (mirrors the web lab: cyan / pink / gold; soft white for tune). */
const TAB_ACCENT: Record<Tab, number> = {
  palette: 0x5ad1ff,
  surface: 0xff7ad9,
  around: 0xffd27a,
  tune: 0xc9d4e8,
};
const TAB_ACCENT_HEX: Record<Tab, string> = {
  palette: "#5ad1ff",
  surface: "#ff7ad9",
  around: "#ffd27a",
  tune: "#c9d4e8",
};
/** Short single-letter prefix for the equipped-loadout chips (P / S / A). */
const CHIP_PREFIX: Record<ErShinyLabCategory, string> = { palette: "P", surface: "S", around: "A" };
const RARITY_HEX: Record<ErShinyLabRarity, string> = {
  common: "#aab4c6",
  rare: "#5ab6ff",
  epic: "#c08bff",
  legendary: "#ffd34d",
};
const RARITY_COLOR: Record<ErShinyLabRarity, number> = {
  common: 0xaab4c6,
  rare: 0x5ab6ff,
  epic: 0xc08bff,
  legendary: 0xffd34d,
};
/** Minimum earned tier per layer (the locked decisions: T1-2 palette, T3 surface, T4 aura). */
const CATEGORY_MIN_TIER: Record<ErShinyLabCategory, number> = { palette: 1, surface: 3, around: 4 };

const INK = "#e8ecf6";
const DIM = "#8b93a8";
const GOLD = "#ffd27a";
const VOID_COLOR = 0x080912;
const PANEL_TINT = 0x2a3050;

// --- Layout (logical 320x180; container at y=-h so child (0,0) == top-left) ---
const SCREEN_W = 320;
const SCREEN_H = 180;
const PREV_X = 4;
const PREV_Y = 16;
const PREV_W = 110;
const PREV_H = 156;
const RIGHT_X = 118;
const RIGHT_W = SCREEN_W - RIGHT_X - 4; // 198
const TAB_Y = 16;
const TAB_H = 13;
const LIST_X = RIGHT_X;
const LIST_Y = 31;
const LIST_W = RIGHT_W;
const LIST_H = 105;
const ROW_X = LIST_X + 9;
const ROW_Y0 = LIST_Y + 9;
const ROW_STEP = 13;
const VISIBLE_ROWS = 7;
const DETAIL_X = RIGHT_X;
const DETAIL_Y = 139;
const DETAIL_W = RIGHT_W;
const DETAIL_H = 31;
const HINT_Y = 173;
// TUNE panel geometry: a label, a segmented bar, and a right-aligned value per row.
const TUNE_ROWS: TuneRow[] = [
  "palAmt",
  "surfAmt",
  "aroAmt",
  "scale",
  "speed",
  "auraSize",
  "matchPalette",
  "protectBlack",
  "protectWhite",
  "nameFx",
  "name",
  "seed",
  "load",
  "save",
];
const TUNE_ROW_Y0 = ROW_Y0 + 1;
const TUNE_ROW_STEP = 10;
/** Rows visible at once in the TUNE panel; the rest scroll (the list grew past the panel height). */
const VISIBLE_TUNE_ROWS = 9;
const TUNE_CURSOR_H = 10;
const TUNE_BAR_X = ROW_X + 60;
const TUNE_BAR_SEGMENTS = 12;
const TUNE_SEG_W = 6;
const TUNE_VALUE_X = LIST_X + LIST_W - 9;

export class ErShinyLabUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  // Preview pane.
  private previewWindow: Phaser.GameObjects.NineSlice;
  private glowOuter: Phaser.GameObjects.Ellipse;
  private glowInner: Phaser.GameObjects.Ellipse;
  private auraRing: Phaser.GameObjects.Ellipse;
  private auraOuterRing: Phaser.GameObjects.Ellipse;
  private auraSparkles: Phaser.GameObjects.Rectangle[] = [];
  private auraGlowSprites: Phaser.GameObjects.Sprite[] = [];
  private monSprite: Phaser.GameObjects.Sprite;
  private fxSprite: Phaser.GameObjects.Sprite;
  private surfaceFx: Phaser.GameObjects.Container;
  private surfaceMask: Phaser.Display.Masks.BitmapMask | null = null;
  private surfaceWash: Phaser.GameObjects.Ellipse;
  private surfaceLines: Phaser.GameObjects.Rectangle[] = [];
  private surfaceSparks: Phaser.GameObjects.Rectangle[] = [];
  private nameText: Phaser.GameObjects.Text;
  private nameFx?: ErShinyLabNameFx | undefined;
  private tierText: Phaser.GameObjects.Text;
  private tierPips: Phaser.GameObjects.Rectangle[] = [];
  private chipTexts: Phaser.GameObjects.Text[] = [];
  // Header.
  private titleText: Phaser.GameObjects.Text;
  private candyIcon: Phaser.GameObjects.Sprite;
  private candyText: Phaser.GameObjects.Text;
  // Tabs.
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private tabUnderline: Phaser.GameObjects.Rectangle;
  private tabHintL: Phaser.GameObjects.Text;
  private tabHintR: Phaser.GameObjects.Text;
  // List / panel body.
  private listWindow: Phaser.GameObjects.NineSlice;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private rowDots: Phaser.GameObjects.Rectangle[] = [];
  private rowTokens: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;
  private scrollUp: Phaser.GameObjects.Text;
  private scrollDown: Phaser.GameObjects.Text;
  /** Rebuilt container for the TUNE panel rows (labels + bars + values). */
  private tuneContent: Phaser.GameObjects.Container;
  // Detail.
  private detailWindow: Phaser.GameObjects.NineSlice;
  private detailTitle: Phaser.GameObjects.Text;
  private detailMeta: Phaser.GameObjects.Text;
  private detailStatus: Phaser.GameObjects.Text;
  // Hint.
  private hintText: Phaser.GameObjects.Text;

  // State.
  private config: ErShinyLabConfig | null = null;
  private tab: Tab = "palette";
  // `cursor` (the active effect-list index) is the inherited UiHandler.cursor.
  private scrollTop = 0;
  /** Cursor within the TUNE panel rows. */
  private tuneCursor = 0;
  /** Top of the visible TUNE-row window (the panel scrolls when the cursor leaves it). */
  private tuneScrollTop = 0;
  /** Which preset the "Load preset" row points at, and which slot "Save" targets. */
  private loadSel = 0;
  private saveSel = 0;
  private openedAt = 0;
  private previewSpriteKey: string | null = null;
  private previewSourcePixels: PreviewPixels | null = null;
  private previewFxKey: string | null = null;
  private previewFxVersion = 0;
  private previewFxTick = 0;
  private previewAnimTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(UiMode.ER_SHINY_LAB);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop + a header band.
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, VOID_COLOR, 1).setOrigin(0));
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, 15, 0x11131d, 1).setOrigin(0));

    // --- Header ---
    // A small cyan diamond logo (a rotated square) - drawn, not a glyph, so it always renders.
    const logo = globalScene.add.rectangle(11, 8, 7, 7, 0x5ad1ff, 1).setAngle(45);
    logo.setStrokeStyle(1, 0xa6e9ff, 1);
    this.container.add(logo);
    this.titleText = addTextObject(20, 2, "SHINY LAB", TextStyle.WINDOW, { fontSize: "56px" });
    this.titleText.setOrigin(0, 0).setColor("#a6e9ff");
    this.container.add(this.titleText);
    // Candy: the real candy icon (tinted gold) + the count, top-right.
    this.candyText = addTextObject(SCREEN_W - 6, 3, "", TextStyle.WINDOW, { fontSize: "48px" });
    this.candyText.setOrigin(1, 0).setColor(GOLD);
    this.container.add(this.candyText);
    this.candyIcon = globalScene.add.sprite(SCREEN_W - 8, 9, "candy");
    this.candyIcon.setOrigin(1, 0.5).setTint(0xffcf52);
    this.fitCandyIcon();
    this.container.add(this.candyIcon);

    // --- Preview pane ---
    this.previewWindow = addWindow(PREV_X, PREV_Y, PREV_W, PREV_H);
    this.previewWindow.setTint(PANEL_TINT);
    this.container.add(this.previewWindow);

    const cx = PREV_X + PREV_W / 2;
    const cy = PREV_Y + 56;
    this.glowOuter = globalScene.add.ellipse(cx, cy, 92, 92, 0x5ad1ff, 0.16);
    this.container.add(this.glowOuter);
    this.glowInner = globalScene.add.ellipse(cx, cy, 54, 54, 0x5ad1ff, 0.26);
    this.container.add(this.glowInner);
    this.auraRing = globalScene.add.ellipse(cx, cy, 78, 78);
    this.auraRing.setStrokeStyle(1.5, 0xffd27a, 0.8).setFillStyle(0, 0);
    this.auraRing.setVisible(false);
    this.container.add(this.auraRing);
    this.auraOuterRing = globalScene.add.ellipse(cx, cy, 96, 66);
    this.auraOuterRing.setStrokeStyle(1, 0xffd27a, 0.45).setFillStyle(0xffd27a, 0.04);
    this.auraOuterRing.setVisible(false);
    this.container.add(this.auraOuterRing);
    for (let i = 0; i < 8; i++) {
      const sparkle = globalScene.add.rectangle(cx, cy, 2, 2, 0xffd27a, 0.85).setAngle(45).setVisible(false);
      this.container.add(sparkle);
      this.auraSparkles.push(sparkle);
    }
    for (let i = 0; i < 2; i++) {
      const glow = globalScene.add.sprite(cx, cy, "unknown").setOrigin(0.5, 0.5).setVisible(false).setAlpha(0);
      this.container.add(glow);
      this.auraGlowSprites.push(glow);
    }

    this.monSprite = globalScene.add.sprite(cx, cy, "unknown");
    this.monSprite
      .setOrigin(0.5, 0.5)
      .setVisible(false)
      .setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        ignoreTimeTint: true,
      });
    this.container.add(this.monSprite);
    this.fxSprite = globalScene.add.sprite(cx, cy, "unknown");
    this.fxSprite.setOrigin(0.5, 0.5).setVisible(false);
    this.container.add(this.fxSprite);
    this.surfaceFx = globalScene.add.container(cx, cy);
    this.surfaceFx.setVisible(false);
    this.container.add(this.surfaceFx);
    this.surfaceWash = globalScene.add.ellipse(0, 0, 46, 58, 0xff7ad9, 0.16);
    this.surfaceFx.add(this.surfaceWash);
    for (let i = 0; i < 4; i++) {
      const line = globalScene.add.rectangle(0, 0, 48, 2, 0xff7ad9, 0.45);
      this.surfaceFx.add(line);
      this.surfaceLines.push(line);
    }
    for (let i = 0; i < 5; i++) {
      const spark = globalScene.add.rectangle(0, 0, 3, 3, 0xff7ad9, 0.55).setAngle(45);
      this.surfaceFx.add(spark);
      this.surfaceSparks.push(spark);
    }
    this.createSurfaceMask();

    this.nameText = addTextObject(cx, PREV_Y + 98, "", TextStyle.WINDOW, { fontSize: "52px", align: "center" });
    this.nameText.setOrigin(0.5, 0).setColor(INK);
    this.container.add(this.nameText);
    this.tierText = addTextObject(cx, PREV_Y + 110, "", TextStyle.WINDOW, { fontSize: "32px", align: "center" });
    this.tierText.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.tierText);

    // --- Tabs ---
    const tabW = RIGHT_W / TABS.length;
    for (let i = 0; i < TABS.length; i++) {
      const t = addTextObject(RIGHT_X + tabW * i + tabW / 2, TAB_Y + 1, TAB_LABEL[TABS[i]], TextStyle.WINDOW, {
        fontSize: "38px",
        align: "center",
      });
      t.setOrigin(0.5, 0);
      this.container.add(t);
      this.tabTexts.push(t);
    }
    this.tabUnderline = globalScene.add.rectangle(RIGHT_X, TAB_Y + TAB_H - 1, tabW, 2, 0x5ad1ff, 1).setOrigin(0, 0.5);
    this.container.add(this.tabUnderline);
    // "<" / ">" chevrons flanking the active tab so it reads as Left/Right switchable.
    this.tabHintL = addTextObject(0, TAB_Y + 2, "<", TextStyle.WINDOW, { fontSize: "38px" });
    this.tabHintL.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.tabHintL);
    this.tabHintR = addTextObject(0, TAB_Y + 2, ">", TextStyle.WINDOW, { fontSize: "38px" });
    this.tabHintR.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.tabHintR);

    // --- List / panel body ---
    this.listWindow = addWindow(LIST_X, LIST_Y, LIST_W, LIST_H);
    this.listWindow.setTint(PANEL_TINT);
    this.container.add(this.listWindow);

    this.cursorObj = globalScene.add.rectangle(0, 0, LIST_W - 12, ROW_STEP, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(1, 0x5ad1ff).setOrigin(0, 0.5).setVisible(false);
    this.container.add(this.cursorObj);

    this.scrollUp = addTextObject(LIST_X + LIST_W - 12, LIST_Y + 3, "▲", TextStyle.WINDOW, { fontSize: "30px" });
    this.scrollUp.setOrigin(0.5, 0).setColor(DIM).setVisible(false);
    this.container.add(this.scrollUp);
    this.scrollDown = addTextObject(LIST_X + LIST_W - 12, LIST_Y + LIST_H - 8, "▼", TextStyle.WINDOW, {
      fontSize: "30px",
    });
    this.scrollDown.setOrigin(0.5, 0).setColor(DIM).setVisible(false);
    this.container.add(this.scrollDown);

    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const y = ROW_Y0 + i * ROW_STEP;
      const dot = globalScene.add.rectangle(ROW_X, y, 5, 5, 0xffffff, 1).setOrigin(0.5, 0.5).setVisible(false);
      this.container.add(dot);
      this.rowDots.push(dot);
      const label = addTextObject(ROW_X + 9, y, "", TextStyle.WINDOW, { fontSize: "48px" });
      label.setOrigin(0, 0.5);
      this.container.add(label);
      this.rowTexts.push(label);
      const token = addTextObject(LIST_X + LIST_W - 8, y, "", TextStyle.WINDOW, { fontSize: "40px", align: "right" });
      token.setOrigin(1, 0.5);
      this.container.add(token);
      this.rowTokens.push(token);
    }

    this.tuneContent = globalScene.add.container(0, 0);
    this.container.add(this.tuneContent);

    // --- Detail ---
    this.detailWindow = addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H);
    this.detailWindow.setTint(PANEL_TINT);
    this.container.add(this.detailWindow);
    this.detailTitle = addTextObject(DETAIL_X + 8, DETAIL_Y + 5, "", TextStyle.WINDOW, { fontSize: "48px" });
    this.detailTitle.setOrigin(0, 0);
    this.container.add(this.detailTitle);
    this.detailMeta = addTextObject(DETAIL_X + DETAIL_W - 8, DETAIL_Y + 6, "", TextStyle.WINDOW, {
      fontSize: "36px",
      align: "right",
    });
    this.detailMeta.setOrigin(1, 0).setColor(DIM);
    this.container.add(this.detailMeta);
    this.detailStatus = addTextObject(DETAIL_X + 8, DETAIL_Y + 18, "", TextStyle.WINDOW, { fontSize: "38px" });
    this.detailStatus.setOrigin(0, 0).setColor(DIM);
    this.container.add(this.detailStatus);

    // --- Hint ---
    this.hintText = addTextObject(SCREEN_W / 2, HINT_Y, "", TextStyle.WINDOW, { fontSize: "34px", align: "center" });
    this.hintText.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.hintText);
  }

  show(args: any[]): boolean {
    const cfg = args.length > 0 && this.isConfig(args[0]) ? (args[0] as ErShinyLabConfig) : buildDemoConfig(144);
    this.config = cfg;
    this.tab = "palette";
    this.cursor = 0;
    this.scrollTop = 0;
    this.tuneCursor = 0;
    this.loadSel = 0;
    this.saveSel = 0;
    this.previewSpriteKey = null;
    this.previewSourcePixels = null;
    this.previewFxVersion = 0;
    this.previewFxTick = 0;
    this.fxSprite.setVisible(false);

    this.candyText.setText(String(cfg.candy));
    this.repositionCandyIcon();
    this.nameText.setText(cfg.speciesName);
    this.refreshTier();
    this.render();

    this.openedAt = performance.now();
    this.container.setVisible(true);
    this.active = true;
    this.startPreviewAnimation();
    // After active=true so the synchronous (cached) path is allowed to reveal the sprite.
    this.loadPreviewSprite(cfg.speciesId);
    return true;
  }

  private isConfig(arg: unknown): arg is ErShinyLabConfig {
    return (
      typeof arg === "object"
      && arg !== null
      && typeof (arg as ErShinyLabConfig).speciesId === "number"
      && typeof (arg as ErShinyLabConfig).effects === "object"
    );
  }

  // ---- Data helpers -------------------------------------------------------

  private effectCategory(): ErShinyLabCategory {
    return this.tab === "tune" ? "palette" : this.tab;
  }

  private effects(): ErShinyLabEffect[] {
    if (this.tab === "tune") {
      return [];
    }
    return this.config?.effects[this.tab] ?? [];
  }

  private focusedEffect(): ErShinyLabEffect | null {
    return this.effects()[this.cursor] ?? null;
  }

  /** Resolve the 3-gate state (tier x availability x owned) of an effect for this species. */
  private stateOf(effect: ErShinyLabEffect, category: ErShinyLabCategory): EffectState {
    const cfg = this.config;
    if (!cfg) {
      return "locked-tier";
    }
    return resolveErShinyLabEffectState({
      effect,
      category,
      earnedTier: cfg.earnedTier,
      candy: cfg.candy,
      owned: cfg.owned,
      available: cfg.available,
      equipped: cfg.equipped,
    });
  }

  // ---- Preview sprite -----------------------------------------------------

  private loadPreviewSprite(speciesId: number): void {
    const species = getPokemonSpecies(speciesId);
    const key = species.getSpriteKey(false, 0, false, 0);
    let retryCount = 0;
    const apply = () => {
      if (!this.active) {
        return;
      }
      if (!globalScene.textures.exists(key)) {
        if (retryCount++ < 10) {
          globalScene.time.delayedCall(50, apply);
        }
        return;
      }
      ensureErSpriteAnim(key);
      this.previewSpriteKey = key;
      this.monSprite.setTexture(key);
      for (const glow of this.auraGlowSprites) {
        glow.setTexture(key);
      }
      if (globalScene.anims.exists(key)) {
        this.monSprite.play(key);
        for (const glow of this.auraGlowSprites) {
          glow.play(key);
        }
      }
      this.fitSprite();
      this.previewSourcePixels = this.readPreviewSourcePixels(key, this.monSprite.frame);
      this.refreshPreview();
    };
    if (globalScene.textures.exists(key)) {
      apply();
    }
    species
      .loadAssets(false, 0, false, 0, true, false, true)
      .then(apply)
      .catch(() => {});
  }

  private fitSprite(): void {
    this.monSprite.setScale(1);
    const sh = this.monSprite.height || 1;
    const maxH = 78;
    this.monSprite.setScale(sh > maxH ? maxH / sh : 1);
    const spriteScale = this.monSprite.scaleX || 1;
    this.surfaceFx.setPosition(this.monSprite.x, this.monSprite.y).setScale(spriteScale);
    for (const [idx, glow] of this.auraGlowSprites.entries()) {
      glow.setPosition(this.monSprite.x, this.monSprite.y).setScale(spriteScale * (1.16 + idx * 0.14));
    }
    this.monSprite.setVisible(true);
  }

  private createSurfaceMask(): void {
    try {
      this.surfaceMask = new Phaser.Display.Masks.BitmapMask(globalScene, this.monSprite);
      this.surfaceFx.setMask(this.surfaceMask);
    } catch {
      this.surfaceMask = null;
    }
  }

  private readPreviewSourcePixels(key: string, sourceFrame?: Phaser.Textures.Frame | null): PreviewPixels | null {
    return readErShinyLabSpriteSourcePixels(sourceFrame?.name == null ? { key } : { key, frame: sourceFrame.name });
  }

  private refreshExactPreview(loadout: ErShinyLabLoadout, params: ErShinyLabParams): boolean {
    const source = this.previewSpriteKey
      ? (this.readPreviewSourcePixels(this.previewSpriteKey, this.monSprite.frame) ?? this.previewSourcePixels)
      : this.previewSourcePixels;
    if (!source) {
      return false;
    }
    this.previewSourcePixels = source;
    const rendered = renderErShinyLabLook(source, loadout, params, this.previewFxTick / 10);
    if (!rendered) {
      return false;
    }
    return this.applyExactPreviewTexture(rendered, source);
  }

  private startPreviewAnimation(): void {
    this.previewAnimTimer?.remove();
    this.previewAnimTimer = globalScene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.active || !this.config || !this.previewSpriteKey) {
          return;
        }
        this.previewFxTick = (this.previewFxTick + 1) % 60000;
        this.refreshPreview();
      },
    });
  }

  private applyExactPreviewTexture(rendered: ErShinyLabRenderedPixels, source: PreviewPixels): boolean {
    try {
      if (typeof document === "undefined") {
        return false;
      }
      const textures = globalScene.textures as Phaser.Textures.TextureManager & {
        addCanvas?: (key: string, canvas: HTMLCanvasElement) => Phaser.Textures.CanvasTexture | null;
        remove?: (key: string) => unknown;
      };
      if (!textures.addCanvas) {
        return false;
      }

      const canvas = document.createElement("canvas");
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      const image = ctx.createImageData(rendered.width, rendered.height);
      image.data.set(rendered.data);
      ctx.putImageData(image, 0, 0);

      const oldKey = this.previewFxKey;
      let key: string;
      do {
        key = `er-shiny-lab-preview-${this.config?.speciesId ?? "demo"}-${++this.previewFxVersion}`;
      } while (textures.exists(key));
      const texture = textures.addCanvas(key, canvas);
      texture?.refresh();
      this.previewFxKey = key;
      this.fxSprite.setTexture(key);
      this.fitExactPreview(rendered, source);
      if (oldKey && oldKey !== key && textures.exists(oldKey)) {
        textures.remove?.(oldKey);
      }
      return true;
    } catch {
      return false;
    }
  }

  private fitExactPreview(rendered: ErShinyLabRenderedPixels, source: PreviewPixels): void {
    const cx = PREV_X + PREV_W / 2;
    const cy = PREV_Y + 54;
    const coreScale = source.height > 0 ? 78 / source.height : 1;
    const fitScale = Math.min(104 / rendered.width, 92 / rendered.height);
    const scale = Math.min(coreScale, fitScale, 1.5);
    this.fxSprite.setPosition(cx, cy).setScale(scale).setVisible(true);
  }

  private hideApproxPreview(): void {
    this.monSprite.setVisible(false);
    this.surfaceFx.setVisible(false);
    this.auraRing.setVisible(false);
    this.auraOuterRing.setVisible(false);
    for (const glow of this.auraGlowSprites) {
      glow.setVisible(false);
    }
    for (const sparkle of this.auraSparkles) {
      sparkle.setVisible(false);
    }
  }

  private refreshPreviewSpritePalette(paletteId?: string | null): void {
    const baseKey = this.previewSpriteKey;
    if (!baseKey) {
      return;
    }
    const nextPaletteId =
      paletteId
      ?? (this.tab === "palette" ? this.focusedEffect()?.id : this.config?.equipped.palette)
      ?? this.config?.equipped.palette
      ?? null;
    const spriteKey = ensureErShinyLabPaletteVariantCache(baseKey, nextPaletteId, 0) ?? baseKey;
    this.monSprite
      .setPipelineData("shiny", spriteKey !== baseKey)
      .setPipelineData("variant", 0)
      .setPipelineData("spriteKey", spriteKey);
  }

  private fitCandyIcon(): void {
    this.candyIcon.setScale(1);
    const sh = this.candyIcon.height || 16;
    this.candyIcon.setScale(11 / sh);
  }

  /** Place the candy icon just left of the (right-aligned) candy count. */
  private repositionCandyIcon(): void {
    const left = this.candyText.x - this.candyText.displayWidth - 4;
    this.candyIcon.setX(left);
  }

  // ---- Render -------------------------------------------------------------

  /** Full refresh for the current tab (tabs, body, detail, preview, cursor, hint). */
  private render(): void {
    this.refreshTabs();
    if (this.tab === "tune") {
      this.hideEffectRows();
      this.refreshTune();
    } else {
      this.tuneContent.removeAll(true);
      this.rebuildRows();
      this.placeEffectCursor();
      this.refreshEffectDetail();
    }
    this.refreshPreview();
    this.refreshHint();
  }

  private refreshTier(): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    const pct = cfg.completion ? `  ${cfg.completion.percent}%` : "";
    this.tierText.setText(`TIER ${cfg.earnedTier}/4${pct}`);
    for (const p of this.tierPips) {
      p.destroy();
    }
    this.tierPips = [];
    const x0 = PREV_X + PREV_W / 2 - (4 * 6 - 2) / 2;
    for (let i = 0; i < 4; i++) {
      const pip = globalScene.add.rectangle(
        x0 + i * 6,
        PREV_Y + 120,
        4,
        4,
        i < cfg.earnedTier ? 0xffd27a : 0x39405a,
        1,
      );
      pip.setOrigin(0, 0.5);
      this.container.add(pip);
      this.tierPips.push(pip);
    }
    this.refreshChips();
  }

  /** The equipped-loadout chips at the bottom of the preview pane (one per layer). */
  private refreshChips(): void {
    const cfg = this.config;
    for (const c of this.chipTexts) {
      c.destroy();
    }
    this.chipTexts = [];
    if (!cfg) {
      return;
    }
    let y = PREV_Y + 128;
    for (const cat of CATEGORIES) {
      const id = cfg.equipped[cat];
      const eff = id ? cfg.effects[cat].find(e => e.id === id) : null;
      const chip = addTextObject(PREV_X + 8, y, `${CHIP_PREFIX[cat]} ${eff ? eff.label : "-"}`, TextStyle.WINDOW, {
        fontSize: "32px",
      });
      chip.setOrigin(0, 0).setColor(eff ? TAB_ACCENT_HEX[cat] : DIM);
      this.container.add(chip);
      this.chipTexts.push(chip);
      y += 8;
    }
  }

  private refreshTabs(): void {
    const tabW = RIGHT_W / TABS.length;
    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i];
      const on = tab === this.tab;
      const reachable = tab === "tune" || (this.config?.earnedTier ?? 1) >= CATEGORY_MIN_TIER[tab];
      this.tabTexts[i].setColor(on ? TAB_ACCENT_HEX[tab] : reachable ? DIM : "#5a6072");
      this.tabTexts[i].setAlpha(reachable ? 1 : 0.6);
    }
    const idx = TABS.indexOf(this.tab);
    this.tabUnderline.setX(RIGHT_X + tabW * idx);
    this.tabUnderline.setFillStyle(TAB_ACCENT[this.tab], 1);
    // Park the chevrons just outside the active tab label.
    const t = this.tabTexts[idx];
    this.tabHintL.setX(RIGHT_X + tabW * idx + tabW / 2 - t.displayWidth / 2 - 6);
    this.tabHintR.setX(RIGHT_X + tabW * idx + tabW / 2 + t.displayWidth / 2 + 6);
    this.tabHintL.setVisible(idx > 0);
    this.tabHintR.setVisible(idx < TABS.length - 1);
  }

  private hideEffectRows(): void {
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      this.rowTexts[i].setText("");
      this.rowTokens[i].setText("");
      this.rowDots[i].setVisible(false);
    }
    this.scrollUp.setVisible(false);
    this.scrollDown.setVisible(false);
  }

  private rebuildRows(): void {
    const list = this.effects();
    const cat = this.effectCategory();
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + VISIBLE_ROWS) {
      this.scrollTop = this.cursor - VISIBLE_ROWS + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, list.length - VISIBLE_ROWS)));

    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const eff = list[this.scrollTop + i];
      const label = this.rowTexts[i];
      const dot = this.rowDots[i];
      const token = this.rowTokens[i];
      if (!eff) {
        label.setText("");
        dot.setVisible(false);
        token.setText("");
        continue;
      }
      const state = this.stateOf(eff, cat);
      const locked = state === "locked-tier" || state === "locked-achv" || state === "locked-candy";
      label.setText(eff.label);
      label.setColor(state === "equipped" ? TAB_ACCENT_HEX[cat] : locked ? "#6a7188" : INK);
      dot.setVisible(true).setFillStyle(RARITY_COLOR[eff.rarity], locked ? 0.5 : 1);
      token.setText(this.tokenFor(eff, state)).setColor(this.tokenColor(state, cat));
    }
    this.scrollUp.setVisible(this.scrollTop > 0);
    this.scrollDown.setVisible(this.scrollTop + VISIBLE_ROWS < list.length);
  }

  private tokenFor(eff: ErShinyLabEffect, state: EffectState): string {
    switch (state) {
      case "equipped":
        return "EQUIP";
      case "owned":
        return "OWN";
      case "buyable":
        return `${eff.cost}`;
      case "locked-tier":
        return `T${eff.minTier}`;
      case "locked-achv":
        return "LOCK";
      default:
        return `${eff.cost}`;
    }
  }

  private tokenColor(state: EffectState, cat: ErShinyLabCategory): string {
    switch (state) {
      case "equipped":
        return TAB_ACCENT_HEX[cat];
      case "owned":
        return "#9aa3b8";
      case "buyable":
        return GOLD;
      case "locked-achv":
        return "#c08bff";
      default:
        return "#e0707a";
    }
  }

  private placeCursor(slot: number): void {
    this.cursorObj.setDisplaySize(LIST_W - 12, ROW_STEP);
    this.cursorObj.setPosition(LIST_X + 6, ROW_Y0 + slot * ROW_STEP);
    this.cursorObj.setVisible(true);
  }

  private placeEffectCursor(): void {
    if (this.effects().length === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    this.placeCursor(this.cursor - this.scrollTop);
  }

  private tuneRowY(slot: number): number {
    return TUNE_ROW_Y0 + slot * TUNE_ROW_STEP;
  }

  private placeTuneCursor(): void {
    this.cursorObj.setDisplaySize(LIST_W - 12, TUNE_CURSOR_H);
    this.cursorObj.setPosition(LIST_X + 6, this.tuneRowY(this.tuneCursor - this.tuneScrollTop));
    this.cursorObj.setVisible(true);
  }

  /** Keep the TUNE cursor inside the visible window, scrolling the panel as needed. */
  private ensureTuneCursorVisible(): void {
    const maxTop = Math.max(0, TUNE_ROWS.length - VISIBLE_TUNE_ROWS);
    if (this.tuneCursor < this.tuneScrollTop) {
      this.tuneScrollTop = this.tuneCursor;
    } else if (this.tuneCursor >= this.tuneScrollTop + VISIBLE_TUNE_ROWS) {
      this.tuneScrollTop = this.tuneCursor - VISIBLE_TUNE_ROWS + 1;
    }
    this.tuneScrollTop = Math.max(0, Math.min(maxTop, this.tuneScrollTop));
  }

  private refreshEffectDetail(): void {
    const eff = this.focusedEffect();
    const cat = this.effectCategory();
    if (!eff) {
      this.detailTitle.setText("");
      this.detailMeta.setText("");
      this.detailStatus.setText("");
      return;
    }
    const state = this.stateOf(eff, cat);
    this.detailTitle.setText(eff.label).setColor(RARITY_HEX[eff.rarity]);
    this.detailMeta.setText(`${eff.rarity.toUpperCase()}  T${eff.minTier}+`);
    let status: string;
    let color = DIM;
    switch (state) {
      case "equipped":
        status = "Equipped.  A: unequip";
        color = TAB_ACCENT_HEX[cat];
        break;
      case "owned":
        status = "Owned.  A: equip";
        color = "#9aa3b8";
        break;
      case "buyable":
        status = `A: unlock for ${eff.cost} candy`;
        color = GOLD;
        break;
      case "locked-tier":
        status = `Locked: needs a Tier ${eff.minTier} shiny`;
        color = "#e0707a";
        break;
      case "locked-achv":
        status = `Locked: ${eff.lockHint ?? "complete its challenge"}`;
        color = "#c08bff";
        break;
      default:
        status = `Need ${eff.cost} candy (have ${this.config?.candy ?? 0})`;
        color = "#e0707a";
    }
    this.detailStatus.setText(status).setColor(color);
  }

  /** Update the live preview glow / aura ring from the focused-or-equipped look + intensities. */
  private refreshPreview(): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    // Preview the focused effect of the active tab, layered over the equipped effects of the other two.
    // Palette only swaps sprite colors; the preview backdrop stays neutral for comparison.
    const palId = this.tab === "palette" ? this.focusedEffect()?.id : cfg.equipped.palette;
    const surfId = this.tab === "surface" ? this.focusedEffect()?.id : cfg.equipped.surface;
    const aroId = this.tab === "around" ? this.focusedEffect()?.id : cfg.equipped.around;
    const surfEff =
      cfg.effects.surface.find(e => e.id === surfId) ?? cfg.effects.surface.find(e => e.id === cfg.equipped.surface);
    const aroEff =
      cfg.effects.around.find(e => e.id === aroId) ?? cfg.effects.around.find(e => e.id === cfg.equipped.around);

    this.glowOuter.setVisible(false);
    this.glowInner.setVisible(false);
    const loadout: ErShinyLabLoadout = {
      palette: palId ?? null,
      surface: surfEff?.id ?? null,
      around: aroEff?.id ?? null,
    };
    this.refreshNameFxPreview(loadout);
    if (this.refreshExactPreview(loadout, cfg.params)) {
      this.hideApproxPreview();
      return;
    }
    this.fxSprite.setVisible(false);
    this.monSprite.setVisible(!!this.previewSpriteKey);
    this.refreshPreviewSpritePalette(palId);
    this.refreshPreviewSurface(surfEff, cfg.params);
    this.refreshPreviewAura(aroEff, cfg.params);
  }

  private refreshNameFxPreview(loadout: ErShinyLabLoadout): void {
    const cfg = this.config;
    // The name adopts the equipped palette's color (or a named-combo signature) when
    // Name FX is on for a T3+ shiny. The color goes on the name TEXT, not a box.
    const style = cfg && cfg.earnedTier >= 3 && cfg.params.nameFx ? getErShinyLabNameStyle(loadout) : null;
    this.nameText.setColor(style?.color ?? INK);
    // Layer the animated SURFACE FX onto the preview name when a surface is equipped (T3+, Name FX
    // on). update() internally no-ops to the flat colour above for palette-only / no-FX previews.
    const look = cfg && cfg.earnedTier >= 3 ? { loadout, params: cfg.params } : null;
    this.getNameFx().update(this.nameText, look);
  }

  /** Lazily build the owned animated Name-FX overlay for the preview name. */
  private getNameFx(): ErShinyLabNameFx {
    if (!this.nameFx) {
      this.nameFx = new ErShinyLabNameFx();
    }
    return this.nameFx;
  }

  private refreshPreviewSurface(effect: ErShinyLabEffect | null | undefined, params: ErShinyLabParams): void {
    if (!effect) {
      this.surfaceFx.setVisible(false);
      return;
    }
    const color = hexColor(effect.accent, 0xff7ad9);
    const amount = clamp(0.15 + params.surfAmt * 0.7, 0.12, 0.85);
    const seed = hashEffectId(effect.id) + params.seed;
    const mode = seed % 4;
    const scale = clamp(params.scale, 0.55, 1.45);

    if (!this.surfaceMask) {
      this.createSurfaceMask();
    }
    this.surfaceFx
      .setPosition(this.monSprite.x, this.monSprite.y)
      .setScale(this.monSprite.scaleX || 1)
      .setVisible(true);
    this.surfaceWash.setFillStyle(color, mode === 0 ? amount * 0.16 : amount * 0.1);
    this.surfaceWash.setScale(0.9 + scale * 0.12, 0.9 + scale * 0.18);
    for (let i = 0; i < this.surfaceLines.length; i++) {
      const line = this.surfaceLines[i];
      const offset = (i - 1.5) * (mode === 1 ? 9 : 7) * scale;
      const angle = mode === 2 ? 55 : mode === 3 ? -28 : 14;
      line
        .setFillStyle(color, amount * (mode === 2 ? 0.42 : 0.28))
        .setPosition((mode === 3 ? i - 1.5 : 0) * 6, offset)
        .setAngle(angle + ((seed + i * 11) % 10) - 5)
        .setVisible(mode !== 0 || i % 2 === 0);
    }
    for (let i = 0; i < this.surfaceSparks.length; i++) {
      const spark = this.surfaceSparks[i];
      const angle = ((seed * 17 + i * 71) % 360) * (Math.PI / 180);
      const radius = (12 + ((seed + i * 13) % 17)) * scale;
      spark
        .setFillStyle(color, amount * (mode === 0 ? 0.5 : 0.34))
        .setPosition(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.8)
        .setScale(mode === 1 ? 0.85 : 1.05)
        .setVisible(mode !== 2 || i % 2 === 0);
    }
  }

  private refreshPreviewAura(effect: ErShinyLabEffect | null | undefined, params: ErShinyLabParams): void {
    if (!effect) {
      this.auraRing.setVisible(false);
      this.auraOuterRing.setVisible(false);
      for (const glow of this.auraGlowSprites) {
        glow.setVisible(false);
      }
      for (const sparkle of this.auraSparkles) {
        sparkle.setVisible(false);
      }
      return;
    }
    const color = hexColor(effect.accent, 0xffd27a);
    const amount = clamp(0.25 + params.aroAmt * 0.65, 0.2, 0.9);
    const seed = hashEffectId(effect.id) + params.seed;
    const scale = clamp(params.scale, 0.65, 1.45);
    const cx = PREV_X + PREV_W / 2;
    const cy = PREV_Y + 56;
    const orbit = 39 * scale;
    const spriteScale = this.monSprite.scaleX || 1;

    for (const [idx, glow] of this.auraGlowSprites.entries()) {
      glow
        .setTint(color)
        .setAlpha(amount * (idx === 0 ? 0.22 : 0.12))
        .setPosition(this.monSprite.x, this.monSprite.y)
        .setScale(spriteScale * scale * (1.1 + idx * 0.17))
        .setVisible(this.monSprite.visible);
    }
    this.auraRing
      .setStrokeStyle(2, color, amount)
      .setFillStyle(color, amount * 0.04)
      .setDisplaySize(78 * scale, 78 * scale)
      .setVisible(true);
    this.auraOuterRing
      .setStrokeStyle(1, color, amount * 0.55)
      .setFillStyle(color, amount * 0.04)
      .setDisplaySize(96 * scale, 66 * scale)
      .setAngle((seed % 18) - 9)
      .setVisible(true);
    for (let i = 0; i < this.auraSparkles.length; i++) {
      const angle = (i / this.auraSparkles.length) * Math.PI * 2 + seed * 0.09;
      const wobble = 1 + (((seed + i * 19) % 9) - 4) * 0.025;
      this.auraSparkles[i]
        .setFillStyle(color, amount * 0.88)
        .setPosition(cx + Math.cos(angle) * orbit * wobble, cy + Math.sin(angle) * orbit * 0.78 * wobble)
        .setScale(i % 3 === 0 ? 1.25 : 1)
        .setVisible(true);
    }
  }

  // ---- TUNE panel ---------------------------------------------------------

  private tuneFraction(row: TuneRow): number {
    const p = this.config?.params;
    if (!p) {
      return 0;
    }
    switch (row) {
      case "palAmt":
        return p.palAmt;
      case "surfAmt":
        return p.surfAmt;
      case "aroAmt":
        return p.aroAmt;
      case "scale":
        return (p.scale - 0.4) / 1.6;
      case "speed":
        return (p.speed - ER_SHINY_LAB_SPEED_MIN) / (ER_SHINY_LAB_SPEED_MAX - ER_SHINY_LAB_SPEED_MIN);
      case "auraSize":
        return (p.auraSize - ER_SHINY_LAB_AURA_SIZE_MIN) / (ER_SHINY_LAB_AURA_SIZE_MAX - ER_SHINY_LAB_AURA_SIZE_MIN);
      default:
        return 0;
    }
  }

  private tuneLabel(row: TuneRow): string {
    switch (row) {
      case "palAmt":
        return "Palette";
      case "surfAmt":
        return "Surface";
      case "aroAmt":
        return "Aura";
      case "scale":
        return "Texture";
      case "speed":
        return "Speed";
      case "auraSize":
        return "Aura Size";
      case "matchPalette":
        return "Match Pal";
      case "protectBlack":
        return "Black";
      case "protectWhite":
        return "White";
      case "nameFx":
        return "Name FX";
      case "name":
        return "Name";
      case "seed":
        return "Seed";
      case "load":
        return "Load";
      case "save":
        return "Save";
    }
  }

  private tuneValueText(row: TuneRow): string {
    const cfg = this.config;
    const p = cfg?.params;
    if (!cfg || !p) {
      return "";
    }
    switch (row) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
        return `${Math.round(this.tuneFraction(row) * 100)}%`;
      case "scale":
        return `${p.scale.toFixed(1)}x`;
      case "speed":
        return `${p.speed.toFixed(2)}x`;
      case "auraSize":
        return `${p.auraSize.toFixed(2)}x`;
      case "matchPalette":
        return p.tintMode === 1 ? "ON" : "OFF";
      case "protectBlack":
        return p.protectBlack ? "ON" : "OFF";
      case "protectWhite":
        return p.protectWhite ? "ON" : "OFF";
      case "nameFx":
        if (cfg.earnedTier < 3) {
          return "T3+";
        }
        return cfg.nameFxUnlocked ? (p.nameFx ? "ON" : "OFF") : `x${cfg.nameFxCost ?? 300}`;
      case "name": {
        const nm = cfg.equippedName ?? "";
        return nm ? (nm.length > 9 ? `${nm.slice(0, 8)}...` : nm) : "(none)";
      }
      case "seed":
        return String(p.seed).padStart(3, "0");
      case "load": {
        const preset = cfg.presets[this.loadSel] ?? null;
        return `< ${this.loadSel + 1}: ${preset ? this.presetLabel(cfg, preset) : "empty"} >`;
      }
      case "save":
        return `< slot ${this.saveSel + 1} >`;
    }
  }

  private presetLabel(cfg: ErShinyLabConfig, preset: ErShinyLabPreset): string {
    if (preset.name) {
      return preset.name.length > 9 ? `${preset.name.slice(0, 8)}...` : preset.name;
    }
    const pal = preset.loadout.palette ? cfg.effects.palette.find(e => e.id === preset.loadout.palette)?.label : null;
    return pal && pal.length > 9 ? `${pal.slice(0, 8)}...` : (pal ?? "set");
  }

  /** True for rows that draw a segmented intensity bar. */
  private isSliderRow(row: TuneRow): boolean {
    return (
      row === "palAmt"
      || row === "surfAmt"
      || row === "aroAmt"
      || row === "scale"
      || row === "speed"
      || row === "auraSize"
    );
  }

  private refreshTune(): void {
    this.tuneContent.removeAll(true);
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    this.ensureTuneCursorVisible();
    const end = Math.min(TUNE_ROWS.length, this.tuneScrollTop + VISIBLE_TUNE_ROWS);
    for (let i = this.tuneScrollTop; i < end; i++) {
      const row = TUNE_ROWS[i];
      const y = this.tuneRowY(i - this.tuneScrollTop);
      const sel = this.tuneCursor === i;
      const label = addTextObject(ROW_X, y, this.tuneLabel(row), TextStyle.WINDOW, { fontSize: "36px" });
      label.setOrigin(0, 0.5).setColor(sel ? "#eef4ff" : DIM);
      this.tuneContent.add(label);

      if (this.isSliderRow(row)) {
        const filled = Math.round(this.tuneFraction(row) * TUNE_BAR_SEGMENTS);
        for (let s = 0; s < TUNE_BAR_SEGMENTS; s++) {
          const on = s < filled;
          const seg = globalScene.add.rectangle(
            TUNE_BAR_X + s * TUNE_SEG_W,
            y,
            TUNE_SEG_W - 1,
            5,
            on ? (sel ? 0xa6e9ff : 0x5ad1ff) : 0x39405a,
            1,
          );
          seg.setOrigin(0, 0.5);
          this.tuneContent.add(seg);
        }
      }

      const value = addTextObject(TUNE_VALUE_X, y, this.tuneValueText(row), TextStyle.WINDOW, {
        fontSize: row === "load" ? "30px" : "34px",
        align: "right",
      });
      value.setOrigin(1, 0.5).setColor(sel ? GOLD : "#9aa3b8");
      this.tuneContent.add(value);
    }
    this.placeTuneCursor();
    this.refreshTuneDetail();
  }

  private refreshTuneDetail(): void {
    const row = TUNE_ROWS[this.tuneCursor];
    const cfg = this.config;
    this.detailTitle.setText(this.tuneLabel(row)).setColor("#c9d4e8");
    this.detailMeta.setText("");
    let help: string;
    switch (row) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
        help = "Layer strength.  Left/Right adjust, A reset";
        break;
      case "scale":
        help = "Noise scale. Left/Right adjust, A reset";
        break;
      case "speed":
        help = "Animation speed. Left/Right adjust, A reset";
        break;
      case "auraSize":
        help = "Aura reach. Left/Right adjust, A reset";
        break;
      case "matchPalette":
        help = "Tint FX to the palette colors. L/R or A toggle";
        break;
      case "name":
        help = "Name this look. A to edit (prefixes the Pokemon name)";
        break;
      case "protectBlack":
        help = "Keep black outlines. L/R or A toggle";
        break;
      case "protectWhite":
        help = "Keep white highlights. L/R or A toggle";
        break;
      case "nameFx":
        help =
          cfg && cfg.earnedTier >= 3
            ? cfg.nameFxUnlocked
              ? "Battle nameplate FX. L/R or A toggle"
              : `Unlock battle name FX for x${cfg.nameFxCost ?? 300}.`
            : "Requires tier 3 shiny.";
        break;
      case "seed":
        help =
          cfg?.seedRerollTokens && cfg.seedRerollTokens > 0
            ? `Pattern seed.  A uses token (${cfg.seedRerollTokens})`
            : `Pattern seed.  A reroll costs ${cfg?.seedRerollCost ?? 25}`;
        break;
      case "load":
        help = "Choose a saved preset with Left/Right, A to load";
        break;
      case "save":
        help = "Choose a slot with Left/Right, A to save this look";
        break;
    }
    this.detailStatus.setText(help).setColor(DIM);
  }

  private refreshHint(): void {
    this.hintText.setText(
      this.tab === "tune"
        ? "L/R Adjust    U/D Select    A Apply    B Effects"
        : "L/R Tab    U/D Browse    A Equip / Unlock    B Exit",
    );
  }

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
    if (performance.now() - this.openedAt < 250) {
      return true;
    }
    return this.tab === "tune" ? this.inputTune(button) : this.inputEffect(button);
  }

  private inputEffect(button: Button): boolean {
    const count = this.effects().length;
    switch (button) {
      case Button.UP:
        if (count > 0) {
          this.cursor = this.cursor > 0 ? this.cursor - 1 : count - 1;
          this.afterEffectMove();
        }
        return true;
      case Button.DOWN:
        if (count > 0) {
          this.cursor = this.cursor < count - 1 ? this.cursor + 1 : 0;
          this.afterEffectMove();
        }
        return true;
      case Button.LEFT:
        this.switchTab(-1);
        return true;
      case Button.RIGHT:
        this.switchTab(1);
        return true;
      case Button.ACTION:
        this.activateEffect();
        return true;
      case Button.CANCEL:
        this.exit();
        return true;
      default:
        return false;
    }
  }

  private afterEffectMove(): void {
    globalScene.ui.playSelect();
    this.rebuildRows();
    this.placeEffectCursor();
    this.refreshEffectDetail();
    this.refreshPreview();
  }

  private switchTab(dir: number): void {
    const idx = (TABS.indexOf(this.tab) + dir + TABS.length) % TABS.length;
    this.tab = TABS[idx];
    this.cursor = 0;
    this.scrollTop = 0;
    this.tuneCursor = 0;
    this.render();
    globalScene.ui.playSelect();
  }

  private activateEffect(): void {
    const cfg = this.config;
    const eff = this.focusedEffect();
    const cat = this.effectCategory();
    if (!cfg || !eff) {
      return;
    }
    const state = this.stateOf(eff, cat);
    switch (state) {
      case "equipped":
        cfg.equipped[cat] = null;
        break;
      case "owned":
        cfg.equipped[cat] = eff.id;
        break;
      case "buyable":
        cfg.candy -= eff.cost;
        cfg.owned[cat].add(eff.id);
        cfg.equipped[cat] = eff.id;
        cfg.onBuy?.(cat, eff);
        this.candyText.setText(String(cfg.candy));
        this.repositionCandyIcon();
        break;
      default:
        globalScene.ui.playError();
        return;
    }
    globalScene.ui.playSelect();
    cfg.onChange?.({ ...cfg.equipped }, { ...cfg.params });
    this.rebuildRows();
    this.placeEffectCursor();
    this.refreshEffectDetail();
    this.refreshPreview();
    this.refreshChips();
  }

  private inputTune(button: Button): boolean {
    switch (button) {
      case Button.UP:
        this.tuneCursor = (this.tuneCursor - 1 + TUNE_ROWS.length) % TUNE_ROWS.length;
        this.refreshTune();
        globalScene.ui.playSelect();
        return true;
      case Button.DOWN:
        this.tuneCursor = (this.tuneCursor + 1) % TUNE_ROWS.length;
        this.refreshTune();
        globalScene.ui.playSelect();
        return true;
      case Button.LEFT:
        this.adjustTune(-1);
        return true;
      case Button.RIGHT:
        this.adjustTune(1);
        return true;
      case Button.ACTION:
        this.tuneAction();
        return true;
      case Button.CANCEL:
        // Back to the effect tabs (Aura, the tab adjacent to Tune).
        this.tab = "around";
        this.cursor = 0;
        this.scrollTop = 0;
        this.render();
        globalScene.ui.playSelect();
        return true;
      default:
        return false;
    }
  }

  private adjustTune(dir: number): void {
    const cfg = this.config;
    const p = cfg?.params;
    if (!cfg || !p) {
      return;
    }
    const row = TUNE_ROWS[this.tuneCursor];
    switch (row) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
        p[row] = clamp(round2(p[row] + dir * 0.05), 0, 1);
        break;
      case "scale":
        p.scale = clamp(round2(p.scale + dir * 0.1), 0.4, 2);
        break;
      case "speed":
        p.speed = clamp(round2(p.speed + dir * 0.25), ER_SHINY_LAB_SPEED_MIN, ER_SHINY_LAB_SPEED_MAX);
        break;
      case "auraSize":
        p.auraSize = clamp(round2(p.auraSize + dir * 0.1), ER_SHINY_LAB_AURA_SIZE_MIN, ER_SHINY_LAB_AURA_SIZE_MAX);
        break;
      case "matchPalette":
        p.tintMode = p.tintMode === 1 ? 0 : 1;
        break;
      case "protectBlack":
        p.protectBlack = !p.protectBlack;
        break;
      case "protectWhite":
        p.protectWhite = !p.protectWhite;
        break;
      case "nameFx":
        if (!this.toggleNameFx()) {
          return;
        }
        globalScene.ui.playSelect();
        this.refreshTune();
        return;
      case "name":
        // No Left/Right adjust; press A to edit the name.
        return;
      case "seed":
        p.seed = (p.seed + dir + 256) % 256;
        break;
      case "load":
        this.loadSel = (this.loadSel + dir + cfg.presets.length) % cfg.presets.length;
        break;
      case "save":
        this.saveSel = (this.saveSel + dir + cfg.presets.length) % cfg.presets.length;
        break;
    }
    globalScene.ui.playSelect();
    this.refreshTune();
    if (
      this.isSliderRow(row)
      || row === "seed"
      || row === "matchPalette"
      || row === "protectBlack"
      || row === "protectWhite"
    ) {
      cfg.onChange?.({ ...cfg.equipped }, { ...p });
      this.refreshPreview();
    }
  }

  private tuneAction(): void {
    const cfg = this.config;
    const p = cfg?.params;
    if (!cfg || !p) {
      return;
    }
    const row = TUNE_ROWS[this.tuneCursor];
    const def: ErShinyLabParams = { ...ER_SHINY_LAB_DEFAULT_PARAMS };
    switch (row) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
      case "scale":
      case "speed":
      case "auraSize":
        p[row] = def[row];
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        this.refreshPreview();
        break;
      case "matchPalette":
        p.tintMode = p.tintMode === 1 ? 0 : 1;
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        this.refreshPreview();
        break;
      case "name":
        this.promptEquippedName();
        return;
      case "protectBlack":
        p.protectBlack = !p.protectBlack;
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        this.refreshPreview();
        break;
      case "protectWhite":
        p.protectWhite = !p.protectWhite;
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        this.refreshPreview();
        break;
      case "nameFx":
        if (!this.toggleNameFx()) {
          return;
        }
        break;
      case "seed":
        if (cfg.onRerollSeed) {
          const nextParams = cfg.onRerollSeed({ ...p });
          if (!nextParams) {
            globalScene.ui.playError();
            this.refreshTune();
            return;
          }
          Object.assign(p, nextParams);
          this.candyText.setText(String(cfg.candy));
          this.repositionCandyIcon();
        } else {
          p.seed = (p.seed + 73) % 256;
          cfg.onChange?.({ ...cfg.equipped }, { ...p });
        }
        this.refreshPreview();
        break;
      case "load": {
        const preset = cfg.presets[this.loadSel];
        if (preset) {
          this.applyPreset(preset);
        } else {
          globalScene.ui.playError();
          return;
        }
        break;
      }
      case "save":
        // Save the current look INTO the slot, carrying the current name so a named look
        // (e.g. "Glittering") survives load/save of presets.
        cfg.presets[this.saveSel] = {
          loadout: { ...cfg.equipped },
          params: { ...p },
          name: cfg.equippedName ? sanitizeErShinyLabPresetName(cfg.equippedName) : undefined,
        };
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        break;
    }
    globalScene.ui.playSelect();
    this.refreshTune();
  }

  /** Open the text-entry modal to name the equipped look (the Pokemon-name prefix). */
  private promptEquippedName(): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    globalScene.ui.setOverlayMode(
      UiMode.RENAME_POKEMON,
      {
        buttonActions: [
          (encoded: string) => {
            globalScene.ui.playSelect();
            const name = sanitizeErShinyLabPresetName(decodeNickname(encoded, ""));
            cfg.onSetEquippedName?.(name);
            cfg.equippedName = name;
            globalScene.ui.revertMode();
            this.refreshTune();
            this.refreshPreview();
          },
          () => {
            globalScene.ui.revertMode();
          },
        ],
      },
      cfg.equippedName ?? "",
    );
  }

  private toggleNameFx(): boolean {
    const cfg = this.config;
    if (!cfg) {
      return false;
    }
    if (cfg.earnedTier < 3) {
      globalScene.ui.playError();
      this.refreshTune();
      return false;
    }
    if (!cfg.nameFxUnlocked) {
      if (!cfg.onBuyNameFx?.()) {
        globalScene.ui.playError();
        this.refreshTune();
        return false;
      }
      this.candyText.setText(String(cfg.candy));
      this.repositionCandyIcon();
      globalScene.playSound("se/buy");
      this.refreshPreview();
      return true;
    }
    cfg.params.nameFx = !cfg.params.nameFx;
    cfg.onChange?.({ ...cfg.equipped }, { ...cfg.params });
    this.refreshPreview();
    return true;
  }

  /** Apply a saved loadout, but only the effects this species actually owns. */
  private applyPreset(preset: ErShinyLabPreset): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    for (const cat of CATEGORIES) {
      const id = preset.loadout[cat];
      cfg.equipped[cat] = id && cfg.owned[cat].has(id) ? id : null;
    }
    cfg.params = { ...preset.params, nameFx: cfg.earnedTier >= 3 && !!cfg.nameFxUnlocked && !!preset.params.nameFx };
    // Loading a named preset adopts its name as the equipped name (the Pokemon-name prefix).
    cfg.equippedName = sanitizeErShinyLabPresetName(preset.name);
    cfg.onSetEquippedName?.(cfg.equippedName);
    cfg.onChange?.({ ...cfg.equipped }, { ...cfg.params });
    this.refreshChips();
    this.refreshPreview();
  }

  private exit(): void {
    const onExit = this.config?.onExit;
    globalScene.ui.playSelect();
    if (onExit) {
      onExit();
    } else {
      globalScene.ui.revertMode();
    }
  }

  clear(): void {
    super.clear();
    this.previewAnimTimer?.remove();
    this.previewAnimTimer = null;
    this.nameFx?.destroy();
    this.nameFx = undefined;
    this.container.setVisible(false);
    this.monSprite.stop();
    this.monSprite.setVisible(false);
    this.fxSprite.setVisible(false);
    if (this.previewFxKey && globalScene.textures.exists(this.previewFxKey)) {
      (globalScene.textures as Phaser.Textures.TextureManager & { remove?: (key: string) => unknown }).remove?.(
        this.previewFxKey,
      );
    }
    this.previewFxKey = null;
    this.previewSourcePixels = null;
    this.cursorObj.setVisible(false);
    this.tuneContent.removeAll(true);
    this.config = null;
  }
}

// --- helpers -----------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function hexColor(value: string, fallback: number): number {
  try {
    return Phaser.Display.Color.HexStringToColor(value).color;
  } catch {
    return fallback;
  }
}

function hashEffectId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 256;
  }
  return hash;
}

// =============================================================================
// Demo config - a self-contained, representative catalog + player state so the
// screen renders on its own (the render harness + the in-game dev preview). Real
// save data (per-species owned bitsets, candy, earned tier, the candy ramp)
// replaces this via show([config]) once the P1 persistence layer lands.
// =============================================================================

function demoEffect(def: ErShinyLabEffectDefinition): ErShinyLabEffect {
  return {
    id: def.id,
    label: def.label,
    category: def.category,
    rarity: def.rarity,
    minTier: def.minTier,
    cost: def.baseCost,
    accent: def.accent,
    ...(def.lockHint ? { lockHint: def.lockHint } : {}),
  };
}

export function buildDemoConfig(speciesId: number): ErShinyLabConfig {
  const name = (() => {
    try {
      return getPokemonSpecies(speciesId).name;
    } catch {
      return "Articuno";
    }
  })();

  const palette = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.map(demoEffect);
  const surface = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface.map(demoEffect);
  const around = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around.map(demoEffect);

  const owned: Record<ErShinyLabCategory, Set<string>> = {
    palette: new Set(["glacier", "aurum", "duoneon"]),
    surface: new Set(["holofoil", "marble", "starmap"]),
    around: new Set(["halo", "rings", "staticfield"]),
  };
  const available = new Set<string>([...palette, ...surface, ...around].map(e => e.id));
  const params: ErShinyLabParams = {
    ...ER_SHINY_LAB_DEFAULT_PARAMS,
    seed: 42,
    protectBlack: true,
    protectWhite: true,
    nameFx: true,
  };
  let demoCandy = 1240;
  let demoTokens = 1;

  return {
    speciesId,
    speciesName: name,
    earnedTier: 4,
    candy: demoCandy,
    effects: { palette, surface, around },
    owned,
    available,
    equipped: { palette: "duoneon", surface: "starmap", around: "staticfield" },
    params,
    presets: [
      {
        loadout: { palette: "glacier", surface: "marble", around: "rings" },
        params,
      },
      null,
      null,
      null,
      null,
    ],
    completion: { owned: 9, total: palette.length + surface.length + around.length, percent: 6 },
    nameFxUnlocked: true,
    nameFxCost: 300,
    seedRerollCost: 25,
    seedRerollTokens: demoTokens,
    onRerollSeed(currentParams) {
      if (demoTokens > 0) {
        demoTokens--;
      } else if (demoCandy >= 25) {
        demoCandy -= 25;
        this.candy = demoCandy;
      } else {
        return null;
      }
      this.seedRerollTokens = demoTokens;
      return { ...currentParams, seed: (currentParams.seed + 73) % 256 };
    },
  };
}
