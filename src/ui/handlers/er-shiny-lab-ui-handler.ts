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
// Surface FX (T3) and Around FX / aura (T4 black shiny) - for one species, sees
// a live mon preview, equips what they own, spends candy on what they can, and
// tunes per-layer intensity / texture / seed, saving up to 5 presets.
//
// Theme mirrors the web lab: a dark "void" backdrop with three neon accents -
// cyan (palette), pink (surface), gold (around) - so the in-game tool reads as
// the same product the team already uses.
//
// NAVIGATION (directional + Action/Cancel only, no pointer):
//   The screen has three focus zones, with Cancel as a universal "back up one
//   level" (sub-zone -> list, list -> exit). Within any zone L/R is the
//   horizontal action and U/D the vertical one, so the mapping never changes
//   meaning under the player's thumb:
//     LIST   - U/D browse effects, L/R switch category, A equip/buy, B exit.
//              DOWN past the last effect drops into TUNE.
//     TUNE   - L/R select control (or step out at the ends), U/D adjust value,
//              A reset the control, B back to LIST.
//     PRESETS- L/R select slot (or step back to TUNE at the left end), A load
//              (or save into an empty slot), UP save, B back to LIST.
//   A context hint line at the very bottom always teaches the active zone.
//
// Modeled on ErBargainUiHandler / BiomeShop: a full-screen container the UI shows
// on top of the field, placed at y = -h so a child at logical (0,0) lands at the
// screen top-left. Pure presentation + cursor + callbacks; the caller owns the
// real save data (this handler is driven by an {@linkcode ErShinyLabConfig}; a
// self-contained demo config is generated when none is supplied so the screen is
// renderable on its own).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** The three effect layers, lowest to highest tier requirement. */
export type ErShinyLabCategory = "palette" | "surface" | "around";
/** Wild-rarity label, drives the prestige badge color. */
export type ErShinyLabRarity = "common" | "rare" | "epic" | "legendary";

/** One designable effect in a category (a palette, a surface FX or an aura). */
export interface ErShinyLabEffect {
  id: string;
  label: string;
  rarity: ErShinyLabRarity;
  /** Earned shiny tier this species needs to wear the effect (1 palette, 3 surface, 4 aura). */
  minTier: number;
  /** Candy price (post-discount). The Nth-in-category ramp is baked in by the caller. */
  cost: number;
  /** Representative #rrggbb accent used for the live preview glow / aura ring. */
  accent: string;
  /** When set, the effect is achievement/challenge gated - the hint shown until it's unlocked. */
  lockHint?: string;
}

/** A wearable combination - one effect id (or none) per layer. */
export interface ErShinyLabLoadout {
  palette: string | null;
  surface: string | null;
  around: string | null;
}

/** Quantized per-layer tuning. Intensities 0..1, scale 0.4..2, seed 0..255. */
export interface ErShinyLabParams {
  palAmt: number;
  surfAmt: number;
  aroAmt: number;
  scale: number;
  seed: number;
}

/** Everything the handler needs to render + drive the designer for one species. */
export interface ErShinyLabConfig {
  speciesId: number;
  speciesName: string;
  /** Best earned shiny tier on THIS species (1..4); gates which categories unlock. */
  earnedTier: number;
  candy: number;
  effects: Record<ErShinyLabCategory, ErShinyLabEffect[]>;
  /** Per-category owned effect ids (bought / caught wild / granted). */
  owned: Record<ErShinyLabCategory, Set<string>>;
  /** Effect ids whose achievement/challenge gate is satisfied globally (buyable everywhere). */
  available: Set<string>;
  equipped: ErShinyLabLoadout;
  params: ErShinyLabParams;
  /** Up to 5 saved loadouts (null = empty slot). */
  presets: (ErShinyLabLoadout | null)[];
  /** Fired whenever the equipped loadout or params change (caller persists). */
  onChange?: (loadout: ErShinyLabLoadout, params: ErShinyLabParams) => void;
  /** Fired when the player spends candy to buy an effect (caller debits + persists). */
  onBuy?: (category: ErShinyLabCategory, effect: ErShinyLabEffect) => void;
  /** Fired on exit (Cancel from the list). */
  onExit?: () => void;
}

/** The resolved gate state of an effect for the current species (the 3-gate resolver, visualized). */
type EffectState = "equipped" | "owned" | "buyable" | "locked-tier" | "locked-achv" | "locked-candy";

/** Which focus zone owns the directional input right now. */
type Focus = "list" | "tune" | "presets";

