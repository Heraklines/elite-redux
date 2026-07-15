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
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  awaitCoopChoiceWithOrphanBackstop,
  COOP_BIOME_STOCK_REROLL,
  COOP_BIOME_WAIT_MS,
  COOP_INTERACTION_LEAVE,
  coopBiomeShopSeq,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  adoptRewardWatcherChoice,
  captureCoopRewardOperationBinding,
  commitRewardAuthoritativeResult,
  commitRewardOwnerIntent,
  isCoopRewardOperationEnabled,
  isCoopRewardRetainedResultMode,
} from "#data/elite-redux/coop/coop-reward-operation";
import { reconstructRewardOptions, serializeRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import {
  advanceCoopInteractionForContinuation,
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_SHOP_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { erRecordBiomeShopPurchase, erRecordBlackMarketPurchase } from "#data/elite-redux/er-achievement-detection";
import { erAchvRun } from "#data/elite-redux/er-achievement-run-state";
import { erBiomeStockCount } from "#data/elite-redux/er-biome-economy";
import { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import { HealShopCostModifier } from "#modifiers/modifier";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { getPlayerShopModifierTypeOptionsForWave, PokemonModifierType } from "#modifiers/modifier-type";
import type { ModifierSelectCallback } from "#phases/select-modifier-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { SHOP_TYPE_BY_BIOME } from "#ui/handlers/biome-shop-ui-handler";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

/**
 * #673 TEST KNOB: legacy co-op tests advance x0 waves without driving the (now enabled) co-op
 * market - the GameManager test framework turns this on by default so those runs keep their old
 * "market skipped in co-op" behavior, and market-specific probes turn it back off. Production
 * never touches it (defaults false).
 */
let coopBiomeMarketTestSkip = false;
export function setCoopBiomeMarketTestSkip(on: boolean): void {
  coopBiomeMarketTestSkip = on;
}

export class BiomeShopPhase extends SelectModifierPhase {
  /** The shop stock. `protected` so event-specific shops (e.g. ExoticShopPhase)
   * can override buildStock() to supply their own curated goods. */
  protected shopOptions: ModifierTypeOption[] = [];
  /** Remaining stock per slot (rarer items stock fewer; see erBiomeStockCount). */
  protected qtys: number[] = [];
  /** Slot index awaiting a purchase result, so applyModifier can decrement it. */
  private pendingIndex = -1;

  /** Co-op (#673): the alternation counter pinned when this market opened (-1 = solo). */
  private coopBiomeStart = -1;
  /** Co-op (#673): true when THIS client drives the market (relays each buy + the leave) - the PICK axis. */
  private coopBiomeOwner = false;
  /**
   * Co-op (#832, audit P1#5): the OPTION axis, distinct from the PICK axis {@linkcode coopBiomeOwner}.
   * True when THIS client rolls the stock + streams it; false when it ADOPTS the streamed stock. For a
   * wave market the option axis == the pick axis (the counter-parity owner rolls). Inside an authoritative
   * mystery encounter it SPLITS: the HOST is always the option owner (only it runs the real curated
   * Exotic / Black-Market / Import subclass; the guest opens a plain BiomeShopPhase that cannot rebuild that
   * stock), even when the GUEST owns the ME pick - mirrors SelectModifierPhase's #828 option/pick split.
   */
  private coopBiomeOptionOwner = false;
  /** Invalidates callbacks retained by an older CONFIRM handler on this same phase instance. */
  private coopConfirmAttempt = 0;
  private coopTerminalPromise: Promise<boolean> | null = null;
  // coopPendingAuthorityOperationId is inherited (now `protected`) from SelectModifierPhase - the same
  // runtime slot the base's applyModifier commits; a same-name private redeclaration here was TS2415.
  /**
   * Co-op (#866): true when THIS phase is a move-learn CONTINUATION copy (queued by
   * {@linkcode SelectModifierPhase.applyModifier} when a TM / Memory Mushroom / Learner's Shroom /
   * Ability Capsule is bought - the "escape the move-learn -> return to the shop" handler, #25). Such a
   * copy re-opens the SAME biome grid on the ALREADY-pinned interaction, so it must NOT re-run the open
   * handshake (re-roll + re-stream the stock, or spawn a SECOND watcher loop for the seq the live
   * watcher already owns). Carried by the overridden {@linkcode copy}.
   */
  private coopBiomeContinuation = false;

  /** The biome market re-appears (not the vanilla reward screen) after the
   * party-target menu closes on a held-item / TM purchase. */
  protected override getModifierSelectMode(): UiMode {
    return UiMode.BIOME_SHOP;
  }

  /** Ability sub-pickers inherit the biome market's real pin/owner axis, not the unused base reward pin. */
  public override coopAbilityContext(): { seq: number; watcher: boolean } {
    const inCoop = globalScene.gameMode.isCoop && getCoopController() != null;
    return inCoop ? { seq: this.coopBiomeStart, watcher: !this.coopBiomeOwner } : { seq: -1, watcher: false };
  }

  /**
   * Co-op (#866): a biome-market move-learn CONTINUATION copy must be the SAME phase type (re-opening
   * the biome grid, not the vanilla reward row) AND carry the biome interaction PIN. The inherited
   * {@linkcode SelectModifierPhase.copy} instead created a plain `SelectModifierPhase` and copied
   * `coopInteractionStart` (which the biome market never pins - it pins {@linkcode coopBiomeStart}),
   * yielding an UNPINNED, wrong-typed orphan: its terminal fired an asymmetric #837 "advance interaction
   * SKIP unpinned" (never advancing the partner) and it opened a stray reward screen the watcher never
   * mirrored - the wave-10 owner/watcher handshake stall. Build our OWN class, carrying the pin + roles +
   * already-rolled stock, and mark it a continuation so {@linkcode start} re-opens WITHOUT re-handshaking.
   */
  override copy(): SelectModifierPhase {
    const Ctor = this.constructor as new () => BiomeShopPhase;
    const copied = new Ctor();
    copied.shopOptions = this.shopOptions;
    copied.qtys = this.qtys;
    copied.coopBiomeStart = this.coopBiomeStart;
    copied.coopBiomeOwner = this.coopBiomeOwner;
    copied.coopBiomeOptionOwner = this.coopBiomeOptionOwner;
    copied.coopBiomeContinuation = true;
    copied.coopRewardOperationBinding = this.coopRewardOperationBinding;
    return copied;
  }

  override start(): false | undefined {
    // NOTE: intentionally does NOT call super.start() - that builds the vanilla
    // reward options + opens MODIFIER_SELECT. We build the biome stock instead.
    if (!this.isPlayer()) {
      this.end();
      return false;
    }

    // Co-op (#673, replaces the old self-skip): the market ALTERNATES like the reward shop.
    // The interaction OWNER (counter parity, pinned at open) drives the real screen; every
    // committed buy relays SELF-DESCRIBING data (slot into the owner-streamed stock + target
    // party slot + resulting money) so the WATCHER applies it verbatim - no stock-determinism
    // assumption, no independent screens, one shared money pool. Solo / non-coop untouched.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (coopController != null && this.coopRewardOperationBinding == null) {
      this.coopRewardOperationBinding = captureCoopRewardOperationBinding();
    }
    if (coopController != null && coopBiomeMarketTestSkip) {
      this.end();
      return;
    }
    if (coopController != null) {
      if (this.coopBiomeStart < 0) {
        // #832 (audit P1#5, defect b): inside a live mystery encounter, pin to the ME's interaction
        // counter (coopMeInteractionStartValue) - the SAME counter the host's ExoticShopPhase streams
        // under and the guest's shop-open (coop-biome-shop) awaits - NOT the live counter, which an
        // inbound reconcile broadcast can bump mid-encounter (drifting the owner/watcher + seq calc off
        // the host). Outside an ME (the every-10-wave market) the live counter is correct + byte-identical.
        this.coopBiomeStart = coopMeInProgress() ? coopMeInteractionStartValue() : coopController.interactionCounter();
      }
      const spoofed = getCoopRuntime()?.spoof != null;
      const inMe = coopMeInProgress();
      // PICK axis (#832): the ME owner (or the counter-parity owner for a wave market) DRIVES the real
      // screen + relays each buy. Resolved from the PINNED counter, stable for the whole interaction.
      const pickOwner = spoofed || coopController.isLocalOwnerAtCounter(this.coopBiomeStart);
      // OPTION axis (#832, audit P1#5): who rolls + streams the stock. Inside an authoritative ME the HOST
      // is the sole engine and the only client running the real curated subclass (Exotic / Black-Market /
      // Import), so it is ALWAYS the option owner - the guest opens a plain BiomeShopPhase and ADOPTS the
      // stream. Outside an ME the option owner == the pick owner (wave market, byte-identical to before).
      const optionOwner =
        spoofed
        || (isCoopRewardRetainedResultMode(this.coopRewardOperationBinding)
          ? coopController.role === "host"
          : inMe
            ? coopController.role === "host"
            : pickOwner);
      this.coopBiomeOwner = pickOwner;
      this.coopBiomeOptionOwner = optionOwner;
      coopLog(
        "reward",
        `biome market roles: pinnedStart=${this.coopBiomeStart} inMe=${inMe} role=${coopController.role} spoof=${spoofed} pick=${pickOwner ? "OWNER" : "WATCHER"} option=${optionOwner ? "ROLL+STREAM" : "ADOPT"} continuation=${this.coopBiomeContinuation}`,
      );
      if (this.coopBiomeContinuation) {
        // #866: a move-learn continuation copy re-opens the SAME grid on the already-pinned interaction.
        // The pick WATCHER's live coopBiomeWatch loop still owns the seq, so its copy is INERT (a second
        // loop would double-consume the owner's relayed buys); the pick OWNER just re-opens its inherited
        // grid (no re-roll, no re-stream - the stock + qtys rode the copy). The terminal advance stays
        // from-pinned via coopBiomeTerminal (idempotent), never the base's unpinned coopAdvanceInteraction.
        if (!pickOwner) {
          this.end();
          return;
        }
        if (this.shopOptions.length === 0) {
          void this.finishEmptyCoopBiomeShop();
          return;
        }
        this.openBiomeShop();
        return;
      }
      if (!pickOwner) {
        // PICK WATCHER: never opens the interactive market. coopBiomeWatch adopts the streamed stock
        // (option watcher) OR rolls + streams its own (the host on a GUEST-owned ME: option owner, pick
        // watcher), then applies each relayed buy verbatim until the LEAVE.
        void this.coopBiomeWatch();
        return;
      }
      if (!optionOwner) {
        // PICK OWNER but OPTION WATCHER (the guest on a GUEST-owned ME): the guest cannot rebuild the
        // curated subclass stock, so ADOPT the host's streamed stock first, THEN open + drive the market.
        void this.coopBiomeDriveAdoptOptions();
        return;
      }
      // else: pick owner AND option owner -> the normal roll + stream + drive owner path below.
    }

    // #866: a continuation copy (solo, or the co-op pick+option owner falling through above) re-opens the
    // inherited grid WITHOUT re-rolling the stock. (Co-op pick+option owner already streamed on the first
    // open; re-streaming an adopted list here is unnecessary and the watcher is past its stock await.)
    if (this.coopBiomeContinuation) {
      if (this.shopOptions.length === 0) {
        void this.finishEmptyCoopBiomeShop();
        return;
      }
      this.openBiomeShop();
      return;
    }

    this.buildStock();
    // Co-op OPTION OWNER: stream the exact rolled stock BEFORE the empty check, so the watcher's stock
    // await resolves even when the market is empty (it then just consumes the LEAVE). #832: gated on the
    // OPTION axis (not the pick axis) so the host on a guest-owned ME - option owner, pick watcher - streams
    // from coopBiomeWatch instead, and a guest pick-owner does NOT double-stream an adopted list.
    if (this.coopBiomeOptionOwner && getCoopRuntime()?.spoof == null) {
      getCoopInteractionRelay()?.sendRewardOptions(
        this.coopBiomeStart,
        COOP_BIOME_STOCK_REROLL,
        serializeRewardOptions(this.shopOptions),
      );
    }
    if (this.shopOptions.length === 0) {
      void this.finishEmptyCoopBiomeShop();
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
    if (!globalScene.gameMode.isCoop) {
      globalScene.ui.setMode(
        UiMode.BIOME_SHOP,
        this.shopOptions,
        globalScene.arena.biomeId,
        (index: number) => this.onSelect(index),
        this.qtys,
      );
      return;
    }
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    void globalScene.ui
      .setModeBoundedWhen(
        UiMode.BIOME_SHOP,
        2_000,
        () => this.coopBoundaryStillLive(generation, wave),
        this.shopOptions,
        globalScene.arena.biomeId,
        (index: number) => (this.coopBoundaryStillLive(generation, wave) ? this.onSelect(index) : false),
        this.qtys,
      )
      .then(result => {
        if (result === "superseded" && this.coopBoundaryStillLive(generation, wave)) {
          this.openBiomeShop();
        }
      });
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
    this.coopResolvedModifierOption = 0;
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
    const coOp = globalScene.gameMode.isCoop;
    const generation = coOp ? coopSessionGeneration() : -1;
    const wave = coOp ? (globalScene.currentBattle?.waveIndex ?? -1) : -1;
    const attempt = coOp ? ++this.coopConfirmAttempt : 0;
    const coopCallbackStillLive = (): boolean =>
      !coOp || (attempt === this.coopConfirmAttempt && this.coopBoundaryStillLive(generation, wave));
    const confirm = (): void => {
      if (!coopCallbackStillLive()) {
        return;
      }
      if (coOp) {
        ++this.coopConfirmAttempt;
      }
      if (coOp) {
        globalScene.ui.resetModeChain();
        void this.finishConfirmedCoopBiomeShopLeave();
      } else {
        globalScene.ui.clearText();
        globalScene.ui.revertMode();
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
      }
    };
    const cancel = (): void => {
      if (!coopCallbackStillLive()) {
        return;
      }
      if (coOp) {
        ++this.coopConfirmAttempt;
      }
      globalScene.ui.clearText();
      if (coOp) {
        globalScene.ui.resetModeChain();
      } else {
        globalScene.ui.revertMode();
      }
      this.openBiomeShop();
    };
    if (coOp) {
      globalScene.ui.showText(i18next.t("battle:leaveShopQuestion"));
      void globalScene.ui
        .setModeBoundedWhen(UiMode.CONFIRM, 2_000, coopCallbackStillLive, confirm, cancel)
        .then(result => {
          if (result === "superseded" && this.coopBoundaryStillLive(generation, wave)) {
            this.confirmLeave();
          }
        });
      return;
    }
    globalScene.ui.showText(i18next.t("battle:leaveShopQuestion"), null, () => {
      globalScene.ui.setOverlayMode(UiMode.CONFIRM, confirm, cancel);
    });
  }

  private finishCoopBiomeShopLeave(): void {
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    void globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.coopBoundaryStillLive(generation, wave))
      .then(result => {
        if (!this.coopBoundaryStillLive(generation, wave)) {
          return;
        }
        if (result === "superseded") {
          this.finishCoopBiomeShopLeave();
          return;
        }
        this.end();
      });
  }

  private coopBoundaryStillLive(generation: number, wave: number): boolean {
    return (
      coopSessionGeneration() === generation
      && globalScene.currentBattle?.waveIndex === wave
      && globalScene.phaseManager.getCurrentPhase() === this
    );
  }

  private coopAsyncBoundaryStillLive(generation: number, wave: number, pinned: number): boolean {
    return this.coopBiomeStart === pinned && this.coopBoundaryStillLive(generation, wave);
  }

  /**
   * After a confirmed purchase (cost !== -1), decrement that slot's stock and
   * refresh the grid. The party-CANCEL path goes through resetModifierSelect
   * (no applyModifier), so cancelling never consumes stock.
   */
  /**
   * Co-op (#673): terminal for this market interaction. The OWNER relays the LEAVE so the
   * parked watcher exits its watch loop; BOTH sides then advance the alternation locally
   * (from-pinned, so the partner's broadcast merging first makes it a no-op).
   */
  private coopBiomeTerminal(): Promise<boolean> {
    if (this.coopTerminalPromise != null) {
      return this.coopTerminalPromise;
    }
    this.coopTerminalPromise = this.commitCoopBiomeTerminal();
    return this.coopTerminalPromise;
  }

  private async commitCoopBiomeTerminal(): Promise<boolean> {
    if (this.coopBiomeStart < 0) {
      return true;
    }
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    this.coopRewardOperationBinding ??= captureCoopRewardOperationBinding();
    if (this.coopBiomeOwner) {
      const role = getCoopController()?.role ?? "guest";
      const relay = getCoopInteractionRelay();
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
          return false;
        }
        const commit = commitRewardOwnerIntent(
          {
            surface: "market",
            pinned,
            label: "biomeShop",
            choice: COOP_INTERACTION_LEAVE,
            data: undefined,
            terminal: true,
            localRole: role,
            wave,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
          this.coopRewardOperationBinding,
        );
        if (!isCoopRewardOperationEnabled() || commit != null) {
          const resend = (): void =>
            relay?.sendInteractionChoice(coopBiomeShopSeq(pinned), "biomeShop", COOP_INTERACTION_LEAVE);
          // The authority must retain the complete terminal result before exposing the legacy companion.
          // Otherwise a transient journal failure lets the watcher consume LEAVE and advance while the
          // authority retries the same still-unretained terminal. A guest-owned intent still has to travel
          // first so the host can execute/retain it; that owner remains parked below until the host's exact
          // addressed result is materialized back into its relay.
          if (
            role === "host"
            && isCoopRewardRetainedResultMode(this.coopRewardOperationBinding)
            && (commit == null
              || commitRewardAuthoritativeResult(commit.operationId, undefined, this.coopRewardOperationBinding)
                == null)
          ) {
            getCoopRuntime()?.durability?.reconnect();
            continue;
          }
          try {
            resend();
          } catch {
            /* the retained journal or the next exact resend remains authoritative */
          }
          if (role === "guest" && isCoopRewardOperationEnabled()) {
            let resendTimer: ReturnType<typeof setInterval> | null = null;
            resendTimer = setInterval(() => {
              if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
                if (resendTimer != null) {
                  clearInterval(resendTimer);
                  resendTimer = null;
                }
                return;
              }
              try {
                resend();
              } catch {
                /* retry remains armed */
              }
            }, 1_000);
            const action =
              relay == null
                ? null
                : await awaitCoopChoiceWithOrphanBackstop(
                    relay,
                    getCoopController(),
                    coopBiomeShopSeq(pinned),
                    pinned,
                    COOP_BIOME_SHOP_CHOICE_KINDS,
                  );
            if (resendTimer != null) {
              clearInterval(resendTimer);
              resendTimer = null;
            }
            if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
              return false;
            }
            const adopted =
              action != null
              && action.choice === COOP_INTERACTION_LEAVE
              && action.operationId === commit?.operationId
              && adoptRewardWatcherChoice(
                {
                  surface: "market",
                  pinned,
                  action: { choice: action.choice, data: action.data, operationId: action.operationId },
                  terminal: true,
                  localRole: role,
                  wave,
                  turn: globalScene.currentBattle?.turn ?? 0,
                },
                this.coopRewardOperationBinding,
              ).adopt;
            if (!adopted) {
              getCoopRuntime()?.durability?.reconnect();
              continue;
            }
          }
          return this.advanceCoopBiomeTerminal(pinned);
        }
        getCoopRuntime()?.durability?.reconnect();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      failCoopSharedSession(`Biome market terminal could not commit for ${pinned}`);
      return false;
    }
    // #832 (audit P1#5, defect c): advanceCoopInteractionForContinuation SUPPRESSES its own advance while
    // an ME is in progress (its coopMeInProgress guard) - the whole ME counts as ONE alternation step,
    // advanced once at the true ME terminal (PostMysteryEncounterPhase on the host, CoopReplayMePhase's
    // leaveDefensive on the guest), exactly like the embedded SelectModifierPhase (coopAdvanceInteraction's
    // matching coopMeInProgress guard). Outside an ME (the wave market) it advances normally. So the owner
    // terminal here AND the watcher terminal in coopBiomeWatch are both no-ops inside an ME - no host-only
    // extra advance, no counter desync.
    return this.advanceCoopBiomeTerminal(pinned);
  }

  private advanceCoopBiomeTerminal(pinned: number): boolean {
    const controller = getCoopController();
    const interactionEndsHere = !coopMeInProgress();
    advanceCoopInteractionForContinuation(pinned);
    if (interactionEndsHere && controller != null && controller.interactionCounter() <= pinned) {
      failCoopSharedSession(`Biome market terminal ${pinned} did not advance shared ownership`);
      return false;
    }
    return true;
  }

  private async finishEmptyCoopBiomeShop(): Promise<void> {
    if (await this.coopBiomeTerminal()) {
      this.end();
    }
  }

  private async finishConfirmedCoopBiomeShopLeave(): Promise<void> {
    if (!(await this.coopBiomeTerminal())) {
      return;
    }
    globalScene.ui.clearText();
    this.finishCoopBiomeShopLeave();
  }

  /**
   * Co-op (#832, audit P1#5) PICK OWNER + OPTION WATCHER: the GUEST on a GUEST-owned biome ME. The guest
   * opens a plain BiomeShopPhase and cannot rebuild the host's curated subclass stock, so ADOPT the host's
   * streamed stock (recomputing per-slot quantities from each option's tier - erBiomeStockCount is pure, so
   * they match the host's buildStock exactly), THEN open + DRIVE the real market like a normal owner (each
   * buy relays via applyModifier's coopBiomeOwner gate). Mirrors SelectModifierPhase.startCoopOwnerAdoptOptions
   * (#828). A missing/invalid stream fails closed with a recovery message; local stock is never generated.
   */
  private async coopBiomeDriveAdoptOptions(): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      this.coopBiomeAuthoritativeStockUnavailable("guest owner has no live relay");
      return;
    }
    const streamed = await relay.awaitRewardOptions(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL, COOP_BIOME_WAIT_MS);
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    const rebuilt = streamed == null ? null : reconstructRewardOptions(streamed, globalScene.getPlayerParty());
    if (rebuilt == null) {
      this.coopBiomeAuthoritativeStockUnavailable("guest owner could not recover/reconstruct streamed stock");
      return;
    }
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    this.shopOptions = rebuilt;
    // Per-slot stock counts are NOT streamed (only the options are); recompute them from each option's
    // resolved tier - erBiomeStockCount is pure, so this matches the host's buildStock quantities exactly.
    this.qtys = this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT));
    if (this.shopOptions.length === 0) {
      void this.finishEmptyCoopBiomeShop();
      return;
    }
    this.openBiomeShop();
  }

  /**
   * Co-op (#673) WATCHER: never opens the market UI. Adopts the owner's streamed stock, then
   * applies each relayed buy VERBATIM (slot into that stock + target party slot + the owner's
   * post-buy money) until the exact LEAVE terminal. A timeout reconnects and retries without ever
   * inferring a terminal; bounded repeated absence stops the shared session safely. #832: the host on a GUEST-owned ME (option owner, pick watcher)
   * ROLLS + STREAMS its own stock here instead of adopting - see the coopBiomeOptionOwner branch.
   */
  private async coopBiomeWatch(): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      this.coopBiomeAuthoritativeStockUnavailable("watcher has no live relay");
      return;
    }
    globalScene.ui.showText("Your partner is browsing the market...", null, undefined, null, true);
    if (this.coopBiomeOptionOwner) {
      // #832 (audit P1#5): the HOST on a GUEST-owned biome ME is the OPTION owner but the PICK watcher. It
      // runs the real curated subclass, so it ROLLS + STREAMS its own authoritative stock (the guest, a
      // plain BiomeShopPhase, adopts it) and does NOT adopt - there is no other streamer. It then falls
      // through to the buy-apply loop and applies the guest's relayed buys verbatim, exactly like a normal
      // watcher (SelectModifierPhase's #828 host-option-owner-but-pick-watcher case).
      this.buildStock();
      if (getCoopRuntime()?.spoof == null) {
        relay.sendRewardOptions(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL, serializeRewardOptions(this.shopOptions));
      }
    } else {
      const streamed = await relay.awaitRewardOptions(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL, COOP_BIOME_WAIT_MS);
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      const rebuilt = streamed == null ? null : reconstructRewardOptions(streamed, globalScene.getPlayerParty());
      if (rebuilt == null) {
        this.coopBiomeAuthoritativeStockUnavailable("watcher could not recover/reconstruct streamed stock");
        return;
      }
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      this.shopOptions = rebuilt;
      this.qtys = this.shopOptions.map(() => 99);
    }
    const seq = coopBiomeShopSeq(this.coopBiomeStart);
    this.coopRewardOperationBinding ??= captureCoopRewardOperationBinding();
    let missingTerminalAttempts = 0;
    for (;;) {
      const action = await awaitCoopChoiceWithOrphanBackstop(
        relay,
        getCoopController(),
        seq,
        pinned,
        COOP_BIOME_SHOP_CHOICE_KINDS,
      );
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      if (action == null) {
        missingTerminalAttempts += 1;
        coopWarn(
          "reward",
          `biome market watcher did not receive an exact terminal seq=${seq} attempt=${missingTerminalAttempts}/3 - reconnecting without inferring LEAVE`,
        );
        getCoopRuntime()?.durability?.reconnect();
        if (missingTerminalAttempts >= 3) {
          failCoopSharedSession(`Biome market watcher never received an exact terminal for ${pinned}`);
          return;
        }
        continue;
      }
      missingTerminalAttempts = 0;
      const terminal = action.choice === COOP_INTERACTION_LEAVE;
      // Wave-2d: gate adoption through the authoritative operation primitive (idempotent by operationId,
      // stale-/late-rejecting a buy from an earlier interaction or after this market left - the #861 shape).
      // When the flag is OFF this passes through verbatim (legacy). The LEAVE terminal always ends the loop
      // (the gate still records its watermark); a rejected non-terminal buy is IGNORED (keep awaiting).
      const decision = adoptRewardWatcherChoice(
        {
          surface: "market",
          pinned: this.coopBiomeStart,
          action: { choice: action.choice, data: action.data, operationId: action.operationId },
          terminal,
          localRole: getCoopController()?.role ?? "guest",
          wave: globalScene.currentBattle?.waveIndex ?? -1,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopRewardOperationBinding,
      );
      if (!decision.adopt) {
        coopWarn(
          "reward",
          `biome market watcher op-gate rejected buy (${decision.reason}) seq=${seq} slot=${action.choice} - keep awaiting (Wave-2d)`,
        );
        continue;
      }
      if (decision.requiresAuthorityCommit) {
        this.coopPendingAuthorityOperationId = decision.operationId ?? null;
      }
      if (terminal) {
        if (
          decision.authoritativeProjection !== true
          && decision.operationId != null
          && commitRewardAuthoritativeResult(decision.operationId!, undefined, this.coopRewardOperationBinding) == null
        ) {
          failCoopSharedSession(`Biome market terminal result ${decision.operationId} could not be retained`);
          return;
        }
        break;
      }
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      const slot = action.choice;
      const data = action.data ?? [];
      const partySlot = data[0] ?? -1;
      const money = data[1] ?? -1;
      const nestedOption = data[2] ?? 0;
      const validatedCost = data[3] ?? -1;
      const opt = this.shopOptions[slot];
      coopLog(
        "reward",
        `biome market watcher applies buy slot=${slot} id=${opt?.type?.id ?? "?"} partySlot=${partySlot} option=${nestedOption} money=${money}`,
      );
      try {
        if (decision.authoritativeProjection === true) {
          if (slot >= 0 && slot < this.qtys.length) {
            this.qtys[slot] = Math.max(0, this.qtys[slot] - 1);
          }
          if (opt?.type != null) {
            this.queueCoopProjectedModifierFollowUp(opt.type, partySlot, nestedOption, validatedCost);
          }
          continue;
        }
        if (opt?.type != null) {
          const modifier =
            opt.type instanceof PokemonModifierType
              ? this.buildPokemonModifier(opt.type, partySlot, nestedOption)
              : opt.type.newModifier();
          if (modifier != null) {
            this.pendingIndex = slot;
            // Keep PAID-shop control flow while adopting the owner's exact
            // balance. Passing -1 here means "free reward terminal" to the base
            // phase and used to end this watcher after the first held item,
            // racing it into SelectBiomePhase before the owner left the market.
            this.applyCoopRelayedPurchase(modifier, validatedCost, money, false);
          }
        }
      } catch {
        /* one bad relayed buy must never strand the watcher */
      }
      if (money >= 0 && decision.authoritativeProjection !== true) {
        if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
          return;
        }
        globalScene.money = money;
        globalScene.updateMoneyText();
      }
      if (
        decision.requiresAuthorityCommit
        && decision.operationId != null
        && commitRewardAuthoritativeResult(decision.operationId!, undefined, this.coopRewardOperationBinding) == null
      ) {
        failCoopSharedSession(`Biome market buy result ${decision.operationId} could not be retained`);
        return;
      }
      this.coopPendingAuthorityOperationId = null;
    }
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    if (!this.advanceCoopBiomeTerminal(this.coopBiomeStart)) {
      return;
    }
    globalScene.ui.clearText();
    this.finishCoopBiomeShopLeave();
  }

  /** Never let a market continue against locally generated stock after authority was lost. */
  private coopBiomeAuthoritativeStockUnavailable(context: string): void {
    coopWarn(
      "reward",
      `biome market authoritative stock unavailable (${context}) -> FAIL CLOSED; local roll suppressed`,
    );
    try {
      globalScene.ui.showText(
        "Could not recover your partner's authoritative market stock. Reconnect to resume safely.",
        null,
        undefined,
        null,
        true,
      );
    } catch {
      /* the phase remains parked even if the cosmetic banner cannot render */
    }
  }

  /** catalog-v2 (#900): overridden true by the Black Market variant (BLACK_FRIDAY vs BIOME_TOURIST). */
  protected erIsBlackMarket(): boolean {
    return false;
  }

  protected override applyModifier(modifier: Modifier, cost = -1, playSound = false): void {
    // Co-op (#673) OWNER: capture the buy BEFORE the stock decrement resets pendingIndex,
    // then relay it self-describing: [slotIntoStreamedStock] +
    // [targetPartySlot, moneyAfter, nestedOption, validatedCost].
    const coopBoughtSlot = this.coopBiomeOwner && cost !== -1 ? this.pendingIndex : -1;
    let preparedOperationId: string | null = null;
    if (coopBoughtSlot >= 0) {
      this.coopRewardOperationBinding ??= captureCoopRewardOperationBinding();
      const party = globalScene.getPlayerParty();
      const pokemonId = (modifier as unknown as { pokemonId?: number }).pokemonId;
      const partySlot = typeof pokemonId === "number" ? party.findIndex(p => p?.id === pokemonId) : -1;
      const resultingMoney = Overrides.WAIVE_ROLL_FEE_OVERRIDE ? globalScene.money : globalScene.money - cost;
      const prepared = commitRewardOwnerIntent(
        {
          surface: "market",
          pinned: this.coopBiomeStart,
          label: "biomeShop",
          choice: coopBoughtSlot,
          data: [partySlot, resultingMoney, this.coopResolvedModifierOption, cost],
          terminal: false,
          localRole: getCoopController()?.role ?? "guest",
          wave: globalScene.currentBattle?.waveIndex ?? -1,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopRewardOperationBinding,
      );
      preparedOperationId = prepared?.operationId ?? null;
      getCoopInteractionRelay()?.sendInteractionChoice(
        coopBiomeShopSeq(this.coopBiomeStart),
        "biomeShop",
        coopBoughtSlot,
        [partySlot, resultingMoney, this.coopResolvedModifierOption, cost],
      );
      if (
        getCoopController()?.role === "guest"
        && isCoopRewardRetainedResultMode(this.coopRewardOperationBinding)
        && preparedOperationId != null
      ) {
        this.coopPendingAuthorityOperationId = preparedOperationId;
        this.hideShopForOverlay();
        void globalScene.ui.setMode(UiMode.MESSAGE);
        void this.coopAwaitAuthoritativeMarketBuy(
          preparedOperationId,
          coopBoughtSlot,
          partySlot,
          this.coopResolvedModifierOption,
        );
        return;
      }
    }
    super.applyModifier(modifier, cost, playSound);
    // catalog-v2 (#900): a completed paid purchase. BLACK_FRIDAY (black market, one credit per run)
    // or BIOME_TOURIST (distinct biome shop types). Fully guarded - never disturbs the buy.
    try {
      if (cost !== -1) {
        if (this.erIsBlackMarket()) {
          const run = erAchvRun();
          if (!run.blackMarketCredited) {
            run.blackMarketCredited = true;
            erRecordBlackMarketPurchase();
          }
        } else {
          erRecordBiomeShopPurchase(SHOP_TYPE_BY_BIOME[globalScene.arena.biomeId] ?? "Market");
        }
      }
    } catch {
      /* achievement recording must never disturb the purchase */
    }
    if (
      preparedOperationId != null
      && getCoopController()?.role === "host"
      && isCoopRewardRetainedResultMode(this.coopRewardOperationBinding)
      && commitRewardAuthoritativeResult(preparedOperationId, undefined, this.coopRewardOperationBinding) == null
    ) {
      failCoopSharedSession(`Biome market buy result ${preparedOperationId} could not be retained`);
      return;
    }
    if (cost !== -1 && this.pendingIndex >= 0 && this.pendingIndex < this.qtys.length) {
      this.qtys[this.pendingIndex] = Math.max(0, this.qtys[this.pendingIndex] - 1);
      const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
      handler.setStock?.(this.pendingIndex, this.qtys[this.pendingIndex]);
      this.pendingIndex = -1;
    }
  }

  /** Guest market owner: project the committed result only after its complete state was atomically applied. */
  private async coopAwaitAuthoritativeMarketBuy(
    operationId: string,
    slot: number,
    proposedPartySlot: number,
    proposedNestedOption: number,
  ): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = globalScene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      failCoopSharedSession(`Biome market buy ${operationId} has no live relay`);
      return;
    }
    this.coopRewardOperationBinding ??= captureCoopRewardOperationBinding();
    for (;;) {
      const action = await awaitCoopChoiceWithOrphanBackstop(
        relay,
        getCoopController(),
        coopBiomeShopSeq(pinned),
        pinned,
        COOP_BIOME_SHOP_CHOICE_KINDS,
      );
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      if (action == null) {
        getCoopRuntime()?.durability?.reconnect();
        continue;
      }
      const decision = adoptRewardWatcherChoice(
        {
          surface: "market",
          pinned,
          action: { choice: action.choice, data: action.data, operationId: action.operationId },
          terminal: false,
          localRole: "guest",
          wave,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopRewardOperationBinding,
      );
      if (
        !decision.adopt
        || decision.operationId !== operationId
        || action.choice !== slot
        || decision.authoritativeProjection !== true
      ) {
        continue;
      }
      const partySlot = action.data?.[0] ?? proposedPartySlot;
      const nestedOption = action.data?.[2] ?? proposedNestedOption;
      const validatedCost = action.data?.[3] ?? -1;
      const modifierType = this.shopOptions[slot]?.type;
      if (modifierType != null) {
        this.queueCoopProjectedModifierFollowUp(modifierType, partySlot, nestedOption, validatedCost);
      }
      this.qtys[slot] = Math.max(0, (this.qtys[slot] ?? 0) - 1);
      const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
      handler.setStock?.(slot, this.qtys[slot]);
      this.pendingIndex = -1;
      this.coopPendingAuthorityOperationId = null;
      this.openBiomeShop();
      return;
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
