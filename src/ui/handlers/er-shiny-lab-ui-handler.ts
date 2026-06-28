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
import {
  buildErShinyLabVariantPalette,
  type ErShinyLabCategory,
  type ErShinyLabConfig,
  type ErShinyLabEffect,
  type ErShinyLabEffectState,
  type ErShinyLabParams,
  type ErShinyLabPreset,
  type ErShinyLabRarity,
  resolveErShinyLabEffectState,
} from "#data/elite-redux/er-shiny-lab-effects";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getErShinyLabVariantCacheKey, variantColorCache } from "#sprites/variant";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";

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
type TuneRow = "palAmt" | "surfAmt" | "aroAmt" | "scale" | "seed" | "load" | "save";
type VariantPaletteMap = Record<number, Record<string, string>>;

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
const TUNE_ROWS: TuneRow[] = ["palAmt", "surfAmt", "aroAmt", "scale", "seed", "load", "save"];
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
  private monSprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
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
  /** Which preset the "Load preset" row points at, and which slot "Save" targets. */
  private loadSel = 0;
  private saveSel = 0;
  private openedAt = 0;
  private previewSpriteKey: string | null = null;

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

    this.monSprite = globalScene.add.sprite(cx, cy, "unknown");
    this.monSprite
      .setOrigin(0.5, 0.5)
      .setVisible(false)
      .setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        ignoreTimeTint: true,
      });
    this.container.add(this.monSprite);

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

    this.candyText.setText(String(cfg.candy));
    this.repositionCandyIcon();
    this.nameText.setText(cfg.speciesName);
    this.refreshTier();
    this.render();

    this.openedAt = performance.now();
    this.container.setVisible(true);
    this.active = true;
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
    const apply = () => {
      if (!this.active || !globalScene.textures.exists(key)) {
        return;
      }
      this.previewSpriteKey = key;
      this.monSprite.setTexture(key);
      if (globalScene.anims.exists(key)) {
        this.monSprite.play(key);
      }
      this.refreshPreviewSpritePalette();
      this.fitSprite();
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
    this.monSprite.setVisible(true);
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
    let spriteKey = baseKey;
    if (nextPaletteId) {
      const cacheKey = getErShinyLabVariantCacheKey(baseKey, nextPaletteId);
      if (!Object.hasOwn(variantColorCache, cacheKey)) {
        const baseColors = variantColorCache[baseKey] as VariantPaletteMap | undefined;
        if (baseColors) {
          variantColorCache[cacheKey] = buildErShinyLabVariantPalette(baseColors, nextPaletteId, 0);
        }
      }
      if (Object.hasOwn(variantColorCache, cacheKey)) {
        spriteKey = cacheKey;
      }
    }
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
    this.tierText.setText(`TIER ${cfg.earnedTier}/4`);
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
    // Preview the FOCUSED effect of the active effect tab, layered over the equipped
    // effects of the other two - so browsing a palette recolors the glow live.
    const palId = this.tab === "palette" ? this.focusedEffect()?.id : cfg.equipped.palette;
    const aroId = this.tab === "around" ? this.focusedEffect()?.id : cfg.equipped.around;
    const palEff =
      cfg.effects.palette.find(e => e.id === palId) ?? cfg.effects.palette.find(e => e.id === cfg.equipped.palette);
    const aroEff =
      cfg.effects.around.find(e => e.id === aroId) ?? cfg.effects.around.find(e => e.id === cfg.equipped.around);

    const glow = palEff ? Phaser.Display.Color.HexStringToColor(palEff.accent).color : 0x5ad1ff;
    const palA = 0.35 + 0.65 * cfg.params.palAmt;
    this.glowOuter.setFillStyle(glow, 0.16 * palA);
    this.glowInner.setFillStyle(glow, 0.28 * palA);
    this.refreshPreviewSpritePalette(palId);

    if (aroEff) {
      const ringCol = Phaser.Display.Color.HexStringToColor(aroEff.accent).color;
      this.auraRing.setStrokeStyle(1.5, ringCol, 0.4 + 0.6 * cfg.params.aroAmt);
      this.auraRing.setVisible(true);
    } else {
      this.auraRing.setVisible(false);
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
    const pal = preset.loadout.palette ? cfg.effects.palette.find(e => e.id === preset.loadout.palette)?.label : null;
    return pal ?? "set";
  }

  /** True for rows that draw a segmented intensity bar. */
  private isSliderRow(row: TuneRow): boolean {
    return row === "palAmt" || row === "surfAmt" || row === "aroAmt" || row === "scale";
  }

  private refreshTune(): void {
    this.tuneContent.removeAll(true);
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    for (let i = 0; i < TUNE_ROWS.length; i++) {
      const row = TUNE_ROWS[i];
      const y = ROW_Y0 + i * ROW_STEP;
      const sel = this.tuneCursor === i;
      const label = addTextObject(ROW_X, y, this.tuneLabel(row), TextStyle.WINDOW, { fontSize: "44px" });
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
        fontSize: "40px",
        align: "right",
      });
      value.setOrigin(1, 0.5).setColor(sel ? GOLD : "#9aa3b8");
      this.tuneContent.add(value);
    }
    this.placeCursor(this.tuneCursor);
    this.refreshTuneDetail();
  }

  private refreshTuneDetail(): void {
    const row = TUNE_ROWS[this.tuneCursor];
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
        help = "Effect texture scale.  Left/Right adjust, A reset";
        break;
      case "seed":
        help = "Pattern seed.  Left/Right change, A reroll";
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
        if (this.cursor > 0) {
          this.cursor--;
          this.afterEffectMove();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.cursor < count - 1) {
          this.cursor++;
          this.afterEffectMove();
          return true;
        }
        return false;
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
        if (this.tuneCursor > 0) {
          this.tuneCursor--;
          this.refreshTune();
          globalScene.ui.playSelect();
        }
        return true;
      case Button.DOWN:
        if (this.tuneCursor < TUNE_ROWS.length - 1) {
          this.tuneCursor++;
          this.refreshTune();
          globalScene.ui.playSelect();
        }
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
    if (this.isSliderRow(row) || row === "seed") {
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
    const def: ErShinyLabParams = { palAmt: 1, surfAmt: 1, aroAmt: 1, scale: 1, seed: 0, tintMode: 0 };
    switch (row) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
      case "scale":
        p[row] = def[row];
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        this.refreshPreview();
        break;
      case "seed":
        p.seed = Math.floor(Math.random() * 256);
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
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
        cfg.presets[this.saveSel] = { loadout: { ...cfg.equipped }, params: { ...p } };
        cfg.onChange?.({ ...cfg.equipped }, { ...p });
        break;
    }
    globalScene.ui.playSelect();
    this.refreshTune();
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
    cfg.params = { ...preset.params };
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
    this.container.setVisible(false);
    this.monSprite.stop();
    this.monSprite.setVisible(false);
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

// =============================================================================
// Demo config - a self-contained, representative catalog + player state so the
// screen renders on its own (the render harness + the in-game dev preview). Real
// save data (per-species owned bitsets, candy, earned tier, the candy ramp)
// replaces this via show([config]) once the P1 persistence layer lands.
// =============================================================================

function demoEffect(
  id: string,
  label: string,
  category: ErShinyLabCategory,
  rarity: ErShinyLabRarity,
  minTier: number,
  cost: number,
  accent: string,
  lockHint?: string,
): ErShinyLabEffect {
  const e: ErShinyLabEffect = { id, label, category, rarity, minTier, cost, accent };
  if (lockHint) {
    e.lockHint = lockHint;
  }
  return e;
}

export function buildDemoConfig(speciesId: number): ErShinyLabConfig {
  const name = (() => {
    try {
      return getPokemonSpecies(speciesId).name;
    } catch {
      return "Articuno";
    }
  })();

  const palette: ErShinyLabEffect[] = [
    demoEffect("glacier", "Glacier", "palette", "common", 1, 100, "#7fd8ff"),
    demoEffect("obsidian", "Obsidian", "palette", "common", 1, 100, "#2a2a3a"),
    demoEffect("crimson", "Crimson", "palette", "common", 1, 100, "#ff4a5a"),
    demoEffect("emerald", "Emerald", "palette", "common", 1, 140, "#3affa0"),
    demoEffect("sunset", "Sunset", "palette", "rare", 1, 180, "#ff8a3d"),
    demoEffect("aurora", "Aurora", "palette", "rare", 1, 180, "#5affc0"),
    demoEffect("vaporwave", "Vaporwave", "palette", "rare", 1, 220, "#ff77e6"),
    demoEffect("toxic", "Toxic", "palette", "rare", 1, 220, "#9bff4a"),
    demoEffect("galaxy", "Galaxy", "palette", "epic", 1, 320, "#9b6cff"),
    demoEffect("synthsun", "Synthwave Sun", "palette", "epic", 1, 360, "#ff9a3d"),
    demoEffect("aurum", "Aurum", "palette", "epic", 1, 400, "#ffcf52"),
    demoEffect(
      "prism",
      "Prism",
      "palette",
      "legendary",
      1,
      500,
      "#a0e0ff",
      "win with a different type on every team member",
    ),
  ];
  const surface: ErShinyLabEffect[] = [
    demoEffect("scales", "Scales", "surface", "common", 3, 500, "#9fd0ff"),
    demoEffect("marble", "Marble", "surface", "common", 3, 500, "#dfe6f2"),
    demoEffect("holofoil", "Holofoil", "surface", "rare", 3, 620, "#7fe0ff"),
    demoEffect("oilfilm", "Oil Film", "surface", "rare", 3, 620, "#b08bff"),
    demoEffect("electric", "Electric", "surface", "rare", 3, 700, "#ffe85a"),
    demoEffect("tron", "Tron Lines", "surface", "rare", 3, 700, "#36e6ff"),
    demoEffect("crystal", "Crystal Facets", "surface", "epic", 3, 900, "#a6f0ff"),
    demoEffect("plasma", "Plasma", "surface", "epic", 3, 900, "#ff6ad9"),
    demoEffect("stained", "Stained Glass", "surface", "epic", 3, 980, "#c08bff"),
    demoEffect("sunsetsun", "Sunset Sun", "surface", "epic", 3, 980, "#ff8a3d"),
    demoEffect(
      "prismsplit",
      "Prism Split",
      "surface",
      "legendary",
      3,
      1200,
      "#9ad0ff",
      "win a Ghost-Trainers run with no faints",
    ),
  ];
  const around: ErShinyLabEffect[] = [
    demoEffect("softhalo", "Soft Halo", "around", "common", 4, 1000, "#9fd0ff"),
    demoEffect("petals", "Petals", "around", "common", 4, 1000, "#ff9ad0"),
    demoEffect("orbiting", "Orbiting Sparks", "around", "rare", 4, 1200, "#7fe0ff"),
    demoEffect("fireflies", "Fireflies", "around", "rare", 4, 1200, "#ffe07a"),
    demoEffect("embers", "Embers", "around", "rare", 4, 1300, "#ff7a3a"),
    demoEffect("frost", "Frost Aura", "around", "rare", 4, 1300, "#a6f0ff"),
    demoEffect("flame", "Flame Aura", "around", "epic", 4, 1600, "#ff7a3a", "win Classic (Ace+) holding no items"),
    demoEffect("golden", "Golden Glow", "around", "epic", 4, 1600, "#ffcf52"),
    demoEffect("shadow", "Shadow Aura", "around", "epic", 4, 1700, "#9b6cff"),
    demoEffect(
      "cursed",
      "Cursed Aura",
      "around",
      "epic",
      4,
      1700,
      "#ff4a6a",
      "win a Ghost-Trainers run with no faints",
    ),
    demoEffect(
      "rainbowout",
      "Rainbow Outline",
      "around",
      "legendary",
      4,
      2200,
      "#a0e0ff",
      "reach wave 50 without taking damage",
    ),
  ];

  const owned: Record<ErShinyLabCategory, Set<string>> = {
    palette: new Set(["glacier", "obsidian", "aurora", "galaxy"]),
    surface: new Set(["scales", "holofoil"]),
    around: new Set(["softhalo", "orbiting"]),
  };
  // Globally available (achievement/challenge gate satisfied) - prism stays locked.
  const available = new Set<string>(["prismsplit", "flame", "cursed"]);

  return {
    speciesId,
    speciesName: name,
    earnedTier: 4,
    candy: 1240,
    effects: { palette, surface, around },
    owned,
    available,
    equipped: { palette: "aurora", surface: "holofoil", around: "softhalo" },
    params: { palAmt: 1, surfAmt: 0.8, aroAmt: 1, scale: 1, seed: 42, tintMode: 0 },
    presets: [
      {
        loadout: { palette: "galaxy", surface: "holofoil", around: "orbiting" },
        params: { palAmt: 1, surfAmt: 0.8, aroAmt: 1, scale: 1, seed: 42, tintMode: 0 },
      },
      null,
      null,
      null,
      null,
    ],
  };
}
