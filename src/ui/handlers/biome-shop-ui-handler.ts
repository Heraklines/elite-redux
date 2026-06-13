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
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { formatMoney, getBiomeName } from "#utils/common";

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

/** Per-biome shopkeeper, cast from the preloaded trainer-class sprites. */
const KEEPER_BY_BIOME: Partial<Record<BiomeId, string>> = {
  [BiomeId.SEA]: "fisherman",
  [BiomeId.BEACH]: "fisherman",
  [BiomeId.LAKE]: "fisherman",
  [BiomeId.SEABED]: "fisherman",
  [BiomeId.ISLAND]: "fisherman",
  [BiomeId.SWAMP]: "fisherman",
  [BiomeId.MOUNTAIN]: "hiker",
  [BiomeId.CAVE]: "hiker",
  [BiomeId.BADLANDS]: "hiker",
  [BiomeId.VOLCANO]: "hiker",
  [BiomeId.DESERT]: "backpacker_m",
  [BiomeId.WASTELAND]: "backpacker_m",
  [BiomeId.CONSTRUCTION_SITE]: "backpacker_m",
  [BiomeId.POWER_PLANT]: "backpacker_m",
  [BiomeId.FACTORY]: "backpacker_m",
  [BiomeId.LABORATORY]: "backpacker_m",
  [BiomeId.SPACE]: "backpacker_m",
  [BiomeId.ICE_CAVE]: "parasol_lady",
  [BiomeId.SNOWY_FOREST]: "parasol_lady",
  [BiomeId.FOREST]: "aroma_lady",
  [BiomeId.JUNGLE]: "aroma_lady",
  [BiomeId.TALL_GRASS]: "aroma_lady",
  [BiomeId.GRASS]: "aroma_lady",
  [BiomeId.MEADOW]: "aroma_lady",
  [BiomeId.GRAVEYARD]: "maid",
  [BiomeId.RUINS]: "maid",
  [BiomeId.TEMPLE]: "maid",
  [BiomeId.FAIRY_CAVE]: "maid",
  [BiomeId.METROPOLIS]: "beauty",
  [BiomeId.SLUM]: "beauty",
  [BiomeId.DOJO]: "hiker",
};

export class BiomeShopUiHandler extends UiHandler {
  private shopContainer: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private bgOverlay: Phaser.GameObjects.Rectangle;
  private gridWindow: Phaser.GameObjects.NineSlice;
  private keeper: Phaser.GameObjects.Sprite;
  private bannerText: Phaser.GameObjects.Text;
  private itemNameText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private moneyText: Phaser.GameObjects.Text;
  private leaveText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Rectangle;

  /** One {icon, price} pair per stocked slot. */
  private cells: { icon: Phaser.GameObjects.Sprite; price: Phaser.GameObjects.Text }[] = [];
  private options: ModifierTypeOption[] = [];
  private onSelect: BiomeShopSelectCallback | null = null;

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

    // Backdrop: the ACTUAL biome scenery (the bg already loaded for this wave's
    // arena), set per-biome in show(). A dark overlay keeps text/panel readable.
    // Falls back to the game's default_bg panel if a biome bg is missing.
    this.bg = globalScene.add.image(0, 0, "default_bg").setOrigin(0);
    this.bg.setDisplaySize(w, h);
    this.shopContainer.add(this.bg);

    this.bgOverlay = globalScene.add.rectangle(0, 0, w, h, 0x10101c, 0.4).setOrigin(0);
    this.shopContainer.add(this.bgOverlay);

    // Framed shelf window for the item grid (right two thirds).
    this.gridWindow = addWindow(96, 20, w - 98, 150);
    this.shopContainer.add(this.gridWindow);

    this.keeper = globalScene.add.sprite(KEEPER_X, h - 8, "baker");
    this.keeper.setOrigin(0.5, 1);
    this.shopContainer.add(this.keeper);

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

    this.leaveText = addTextObject(w - 4, h - 6, "B: Leave", TextStyle.PARTY, { fontSize: "42px" });
    this.leaveText.setOrigin(1, 1);
    this.shopContainer.add(this.leaveText);

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

      this.bannerText.setText(`${getBiomeName(biome)} Market`.toUpperCase());
      this.setBackground(biome);
      this.setKeeper(biome);
      this.buildGrid();
      this.cursor = 0;
      this.moveCursorTo(0);
      this.refresh();

      this.shopContainer.setVisible(true);
      this.active = true;
      return true;
    }

    // Re-shown after a party-target purchase: refresh money + affordability.
    this.shopContainer.setVisible(true);
    this.active = true;
    this.refresh();
    return true;
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

  private setKeeper(biome: BiomeId): void {
    const key = KEEPER_BY_BIOME[biome] ?? "baker";
    if (globalScene.textures.exists(key)) {
      this.keeper.setTexture(key).setFrame(0);
      this.keeper.setVisible(true);
      const sh = this.keeper.height || 1;
      const maxH = 120;
      this.keeper.setScale(sh > maxH ? maxH / sh : 1);
    } else {
      this.keeper.setVisible(false);
    }
  }

  private buildGrid(): void {
    for (const cell of this.cells) {
      cell.icon.destroy();
      cell.price.destroy();
    }
    this.cells = [];
    for (let i = 0; i < this.options.length && i < ER_BIOME_SHOP_SLOTS; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = GRID_X + col * COL_STEP;
      const y = GRID_Y + row * ROW_STEP;
      const type = this.options[i].type;

      const icon = globalScene.add.sprite(x, y - 3, "items", type?.iconImage).setScale(0.75);
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

      this.cells.push({ icon, price });
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
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  /** Refresh the money readout + dim unaffordable slots. */
  private refresh(): void {
    this.moneyText.setText(money(globalScene.money));
    for (let i = 0; i < this.cells.length; i++) {
      const affordable = globalScene.money >= (this.options[i]?.cost ?? 0);
      this.cells[i].icon.setAlpha(affordable ? 1 : 0.4);
      this.cells[i].price.setAlpha(affordable ? 1 : 0.4);
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
      globalScene.playSound("se/select");
    }
    return moved;
  }

  clear(): void {
    super.clear();
    this.shopContainer.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const cell of this.cells) {
      cell.icon.destroy();
      cell.price.destroy();
    }
    this.cells = [];
    this.options = [];
    this.onSelect = null;
  }
}
