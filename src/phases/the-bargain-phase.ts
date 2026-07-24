/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - Giratina's deal. A dialogue EVENT that fills the
// Abyss's every-10-waves shop slot (the Abyss has no market - this is its
// "shop"). Pushed from VictoryPhase on x0 waves when the biome is the Abyss.
//
// The presentation is the dedicated full-screen ErBargainUiHandler (UiMode.
// ER_BARGAIN): a dark void backdrop, Giratina Origin's portrait, his line, and
// the bargain list. This phase owns the deal LOGIC: it opens that screen, then on
// a pick runs the chosen Sin's cost/payoff (party pick -> apply -> result). All
// deal logic is save-safe (party never exceeds 6; no new serialized save state).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import {
  adoptBargainWatcherOutcome,
  COOP_BARGAIN_PRESENT_KIND,
  commitBargainOwnerOutcome,
  commitBargainWatcherOutcome,
  commitCoopBargainPresentation,
  coopBargainOperationId,
  coopBargainPresentationOperationId,
  isCoopBargainOperationEnabled,
} from "#data/elite-redux/coop/coop-bargain-operation";
import { applyCoopMeOutcome, captureCoopMeOutcome } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_BARGAIN_SEQ_BASE, COOP_BIOME_WAIT_MS } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  advanceCoopInteractionForContinuation,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  isCoopV2InteractionHumanInputFrozen,
  notifyCoopV2InteractionSurfaceReady,
  retainCoopV2InteractionProposal,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { erRecordSevenSinOutcome } from "#data/elite-redux/er-achievement-detection";
import { erAchvRun } from "#data/elite-redux/er-achievement-run-state";
import {
  BARGAIN_RELIC_CHOICES,
  BARGAIN_SIN_ORDER,
  BARGAIN_STAT_CHOICES,
  type BargainAbilityChoice,
  type BargainSinKey,
  bargainBestCombatStat,
  bargainCurseRandomStat,
  bargainDullShine,
  bargainGrantStatBoost,
  bargainHeldCount,
  bargainLockAbilitySlot,
  bargainReplaceAbilitySlot,
  bargainResetToLevelOne,
  bargainSinAvailable,
  bargainWipeCandy,
  DISABLED_BARGAIN_SINS,
  LUST_CANDY_COST,
  pickBargainSins,
  rollCuriosityAbilities,
} from "#data/elite-redux/er-bargain-sins";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { achvs } from "#system/achv";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "mysteryEncounters/theBargain";

export class TheBargainPhase extends Phase {
  public readonly phaseName = "TheBargainPhase";
  /** Exact V2 presentation address owned by this phase generation. */
  public coopV2ControlOperationId: string | null = null;

  /** Guards against a double input resolving the event twice. */
  private resolving = false;

  /** Co-op (#795): interaction counter pinned at open (-1 = solo / not pinned). */
  private coopBargainStart = -1;
  /** Co-op (#795): this client drives the real bargain screen. */
  private coopBargainOwner = false;
  /** Co-op (#795): the owner terminal fired (idempotence guard). */
  private coopBargainDone = false;
  /** Complete owner result captured before cosmetic teardown and published only after this phase ends. */
  private coopTerminalOutcome: ReturnType<typeof captureCoopMeOutcome> | null = null;
  /** Guest-owned V2 terminal parked on this phase until the host-authored result returns. */
  private coopAwaitingAuthorityOperationId: string | null = null;
  /** Exact runtime that owns this phase across its post-terminal publication callback. */
  private readonly coopOwningRuntime = getCoopRuntime();

