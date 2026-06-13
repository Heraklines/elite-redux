/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome Market (#440) - the bespoke every-10-waves shop UI.
//
// A FULL-SCREEN, distinct-from-the-wave-shop screen (design doc §1):
//   - full-screen BW market backdrop
//   - a per-biome shopkeeper sprite on the left third
//   - a "<BIOME> MARKET" banner + greeting up top, money top-right
//   - a 4x4 GRID (16 slots) of item icons + prices with a starter-grid-style
//     cursor. The whole screen is stock - no "one row of heals + reward row".
//
// All purchase / party-target / money plumbing is REUSED from
// SelectModifierPhase (BiomeShopPhase subclasses it); this handler is pure
// presentation + cursor + a buy/leave callback. Staging-gated by the phase.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_BIOME_SHOP_SLOTS } from "#data/elite-redux/er-biome-economy";
import type { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { ModifierOption } from "#ui/modifier-select-ui-handler";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { formatMoney, getBiomeName } from "#utils/common";

/** Buy a slot (index) or leave the shop (index < 0). */
export type BiomeShopSelectCallback = (index: number) => boolean;

const GRID_COLS = 4;

export class BiomeShopUiHandler extends UiHandler {
  private shopContainer: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private keeper: Phaser.GameObjects.Image;
  private bannerText: Phaser.GameObjects.Text;
  private greetingText: Phaser.GameObjects.Text;
  private moneyText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Rectangle;

  private cells: ModifierOption[] = [];
  private options: ModifierTypeOption[] = [];
  private onSelect: BiomeShopSelectCallback | null = null;

  // Grid geometry, in the 320x180 logical screen (right two-thirds).
  private readonly colStep = 52;
  private readonly rowStep = 33;
  private readonly gridX = 128;
  private readonly gridY = 54;

  constructor() {
    super(UiMode.BIOME_SHOP);
  }

  setup(): void {
    const ui = this.getUi();
    const screenW = globalScene.scaledCanvas.width;
    const screenH = globalScene.scaledCanvas.height;

    // Container origin sits at the top-left of the visible screen (matches the
    // egg-gacha screen convention: child (0,0) == screen top-left).
    this.shopContainer = globalScene.add.container(0, -screenH);
    this.shopContainer.setVisible(false);
    ui.add(this.shopContainer);

    this.bg = globalScene.add.image(0, 0, "er_biome_shop_bg").setOrigin(0, 0);
    this.bg.setDisplaySize(screenW, screenH);
    this.shopContainer.add(this.bg);

    this.keeper = globalScene.add.image(46, screenH - 26, "er_biome_shop_keeper_00").setOrigin(0.5, 1);
    this.shopContainer.add(this.keeper);

    this.bannerText = addTextObject(214, 6, "", TextStyle.WINDOW, { fontSize: "96px" });
    this.bannerText.setOrigin(0.5, 0);
    this.shopContainer.add(this.bannerText);

    this.greetingText = addTextObject(214, 26, "", TextStyle.PARTY, { fontSize: "48px" });
    this.greetingText.setOrigin(0.5, 0);
    this.shopContainer.add(this.greetingText);

    this.moneyText = addTextObject(screenW - 4, 6, "", TextStyle.MONEY);
    this.moneyText.setOrigin(1, 0);
    this.shopContainer.add(this.moneyText);

    this.cursorObj = globalScene.add.rectangle(0, 0, 46, 40, 0xffffff, 0);
    this.cursorObj.setStrokeStyle(1.5, 0xffe070);
    this.cursorObj.setOrigin(0.5);
    this.cursorObj.setVisible(false);
    this.shopContainer.add(this.cursorObj);
  }

  show(args: any[]): boolean {
    // Full (re)build when handed fresh data: [options, biome, callback].
    if (args.length >= 3 && Array.isArray(args[0]) && typeof args[2] === "function") {
      this.options = args[0] as ModifierTypeOption[];
      const biome = args[1] as BiomeId;
      this.onSelect = args[2] as BiomeShopSelectCallback;

      this.bannerText.setText(`${getBiomeName(biome)} Market`.toUpperCase());
      this.greetingText.setText("Take a look at my wares!");
      this.setKeeper(biome);
      this.buildGrid();
      this.cursor = 0;
      this.moveCursorTo(0);
      this.refreshMoneyAndAffordability();

      this.shopContainer.setVisible(true);
      this.active = true;
      return true;
    }

    // Re-shown after a party-target purchase: just refresh money + dims.
    this.shopContainer.setVisible(true);
    this.active = true;
    this.refreshMoneyAndAffordability();
    return true;
  }

  /** Cast the per-biome shopkeeper from the 16 BW sprites (deterministic). */
  private setKeeper(biome: BiomeId): void {
    const idx = (((biome as number) % 16) + 16) % 16;
    const key = `er_biome_shop_keeper_${idx.toString().padStart(2, "0")}`;
    if (globalScene.textures.exists(key)) {
      this.keeper.setTexture(key);
    }
    this.keeper.setVisible(globalScene.textures.exists(this.keeper.texture.key));
    // Keep the keeper within the left third (cap display height).
    const h = this.keeper.height || 1;
    const maxH = 96;
    this.keeper.setScale(h > maxH ? maxH / h : 1);
  }

  private buildGrid(): void {
    for (const cell of this.cells) {
      cell.destroy();
    }
    this.cells = [];
    for (let i = 0; i < this.options.length && i < ER_BIOME_SHOP_SLOTS; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cell = new ModifierOption(
        this.gridX + col * this.colStep,
        this.gridY + row * this.rowStep,
        this.options[i],
      );
      cell.setScale(0.5);
      globalScene.add.existing(cell);
      cell.revealInstant();
      this.shopContainer.add(cell);
      this.cells.push(cell);
    }
  }

  private moveCursorTo(index: number): void {
    if (this.cells.length === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    const i = Math.max(0, Math.min(index, this.cells.length - 1));
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    this.cursorObj.setPosition(this.gridX + col * this.colStep, this.gridY + row * this.rowStep + 6);
    this.cursorObj.setVisible(true);
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  /** Refresh the money readout and dim slots the player cannot afford. */
  private refreshMoneyAndAffordability(): void {
    this.moneyText.setText(formatMoney(globalScene.moneyFormat, globalScene.money));
    for (let i = 0; i < this.cells.length; i++) {
      const cost = this.options[i]?.cost ?? 0;
      this.cells[i].setAlpha(globalScene.money >= cost ? 1 : 0.45);
    }
  }

  /** Called by SelectModifierPhase.applyModifier after a purchase. */
  updateCostText(): void {
    this.refreshMoneyAndAffordability();
  }

  processInput(button: Button): boolean {
    let success = false;
    const count = this.cells.length;

    switch (button) {
      case Button.ACTION:
        if (count > 0 && this.cursor < count && this.onSelect) {
          this.onSelect(this.cursor);
          success = true;
        }
        break;
      case Button.CANCEL:
        if (this.onSelect) {
          this.onSelect(-1);
          success = true;
        }
        break;
      case Button.UP:
        if (this.cursor - GRID_COLS >= 0) {
          success = this.setCursor(this.cursor - GRID_COLS);
        }
        break;
      case Button.DOWN:
        if (this.cursor + GRID_COLS < count) {
          success = this.setCursor(this.cursor + GRID_COLS);
        }
        break;
      case Button.LEFT:
        if (this.cursor % GRID_COLS > 0) {
          success = this.setCursor(this.cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (this.cursor % GRID_COLS < GRID_COLS - 1 && this.cursor + 1 < count) {
          success = this.setCursor(this.cursor + 1);
        }
        break;
    }

    if (
      success
      && (button === Button.UP || button === Button.DOWN || button === Button.LEFT || button === Button.RIGHT)
    ) {
      globalScene.playSound("se/select");
    }
    return success;
  }

  clear(): void {
    super.clear();
    this.shopContainer.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const cell of this.cells) {
      cell.destroy();
    }
    this.cells = [];
    this.options = [];
    this.onSelect = null;
  }
}
