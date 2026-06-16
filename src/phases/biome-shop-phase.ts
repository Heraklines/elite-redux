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
import i18next from "i18next";

export class BiomeShopPhase extends SelectModifierPhase {
  /** The shop stock. `protected` so event-specific shops (e.g. ExoticShopPhase)
   * can override buildStock() to supply their own curated goods. */
  protected shopOptions: ModifierTypeOption[] = [];
  /** Remaining stock per slot (rarer items stock fewer; see erBiomeStockCount). */
  protected qtys: number[] = [];
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

    this.buildStock();
    if (this.shopOptions.length === 0) {
      this.end();
      return;
    }
    this.openBiomeShop();
    return;
  }

  /**
   * Populate this.shopOptions + this.qtys. Default = the every-10-wave biome
   * market (the 16-slot biome stock). Event-specific shops override this to
   * supply their own curated goods (see ExoticShopPhase).
   */
  protected buildStock(): void {
    const waveIndex = globalScene.currentBattle.waveIndex;
    const baseCost = new NumberHolder(globalScene.getWaveMoneyAmount(1));
    globalScene.applyModifier(HealShopCostModifier, true, baseCost);
    // Same hook the reward screen used: on x0 waves this returns the 16-slot
    // biome market stock (see getPlayerShopModifierTypeOptionsForWave).
    this.shopOptions = getPlayerShopModifierTypeOptionsForWave(waveIndex, baseCost.value, /* forBiomeShop */ true);
    // Stock count per slot by the item's rarity tier (rarer = scarcer).
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT));
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
      this.confirmLeave();
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
   * Cancel out of the market asks for confirmation first (mirrors the reward
   * screen's "skip taking an item" Yes/No). Players run at high speed and spam
   * the Cancel button to skip dialogue, so a bare B-to-leave was getting them
   * out of the shop by accident; the confirm prompt protects against that.
   */
  private confirmLeave(): void {
    // The market backdrop is opaque and full-screen, so leaving it drawn would
    // cover the question text + the Yes/No box. Hide it for the prompt (the same
    // trick the held-item party overlay uses); "No" re-opens it.
    this.hideShopForOverlay();
    globalScene.ui.showText(i18next.t("battle:leaveShopQuestion"), null, () => {
      globalScene.ui.setOverlayMode(
        UiMode.CONFIRM,
        () => {
          // YES: pop the confirm, drop the prompt, hand off to the next phase.
          globalScene.ui.revertMode();
          globalScene.ui.clearText();
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
        },
        () => {
          // NO: drop the prompt and re-show the market (setMode out of CONFIRM
          // rebuilds + re-reveals the hidden shop).
          globalScene.ui.clearText();
          this.openBiomeShop();
        },
      );
    });
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
