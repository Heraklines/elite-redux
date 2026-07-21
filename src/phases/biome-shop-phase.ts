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
import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  coopAppliedStateTick,
  drainCoopApplyFailures,
} from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  awaitCoopChoiceWithOrphanBackstop,
  COOP_BIOME_STOCK_REROLL,
  COOP_BIOME_WAIT_MS,
  COOP_INTERACTION_LEAVE,
  coopBiomeShopSeq,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import type {
  CoopMarketProjectionKind,
  CoopRewardPresentationPayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
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
  notifyCoopV2InteractionSurfaceReady,
  notifyCoopWaveContinuationSurfaceReady,
  runWhenCoopRuntimeActive,
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
import { type SelectModifierCoopContinuation, SelectModifierPhase } from "#phases/select-modifier-phase";
import { SHOP_TYPE_BY_BIOME } from "#ui/handlers/biome-shop-ui-handler";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";

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
  /** Runtime that owns this market, retained across async UI/relay continuations. */
  private readonly coopBiomeOwningRuntime = getCoopRuntime();
  /** Scene that owns this market; ambient `globalScene` may be the peer after an async duo-harness yield. */
  private readonly coopBiomeOwningScene = globalScene;
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
  /** True only after the watcher reconstructed authoritative stock and can consume the exact terminal stream. */
  public coopBiomeWatcherContinuationReady = false;
  /**
   * Narrow subclass-owned execution marker for a relayed paid buy. The base phase deliberately keeps its
   * watcher/option axes private; this marker lets the market validate its retained host intent without
   * reaching through that encapsulation or duplicating the base's UI/money context machinery.
   */
  private coopExecutingRelayedMarketBuy = false;
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

  /** Closed Authority V2 constructor identity; curated Mystery markets override this explicitly. */
  protected coopMarketProjectionKind(): CoopMarketProjectionKind {
    return "biome";
  }

  /** Concrete public identity for the V2 proof ledger; legacy mechanics still see SelectModifierPhase. */
  public get coopV2ProofPhaseName():
    | "BiomeShopPhase"
    | "ExoticShopPhase"
    | "BlackMarketShopPhase"
    | "ImportBazaarShopPhase" {
    const phaseNameByMarket = {
      biome: "BiomeShopPhase",
      exotic: "ExoticShopPhase",
      "black-market": "BlackMarketShopPhase",
      "import-bazaar": "ImportBazaarShopPhase",
    } as const satisfies Record<
      CoopMarketProjectionKind,
      "BiomeShopPhase" | "ExoticShopPhase" | "BlackMarketShopPhase" | "ImportBazaarShopPhase"
    >;
    return phaseNameByMarket[this.coopMarketProjectionKind()];
  }

  /** Complete phase-local market generation needed by ordinary projection and correlated recovery. */
  private coopMarketContinuation(): Extract<CoopRewardPresentationPayload, { readonly surface: "market" }> {
    return {
      surface: "market",
      pinned: this.coopBiomeStart,
      reroll: COOP_BIOME_STOCK_REROLL,
      options: serializeRewardOptions(this.shopOptions),
      marketKind: this.coopMarketProjectionKind(),
      remainingStock: [...this.qtys],
    };
  }

  /** Bind a recovered market generation before it can roll, rebuild, or open a public handler. */
  public installCoopV2MarketProjection(
    operationId: string,
    projection: Extract<CoopRewardPresentationPayload, { readonly surface: "market" }>,
  ): boolean {
    if (
      operationId.length === 0
      || projection.surface !== "market"
      || projection.marketKind !== this.coopMarketProjectionKind()
      || projection.pinned < 0
      || projection.reroll !== COOP_BIOME_STOCK_REROLL
      || projection.remainingStock.length !== projection.options.length
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopBiomeStart = projection.pinned;
    this.coopV2ControlOperationId = operationId;
    return true;
  }

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
    const Ctor = this.constructor as new (
      rerollCount?: number,
      modifierTiers?: undefined,
      customModifierSettings?: undefined,
      isCopy?: boolean,
      coopContinuation?: SelectModifierCoopContinuation,
    ) => BiomeShopPhase;
    const copied = new Ctor(0, undefined, undefined, false, {
      kind: "inherited",
      address: this.coopSourceAddress,
    });
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
    if (!this.coopContinuationIdentityIsUsable()) {
      return false;
    }
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
      const operationId = getCoopInteractionRelay()?.sendRewardOptions(
        this.coopBiomeStart,
        COOP_BIOME_STOCK_REROLL,
        serializeRewardOptions(this.shopOptions),
        undefined,
        {
          marketKind: this.coopMarketProjectionKind(),
          remainingStock: [...this.qtys],
        },
      );
      if (operationId != null) {
        this.coopV2ControlOperationId = operationId;
      }
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
    const waveIndex = this.coopRewardWave();
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
        if (result !== "superseded") {
          // A retained wave is not continuation-safe merely because its biome-market phase exists.
          // Release the source transaction only after the real public BIOME_SHOP handler committed.
          // A bounded timeout force is also a real, active handler and must not be mistaken for failure.
          this.notifyCoopBiomeContinuationSurfaceReady();
          return;
        }
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
      && this.coopBiomeOwningScene.currentBattle?.waveIndex === wave
      && this.coopBiomeOwningScene.phaseManager.getCurrentPhase() === this
    );
  }

  private coopAsyncBoundaryStillLive(generation: number, wave: number, pinned: number): boolean {
    return this.coopBiomeStart === pinned && this.coopBoundaryStillLive(generation, wave);
  }

  /**
   * Record phase insertions made by one market purchase. Modifier application can enqueue both its own
   * renderer tail (for example LearnMovePhase) and the market continuation copy. A material rollback that
   * leaves either tail queued is not atomic: the failed purchase can still escape through the phase queue.
   */
  private beginCoopMarketQueueBoundary(): { commit(): void; rollback(): void } {
    const phaseManager = globalScene.phaseManager as unknown as {
      pushPhase(...phases: unknown[]): void;
      tryRemovePhase(name: string, filter?: (phase: unknown) => boolean): boolean;
      unshiftPhase(...phases: unknown[]): void;
    };
    const inserted: { phase: unknown; name: string }[] = [];
    const hadOwnPush = Object.hasOwn(phaseManager, "pushPhase");
    const hadOwnUnshift = Object.hasOwn(phaseManager, "unshiftPhase");
    const ownPush = hadOwnPush ? phaseManager.pushPhase : null;
    const ownUnshift = hadOwnUnshift ? phaseManager.unshiftPhase : null;
    const push = phaseManager.pushPhase.bind(phaseManager);
    const unshift = phaseManager.unshiftPhase.bind(phaseManager);
    let open = true;

    const remember = (phases: unknown[]): void => {
      for (const phase of phases) {
        const name = (phase as { phaseName?: unknown } | null)?.phaseName;
        if (typeof name === "string") {
          inserted.push({ phase, name });
        }
      }
    };
    phaseManager.pushPhase = (...phases: unknown[]): void => {
      remember(phases);
      push(...phases);
    };
    phaseManager.unshiftPhase = (...phases: unknown[]): void => {
      remember(phases);
      unshift(...phases);
    };

    const close = (): void => {
      if (!open) {
        return;
      }
      open = false;
      if (hadOwnPush) {
        phaseManager.pushPhase = ownPush!;
      } else {
        Reflect.deleteProperty(phaseManager, "pushPhase");
      }
      if (hadOwnUnshift) {
        phaseManager.unshiftPhase = ownUnshift!;
      } else {
        Reflect.deleteProperty(phaseManager, "unshiftPhase");
      }
    };

    return {
      commit: close,
      rollback: (): void => {
        close();
        for (let i = inserted.length - 1; i >= 0; i--) {
          const queued = inserted[i];
          phaseManager.tryRemovePhase(queued.name, phase => phase === queued.phase);
        }
      },
    };
  }

  /**
   * Restore the exact material before-image of a failed local market execution. A market failure is terminal,
   * so the rollback image is admitted above the local receiver high-water before the shared terminal freezes
   * the run. This avoids the old failure mode where a guest's locally-created capture had a lower tick than
   * its last host result and the rollback was silently rejected as stale.
   */
  private restoreCoopMarketRollbackState(
    rollbackState: NonNullable<ReturnType<typeof captureCoopAuthoritativeBattleState>>,
    rngState: string,
  ): boolean {
    rollbackState.tick = Math.max(rollbackState.tick, coopAppliedStateTick() + 1);
    // `authoritativeGuest` controls guest-only material adoption details. A retained guest-owned market is
    // executed by the host, so treating that host rollback as a guest apply can corrupt the local authority
    // boundary (and the two-engine harness's next context). Legacy guest-side execution still uses true.
    try {
      const restored = applyCoopAuthoritativeBattleState(rollbackState, getCoopController()?.role === "guest");
      const optionalShapeRestored = restored && this.restoreCoopMarketOptionalMonShape(rollbackState);
      const failures = drainCoopApplyFailures();
      return restored && optionalShapeRestored && failures.length === 0;
    } finally {
      // The receiver apply intentionally sows the streamed wave seed. A failed LOCAL host execution must
      // instead be invisible to future rolls, so restore the exact pre-buy cursor after all material work.
      Phaser.Math.RND.state(rngState);
    }
  }

  /** Preserve optional Pokemon wire fields whose receiver representation canonicalizes absence to null. */
  private restoreCoopMarketOptionalMonShape(
    rollbackState: NonNullable<ReturnType<typeof captureCoopAuthoritativeBattleState>>,
  ): boolean {
    try {
      const liveById = new Map(
        [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()].map(mon => [mon.id, mon] as const),
      );
      for (const data of [...rollbackState.playerParty, ...rollbackState.enemyParty]) {
        const wire = data as { id?: unknown; fusionSpecies?: unknown };
        if (typeof wire.id !== "number") {
          return false;
        }
        const mon = liveById.get(wire.id);
        if (mon != null && wire.fusionSpecies === undefined) {
          // applyAuthoritativeMonData maps an absent fusion species to null. Both mean "not fused" to the
          // engine, but only undefined reproduces the captured immutable wire image byte-for-byte.
          (mon as unknown as { fusionSpecies?: unknown }).fusionSpecies = undefined;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply the renderer-only half of a retained market result as one control transaction. The host state is
   * already materialized, so this boundary owns only stock and queued continuation surfaces. A malformed
   * TM result cannot consume stock and leave a partial LearnMove/market tail behind.
   */
  private applyCoopProjectedMarketBuy(
    slot: number,
    modifierType: ModifierTypeOption["type"] | undefined,
    partySlot: number,
    nestedOption: number,
    validatedCost: number,
    operationId: string | undefined,
  ): boolean {
    const qtysBefore = [...this.qtys];
    const pendingBefore = this.pendingIndex;
    const queueBoundary = this.beginCoopMarketQueueBoundary();
    try {
      if (modifierType == null || slot < 0 || slot >= this.qtys.length) {
        throw new Error(`missing projected stock slot ${slot}`);
      }
      const continuation = this.queueCoopProjectedModifierFollowUp(
        modifierType,
        partySlot,
        nestedOption,
        validatedCost,
      );
      if (this.modifierQueuesContinuation(modifierType) && !continuation) {
        throw new Error(`projected continuation could not open for stock ${slot}`);
      }
      this.qtys[slot] = Math.max(0, this.qtys[slot] - 1);
      const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
      handler.setStock?.(slot, this.qtys[slot]);
      queueBoundary.commit();
      return true;
    } catch (error) {
      queueBoundary.rollback();
      this.qtys = qtysBefore;
      this.pendingIndex = pendingBefore;
      coopWarn(
        "reward",
        `biome market projected apply rolled back operation=${operationId ?? "legacy"} slot=${slot}`,
        error,
      );
      failCoopSharedSession(`Biome market buy ${operationId ?? "legacy"} could not open its exact continuation`);
      return false;
    }
  }

  /** Install the exact post-action stock vector carried by the immutable market result. */
  private applyCoopAuthoritativeMarketStock(resultData: readonly number[] | undefined, operationId: string): boolean {
    if (
      !Array.isArray(resultData)
      || resultData.length !== this.qtys.length
      || resultData.some(stock => !Number.isSafeInteger(stock) || stock < 0)
    ) {
      failCoopSharedSession(`Biome market result ${operationId} carried an invalid stock vector`);
      return false;
    }
    this.qtys = [...resultData];
    const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
    for (const [index, remaining] of this.qtys.entries()) {
      handler.setStock?.(index, remaining);
    }
    return true;
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
            wave: this.coopRewardWave(),
            turn: this.coopRewardTurn(),
          },
          this.coopRewardOperationBinding,
        );
        if (!isCoopRewardOperationEnabled() || commit != null) {
          const v2 = isCoopV2InteractionCutoverActive(this.coopRewardOperationBinding?.durability);
          let v2HostAdvanced = false;
          if (v2 && commit != null) {
            if (role === "host") {
              // The immutable terminal state includes the ownership advance. Close that local control
              // before capture so the result and its ordered wait describe one complete transaction.
              if (!this.advanceCoopBiomeTerminal(pinned)) {
                return false;
              }
              v2HostAdvanced = true;
            }
            // A guest owner has already closed/reset its market input chain at the confirmed-leave seam;
            // its deterministic operation ID can therefore prove the local terminal before proposal send.
            this.coopProveV2RewardOperationComplete(commit.operationId);
          }
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
              || commitRewardAuthoritativeResult(commit.operationId, undefined, this.coopRewardOperationBinding, {
                remainingStock: this.qtys,
                continuation: this.coopMarketContinuation(),
              }) == null)
          ) {
            if (v2HostAdvanced) {
              failCoopSharedSession(`Biome market terminal ${commit?.operationId ?? pinned} failed after V2 close`);
              return false;
            }
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
                  wave: this.coopRewardWave(),
                  turn: this.coopRewardTurn(),
                },
                this.coopRewardOperationBinding,
              ).adopt;
            if (!adopted) {
              getCoopRuntime()?.durability?.reconnect();
              continue;
            }
          }
          return v2HostAdvanced ? true : this.advanceCoopBiomeTerminal(pinned);
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
    const presentationOperationId = relay.consumeCommittedRewardOptionsOperationId(
      this.coopBiomeStart,
      COOP_BIOME_STOCK_REROLL,
    );
    if (presentationOperationId != null) {
      this.coopV2ControlOperationId = presentationOperationId;
    }
    const projection = relay.consumeRewardOptionsProjection(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL);
    if (isCoopV2InteractionCutoverActive(this.coopRewardOperationBinding?.durability) && projection == null) {
      this.coopBiomeAuthoritativeStockUnavailable("guest owner received V2 market options without exact stock");
      return;
    }
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    this.shopOptions = rebuilt;
    this.qtys =
      projection?.remainingStock == null
        ? this.shopOptions.map(o => erBiomeStockCount(o.type.getOrInferTier() ?? ModifierTier.GREAT))
        : [...projection.remainingStock];
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
    const scene = this.coopBiomeOwningScene;
    const runtime = this.coopBiomeOwningRuntime;
    const controller = runtime?.controller ?? getCoopController();
    const wave = scene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      this.coopBiomeAuthoritativeStockUnavailable("watcher has no live relay");
      return;
    }
    // MESSAGE identity is not enough: a prior transition can leave that handler selected but inactive.
    // Open a bounded real public surface before waiting so the player sees progress and the later retained
    // continuation can be attested against an executable handler rather than a one-shot assumption.
    if (!(await this.openCoopBiomeWatcherMessage(generation, wave, pinned))) {
      return;
    }
    if (this.coopBiomeOptionOwner) {
      // #832 (audit P1#5): the HOST on a GUEST-owned biome ME is the OPTION owner but the PICK watcher. It
      // runs the real curated subclass, so it ROLLS + STREAMS its own authoritative stock (the guest, a
      // plain BiomeShopPhase, adopts it) and does NOT adopt - there is no other streamer. It then falls
      // through to the buy-apply loop and applies the guest's relayed buys verbatim, exactly like a normal
      // watcher (SelectModifierPhase's #828 host-option-owner-but-pick-watcher case).
      this.buildStock();
      if (runtime?.spoof == null) {
        const operationId = relay.sendRewardOptions(
          this.coopBiomeStart,
          COOP_BIOME_STOCK_REROLL,
          serializeRewardOptions(this.shopOptions),
          undefined,
          {
            marketKind: this.coopMarketProjectionKind(),
            remainingStock: [...this.qtys],
          },
        );
        if (operationId != null) {
          this.coopV2ControlOperationId = operationId;
        }
      }
    } else {
      const streamed = await relay.awaitRewardOptions(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL, COOP_BIOME_WAIT_MS);
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      const rebuilt = streamed == null ? null : reconstructRewardOptions(streamed, scene.getPlayerParty());
      if (rebuilt == null) {
        this.coopBiomeAuthoritativeStockUnavailable("watcher could not recover/reconstruct streamed stock");
        return;
      }
      const presentationOperationId = relay.consumeCommittedRewardOptionsOperationId(
        this.coopBiomeStart,
        COOP_BIOME_STOCK_REROLL,
      );
      if (presentationOperationId != null) {
        this.coopV2ControlOperationId = presentationOperationId;
      }
      const projection = relay.consumeRewardOptionsProjection(this.coopBiomeStart, COOP_BIOME_STOCK_REROLL);
      if (isCoopV2InteractionCutoverActive(this.coopRewardOperationBinding?.durability) && projection == null) {
        this.coopBiomeAuthoritativeStockUnavailable("watcher received V2 market options without exact stock");
        return;
      }
      if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
        return;
      }
      this.shopOptions = rebuilt;
      this.qtys = projection?.remainingStock == null ? this.shopOptions.map(() => 99) : [...projection.remainingStock];
    }
    // Stock awaits can span another UI transition. Revalidate (and reopen only when actually lost) at the
    // instant readiness is published; a buffered owner terminal remains safe until the loop below.
    if (!(await this.openCoopBiomeWatcherMessage(generation, wave, pinned))) {
      return;
    }
    // The watcher never opens BIOME_SHOP, so its equivalent executable continuation is the fully
    // materialized stock plus the live terminal-consumer loop. Record readiness only after option
    // authority has been resolved; phase construction or the initial waiting message is too early.
    this.coopBiomeWatcherContinuationReady = true;
    this.notifyCoopBiomeContinuationSurfaceReady();
    const seq = coopBiomeShopSeq(this.coopBiomeStart);
    this.coopRewardOperationBinding ??= captureCoopRewardOperationBinding();
    let missingTerminalAttempts = 0;
    let terminalOperationId: string | null = null;
    let terminalAlreadyAdvanced = false;
    for (;;) {
      const action = await awaitCoopChoiceWithOrphanBackstop(
        relay,
        controller,
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
        runtime?.durability?.reconnect();
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
          localRole: controller?.role ?? "guest",
          wave: this.coopRewardWave(),
          turn: this.coopRewardTurn(),
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
        terminalOperationId = decision.operationId ?? null;
        if (
          decision.authoritativeProjection === true
          && decision.operationId != null
          && !this.applyCoopAuthoritativeMarketStock(action.resultData, decision.operationId)
        ) {
          return;
        }
        if (decision.authoritativeProjection !== true && decision.operationId != null) {
          if (isCoopV2InteractionCutoverActive(this.coopRewardOperationBinding?.durability)) {
            if (!this.advanceCoopBiomeTerminal(this.coopBiomeStart)) {
              return;
            }
            terminalAlreadyAdvanced = true;
            this.coopProveV2RewardOperationComplete(decision.operationId);
          }
          if (
            commitRewardAuthoritativeResult(decision.operationId, undefined, this.coopRewardOperationBinding, {
              remainingStock: this.qtys,
              continuation: this.coopMarketContinuation(),
            }) == null
          ) {
            failCoopSharedSession(`Biome market terminal result ${decision.operationId} could not be retained`);
            return;
          }
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
      let purchaseApplied = false;
      try {
        if (decision.authoritativeProjection === true) {
          if (
            !this.applyCoopProjectedMarketBuy(
              slot,
              opt?.type,
              partySlot,
              nestedOption,
              validatedCost,
              decision.operationId,
            )
          ) {
            return;
          }
          if (
            decision.operationId == null
            || !this.applyCoopAuthoritativeMarketStock(action.resultData, decision.operationId)
          ) {
            return;
          }
          this.coopProveV2RewardOperationComplete(decision.operationId);
          continue;
        }
        if (opt?.type == null) {
          failCoopSharedSession(`Biome market buy ${decision.operationId ?? "legacy"} addressed missing stock ${slot}`);
          return;
        }
        const modifier =
          opt.type instanceof PokemonModifierType
            ? this.buildPokemonModifier(opt.type, partySlot, nestedOption)
            : opt.type.newModifier();
        if (modifier == null) {
          failCoopSharedSession(
            `Biome market buy ${decision.operationId ?? "legacy"} could not materialize stock ${slot}`,
          );
          return;
        }
        this.pendingIndex = slot;
        // Keep PAID-shop control flow while adopting the owner's exact balance. Passing -1 here means
        // "free reward terminal" to the base phase and used to end this watcher after the first held item,
        // racing it into SelectBiomePhase before the owner left the market.
        purchaseApplied = this.applyCoopRelayedPurchase(modifier, validatedCost, money, false);
      } catch (error) {
        coopWarn(
          "reward",
          `biome market watcher apply failed operation=${decision.operationId ?? "legacy"} slot=${slot}`,
          error,
        );
        failCoopSharedSession(`Biome market buy ${decision.operationId ?? "legacy"} could not be applied exactly`);
        return;
      }
      if (!purchaseApplied) {
        failCoopSharedSession(`Biome market buy ${decision.operationId ?? "legacy"} was rejected locally`);
        return;
      }
      const retainedHostResultCommitted =
        decision.requiresAuthorityCommit
        && decision.operationId != null
        && controller?.role === "host"
        && isCoopRewardRetainedResultMode(this.coopRewardOperationBinding);
      if (!retainedHostResultCommitted && money >= 0) {
        if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
          return;
        }
        scene.money = money;
        scene.updateMoneyText();
      }
      if (
        !retainedHostResultCommitted
        && decision.requiresAuthorityCommit
        && decision.operationId != null
        && commitRewardAuthoritativeResult(decision.operationId!, undefined, this.coopRewardOperationBinding, {
          remainingStock: this.qtys,
          continuation: this.coopMarketContinuation(),
        }) == null
      ) {
        failCoopSharedSession(`Biome market buy result ${decision.operationId} could not be retained`);
        return;
      }
      this.coopPendingAuthorityOperationId = null;
    }
    if (!this.coopAsyncBoundaryStillLive(generation, wave, pinned)) {
      return;
    }
    if (!terminalAlreadyAdvanced && !this.advanceCoopBiomeTerminal(this.coopBiomeStart)) {
      return;
    }
    this.coopProveV2RewardOperationComplete(terminalOperationId);
    scene.ui.clearText();
    this.finishCoopBiomeShopLeave();
  }

  /** Materialize the watcher-facing MESSAGE handler and prove it still belongs to this exact market. */
  private async openCoopBiomeWatcherMessage(generation: number, wave: number, pinned: number): Promise<boolean> {
    const live = (): boolean => this.coopAsyncBoundaryStillLive(generation, wave, pinned);
    const scene = this.coopBiomeOwningScene;
    const alreadyOpen = scene.ui.getMode() === UiMode.MESSAGE && scene.ui.getHandler()?.active === true;
    if (alreadyOpen) {
      return live();
    }
    const opened = await scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, live);
    if (opened === "superseded" || !live()) {
      return false;
    }
    scene.ui.showText("Your partner is browsing the market...", null, undefined, null, false);
    if (!live()) {
      return false;
    }
    const publicSurface = scene.ui.getMode() === UiMode.MESSAGE && scene.ui.getHandler()?.active === true;
    if (!publicSurface) {
      failCoopSharedSession(`Biome market watcher could not open its continuation surface for ${pinned}`);
      return false;
    }
    return true;
  }

  /** Publish readiness only while this phase's scene and runtime are installed together. */
  private notifyCoopBiomeContinuationSurfaceReady(): void {
    const runtime = this.coopBiomeOwningRuntime;
    if (runtime == null) {
      return;
    }
    const generation = coopSessionGeneration();
    const wave = this.coopBiomeOwningScene.currentBattle?.waveIndex ?? -1;
    const pinned = this.coopBiomeStart;
    const notify = (): void => {
      if (
        !Number.isSafeInteger(wave)
        || wave < 0
        || pinned < 0
        || !this.coopAsyncBoundaryStillLive(generation, wave, pinned)
      ) {
        return;
      }
      const handler = this.coopBiomeOwningScene.ui.getHandler() as
        | {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          }
        | undefined;
      const actionable = handler?.active === true && handler.isCoopV2InputActionable?.() === true;
      const mode = this.coopBiomeOwningScene.ui.getMode();
      const publicSurface = this.coopBiomeOwner
        ? mode === UiMode.BIOME_SHOP && actionable
        : this.coopBiomeWatcherContinuationReady && mode === UiMode.MESSAGE && actionable;
      if (!publicSurface) {
        setTimeout(() => runWhenCoopRuntimeActive(runtime, notify), 10);
        return;
      }
      notifyCoopWaveContinuationSurfaceReady(
        this.coopSourceAddress?.wave,
        this.coopBiomeOwner ? undefined : "biomeMarketWatcher",
      );
      // SHOP_PRESENT is committed while its concrete market handler is still opening. Bind the immutable
      // presentation to this exact BIOME_SHOP (or watcher MESSAGE) generation once it is genuinely live,
      // so the next SHOP_BUY can consume an installed predecessor instead of racing an unproven claim.
      notifyCoopV2InteractionSurfaceReady(runtime);
    };
    runWhenCoopRuntimeActive(runtime, notify);
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

  /** Validate a guest-owned buy against the host's retained market image before any engine mutation. */
  private coopRetainedHostMarketIntentFailure(cost: number): string | null {
    const slot = this.pendingIndex;
    const option = this.shopOptions[slot];
    if (slot < 0 || option == null || slot >= this.qtys.length) {
      return `addressed missing stock ${slot}`;
    }
    if ((this.qtys[slot] ?? 0) <= 0) {
      return `addressed sold-out stock ${slot}`;
    }
    if (!Number.isFinite(cost) || cost < 0 || cost !== option.cost) {
      return `proposed cost ${cost} for stock ${slot}, expected ${option.cost}`;
    }
    if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE && globalScene.money < cost) {
      return `proposed unaffordable stock ${slot} cost=${cost} money=${globalScene.money}`;
    }
    return null;
  }

  /**
   * Preserve SelectModifierPhase's private watcher context while refusing to trust a guest-proposed balance.
   * The base helper is still the single place that suppresses interactive watcher UI and threads relayed
   * money. In retained host-result mode we replace that proposal with the balance derived from the host's
   * own validated cost before entering it; legacy watcher replay keeps the original authoritative balance.
   */
  protected override applyCoopRelayedPurchase(
    modifier: Modifier,
    validatedCost: number,
    authoritativeMoney: number,
    playSound = false,
  ): boolean {
    const retainedHostExecution =
      getCoopController()?.role === "host"
      && isCoopRewardRetainedResultMode(this.coopRewardOperationBinding)
      && this.coopPendingAuthorityOperationId != null;
    const trustedMoney =
      retainedHostExecution && !Overrides.WAIVE_ROLL_FEE_OVERRIDE
        ? globalScene.money - Math.max(0, validatedCost)
        : authoritativeMoney;
    const prior = this.coopExecutingRelayedMarketBuy;
    this.coopExecutingRelayedMarketBuy = true;
    try {
      return super.applyCoopRelayedPurchase(modifier, validatedCost, trustedMoney, playSound);
    } finally {
      this.coopExecutingRelayedMarketBuy = prior;
    }
  }

  /** catalog-v2 (#900): overridden true by the Black Market variant (BLACK_FRIDAY vs BIOME_TOURIST). */
  protected erIsBlackMarket(): boolean {
    return false;
  }

  protected override applyModifier(modifier: Modifier, cost = -1, playSound = false): boolean {
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
          wave: this.coopRewardWave(),
          turn: this.coopRewardTurn(),
        },
        this.coopRewardOperationBinding,
      );
      preparedOperationId = prepared?.operationId ?? null;
      if (isCoopRewardRetainedResultMode(this.coopRewardOperationBinding) && preparedOperationId == null) {
        failCoopSharedSession(`Biome market owner purchase at stock ${coopBoughtSlot} could not prepare its intent`);
        return false;
      }
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
        return true;
      }
    }
    const controller = getCoopController();
    const retainedResultMode = isCoopRewardRetainedResultMode(this.coopRewardOperationBinding);
    const pendingAuthorityOperationId =
      controller?.role === "host" && retainedResultMode ? this.coopPendingAuthorityOperationId : null;
    const operationIdToCommit = preparedOperationId ?? pendingAuthorityOperationId;
    const executesRetainedWatcherIntent =
      controller?.role === "host" && retainedResultMode && this.coopExecutingRelayedMarketBuy;
    if (executesRetainedWatcherIntent && pendingAuthorityOperationId == null) {
      failCoopSharedSession(`Biome market host received an unaddressed retained buy at stock ${this.pendingIndex}`);
      return false;
    }
    if (executesRetainedWatcherIntent) {
      const validationFailure = this.coopRetainedHostMarketIntentFailure(cost);
      if (validationFailure != null) {
        failCoopSharedSession(`Biome market retained buy ${pendingAuthorityOperationId} ${validationFailure}`);
        return false;
      }
    }
    const atomic = controller != null && cost !== -1;
    const rollbackRngState = atomic ? Phaser.Math.RND.state() : null;
    const rollbackState = atomic ? captureCoopAuthoritativeBattleState(globalScene.currentBattle?.turn ?? 0) : null;
    if (atomic && rollbackState == null) {
      failCoopSharedSession(`Biome market buy ${operationIdToCommit ?? "legacy"} had no rollback image`);
      return false;
    }
    const qtysBefore = [...this.qtys];
    const pendingIndexBefore = this.pendingIndex;
    const moneyBefore = globalScene.money;
    const queueBoundary = atomic ? this.beginCoopMarketQueueBoundary() : null;
    // SelectModifierPhase normally commits this inherited pending id immediately after addModifier. The
    // market has more state to commit (stock + continuation queue), so hold it until those mutations pass.
    if (pendingAuthorityOperationId != null) {
      this.coopPendingAuthorityOperationId = null;
    }
    let applied = false;
    try {
      applied = super.applyModifier(modifier, cost, playSound);
      if (!applied) {
        throw new Error("modifier engine rejected the purchase");
      }

      if (cost !== -1 && this.pendingIndex >= 0 && this.pendingIndex < this.qtys.length) {
        this.qtys[this.pendingIndex] = Math.max(0, this.qtys[this.pendingIndex] - 1);
        const handler = globalScene.ui.getHandler() as { setStock?: (index: number, remaining: number) => void };
        handler.setStock?.(this.pendingIndex, this.qtys[this.pendingIndex]);
        this.pendingIndex = -1;
      }

      if (operationIdToCommit != null && controller?.role === "host" && retainedResultMode) {
        this.coopProveV2RewardOperationComplete(operationIdToCommit);
        if (
          commitRewardAuthoritativeResult(operationIdToCommit, undefined, this.coopRewardOperationBinding, {
            remainingStock: this.qtys,
            continuation: this.coopMarketContinuation(),
          }) == null
        ) {
          throw new Error(`authoritative result ${operationIdToCommit} could not be retained`);
        }
      }
      queueBoundary?.commit();
      if (pendingAuthorityOperationId != null) {
        this.coopPendingAuthorityOperationId = null;
      }
    } catch (error) {
      queueBoundary?.rollback();
      this.qtys = qtysBefore;
      this.pendingIndex = pendingIndexBefore;
      this.coopPendingAuthorityOperationId = pendingAuthorityOperationId;
      let rolledBack = !atomic;
      if (rollbackState != null && rollbackRngState != null) {
        rolledBack = this.restoreCoopMarketRollbackState(rollbackState, rollbackRngState);
      }
      // Keep even the visible balance exact if the comprehensive rollback reports a structured failure.
      // The shared terminal below prevents further play, but its diagnostic must describe the true before-image.
      globalScene.money = moneyBefore;
      try {
        globalScene.updateMoneyText();
      } catch {
        /* the material state is authoritative; terminal UI may already be replacing this handler */
      }
      coopWarn(
        "reward",
        `biome market atomic apply rolled back operation=${operationIdToCommit ?? "legacy"} slot=${pendingIndexBefore} complete=${rolledBack}`,
        error,
      );
      failCoopSharedSession(
        rolledBack
          ? `Biome market buy ${operationIdToCommit ?? "legacy"} failed before atomic commit`
          : `Biome market buy ${operationIdToCommit ?? "legacy"} rollback failed`,
      );
      return false;
    }

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
    return true;
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
          wave: this.coopRewardWave(),
          turn: this.coopRewardTurn(),
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
      if (!this.applyCoopProjectedMarketBuy(slot, modifierType, partySlot, nestedOption, validatedCost, operationId)) {
        return;
      }
      if (!this.applyCoopAuthoritativeMarketStock(action.resultData, operationId)) {
        return;
      }
      this.pendingIndex = -1;
      this.coopPendingAuthorityOperationId = null;
      this.openBiomeShop();
      this.coopProveV2RewardOperationComplete(operationId);
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
