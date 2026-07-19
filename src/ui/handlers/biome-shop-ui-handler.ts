/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome Market (#440) - the bespoke every-10-waves shop UI.
//
// Full-screen, distinct-from-the-wave-shop screen (design doc §1):
//   - clean default_bg panel + a framed grid window (the ROM backdrop rip was
//     a garbage placeholder, so we use the game's own UI art)
//   - a real PokeRogue trainer-class sprite as the per-biome shopkeeper (left)
//   - a "<BIOME> MARKET" banner + the focused item's name + money up top
//   - a 4x4 GRID (16 slots): each cell is an item icon + price (compact, no
//     per-cell name, so labels never collide); the focused item's full name is
//     shown once in the header.
//
// All purchase / party-target / money plumbing is REUSED from
// SelectModifierPhase (BiomeShopPhase subclasses it); this handler is pure
// presentation + cursor + a buy/leave callback. Staging-gated by the phase.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_BIOME_SHOP_SLOTS } from "#data/elite-redux/er-biome-economy";
import { addItemIconSprite } from "#data/elite-redux/er-item-icon";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { Device } from "#enums/devices";
import { PlayerGender } from "#enums/player-gender";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { SettingKeyboard } from "#system/settings-keyboard";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { formatMoney, getBiomeName } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Prefix an amount with the in-game money symbol. */
function money(amount: number): string {
  return `₽${formatMoney(globalScene.moneyFormat, amount)}`;
}

/** Buy a slot (index) or leave the shop (index < 0). */
export type BiomeShopSelectCallback = (index: number) => boolean;

const GRID_COLS = 4;

// Layout in the 320x180 logical screen (container sits at the screen top-left,
// matching the egg-gacha convention: child (0,0) == screen top-left).
const COL_STEP = 52;
const ROW_STEP = 26;
const GRID_X = 124; // centre of the first column
const GRID_Y = 50; // centre of the first row
const KEEPER_X = 46;

const DEFAULT_KEEPER = "clerk_m";

/**
 * Per-biome shopkeeper, cast from real PokeRogue trainer-class sprites to fit
 * each biome's flavor (a clerk runs the town mart, a fisherman the dockside
 * stall, a firebreather the volcano forge, a hex maniac the graveyard curio
 * shop, etc.). Every distinct sprite used here is preloaded in loading-scene.
 */
export const KEEPER_BY_BIOME: Partial<Record<BiomeId, string>> = {
  // Towns & open country - a homey baker stall / general-store clerks / florists.
  [BiomeId.TOWN]: "baker",
  [BiomeId.PLAINS]: "clerk_f",
  [BiomeId.METROPOLIS]: "clerk_m_2",
  [BiomeId.GRASS]: "aroma_lady",
  [BiomeId.TALL_GRASS]: "ranger_m",
  [BiomeId.MEADOW]: "aroma_lady",
  // Water - dockside stalls.
  [BiomeId.SEA]: "fisherman",
  [BiomeId.BEACH]: "sailor",
  [BiomeId.LAKE]: "fisherman",
  [BiomeId.SEABED]: "scuba_diver_m",
  [BiomeId.ISLAND]: "sailor",
  [BiomeId.SWAMP]: "fisherman",
  // Rugged terrain - trail posts / caravans.
  [BiomeId.MOUNTAIN]: "hiker",
  [BiomeId.CAVE]: "hiker",
  [BiomeId.BADLANDS]: "worker_m",
  [BiomeId.DESERT]: "backpacker_m",
  [BiomeId.WASTELAND]: "veteran_m",
  // Cold.
  [BiomeId.ICE_CAVE]: "parasol_lady",
  [BiomeId.SNOWY_FOREST]: "snow_worker_m",
  // Woods.
  [BiomeId.FOREST]: "ranger_f",
  [BiomeId.JUNGLE]: "ranger_m",
  // Industrial / tech - workers & scientists.
  [BiomeId.POWER_PLANT]: "scientist_m",
  [BiomeId.FACTORY]: "worker_f",
  [BiomeId.LABORATORY]: "scientist_f",
  [BiomeId.CONSTRUCTION_SITE]: "worker_m",
  [BiomeId.SPACE]: "scientist_m",
  // Heat & training.
  [BiomeId.VOLCANO]: "firebreather",
  [BiomeId.DOJO]: "black_belt_m",
  // Eerie - curio shops.
  [BiomeId.GRAVEYARD]: "hex_maniac",
  [BiomeId.RUINS]: "ruin_maniac",
  [BiomeId.TEMPLE]: "hex_maniac",
  [BiomeId.FAIRY_CAVE]: "fairy_tale_girl",
  [BiomeId.SLUM]: "roughneck",
};

/** The distinct shopkeeper sprites used above (preloaded in loading-scene). */
export const ER_BIOME_SHOP_KEEPERS = [
  "baker",
  "clerk_m",
  "clerk_f",
  "clerk_m_2",
  "aroma_lady",
  "ranger_m",
  "ranger_f",
  "fisherman",
  "sailor",
  "scuba_diver_m",
  "hiker",
  "worker_m",
  "worker_f",
  "backpacker_m",
  "veteran_m",
  "parasol_lady",
  "snow_worker_m",
  "scientist_m",
  "scientist_f",
  "firebreather",
  "black_belt_m",
  "hex_maniac",
  "ruin_maniac",
  "fairy_tale_girl",
  "roughneck",
];

/**
 * Some biomes use a POKEMON as the shopkeeper instead of a trainer (rendered
 * from the dex-icon atlas). Space gets a Clefairy (cosmic companion); Cave gets
 * a Kecleon, the classic PMD dungeon shopkeeper. Takes priority over the trainer
 * map in setKeeper.
 */
export const POKEMON_KEEPER_BY_BIOME: Partial<Record<BiomeId, SpeciesId>> = {
  [BiomeId.SPACE]: SpeciesId.CLEFAIRY,
  [BiomeId.CAVE]: SpeciesId.KECLEON,
};

/**
 * The shop's TYPE word per biome - it isn't always a "Market". A desert is a
 * caravan, a graveyard the local shaman, a slum a black market, a volcano a
 * forge, etc. Shown in the banner as "<BIOME> <TYPE>". Default "Market".
 */
export const SHOP_TYPE_BY_BIOME: Partial<Record<BiomeId, string>> = {
  [BiomeId.DESERT]: "Caravan",
  [BiomeId.WASTELAND]: "Scavenger",
  [BiomeId.SLUM]: "Black Market",
  [BiomeId.METROPOLIS]: "Department",
  [BiomeId.SEA]: "Dock Stall",
  [BiomeId.BEACH]: "Dock Stall",
  [BiomeId.SEABED]: "Diver's Hold",
  [BiomeId.ISLAND]: "Dock Stall",
  [BiomeId.MOUNTAIN]: "Trail Post",
  [BiomeId.CAVE]: "Trail Post",
  [BiomeId.BADLANDS]: "Trail Post",
  [BiomeId.VOLCANO]: "Forge",
  [BiomeId.DOJO]: "Training Goods",
  [BiomeId.ICE_CAVE]: "Warm Stand",
  [BiomeId.SNOWY_FOREST]: "Warm Stand",
  [BiomeId.POWER_PLANT]: "Tech Counter",
  [BiomeId.FACTORY]: "Tech Counter",
  [BiomeId.LABORATORY]: "Tech Counter",
  [BiomeId.SPACE]: "Observatory Kiosk",
  [BiomeId.GRAVEYARD]: "Shaman",
  [BiomeId.TEMPLE]: "Shrine",
  [BiomeId.RUINS]: "Relic Stall",
  [BiomeId.FAIRY_CAVE]: "Sweets Shop",
  [BiomeId.FOREST]: "Field Supplies",
  [BiomeId.JUNGLE]: "Field Supplies",
  [BiomeId.SWAMP]: "Bog Trader",
};

export class BiomeShopUiHandler extends UiHandler {
  private shopContainer: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private bgOverlay: Phaser.GameObjects.Rectangle;
  private gridWindow: Phaser.GameObjects.NineSlice;
  private keeper: Phaser.GameObjects.Sprite;
  private playerBack: Phaser.GameObjects.Sprite;
  private bannerText: Phaser.GameObjects.Text;
  private itemNameText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private moneyText: Phaser.GameObjects.Text;
  private leaveText: Phaser.GameObjects.Text;
  private leaveIcon: Phaser.GameObjects.Sprite;
  private cursorObj: Phaser.GameObjects.Rectangle;

  /** One {icon, price, qty} trio per stocked slot. */
  private cells: { icon: Phaser.GameObjects.Sprite; price: Phaser.GameObjects.Text; qty: Phaser.GameObjects.Text }[] =
    [];
  private options: ModifierTypeOption[] = [];
  private qtys: number[] = [];
  private onSelect: BiomeShopSelectCallback | null = null;

  /** Remaining stock of the slot at `index` (clamped >= 0). */
  getStock(index: number): number {
    return this.qtys[index] ?? 0;
  }

  /** Set remaining stock of a slot (called by the phase after a purchase). */
  setStock(index: number, remaining: number): void {
    this.qtys[index] = Math.max(0, remaining);
    this.refresh();
  }

  constructor() {
    super(UiMode.BIOME_SHOP);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.shopContainer = globalScene.add.container(0, -h);
    this.shopContainer.setVisible(false);
    ui.add(this.shopContainer);

    // Backdrop: the ACTUAL biome scenery, exactly as it looks during play (the
    // bg already loaded for this wave's arena), set per-biome in show(). Only a
    // very light dimming so it reads as the live biome, not a darkened panel -
    // the grid window already darkens the item area for readability.
    // Falls back to the game's default_bg panel if a biome bg is missing.
    this.bg = globalScene.add.image(0, 0, "default_bg").setOrigin(0);
    this.bg.setDisplaySize(w, h);
    this.shopContainer.add(this.bg);

    this.bgOverlay = globalScene.add.rectangle(0, 0, w, h, 0x10101c, 0.12).setOrigin(0);
    this.shopContainer.add(this.bgOverlay);

    // Framed shelf window for the item grid (right two thirds).
    this.gridWindow = addWindow(96, 20, w - 98, 150);
    this.shopContainer.add(this.gridWindow);

    // Shopkeeper (behind the counter, upper-left) + the player's BACK sprite in
    // the foreground (lower-left), facing the keeper - a proper shop scene.
    this.keeper = globalScene.add.sprite(KEEPER_X - 6, h - 22, "clerk_m");
    this.keeper.setOrigin(0.5, 1);
    this.shopContainer.add(this.keeper);

    this.playerBack = globalScene.add.sprite(KEEPER_X + 30, h + 6, "trainer_m_back");
    this.playerBack.setOrigin(0.5, 1);
    this.playerBack.setScale(0.7);
    this.shopContainer.add(this.playerBack);

    this.bannerText = addTextObject(208, 4, "", TextStyle.WINDOW, { fontSize: "84px" });
    this.bannerText.setOrigin(0.5, 0);
    this.shopContainer.add(this.bannerText);

    this.itemNameText = addTextObject(208, 22, "", TextStyle.PARTY, { fontSize: "54px" });
    this.itemNameText.setOrigin(0.5, 0);
    this.shopContainer.add(this.itemNameText);

    // Focused item's description, wrapped, just under the grid.
    this.descText = addTextObject(208, 150, "", TextStyle.PARTY, {
      fontSize: "40px",
      align: "center",
      wordWrap: { width: (w - 110) * 6 },
    });
    this.descText.setOrigin(0.5, 0);
    this.shopContainer.add(this.descText);

    this.moneyText = addTextObject(w - 4, 4, "", TextStyle.MONEY);
    this.moneyText.setOrigin(1, 0);
    this.shopContainer.add(this.moneyText);

    // "<button>: Leave" hint. The button glyph is resolved to the player's
    // actual Cancel binding (keyboard key or gamepad face button) in
    // updateLeaveHint(), refreshed each show() so a rebind / device swap shows
    // the right key instead of a hardcoded "B".
    this.leaveText = addTextObject(w - 4, h - 6, "Leave", TextStyle.PARTY, { fontSize: "42px" });
    this.leaveText.setOrigin(0, 1);
    this.shopContainer.add(this.leaveText);

    this.leaveIcon = globalScene.add.sprite(0, h - 6, "keyboard", "X.png");
    this.leaveIcon.setOrigin(1, 1).setScale(0.6);
    this.shopContainer.add(this.leaveIcon);

    this.cursorObj = globalScene.add.rectangle(0, 0, 44, 26, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(1, 0xf8d030);
    this.cursorObj.setOrigin(0.5);
    this.cursorObj.setVisible(false);
    this.shopContainer.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    if (args.length >= 3 && Array.isArray(args[0]) && typeof args[2] === "function") {
      this.options = args[0] as ModifierTypeOption[];
      const biome = args[1] as BiomeId;
      this.onSelect = args[2] as BiomeShopSelectCallback;
      this.qtys = (args[3] as number[]) ?? this.options.map(() => 1);

      const shopType = SHOP_TYPE_BY_BIOME[biome] ?? "Market";
      this.bannerText.setText(`${getBiomeName(biome)} ${shopType}`.toUpperCase());
      this.setBackground(biome);
      this.setKeeper(biome);
      this.setPlayer();
      this.buildGrid();
      this.cursor = 0;
      this.moveCursorTo(0);
      this.refresh();
      this.updateLeaveHint();

      this.shopContainer.setVisible(true);
      this.active = true;
      return true;
    }

    // Re-shown after a party-target purchase (the shop was hidden via
    // hideForOverlay while the party menu was up): restore the cursor + refresh
    // money/affordability/stock.
    this.shopContainer.setVisible(true);
    this.active = true;
    this.moveCursorTo(this.cursor);
    this.refresh();
    this.updateLeaveHint();
    return true;
  }

  /**
   * Resolve the "Leave" hint glyph to the player's CURRENT Cancel binding
   * (last-used device + remaps), mirroring CommandUiHandler.updateInfoHint, and
   * right-align the [glyph] Leave pair to the bottom-right corner. Falls back to
   * the keyboard atlas for touch (no separate touch glyph for Cancel).
   */
  private updateLeaveHint(): void {
    let gamepadType: string;
    if (globalScene.inputMethod === "gamepad") {
      const device = globalScene.inputController.selectedDevice[Device.GAMEPAD];
      gamepadType = device == null ? "keyboard" : globalScene.inputController.getConfig(device).padType;
    } else {
      gamepadType = globalScene.inputMethod;
    }
    let iconPath: string | undefined;
    if (gamepadType === "touch") {
      gamepadType = "keyboard";
      iconPath = "X.png";
    } else {
      iconPath = globalScene.inputController?.getIconForLatestInputRecorded(SettingKeyboard.BUTTON_CANCEL);
    }
    if (gamepadType && iconPath) {
      this.leaveIcon.setTexture(gamepadType, iconPath).setVisible(true);
    }
    const textX = globalScene.scaledCanvas.width - 4 - this.leaveText.displayWidth;
    this.leaveText.setX(textX);
    this.leaveIcon.setX(textX - 2);
  }

  /** Use the live biome scenery as the backdrop; fall back to default_bg. */
  private setBackground(biome: BiomeId): void {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const biomeKey = `${getBiomeKey(biome)}_bg`;
    const key = globalScene.textures.exists(biomeKey) ? biomeKey : "default_bg";
    this.bg.setTexture(key);
    this.bg.setDisplaySize(w, h);
  }

  /** Show the player's BACK sprite (gender-matched) in the shop foreground. */
  private setPlayer(): void {
    const key = globalScene.gameData.gender === PlayerGender.FEMALE ? "trainer_f_back" : "trainer_m_back";
    if (globalScene.textures.exists(key)) {
      this.playerBack.setTexture(key).setFrame(0);
      this.playerBack.setVisible(true);
    } else {
      this.playerBack.setVisible(false);
    }
  }

  private setKeeper(biome: BiomeId): void {
    // Pokemon keeper (Clefairy in Space, Kecleon in caves). Show the always-
    // loaded dex icon immediately (no blank frame), then upgrade to the full
    // battle sprite once its atlas loads. Takes priority over trainers.
    const pkmn = POKEMON_KEEPER_BY_BIOME[biome];
    if (pkmn != null) {
      const species = getPokemonSpecies(pkmn);
      const atlas = species.getIconAtlasKey(0, false, 0);
      const frame = species.getIconId(false, 0, false, 0);
      if (globalScene.textures.exists(atlas)) {
        this.keeper.stop();
        this.keeper.setTexture(atlas, frame).setVisible(true).setScale(2.6);
      }
      this.loadKeeperPokemonSprite(species);
      return;
    }

    const key = KEEPER_BY_BIOME[biome] ?? DEFAULT_KEEPER;
    if (globalScene.textures.exists(key)) {
      this.keeper.stop(); // drop any Pokemon-keeper animation from a prior biome
      this.keeper.setTexture(key).setFrame(0);
      this.keeper.setVisible(true);
      const sh = this.keeper.height || 1;
      const maxH = 120;
      this.keeper.setScale(sh > maxH ? maxH / sh : 1);
    } else {
      this.keeper.setVisible(false);
    }
  }

  /**
   * Upgrade a Pokemon keeper from its dex icon to the FULL battle sprite once
   * its atlas loads (sprites are only loaded on demand, never preloaded for the
   * shop). Async: the icon stands in until this lands. No-ops if the shop has
   * since closed or the atlas failed.
   */
  private loadKeeperPokemonSprite(species: ReturnType<typeof getPokemonSpecies>): void {
    const spriteKey = species.getSpriteKey(false, 0, false, 0);
    species
      // female=false, form 0, non-shiny, variant 0, startLoad, front, spriteOnly
      .loadAssets(false, 0, false, 0, true, false, true)
      .then(() => {
        if (!this.active || !globalScene.textures.exists(spriteKey)) {
          return;
        }
        this.keeper.setTexture(spriteKey).setVisible(true);
        if (globalScene.anims.exists(spriteKey)) {
          this.keeper.play(spriteKey);
        }
        // Fit the full sprite (~96px) into the keeper slot.
        this.keeper.setScale(1);
        const sh = this.keeper.height || 1;
        const maxH = 116;
        this.keeper.setScale(sh > maxH ? maxH / sh : 1);
      })
      .catch(() => {});
  }

  private buildGrid(): void {
    for (const cell of this.cells) {
      cell.icon.destroy();
      cell.price.destroy();
      cell.qty.destroy();
    }
    this.cells = [];
    for (let i = 0; i < this.options.length && i < ER_BIOME_SHOP_SLOTS; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = GRID_X + col * COL_STEP;
      const y = GRID_Y + row * ROW_STEP;
      const type = this.options[i].type;

      // Most items are FRAMES in the "items" atlas, but ER customs (gems, terrain
      // seeds, reactive items) are STANDALONE textures loaded via loadImage. Those
      // aren't frames in the atlas, so addItemIconSprite looks them up as their own
      // texture first - otherwise the atlas-frame lookup misses and every one renders
      // the same placeholder.
      const icon = addItemIconSprite(x, y - 3, type?.iconImage).setScale(0.75);
      if (type?.iconTint != null) {
        icon.setTint(type.iconTint);
      }
      if (type?.iconAlpha != null) {
        icon.setAlpha(type.iconAlpha);
      }
      this.shopContainer.add(icon);

      const price = addTextObject(x, y + 9, money(this.options[i].cost), TextStyle.MONEY, {
        fontSize: "38px",
      });
      price.setOrigin(0.5, 0);
      this.shopContainer.add(price);

      // Remaining stock, top-right of the cell (rarer items stock fewer).
      const qty = addTextObject(x + 20, y - 13, "", TextStyle.PARTY, { fontSize: "38px" });
      qty.setOrigin(1, 0);
      this.shopContainer.add(qty);

      this.cells.push({ icon, price, qty });
    }
  }

  private moveCursorTo(index: number): void {
    if (this.cells.length === 0) {
      this.cursorObj.setVisible(false);
      this.itemNameText.setText("");
      this.descText.setText("");
      return;
    }
    const i = Math.max(0, Math.min(index, this.cells.length - 1));
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    this.cursorObj.setPosition(GRID_X + col * COL_STEP, GRID_Y + row * ROW_STEP + 1);
    this.cursorObj.setVisible(true);
    const type = this.options[i]?.type;
    this.itemNameText.setText(type?.name ?? "");
    this.descText.setText(type?.getDescription() ?? "");
    // The hovered item must pop in full colour against the dark backdrop, so
    // re-style every cell whenever the cursor moves.
    this.restyleCells();
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  /** Refresh the money readout + per-cell visuals. */
  private refresh(): void {
    this.moneyText.setText(money(globalScene.money));
    this.restyleCells();
  }

  /**
   * Per-slot visuals. A slot is "lit" (full colour, no tint) when it is either
   * the HOVERED slot - so you can always read what the cursor is on, even an
   * item you can't afford yet - or an affordable, in-stock slot. Non-hovered
   * slots that are unaffordable or sold out dim so they read as "not buyable
   * now" instead of vanishing into the dark backdrop.
   */
  private restyleCells(): void {
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const remaining = this.qtys[i] ?? 0;
      const affordable = globalScene.money >= (this.options[i]?.cost ?? 0);
      const buyable = affordable && remaining > 0;
      const lit = i === this.cursor || buyable;
      cell.icon.setAlpha(lit ? 1 : 0.35);
      // Full colour on a lit slot: drop any greying tint the modifier type
      // carries for its "unusable" state elsewhere in the UI.
      const tint = this.options[i]?.type?.iconTint;
      if (lit || tint == null) {
        cell.icon.clearTint();
      } else {
        cell.icon.setTint(tint);
      }
      cell.price.setAlpha(lit ? 1 : 0.4);
      cell.qty.setText(remaining > 0 ? `x${remaining}` : "SOLD");
      cell.qty.setAlpha(remaining > 0 && lit ? 1 : 0.55);
    }
  }

  /** Called by SelectModifierPhase.applyModifier after a purchase. */
  updateCostText(): void {
    this.refresh();
  }

  processInput(button: Button): boolean {
    const count = this.cells.length;
    let moved = false;

    switch (button) {
      case Button.ACTION:
        if (count > 0 && this.cursor < count && this.onSelect) {
          this.onSelect(this.cursor);
        }
        return true;
      case Button.CANCEL:
        if (this.onSelect) {
          this.onSelect(-1);
        }
        return true;
      case Button.UP:
        if (this.cursor - GRID_COLS >= 0) {
          moved = this.setCursor(this.cursor - GRID_COLS);
        }
        break;
      case Button.DOWN:
        if (this.cursor + GRID_COLS < count) {
          moved = this.setCursor(this.cursor + GRID_COLS);
        }
        break;
      case Button.LEFT:
        if (this.cursor % GRID_COLS > 0) {
          moved = this.setCursor(this.cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (this.cursor % GRID_COLS < GRID_COLS - 1 && this.cursor + 1 < count) {
          moved = this.setCursor(this.cursor + 1);
        }
        break;
    }

    if (moved) {
      globalScene.ui.playSelect();
    }
    return moved;
  }

  /**
   * Hide the full-screen shop WITHOUT tearing it down, so a menu overlaid via
   * setModeWithoutClear (the party target-picker the buy flow opens for a held
   * item) renders ON TOP instead of behind this opaque overlay - which read as
   * a freeze. Restored by show() / openBiomeShop() when the shop regains focus.
   */
  hideForOverlay(): void {
    this.shopContainer.setVisible(false);
    this.cursorObj.setVisible(false);
    this.active = false;
  }

  clear(): void {
    super.clear();
    this.shopContainer.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const cell of this.cells) {
      cell.icon.destroy();
      cell.price.destroy();
      cell.qty.destroy();
    }
    this.cells = [];
    this.options = [];
    this.qtys = [];
    this.onSelect = null;
  }
}