  /** Bind a recovered immutable offer before start() may consult the live interaction cursor. */
  public installCoopV2BargainPresentation(operationId: string, pinned: number): boolean {
    if (
      operationId.length === 0
      || !Number.isSafeInteger(pinned)
      || pinned < 0
      || (this.coopBargainStart >= 0 && this.coopBargainStart !== pinned)
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopBargainStart = pinned;
    this.coopV2ControlOperationId = operationId;
    return true;
  }

  start(): void {
    super.start();
    // Co-op (#795): the Bargain ALTERNATES like the market. The OWNER plays the real
    // screen; whatever the deal did reaches the WATCHER as ONE comprehensive outcome
    // blob (the proven ME-terminal resync: party / money / modifiers / dex / seeds),
    // so no per-Sin serialization exists to get wrong. Solo / non-coop untouched.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (coopController != null) {
      if (this.coopBargainStart < 0) {
        this.coopBargainStart = coopController.interactionCounter();
      }
      const spoofed = getCoopRuntime()?.spoof != null;
      const owns = spoofed || coopController.isLocalOwnerAtCounter(this.coopBargainStart);
      coopLog(
        "reward",
        `bargain owner/watcher decision: pinnedStart=${this.coopBargainStart} role=${coopController.role} spoof=${spoofed} -> ${owns ? "OWNER" : "WATCHER"}`,
      );
      if (coopController.role === "host") {
        const sins = this.rollAvailableSins();
        const presentationOperationId = coopBargainPresentationOperationId(this.coopBargainStart);
        if (owns) {
          this.coopV2ControlOperationId = presentationOperationId;
        }
        if (
          !commitCoopBargainPresentation({
            pinned: this.coopBargainStart,
            sins,
            localRole: "host",
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          })
        ) {
          failCoopSharedSession(`Bargain presentation ${this.coopBargainStart} could not enter durable authority`);
          return;
        }
        if (!owns) {
          this.coopV2ControlOperationId = presentationOperationId;
          this.openWatcherScreen(sins);
          void this.coopBargainWatch();
          return;
        }
        this.coopBargainOwner = true;
        this.runWithSins(sins);
        return;
      }
      void this.coopAwaitBargainPresentation(owns);
      return;
    }
    this.runWithSins(this.rollAvailableSins());
  }

  /** Capture every owner exit exactly once; publication is deliberately post-phase-terminal. */
  private coopBargainTerminal(): void {
    if (!this.coopBargainOwner || this.coopBargainDone) {
      return;
    }
    this.coopBargainDone = true;
    try {
      this.coopTerminalOutcome = captureCoopMeOutcome();
    } catch {
      coopWarn("reward", "bargain OWNER terminal capture threw");
    }
    advanceCoopInteractionForContinuation(this.coopBargainStart);
  }