const CATEGORIES: ErShinyLabCategory[] = ["palette", "surface", "around"];
const CATEGORY_LABEL: Record<ErShinyLabCategory, string> = {
  palette: "PALETTE",
  surface: "SURFACE",
  around: "AROUND",
};
/** Neon accent per layer (mirrors the web lab: cyan / pink / gold). */
const CATEGORY_ACCENT: Record<ErShinyLabCategory, number> = {
  palette: 0x5ad1ff,
  surface: 0xff7ad9,
  around: 0xffd27a,
};
const CATEGORY_ACCENT_HEX: Record<ErShinyLabCategory, string> = {
  palette: "#5ad1ff",
  surface: "#ff7ad9",
  around: "#ffd27a",
};
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

const VOID_COLOR = 0x080912;
const INK = "#e8ecf6";
const DIM = "#8b93a8";
const GOLD = "#ffd27a";

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
const LIST_H = 91;
const ROW_X = LIST_X + 9;
const ROW_Y0 = LIST_Y + 9;
const ROW_STEP = 11;
const VISIBLE_ROWS = 7;
const DETAIL_X = RIGHT_X;
const DETAIL_Y = 124;
const DETAIL_W = RIGHT_W;
const DETAIL_H = 30;
// The contextual tune/preset bar sits under the detail panel in the RIGHT column only,
// so the left column stays clear for the preview pane + its equipped-loadout chips.
const BAR_X = RIGHT_X;
const BAR_Y = 156;
const BAR_W = RIGHT_W;
const BAR_H = 16;
const HINT_Y = 174;
/** The 5 tunable controls, in L/R order. */
const TUNE_KEYS = ["palAmt", "surfAmt", "aroAmt", "scale", "seed"] as const;
const TUNE_LABEL = ["Pal", "Surf", "Aura", "Tex", "Seed"];
const PRESET_COUNT = 5;

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
  private candyText: Phaser.GameObjects.Text;
  // Tabs.
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private tabUnderline: Phaser.GameObjects.Rectangle;
  // List.
  private listWindow: Phaser.GameObjects.NineSlice;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private rowDots: Phaser.GameObjects.Rectangle[] = [];
  private rowTokens: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;
  private scrollUp: Phaser.GameObjects.Text;
  private scrollDown: Phaser.GameObjects.Text;
  // Detail.
  private detailWindow: Phaser.GameObjects.NineSlice;
  private detailTitle: Phaser.GameObjects.Text;
  private detailMeta: Phaser.GameObjects.Text;
  private detailStatus: Phaser.GameObjects.Text;
  // Bottom contextual bar.
  private barWindow: Phaser.GameObjects.NineSlice;
  private barContent: Phaser.GameObjects.Container;
  private hintText: Phaser.GameObjects.Text;

  // State.
  private config: ErShinyLabConfig | null = null;
  private focus: Focus = "list";
  private category: ErShinyLabCategory = "palette";
  private scrollTop = 0;
  private tuneSel = 0;
  private presetSel = 0;
  private openedAt = 0;

  constructor() {
    super(UiMode.ER_SHINY_LAB);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop with a faint vignette band at the top for the header.
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
    this.candyText = addTextObject(SCREEN_W - 8, 3, "", TextStyle.WINDOW, { fontSize: "44px" });
    this.candyText.setOrigin(1, 0).setColor(GOLD);
    this.container.add(this.candyText);

    // --- Preview pane ---
    this.previewWindow = addWindow(PREV_X, PREV_Y, PREV_W, PREV_H);
    this.previewWindow.setTint(0x2a3050);
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
    this.monSprite.setOrigin(0.5, 0.5);
    this.monSprite.setVisible(false);
    this.container.add(this.monSprite);

    this.nameText = addTextObject(cx, PREV_Y + 98, "", TextStyle.WINDOW, { fontSize: "52px", align: "center" });
    this.nameText.setOrigin(0.5, 0).setColor(INK);
    this.container.add(this.nameText);
    this.tierText = addTextObject(cx, PREV_Y + 110, "", TextStyle.WINDOW, { fontSize: "32px", align: "center" });
    this.tierText.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.tierText);

    // --- Tabs ---
    const tabW = RIGHT_W / 3;
    for (let i = 0; i < CATEGORIES.length; i++) {
      const t = addTextObject(
        RIGHT_X + tabW * i + tabW / 2,
        TAB_Y + 1,
        CATEGORY_LABEL[CATEGORIES[i]],
        TextStyle.WINDOW,
        {
          fontSize: "44px",
          align: "center",
        },
      );
      t.setOrigin(0.5, 0);
      this.container.add(t);
      this.tabTexts.push(t);
    }
    this.tabUnderline = globalScene.add.rectangle(RIGHT_X, TAB_Y + TAB_H - 1, tabW, 2, 0x5ad1ff, 1).setOrigin(0, 0.5);
    this.container.add(this.tabUnderline);

    // --- List ---
    this.listWindow = addWindow(LIST_X, LIST_Y, LIST_W, LIST_H);
    this.listWindow.setTint(0x2a3050);
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
      const dot = globalScene.add.rectangle(ROW_X, y, 4, 4, 0xffffff, 1).setOrigin(0.5, 0.5);
      dot.setVisible(false);
      this.container.add(dot);
      this.rowDots.push(dot);
      const label = addTextObject(ROW_X + 8, y, "", TextStyle.WINDOW, { fontSize: "48px" });
      label.setOrigin(0, 0.5);
      this.container.add(label);
      this.rowTexts.push(label);
      const token = addTextObject(LIST_X + LIST_W - 8, y, "", TextStyle.WINDOW, { fontSize: "40px", align: "right" });
      token.setOrigin(1, 0.5);
      this.container.add(token);
      this.rowTokens.push(token);
    }

    // --- Detail ---
    this.detailWindow = addWindow(DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H);
    this.detailWindow.setTint(0x2a3050);
    this.container.add(this.detailWindow);
    this.detailTitle = addTextObject(DETAIL_X + 8, DETAIL_Y + 4, "", TextStyle.WINDOW, { fontSize: "48px" });
    this.detailTitle.setOrigin(0, 0);
    this.container.add(this.detailTitle);
    this.detailMeta = addTextObject(DETAIL_X + DETAIL_W - 8, DETAIL_Y + 5, "", TextStyle.WINDOW, {
      fontSize: "36px",
      align: "right",
    });
    this.detailMeta.setOrigin(1, 0).setColor(DIM);
    this.container.add(this.detailMeta);
    this.detailStatus = addTextObject(DETAIL_X + 8, DETAIL_Y + 17, "", TextStyle.WINDOW, { fontSize: "38px" });
    this.detailStatus.setOrigin(0, 0).setColor(DIM);
    this.container.add(this.detailStatus);

    // --- Bottom contextual bar ---
    this.barWindow = addWindow(BAR_X, BAR_Y, BAR_W, BAR_H);
    this.barWindow.setTint(0x2a3050);
    this.container.add(this.barWindow);
    this.barContent = globalScene.add.container(0, 0);
    this.container.add(this.barContent);

    this.hintText = addTextObject(SCREEN_W / 2, HINT_Y, "", TextStyle.WINDOW, { fontSize: "34px", align: "center" });
    this.hintText.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(this.hintText);
  }

  show(args: any[]): boolean {
    const cfg = args.length > 0 && this.isConfig(args[0]) ? (args[0] as ErShinyLabConfig) : buildDemoConfig(144);
    this.config = cfg;
    this.focus = "list";
    this.category = "palette";
    this.cursor = 0;
    this.scrollTop = 0;
    this.tuneSel = 0;
    this.presetSel = 0;

    this.candyText.setText(`Candy ${cfg.candy}`);
    this.nameText.setText(cfg.speciesName);
    this.refreshTier();
    this.refreshTabs();
    this.rebuildRows();
    this.moveCursorTo(0);
    this.refreshDetail();
    this.refreshPreview();
    this.refreshBar();
    this.refreshHint();

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

  private effects(): ErShinyLabEffect[] {
    return this.config?.effects[this.category] ?? [];
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
    if (cfg.earnedTier < effect.minTier) {
      return "locked-tier";
    }
    if (cfg.owned[category].has(effect.id)) {
      return cfg.equipped[category] === effect.id ? "equipped" : "owned";
    }
    if (effect.lockHint && !cfg.available.has(effect.id)) {
      return "locked-achv";
    }
    return cfg.candy >= effect.cost ? "buyable" : "locked-candy";
  }

  // ---- Preview sprite -----------------------------------------------------

  /**
   * Load + show the species' front battle sprite in the preview pane. Synchronous
   * when cached, on-demand otherwise (the placeholder stays until it lands). Mirrors
   * the bargain handler's on-demand Giratina load.
   */
  private loadPreviewSprite(speciesId: number): void {
    const species = getPokemonSpecies(speciesId);
    const key = species.getSpriteKey(false, 0, false, 0);
    const apply = () => {
      if (!this.active || !globalScene.textures.exists(key)) {
        return;
      }
      this.monSprite.setTexture(key);
      if (globalScene.anims.exists(key)) {
        this.monSprite.play(key);
      }
      this.fitSprite();
    };
    if (globalScene.textures.exists(key)) {
      apply();
      return;
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

  // ---- Render: tier / tabs / rows / detail / preview / bar / hint ----------

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
    const totalW = 4 * 6 - 2;
    const x0 = PREV_X + PREV_W / 2 - totalW / 2;
    for (let i = 0; i < 4; i++) {
      const on = i < cfg.earnedTier;
      const pip = globalScene.add.rectangle(x0 + i * 6, PREV_Y + 120, 4, 4, on ? 0xffd27a : 0x39405a, 1);
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
      const label = `${CATEGORY_LABEL[cat][0]} ${eff ? eff.label : "-"}`;
      const chip = addTextObject(PREV_X + 8, y, label, TextStyle.WINDOW, { fontSize: "32px" });
      chip.setOrigin(0, 0).setColor(eff ? CATEGORY_ACCENT_HEX[cat] : DIM);
      this.container.add(chip);
      this.chipTexts.push(chip);
      y += 8;
    }
  }

  private refreshTabs(): void {
    const tabW = RIGHT_W / 3;
    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      const on = cat === this.category;
      const reachable = (this.config?.earnedTier ?? 1) >= CATEGORY_MIN_TIER[cat];
      this.tabTexts[i].setColor(on ? CATEGORY_ACCENT_HEX[cat] : reachable ? DIM : "#5a6072");
      this.tabTexts[i].setAlpha(reachable ? 1 : 0.6);
    }
    const idx = CATEGORIES.indexOf(this.category);
    this.tabUnderline.setX(RIGHT_X + tabW * idx);
    this.tabUnderline.setFillStyle(CATEGORY_ACCENT[this.category], 1);
  }

  private rebuildRows(): void {
    const list = this.effects();
    // Keep the cursor on-screen within the VISIBLE_ROWS window.
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + VISIBLE_ROWS) {
      this.scrollTop = this.cursor - VISIBLE_ROWS + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, list.length - VISIBLE_ROWS)));

    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const idx = this.scrollTop + i;
      const eff = list[idx];
      const label = this.rowTexts[i];
      const dot = this.rowDots[i];
      const token = this.rowTokens[i];
      if (!eff) {
        label.setText("");
        dot.setVisible(false);
        token.setText("");
        continue;
      }
      const state = this.stateOf(eff, this.category);
      const locked = state === "locked-tier" || state === "locked-achv" || state === "locked-candy";
      label.setText(eff.label);
      label.setColor(state === "equipped" ? CATEGORY_ACCENT_HEX[this.category] : locked ? "#6a7188" : INK);
      dot.setVisible(true);
      dot.setFillStyle(RARITY_COLOR[eff.rarity], locked ? 0.5 : 1);
      token.setText(this.tokenFor(eff, state));
      token.setColor(this.tokenColor(state));
    }
    this.scrollUp.setVisible(this.scrollTop > 0);
    this.scrollDown.setVisible(this.scrollTop + VISIBLE_ROWS < list.length);
  }

  /** The compact right-aligned status token on a list row. */
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
        return "★LOCK";
      case "locked-candy":
        return `${eff.cost}`;
    }
  }

  private tokenColor(state: EffectState): string {
    switch (state) {
      case "equipped":
        return CATEGORY_ACCENT_HEX[this.category];
      case "owned":
        return "#9aa3b8";
      case "buyable":
        return GOLD;
      case "locked-tier":
        return "#e0707a";
      case "locked-achv":
        return "#c08bff";
      case "locked-candy":
        return "#e0707a";
    }
  }

  private moveCursorTo(index: number): void {
    const count = this.effects().length;
    if (count === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    this.cursor = Math.max(0, Math.min(index, count - 1));
    this.rebuildRows();
    const slot = this.cursor - this.scrollTop;
    const y = ROW_Y0 + slot * ROW_STEP;
    this.cursorObj.setPosition(LIST_X + 6, y);
    this.cursorObj.setVisible(this.focus === "list");
  }

  private refreshDetail(): void {
    const eff = this.focusedEffect();
    if (!eff) {
      this.detailTitle.setText("");
      this.detailMeta.setText("");
      this.detailStatus.setText("");
      return;
    }
    const state = this.stateOf(eff, this.category);
    this.detailTitle.setText(eff.label);
    this.detailTitle.setColor(RARITY_HEX[eff.rarity]);
    this.detailMeta.setText(`${eff.rarity.toUpperCase()}  T${eff.minTier}+`);
    let status: string;
    let color = DIM;
    switch (state) {
      case "equipped":
        status = "Equipped.  A: unequip";
        color = CATEGORY_ACCENT_HEX[this.category];
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
      case "locked-candy":
        status = `Need ${eff.cost} candy (have ${this.config?.candy ?? 0})`;
        color = "#e0707a";
        break;
    }
    this.detailStatus.setText(status);
    this.detailStatus.setColor(color);
  }

  /** Update the live preview glow / aura ring from the focused-or-equipped look. */
  private refreshPreview(): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    // Preview the FOCUSED effect of the active category, layered over the equipped
    // effects of the other two - so browsing a palette recolors the glow live.
    const palId = this.category === "palette" ? this.focusedEffect()?.id : cfg.equipped.palette;
    const aroId = this.category === "around" ? this.focusedEffect()?.id : cfg.equipped.around;
    const palEff =
      cfg.effects.palette.find(e => e.id === palId) ?? cfg.effects.palette.find(e => e.id === cfg.equipped.palette);
    const aroEff =
      cfg.effects.around.find(e => e.id === aroId) ?? cfg.effects.around.find(e => e.id === cfg.equipped.around);

    const glow = palEff ? Phaser.Display.Color.HexStringToColor(palEff.accent).color : 0x5ad1ff;
    this.glowOuter.setFillStyle(glow, 0.16);
    this.glowInner.setFillStyle(glow, 0.28);

    if (aroEff) {
      this.auraRing.setStrokeStyle(1.5, Phaser.Display.Color.HexStringToColor(aroEff.accent).color, 0.85);
      this.auraRing.setVisible(true);
    } else {
      this.auraRing.setVisible(false);
    }
  }

  /** Rebuild the contextual bottom bar for the active focus zone. */
  private refreshBar(): void {
    this.barContent.removeAll(true);
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    if (this.focus === "presets") {
      this.buildPresetBar(cfg);
    } else {
      this.buildTuneBar(cfg);
    }
  }

  /** The 5 tuning controls as labeled pip bars across the bar (Seed shows its value). */
  private buildTuneBar(cfg: ErShinyLabConfig): void {
    const colW = BAR_W / TUNE_KEYS.length;
    for (let i = 0; i < TUNE_KEYS.length; i++) {
      const x0 = BAR_X + colW * i + 6;
      const sel = this.focus === "tune" && this.tuneSel === i;
      if (sel) {
        // Faint cyan column behind the selected control so it pops at a glance.
        const hl = globalScene.add.rectangle(BAR_X + colW * i + 2, BAR_Y + 2, colW - 4, BAR_H - 4, 0x5ad1ff, 0.16);
        hl.setOrigin(0, 0);
        this.barContent.add(hl);
      }
      const label = addTextObject(x0, BAR_Y + 2, TUNE_LABEL[i], TextStyle.WINDOW, { fontSize: "32px" });
      label.setOrigin(0, 0).setColor(sel ? "#eef4ff" : DIM);
      this.barContent.add(label);
      const key = TUNE_KEYS[i];
      if (key === "seed") {
        const v = addTextObject(x0, BAR_Y + 9, String(cfg.params.seed).padStart(3, "0"), TextStyle.WINDOW, {
          fontSize: "32px",
        });
        v.setOrigin(0, 0).setColor(sel ? GOLD : "#9aa3b8");
        this.barContent.add(v);
      } else {
        const filled = Math.round(this.tuneFraction(key) * 5);
        for (let p = 0; p < 5; p++) {
          const pip = globalScene.add.rectangle(x0 + p * 6, BAR_Y + 11, 5, 4, p < filled ? 0x5ad1ff : 0x39405a, 1);
          pip.setOrigin(0, 0.5);
          if (sel && p < filled) {
            pip.setFillStyle(0xa6e9ff, 1);
          }
          this.barContent.add(pip);
        }
      }
    }
  }

  /** The 5 preset slots across the bar (filled = a saved loadout). */
  private buildPresetBar(cfg: ErShinyLabConfig): void {
    const colW = BAR_W / PRESET_COUNT;
    for (let i = 0; i < PRESET_COUNT; i++) {
      const x0 = BAR_X + colW * i + 6;
      const sel = this.presetSel === i;
      const preset = cfg.presets[i] ?? null;
      const filled = !!preset;
      if (sel) {
        const hl = globalScene.add.rectangle(BAR_X + colW * i + 2, BAR_Y + 2, colW - 4, BAR_H - 4, 0x5ad1ff, 0.16);
        hl.setOrigin(0, 0);
        this.barContent.add(hl);
      }
      const t = addTextObject(
        x0,
        BAR_Y + 5,
        `${i + 1}: ${filled ? this.presetLabel(cfg, preset) : "empty"}`,
        TextStyle.WINDOW,
        { fontSize: "34px" },
      );
      t.setOrigin(0, 0).setColor(sel ? "#eef4ff" : filled ? "#cfd6e6" : DIM);
      this.barContent.add(t);
    }
  }

  private presetLabel(cfg: ErShinyLabConfig, preset: ErShinyLabLoadout | null): string {
    if (!preset) {
      return "empty";
    }
    const pal = preset.palette ? cfg.effects.palette.find(e => e.id === preset.palette)?.label : null;
    return pal ?? "set";
  }

  private tuneFraction(key: (typeof TUNE_KEYS)[number]): number {
    const p = this.config?.params;
    if (!p) {
      return 0;
    }
    switch (key) {
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

  private refreshHint(): void {
    let hint: string;
    switch (this.focus) {
      case "list":
        hint = "L/R Category    U/D Browse    A Equip / Unlock    Stats Tune    B Back";
        break;
      case "tune":
        hint = "L/R Select    U/D Adjust    A Reset    Stats Presets    B Back";
        break;
      case "presets":
        hint = "L/R Slot    A Load    Up Save    Stats Back    B Back";
        break;
    }
    this.hintText.setText(hint);
  }

  // ---- Input --------------------------------------------------------------

  processInput(button: Button): boolean {
    // Swallow stray input carried over from the opening transition (mirrors bargain).
    if (performance.now() - this.openedAt < 250) {
      return true;
    }
    if (this.focus === "tune") {
      return this.inputTune(button);
    }
    if (this.focus === "presets") {
      return this.inputPresets(button);
    }
    return this.inputList(button);
  }

  private inputList(button: Button): boolean {
    const count = this.effects().length;
    switch (button) {
      case Button.UP:
        if (this.cursor > 0) {
          this.moveCursorTo(this.cursor - 1);
          this.afterListMove();
          return true;
        }
        return false;
      case Button.DOWN:
        if (this.cursor < count - 1) {
          this.moveCursorTo(this.cursor + 1);
          this.afterListMove();
          return true;
        }
        // Past the last effect: drop into the tuning bar.
        this.tuneSel = 0;
        this.enterZone("tune");
        return true;
      case Button.LEFT:
        this.switchCategory(-1);
        return true;
      case Button.RIGHT:
        this.switchCategory(1);
        return true;
      case Button.ACTION:
        this.activateEffect();
        return true;
      // Quick "panel" accelerator: jump straight to the tuning bar (and on round
      // to presets / back) without walking to the bottom of the list.
      case Button.STATS:
        this.tuneSel = 0;
        this.enterZone("tune");
        return true;
      case Button.CANCEL:
        this.exit();
        return true;
      default:
        return false;
    }
  }

  private afterListMove(): void {
    globalScene.ui.playSelect();
    this.refreshDetail();
    this.refreshPreview();
  }

  private switchCategory(dir: number): void {
    const idx = (CATEGORIES.indexOf(this.category) + dir + CATEGORIES.length) % CATEGORIES.length;
    this.category = CATEGORIES[idx];
    this.cursor = 0;
    this.scrollTop = 0;
    this.refreshTabs();
    this.moveCursorTo(0);
    this.refreshDetail();
    this.refreshPreview();
    globalScene.ui.playSelect();
  }

  private activateEffect(): void {
    const cfg = this.config;
    const eff = this.focusedEffect();
    if (!cfg || !eff) {
      return;
    }
    const state = this.stateOf(eff, this.category);
    switch (state) {
      case "equipped":
        cfg.equipped[this.category] = null;
        break;
      case "owned":
        cfg.equipped[this.category] = eff.id;
        break;
      case "buyable":
        cfg.candy -= eff.cost;
        cfg.owned[this.category].add(eff.id);
        cfg.equipped[this.category] = eff.id;
        cfg.onBuy?.(this.category, eff);
        this.candyText.setText(`Candy ${cfg.candy}`);
        break;
      default:
        // Locked: refuse with the error tone, leave state untouched.
        globalScene.ui.playError();
        return;
    }
    globalScene.ui.playSelect();
    cfg.onChange?.({ ...cfg.equipped }, { ...cfg.params });
    this.rebuildRows();
    this.moveCursorTo(this.cursor);
    this.refreshDetail();
    this.refreshPreview();
    this.refreshChips();
  }

  private inputTune(button: Button): boolean {
    const cfg = this.config;
    if (!cfg) {
      return false;
    }
    switch (button) {
      case Button.LEFT:
        if (this.tuneSel > 0) {
          this.tuneSel--;
          this.refreshBar();
          globalScene.ui.playSelect();
        } else {
          this.enterZone("list");
        }
        return true;
      case Button.RIGHT:
        if (this.tuneSel < TUNE_KEYS.length - 1) {
          this.tuneSel++;
          this.refreshBar();
          globalScene.ui.playSelect();
        } else {
          this.presetSel = 0;
          this.enterZone("presets");
        }
        return true;
      case Button.UP:
        this.adjustTune(1);
        return true;
      case Button.DOWN:
        this.adjustTune(-1);
        return true;
      case Button.ACTION:
        this.resetTune();
        return true;
      case Button.STATS:
        this.presetSel = 0;
        this.enterZone("presets");
        return true;
      case Button.CANCEL:
        this.enterZone("list");
        return true;
      default:
        return false;
    }
  }

  private adjustTune(dir: number): void {
    const p = this.config?.params;
    if (!p) {
      return;
    }
    const key = TUNE_KEYS[this.tuneSel];
    switch (key) {
      case "palAmt":
      case "surfAmt":
      case "aroAmt":
        p[key] = clamp(round2(p[key] + dir * 0.1), 0, 1);
        break;
      case "scale":
        p.scale = clamp(round2(p.scale + dir * 0.2), 0.4, 2);
        break;
      case "seed":
        p.seed = (p.seed + dir * 8 + 256) % 256;
        break;
    }
    globalScene.ui.playSelect();
    this.refreshBar();
    this.config?.onChange?.({ ...this.config.equipped }, { ...p });
  }

  private resetTune(): void {
    const p = this.config?.params;
    if (!p) {
      return;
    }
    const key = TUNE_KEYS[this.tuneSel];
    const def: ErShinyLabParams = { palAmt: 1, surfAmt: 1, aroAmt: 1, scale: 1, seed: 0 };
    p[key] = def[key];
    globalScene.ui.playSelect();
    this.refreshBar();
    this.config?.onChange?.({ ...this.config.equipped }, { ...p });
  }

  private inputPresets(button: Button): boolean {
    const cfg = this.config;
    if (!cfg) {
      return false;
    }
    switch (button) {
      case Button.LEFT:
        if (this.presetSel > 0) {
          this.presetSel--;
          this.refreshBar();
          globalScene.ui.playSelect();
        } else {
          this.tuneSel = TUNE_KEYS.length - 1;
          this.enterZone("tune");
        }
        return true;
      case Button.RIGHT:
        if (this.presetSel < PRESET_COUNT - 1) {
          this.presetSel++;
          this.refreshBar();
          globalScene.ui.playSelect();
        }
        return true;
      case Button.UP:
        // Save the current loadout into the slot.
        cfg.presets[this.presetSel] = { ...cfg.equipped };
        globalScene.ui.playSelect();
        this.refreshBar();
        return true;
      case Button.STATS:
        this.enterZone("list");
        return true;
      case Button.ACTION: {
        const preset = cfg.presets[this.presetSel];
        if (preset) {
          this.applyPreset(preset);
        } else {
          cfg.presets[this.presetSel] = { ...cfg.equipped };
        }
        globalScene.ui.playSelect();
        this.refreshBar();
        return true;
      }
      case Button.CANCEL:
        this.enterZone("list");
        return true;
      default:
        return false;
    }
  }

  /** Apply a saved loadout, but only the effects this species actually owns. */
  private applyPreset(preset: ErShinyLabLoadout): void {
    const cfg = this.config;
    if (!cfg) {
      return;
    }
    for (const cat of CATEGORIES) {
      const id = preset[cat];
      cfg.equipped[cat] = id && cfg.owned[cat].has(id) ? id : null;
    }
    cfg.onChange?.({ ...cfg.equipped }, { ...cfg.params });
    this.rebuildRows();
    this.moveCursorTo(this.cursor);
    this.refreshDetail();
    this.refreshPreview();
    this.refreshChips();
  }

  private enterZone(focus: Focus): void {
    this.focus = focus;
    this.cursorObj.setVisible(focus === "list");
    this.refreshBar();
    this.refreshHint();
    globalScene.ui.playSelect();
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
    this.barContent.removeAll(true);
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
// screen renders on its own (the render harness + an in-game smoke). Real save
// data (per-species owned bitsets, candy, earned tier, the candy ramp) replaces
// this via show([config]) once the P1 persistence layer lands.
// =============================================================================

function eff(
  id: string,
  label: string,
  rarity: ErShinyLabRarity,
  minTier: number,
  cost: number,
  accent: string,
  lockHint?: string,
): ErShinyLabEffect {
  const e: ErShinyLabEffect = { id, label, rarity, minTier, cost, accent };
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
    eff("glacier", "Glacier", "common", 1, 100, "#7fd8ff"),
    eff("obsidian", "Obsidian", "common", 1, 100, "#2a2a3a"),
    eff("crimson", "Crimson", "common", 1, 100, "#ff4a5a"),
    eff("emerald", "Emerald", "common", 1, 140, "#3affa0"),
    eff("sunset", "Sunset", "rare", 1, 180, "#ff8a3d"),
    eff("aurora", "Aurora", "rare", 1, 180, "#5affc0"),
    eff("vaporwave", "Vaporwave", "rare", 1, 220, "#ff77e6"),
    eff("toxic", "Toxic", "rare", 1, 220, "#9bff4a"),
    eff("galaxy", "Galaxy", "epic", 1, 320, "#9b6cff"),
    eff("synthsun", "Synthwave Sun", "epic", 1, 360, "#ff9a3d"),
    eff("aurum", "Aurum", "epic", 1, 400, "#ffcf52"),
    eff("prism", "Prism", "legendary", 1, 500, "#a0e0ff", "win with a different type on every team member"),
  ];
  const surface: ErShinyLabEffect[] = [
    eff("scales", "Scales", "common", 3, 500, "#9fd0ff"),
    eff("marble", "Marble", "common", 3, 500, "#dfe6f2"),
    eff("holofoil", "Holofoil", "rare", 3, 620, "#7fe0ff"),
    eff("oilfilm", "Oil Film", "rare", 3, 620, "#b08bff"),
    eff("electric", "Electric", "rare", 3, 700, "#ffe85a"),
    eff("tron", "Tron Lines", "rare", 3, 700, "#36e6ff"),
    eff("crystal", "Crystal Facets", "epic", 3, 900, "#a6f0ff"),
    eff("plasma", "Plasma", "epic", 3, 900, "#ff6ad9"),
    eff("stained", "Stained Glass", "epic", 3, 980, "#c08bff"),
    eff("sunsetsun", "Sunset Sun", "epic", 3, 980, "#ff8a3d"),
    eff("prismsplit", "Prism Split", "legendary", 3, 1200, "#9ad0ff", "win a Ghost-Trainers run with no faints"),
  ];
  const around: ErShinyLabEffect[] = [
    eff("softhalo", "Soft Halo", "common", 4, 1000, "#9fd0ff"),
    eff("petals", "Petals", "common", 4, 1000, "#ff9ad0"),
    eff("orbiting", "Orbiting Sparks", "rare", 4, 1200, "#7fe0ff"),
    eff("fireflies", "Fireflies", "rare", 4, 1200, "#ffe07a"),
    eff("embers", "Embers", "rare", 4, 1300, "#ff7a3a"),
    eff("frost", "Frost Aura", "rare", 4, 1300, "#a6f0ff"),
    eff("flame", "Flame Aura", "epic", 4, 1600, "#ff7a3a", "win Classic (Ace+) holding no items"),
    eff("golden", "Golden Glow", "epic", 4, 1600, "#ffcf52"),
    eff("shadow", "Shadow Aura", "epic", 4, 1700, "#9b6cff"),
    eff("cursed", "Cursed Aura", "epic", 4, 1700, "#ff4a6a", "win a Ghost-Trainers run with no faints"),
    eff("rainbowout", "Rainbow Outline", "legendary", 4, 2200, "#a0e0ff", "reach wave 50 without taking damage"),
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
    params: { palAmt: 1, surfAmt: 0.8, aroAmt: 1, scale: 1, seed: 42 },
    presets: [{ palette: "galaxy", surface: "holofoil", around: "orbiting" }, null, null, null, null],
  };
}
