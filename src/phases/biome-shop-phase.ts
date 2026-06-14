/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome Market (#440) - the every-10-waves shop phase.
//
// Subclasses SelectModifierPhase to REUSE all of its purchase + party-target +
// money plumbing (applyChosenModifier / openModifierMenu / applyModifier), but
// presents the stock through the bespoke full-screen BiomeShopUiHandler (a 4x4
// grid) instead of the vanilla reward row. Keeps phaseName "SelectModifierPhase"
// (inherited) on purpose: the party UI special-cases `.is("SelectModifierPhase")`
// during item assignment, and this IS a select-modifier flow. Pushed as an
// instance (pushPhase) so it needs no PHASES registration.
//
// Buying stays open (a shop purchase returns cost !== -1 -> the handler is
// re-shown), so the player buys as much as they can afford; B leaves.
// Staging-gated by victory-phase (only pushed on x0 boss waves there).
// =============================================================================

import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { erBiomeStockCount } from "#data/elite-redux/er-biome-economy";
import { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import { HealShopCostModifier } from "#modifiers/modifier";
import type { ModifierTypeOption, PokemonModifierType } from "#modifiers/modifier-type";
import { getPlayerShopModifierTypeOptionsForWave } from "#modifiers/modifier-type";
import type { ModifierSelectCallback } from "#phases/select-modifier-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { NumberHolder } from "#utils/common";

export class BiomeShopPhase extends SelectModifierPhase {
  private shopOptions: ModifierTypeOption[] = [];
  /** Remaining stock per slot (rarer items stock fewer; see erBiomeStockCount). */
  private qtys: number[] = [];
  /** Slot index awaiting a purchase result, so applyModifier can decrement it. */
  private pendingIndex = -1;

  /** The biome market re-appears (not the vanilla reward screen) after the
   * party-target menu closes on a held-item / TM purchase. */
  protected override getModifierSelectMode(): UiMode {
    return UiMode.BIOME_SHOP;
  }

  override start(): false | undefined {
    // NOTE: intentionally does NOT call super.start() - that builds the vanilla
    // reward options + opens MODIFIER_SELECT. We build the biome stock instead.
    if (!this.isPlayer()) {
      this.end();
      return false;
    }

    const waveIndex = globalScene.currentBattle.waveIndex;
    const baseCost = new NumberHolder(globalScene.getWaveMoneyAmount(1));
    globalScene.applyModifier(HealShopCostModifier, true, baseCost);
    // Same hook the reward screen used: on x0 waves this returns the 16-slot
    // biome market stock (see getPlayerShopModifierTypeOptionsForWave).
    this.shopOptions = getPlayerShopModifierTypeOptionsForWave(waveIndex, baseCost.value);
    if (this.shopOptions.length === 0) {
      this.end();
      return;
    }
    // Stock count per slot by the item's rarity tier (rarer = scarcer).
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT));

    this.openBiomeShop();
    return;
  }

  private openBiomeShop(): void {
    globalScene.ui.setMode(
      UiMode.BIOME_SHOP,
      this.shopOptions,
      globalScene.arena.biomeId,
      (index: number) => this.onSelect(index),
      this.qtys,
    );
  }

  /** Buy slot `index`, or leave the shop when `index < 0`. */
  private onSelect(index: number): boolean {
    if (index < 0) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
      return true;
    }
    const option = this.shopOptions[index];
    if (!option) {
      return false;
    }
    if ((this.qtys[index] ?? 0) <= 0) {
      // Sold out - rarer items stock fewer copies.
      globalScene.ui.playError();
      return false;
    }
    const cost = option.cost;
    if (globalScene.money < cost && !Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.ui.playError();
      return false;
    }
    // Reuse the proven purchase plumbing: non-targeted items apply directly;
    // held items / TMs / candies open the party menu, then return to the
    // BIOME_SHOP mode (via getModifierSelectMode) and the shop stays open.
    // Remember the slot so applyModifier can decrement its stock on success.
    this.pendingIndex = index;
    const noop: ModifierSelectCallback = () => false;
    return this.applyChosenModifier(option.type, cost, noop);
  }

  /**
   * After a confirmed purchase (cost !== -1), decrement that slot's stock and
   * refresh the grid. The party-CANCEL path goes through resetModifierSelect
   * (no applyModifier), so cancelling never consumes stock.
   */
  protected override applyModifier(modifier: Modifier, cost = -1, playSound = false): void {
    super.applyModifier(modifier, cost, playSound);
    if (cost !== -1 && this.pendingIndex >= 0 && this.pendingIndex < this.qtys.length) {
      this.qtys[this.pendingIndex] = Math.max(0, this.qtys[this.pendingIndex] - 1);
      const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
      handler.setStock?.(this.pendingIndex, this.qtys[this.pendingIndex]);
      this.pendingIndex = -1;
    }
  }

  /** Re-show the market after the party-target menu is cancelled. */
  protected override resetModifierSelect(_modifierSelectCallback: ModifierSelectCallback): void {
    this.openBiomeShop();
  }

  /**
   * Held items / TMs / candies open a party target-picker. The base does this
   * with setModeWithoutClear (no clear()), so our opaque full-screen shop would
   * stay drawn ON TOP of the picker and read as a freeze. Hide the shop first;
   * the handler's show() / openBiomeShop() re-reveals it when the shop regains
   * focus (after a buy or a cancel).
   */
  protected override openModifierMenu(
    modifierType: PokemonModifierType,
    cost: number,
    cb: ModifierSelectCallback,
  ): void {
    this.hideShopForOverlay();
    super.openModifierMenu(modifierType, cost, cb);
  }

  protected override openFusionMenu(modifierType: PokemonModifierType, cost: number, cb: ModifierSelectCallback): void {
    this.hideShopForOverlay();
    super.openFusionMenu(modifierType, cost, cb);
  }

  private hideShopForOverlay(): void {
    const handler = globalScene.ui.getHandler() as { hideForOverlay?: () => void };
    handler.hideForOverlay?.();
  }
}