  /**
   * Publish only after the public Bargain input has closed. A guest V2 owner deliberately keeps this phase
   * current as an ordered wait until the host-authored result returns; ending it at proposal-send time lets
   * the ambient queue advance before Authority V2 owns the successor.
   */
  private flushCoopBargainTerminal(): void {
    const outcome = this.coopTerminalOutcome;
    const controller = getCoopController();
    if (outcome == null || controller == null) {
      return;
    }
    const operationId = coopBargainOperationId(this.coopBargainStart);
    const seq = COOP_BARGAIN_SEQ_BASE + this.coopBargainStart;
    settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime);
    if (
      !commitBargainOwnerOutcome({
        pinned: this.coopBargainStart,
        outcome,
        localRole: controller.role,
        wave: globalScene.currentBattle?.waveIndex ?? 0,
        turn: globalScene.currentBattle?.turn ?? 0,
      })
    ) {
      failCoopSharedSession(`Bargain terminal ${this.coopBargainStart} could not enter durable authority`);
      return;
    }
    const relay = getCoopInteractionRelay();
    const sendProposal = (): void => relay?.sendInteractionOutcomeProposal(seq, "bargain", outcome, operationId);
    const runtime = this.coopOwningRuntime ?? getCoopRuntime();
    if (controller.role === "guest" && isCoopV2InteractionCutoverActive(runtime?.durability)) {
      if (relay == null || runtime == null) {
        failCoopSharedSession(`Bargain proposal ${operationId} has no active V2 relay`);
        return;
      }
      const lease = retainCoopV2InteractionProposal(
        {
          operationId,
          fingerprint: JSON.stringify([seq, "bargain", outcome]),
          resend: sendProposal,
          onExhausted: exhaustedOperationId => {
            if (getCoopRuntime() === runtime) {
              failCoopSharedSession(`Bargain proposal ${exhaustedOperationId} exhausted before Authority V2 commit`);
            }
          },
        },
        runtime,
      );
      if (lease === "conflict" || lease === "invalid" || lease === "disposed") {
        failCoopSharedSession(`Bargain proposal ${operationId} could not obtain a V2 resend lease (${lease})`);
        return;
      }
      coopLog("v2-proposal", `retained Bargain outcome proposal id=${operationId} status=${lease}`);
      this.coopAwaitAuthoritativeBargainResult(operationId, seq, runtime);
      return;
    }
    relay?.sendInteractionOutcome(seq, "bargain", outcome);
    coopLog("reward", `bargain OWNER terminal: outcome blob sent (pinnedStart=${this.coopBargainStart})`);
  }

  /** Guest owner: hold the engine boundary until the exact committed result has materially applied. */
  private coopAwaitAuthoritativeBargainResult(
    operationId: string,
    seq: number,
    runtime: NonNullable<ReturnType<typeof getCoopRuntime>>,
  ): void {
    if (this.coopAwaitingAuthorityOperationId != null) {
      if (this.coopAwaitingAuthorityOperationId !== operationId) {
        failCoopSharedSession(
          `Bargain proposal wait changed identity from ${this.coopAwaitingAuthorityOperationId} to ${operationId}`,
        );
      }
      return;
    }
    this.coopAwaitingAuthorityOperationId = operationId;
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      failCoopSharedSession(`Bargain result ${operationId} has no live relay`);
      return;
    }
    void (async () => {
      const result = await relay.awaitInteractionOutcome(seq, COOP_BIOME_WAIT_MS);
      if (getCoopRuntime() !== runtime || this.coopAwaitingAuthorityOperationId !== operationId) {
        return;
      }
      if (result == null) {
        runtime.durability?.reconnect();
        failCoopSharedSession(`Bargain result ${operationId} was not recovered`);
        return;
      }
      const committedOperationId = relay.consumeCommittedInteractionOutcomeOperationId(seq, result);
      if (committedOperationId !== operationId || result.k !== "meResync") {
        failCoopSharedSession(
          `Bargain result ${operationId} returned the wrong committed address ${committedOperationId ?? "(missing)"}`,
        );
        return;
      }
      if (globalScene.phaseManager.getCurrentPhase() !== this) {
        failCoopSharedSession(`Bargain result ${operationId} arrived after its ordered wait phase was replaced`);
        return;
      }
      this.coopAwaitingAuthorityOperationId = null;
      coopLog("v2-proposal", `Bargain result ${operationId} materially applied; releasing ordered wait`);
      super.end();
      settleCoopV2InteractionOperation(operationId, runtime);
    })();
  }

  /** Close locally only when no host-authored V2 result still owns this phase's successor. */
  private closeCoopBargainOwnerTerminal(): void {
    const runtime = this.coopOwningRuntime ?? getCoopRuntime();
    const controller = getCoopController();
    const parkForAuthority =
      this.coopTerminalOutcome != null
      && controller?.role === "guest"
      && isCoopV2InteractionCutoverActive(runtime?.durability);
    if (!parkForAuthority) {
      super.end();
    }
    this.flushCoopBargainTerminal();
  }

  /** Co-op WATCHER (#795): renders the immutable offer passively and adopts the owner's outcome verbatim. */
  private async coopBargainWatch(): Promise<void> {
    try {
      if (globalScene.ui.getMode() !== UiMode.ER_BARGAIN) {
        globalScene.ui.showText("Your partner is bargaining with Giratina...");
      }
      isCoopV2InteractionHumanInputFrozen();
    } catch {
      /* cosmetic */
    }
    const controller = getCoopController();
    const relay = getCoopInteractionRelay();
    const seq = COOP_BARGAIN_SEQ_BASE + this.coopBargainStart;
    const operationId = coopBargainOperationId(this.coopBargainStart);
    // The host watching a guest-owned Bargain consumes a non-authority proposal and turns it into the
    // ordered V2 result. The guest watching a host-owned Bargain must instead wait for that already-committed
    // result: Authority V2 materializes it into the ordinary outcome FIFO only after the complete state has
    // applied. Sending the replica through awaitInteractionOutcomeProposal() fails closed immediately (it is
    // correctly not the local authority), which used to dismiss the watcher before the host's commit arrived.
    const outcome =
      relay == null || controller == null
        ? null
        : controller.role === "host"
          ? await relay.awaitInteractionOutcomeProposal(seq, "bargain", operationId, COOP_BIOME_WAIT_MS)
          : await relay.awaitInteractionOutcome(seq, COOP_BIOME_WAIT_MS);
    const adoption =
      controller == null
        ? {
            accepted: false,
            projectionApplied: false,
            requiresAuthorityCommit: false,
            operationId: null,
            authoritativeOutcome: null,
          }
        : adoptBargainWatcherOutcome({
            pinned: this.coopBargainStart,
            outcome,
            localRole: controller.role,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          });
    if (adoption.accepted && outcome?.k === "meResync") {
      coopLog("reward", "bargain WATCHER: outcome blob received -> converging");
      if (!adoption.projectionApplied && !applyCoopMeOutcome(outcome)) {
        failCoopSharedSession(`Bargain terminal ${this.coopBargainStart} could not apply its complete state`);
        return;
      }
    } else {
      if (controller?.role === "host" && outcome?.k === "meResync" && isCoopBargainOperationEnabled()) {
        failCoopSharedSession(`Bargain proposal ${this.coopBargainStart} could not enter durable authority`);
        return;
      }
      coopWarn("reward", `bargain WATCHER: ${outcome == null ? "TIMEOUT" : "unexpected outcome kind"} -> move on`);
    }
    advanceCoopInteractionForContinuation(this.coopBargainStart);
    try {
      globalScene.ui.clearText();
    } catch {
      /* cosmetic */
    }
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      this.end();
      if (adoption.accepted && adoption.operationId != null) {
        settleCoopV2InteractionOperation(adoption.operationId, this.coopOwningRuntime);
      }
      if (
        adoption.requiresAuthorityCommit
        && adoption.operationId != null
        && adoption.authoritativeOutcome != null
        && !commitBargainWatcherOutcome(
          adoption.operationId,
          {
            pinned: this.coopBargainStart,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
          adoption.authoritativeOutcome,
        )
      ) {
        failCoopSharedSession(`Bargain result ${adoption.operationId} could not enter durable authority`);
      }
    });
  }

  private rollAvailableSins(): BargainSinKey[] {
    const available = BARGAIN_SIN_ORDER.filter(k => !DISABLED_BARGAIN_SINS.has(k) && bargainSinAvailable(k));
    return pickBargainSins(available, Math.min(3, available.length));
  }

  /** Guest blocks on the immutable host-authored offer list; local RNG never constructs this screen. */
  private async coopAwaitBargainPresentation(owns: boolean): Promise<void> {
    const relay = getCoopInteractionRelay();
    const presented =
      relay == null
        ? null
        : await relay.awaitInteractionChoice(COOP_BARGAIN_SEQ_BASE + this.coopBargainStart, COOP_BIOME_WAIT_MS, [
            COOP_BARGAIN_PRESENT_KIND,
          ]);
    const indices = presented?.data;
    if (
      !Array.isArray(indices)
      || typeof presented?.operationId !== "string"
      || presented.operationId.length === 0
      || indices.length > 3
      || !indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < BARGAIN_SIN_ORDER.length)
      || new Set(indices).size !== indices.length
    ) {
      failCoopSharedSession(`Bargain presentation ${this.coopBargainStart} was unavailable or malformed`);
      return;
    }
    const sins = indices.map(index => BARGAIN_SIN_ORDER[index]);
    this.coopV2ControlOperationId = presented?.operationId ?? null;
    if (sins.some(sin => DISABLED_BARGAIN_SINS.has(sin) || !bargainSinAvailable(sin))) {
      failCoopSharedSession(`Bargain presentation ${this.coopBargainStart} was not executable on the adopted state`);
      return;
    }
    if (!owns) {
      this.openWatcherScreen(sins);
      void this.coopBargainWatch();
      return;
    }
    this.coopBargainOwner = true;
    this.runWithSins(sins);
  }

  private runWithSins(sins: BargainSinKey[]): void {
    if (sins.length === 0) {
      this.coopBargainTerminal();
      if (this.coopV2ControlOperationId != null) {
        settleCoopV2InteractionOperation(this.coopV2ControlOperationId, this.coopOwningRuntime);
      }
      this.closeCoopBargainOwnerTerminal();
      return;
    }
    this.openScreen(sins);
  }

  /** (Re)open the dedicated bargain screen for these Sins (also used to return from Check Team). */
  private openScreen(sins: BargainSinKey[]): void {
    // labels/descs for the dedicated bargain screen: the chosen Sins + a Leave row.
    const labels = [...sins.map(k => i18next.t(`${ns}:sins.${k}.name`)), i18next.t(`${ns}:option.leave.label`)];
    const descs = [...sins.map(k => i18next.t(`${ns}:sins.${k}.tooltip`)), i18next.t(`${ns}:option.leave.tooltip`)];
    // Giratina's offer line per Sin - the handler plays it on this screen (bg +
    // portrait stay) before handing off to the party menu on confirm.
    const offers = sins.map(k => i18next.t(`${ns}:sins.${k}.offer`));
    // The handler's dialogue box fits a short line; use the first two sentences of
    // the intro (the full ominous monologue still plays elsewhere as needed).
    const greeting = i18next.t(`${ns}:introDialogue`).split("$").slice(0, 2).join(" ");

    void globalScene.ui
      .setMode(
        UiMode.ER_BARGAIN,
        labels,
        descs,
        greeting,
        offers,
        (sinIndex: number) => this.beginSin(sins, sins[sinIndex]),
        () => this.leave(),
        () => this.checkTeam(sins),
      )
      .then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
  }

  /** Render the same immutable offer on the non-owner without giving mirrored cursor input local authority. */
  private openWatcherScreen(sins: BargainSinKey[]): void {
    const labels = [...sins.map(k => i18next.t(`${ns}:sins.${k}.name`)), i18next.t(`${ns}:option.leave.label`)];
    const descs = [...sins.map(k => i18next.t(`${ns}:sins.${k}.tooltip`)), i18next.t(`${ns}:option.leave.tooltip`)];
    const offers = sins.map(k => i18next.t(`${ns}:sins.${k}.offer`));
    const greeting = i18next.t(`${ns}:introDialogue`).split("$").slice(0, 2).join(" ");
    void globalScene.ui
      .setMode(
        UiMode.ER_BARGAIN,
        labels,
        descs,
        greeting,
        offers,
        () => {},
        () => {},
        () => {},
      )
      .then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
  }

  /** View the party read-only (the Check Team button), then re-open the bargain screen. */
  private checkTeam(sins: BargainSinKey[]): void {
    globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
      this.openScreen(sins);
    });
  }

  /**
   * A Sin's offer was acknowledged on the bargain screen: run the deal. If the
   * player backs out of the FIRST party pick (nothing applied yet), return to the
   * bargain choices instead of ending the event.
   */
  private async beginSin(sins: BargainSinKey[], key: BargainSinKey): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // The offer already played on the bargain screen; hand off to MESSAGE (tears
    // down the bargain screen) for the party pick(s) + result.
    await globalScene.ui.setMode(UiMode.MESSAGE);
    const committed = await this.applySin(key);
    if (committed) {
      // The player accepted (and the deal was applied) one of Giratina's bargains.
      globalScene.validateAchv(achvs.DEVILS_BARGAIN);
      // catalog-v2 (#900) SEVEN_DEADLY_CHECKBOXES: record this resolved sin outcome (7 classic sins).
      erRecordSevenSinOutcome(key);
      // catalog-v2 (#900) READ_THE_FINE_PRINT: carry an "accepted the bargain" flag to the run victory.
      erAchvRun().bargainAccepted = true;
      this.coopBargainTerminal();
      this.closeCoopBargainOwnerTerminal();
      return;
    }
    // Backed out before any effect - reopen the choices so the player can pick again.
    this.resolving = false;
    this.openScreen(sins);
  }

  /** Leave the bargain (the Leave row, or CANCEL on the choices). */
  private async leave(): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // catalog-v2 (#900) JUST_SAY_NO: refused the bargain - fires when the next boss is beaten.
    erAchvRun().bargainRefusedPendingBoss = true;
    this.coopBargainTerminal();
    await globalScene.ui.setMode(UiMode.MESSAGE);
    await this.giratina(`${ns}:option.leave.line1`);
    await this.narrate(`${ns}:option.leave.line2`);
    await this.giratina(`${ns}:option.leave.line3`);
    this.closeCoopBargainOwnerTerminal();
  }

  /**
   * Run one Sin's party pick(s), cost+payoff, then the result line. The offer line
   * is shown earlier on the bargain screen. Returns false if the player backed out
   * of the first pick before anything was applied (so the caller can reopen the
   * choices); true once the deal has gone through.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: an 8-deal dispatch switch; each case is a small self-contained deal, clearer kept inline than split across eight helpers
  private async applySin(key: BargainSinKey): Promise<boolean> {
    let pokeName = "";

    switch (key) {
      case "greed": {
        const mon = await this.pickPokemon();
        if (!mon) {
          return false;
        }
        bargainWipeCandy(mon);
        const wave = globalScene.currentBattle?.waveIndex ?? 1;
        globalScene.addMoney(2000 + wave * 300);
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.ER_GREATER_GOLDEN_BALL);
        pokeName = mon.getNameToRender();
        break;
      }
      case "gluttony": {
        const mon = await this.pickPokemon();
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        globalScene.removePokemonFromPlayerParty(mon, true);
        coopAllowAccountWrite("bargain-egg-reward", () =>
          new Egg({ sourceType: EggSourceType.EVENT, tier: EggTier.LEGENDARY }).addEggToGameData(),
        );
        break;
      }
      case "pride": {
        const mon = await this.pickPokemon(p => (p.isShiny() ? null : "This Pokémon does not shine."));
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        const stat = await this.pickStat();
        bargainDullShine(mon);
        await mon.loadAssets();
        bargainGrantStatBoost(mon, stat ?? Stat.ATK, 3);
        break;
      }
      case "wrath": {
        const victim = await this.pickPokemon();
        if (!victim) {
          return false;
        }
        pokeName = victim.getNameToRender();
        bargainCurseRandomStat(victim);
        const beneficiary = await this.pickPokemon(p => (p === victim ? "Choose a different Pokémon." : null));
        if (beneficiary) {
          bargainGrantStatBoost(beneficiary, bargainBestCombatStat(beneficiary), 2);
        }
        break;
      }
      case "envy": {
        const mon = await this.pickPokemon(p =>
          bargainHeldCount(p) >= 3 ? null : "This Pokémon isn't carrying enough.",
        );
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        for (const item of mon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier))) {
          globalScene.removeModifier(item);
        }
        globalScene.updateModifiers(true);
        // Offer the relic on the native reward-select screen (icons + on-focus
        // descriptions, pick one), restricted to the bargain relics - no bespoke
        // menu and no softlock.
        globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
          guaranteedModifierTypeFuncs: BARGAIN_RELIC_CHOICES.map(c => c.make),
          fillRemaining: false,
        });
        break;
      }
      case "sloth": {
        const a = await this.pickPokemon();
        if (!a) {
          return false;
        }
        const b = await this.pickPokemon(p => (p === a ? "Choose a different Pokémon." : null));
        if (!b) {
          return false;
        }
        for (const mon of [a, b]) {
          bargainResetToLevelOne(mon);
          bargainWipeCandy(mon);
        }
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.ER_RELIC_COVENANT);
        break;
      }
      case "lust": {
        // Surrender everything a single mon earned (its levels, its IVs, its whole
        // candy hoard) and Giratina makes it a PERMANENT tier-1 shiny. No black shiny
        // here - that stays an apex-challenge-only reward.
        const target = await this.pickPokemon(p =>
          globalScene.gameData.getStarterDataEntry(p.species.speciesId).candyCount >= LUST_CANDY_COST
            ? null
            : "This Pokémon needs 100 candy.",
        );
        if (!target) {
          return false;
        }
        pokeName = target.getNameToRender();
        // Cost: zero the IVs FIRST so the Lv 1 stat recompute reads them, then drop to
        // Lv 1 and spend the entire candy stock.
        target.ivs = [0, 0, 0, 0, 0, 0];
        bargainResetToLevelOne(target);
        bargainWipeCandy(target);
        // Payoff: a normal tier-1 shiny (variant 0, Luck 1) for the run.
        target.shiny = true;
        target.variant = 0;
        target.luck = 1;
        await target.loadAssets();
        target.updateInfo(true);
        break;
      }
      case "curiosity": {
        // The ability gamble. Gather every choice BEFORE mutating so any back-out
        // leaves the mon untouched (return false -> the choices reopen):
        //   1. pick the mon + the slot to LOCK (the party ability path).
        //   2. roll 7 random abilities; pick one in the Bargain-styled picker.
        //   3. pick which slot the chosen ability replaces. The locked slot is NOT
        //      excluded - the player may overwrite it (their mistake to make).
        // Only once all three are chosen do we lock + write the override.
        await this.giratina(`${ns}:sins.curiosity.lockPrompt`);
        const target = await this.pickAbilitySlot();
        if (!target) {
          return false;
        }
        const { mon, slot: lockSlot } = target;
        pokeName = mon.getNameToRender();
        // Roll 7 abilities, excluding what the surviving slots already hold so the
        // gamble never offers a duplicate of a slot it could land in.
        const remaining = mon.getAbilitySlots().filter(s => s.slot !== lockSlot);
        const choices = rollCuriosityAbilities(remaining.map(s => s.ability.id));
        const chosen = await this.pickCuriosityAbility(choices);
        if (chosen === null) {
          return false;
        }
        await this.giratina(`${ns}:sins.curiosity.replacePrompt`);
        const replaceTarget = await this.pickAbilitySlot(p => (p === mon ? null : "Choose the same Pokémon."));
        if (!replaceTarget) {
          return false;
        }
        // Commit: lock the cost slot (run-only, never the permanent unlock) and
        // write the rolled ability into the chosen slot.
        bargainLockAbilitySlot(mon, lockSlot);
        bargainReplaceAbilitySlot(mon, replaceTarget.slot, chosen.abilityId);
        break;
      }
    }

    globalScene.currentBattle.mysteryEncounter?.setDialogueToken("pokeName", pokeName);
    await this.narrate(`${ns}:sins.${key}.result`, { pokeName });
    return true;
  }

  // --- UI helpers ---

  /**
   * Open the party menu; resolves to the chosen mon, or null if backed out.
   * Mirrors the ME framework's selectPokemonForOption: capture the mode to return
   * to, AWAIT the restore inside the callback before resolving (a non-awaited
   * restore raced the next setMode and softlocked the deal flow, #550).
   */
  private pickPokemon(filter?: (p: PlayerPokemon) => string | null): Promise<PlayerPokemon | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.SELECT,
        -1,
        async (slotIndex: number) => {
          await globalScene.ui.setMode(exitMode);
          const party = globalScene.getPlayerParty();
          resolve(slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null);
        },
        filter,
      );
    });
  }

  /**
   * Open the party in the ER ability-slot mode (the same path the Ability
   * Randomizer uses): pick a mon, then one of its ability slots. Resolves to the
   * chosen `{ mon, slot }` (slot is the ER slot index: 0 = active ability, 1-3 =
   * innates), or null if backed out. Restores the prior mode before resolving so
   * the dialogue/picker that follows never races a dead party screen (#550).
   */
  private pickAbilitySlot(
    filter?: (p: PlayerPokemon) => string | null,
  ): Promise<{ mon: PlayerPokemon; slot: number } | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.ABILITY_MODIFIER,
        -1,
        async (slotIndex: number, option: PartyOption) => {
          await globalScene.ui.setMode(exitMode);
          const party = globalScene.getPlayerParty();
          const mon = slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null;
          if (!mon || option < PartyOption.ABILITY_SLOT_0) {
            resolve(null);
            return;
          }
          resolve({ mon, slot: option - PartyOption.ABILITY_SLOT_0 });
        },
        filter,
      );
    });
  }

  /**
   * Show the 7 rolled abilities (+ descriptions) on the Bargain-styled picker.
   * Resolves to the chosen ability, or null on cancel. Restores the prior mode
   * before resolving (same softlock-avoidance as the party / option menus).
   */
  private pickCuriosityAbility(choices: BargainAbilityChoice[]): Promise<BargainAbilityChoice | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      const restore = (value: BargainAbilityChoice | null): void => {
        globalScene.ui.setMode(exitMode).then(() => resolve(value));
      };
      globalScene.ui.setMode(UiMode.ER_BARGAIN, {
        picker: true,
        title: i18next.t(`${ns}:sins.curiosity.name`).toUpperCase(),
        greeting: i18next.t(`${ns}:sins.curiosity.pickAbility`),
        options: choices.map(c => ({ label: c.name, description: c.description })),
        onPick: (index: number) => restore(choices[index] ?? null),
        onCancel: () => restore(null),
      });
    });
  }

  private pickStat(): Promise<Stat | null> {
    return this.subMenu(BARGAIN_STAT_CHOICES.map(c => ({ label: c.label, value: c.stat })));
  }

  /** A simple labelled choice menu; resolves to the chosen value or null on cancel. */
  private subMenu<T>(choices: { label: string; value: T }[]): Promise<T | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      // Tear the option menu back down to the prior mode BEFORE resolving - a non-
      // awaited restore lets the result/dialogue that follows race the dead
      // OPTION_SELECT and softlock (same class as the party-select fix).
      const restore = (value: T | null): boolean => {
        globalScene.ui.setMode(exitMode).then(() => resolve(value));
        return true;
      };
      const options = choices.map(c => ({
        label: c.label,
        handler: () => restore(c.value),
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => restore(null),
      });
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
    });
  }

  private giratina(textKey: string): Promise<void> {
    return new Promise(resolve => {
      globalScene.ui.showDialogue(i18next.t(textKey), i18next.t(`${ns}:speaker`), null, () => resolve());
    });
  }

  private narrate(textKey: string, tokens?: Record<string, string>): Promise<void> {
    return new Promise(resolve => {
      globalScene.ui.showText(i18next.t(textKey, tokens ?? {}), null, () => resolve(), null, true);
    });
  }
}
