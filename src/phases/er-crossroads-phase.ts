/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - World Map core, the every-5-waves CROSSROADS.
//
// After the post-wave reward, every ~5 waves spent in the current biome (and only
// while the biome is NOT already ending), the run raises a "Stay / Move on" choice:
//   - STAY     -> keep going in this biome (the rolled length still bounds it).
//   - MOVE ON  -> end the biome NOW: flag an early exit (so isNewBiome honors it)
//                 and open the World Map node picker (SelectBiomePhase) before the
//                 next battle starts.
//
// Pushed by VictoryPhase (after the reward, before NewBattlePhase) when
// erShouldRaiseCrossroads() is true. The "Move on" path UNSHIFTS SelectBiomePhase
// so it runs immediately, ahead of the already-queued NewBattlePhase - mirroring
// the normal biome-end flow (SelectBiomePhase -> SwitchBiomePhase -> NewBattle).
//
// Gated entirely by erBiomeRoutingActive() at the push site (VictoryPhase), so it
// never appears in production / non-classic / daily / endless / random-biome runs.
//
// Co-op (#848): the crossroads is the ENTRY POINT of an owner-alternated interaction.
// The interaction OWNER (shared-counter parity, same alternation as reward shop / ME /
// bargain) drives the real Stay/Leave screen; the WATCHER opens a mirrored read-only
// copy that follows the owner's live cursor and adopts the owner's relayed pick. On
// STAY the crossroads is the terminal (it advances the counter once). On LEAVE it DEFERS
// its terminal to the chained SelectBiomePhase (setCoopBiomeInteractionStart), so the
// whole Stay/Leave->biome decision is ONE interaction with ONE counter advance at the
// map terminal - one player drives the whole chain. A disconnect / stall backstops to
// the deterministic auto-resolve on BOTH clients identically (same wave seed), so the
// fallback can never desync.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  adoptBiomeWatcherChoice,
  armCoopBiomeIntentResend,
  awaitCoopBiomeCommitReceipt,
  type CoopBiomeCommitReceipt,
  type CoopBiomeRelayResult,
  commitBiomeOwnerIntent,
  coopBiomeCommitRequired,
  coopBiomeOperationId,
  isCoopBiomeOperationEnabled,
  releaseCoopBiomeCommitReceipt,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  coopBiomePickerAutoResolvesInTest,
  setCoopBiomeInteractionStart,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { awaitCoopChoiceWithOrphanBackstop } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopCrossroadsPickPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import { getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  advanceCoopInteractionForContinuation,
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRendezvous,
  getCoopRuntime,
  getCoopUiMirror,
  notifyCoopWaveContinuationSurfaceReady,
  runWhenCoopRuntimeActive,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_CROSSROADS_CHOICE_KINDS, COOP_CROSSROADS_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { erHasNotoriety } from "#data/elite-redux/er-biome-notoriety";
import { erMarkBiomeStay, setErLeaveBiomeNow } from "#data/elite-redux/er-biome-structure";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import type { BiomeId } from "#enums/biome-id";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getBiomeName } from "#utils/common";

interface CoopCrossroadsContinuationRecoveryPolicy {
  readonly retryDelayMs: number;
  readonly maxAutomaticRetries: number;
  readonly deadlineMs: number;
}

const DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY: CoopCrossroadsContinuationRecoveryPolicy = {
  retryDelayMs: 250,
  maxAutomaticRetries: 2,
  // The exact operation receipt itself waits for up to 60s. Two re-awaits preserve reconnect grace while
  // this independent ceiling also fences a callback that never resolves or reports another failure.
  deadlineMs: 125_000,
};

let coopCrossroadsContinuationRecoveryPolicy = DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY;

/** Keep production recovery generous while allowing production-shaped tests to prove exhaustion quickly. */
export function setCoopCrossroadsContinuationRecoveryPolicyForTest(
  policy: Partial<CoopCrossroadsContinuationRecoveryPolicy>,
): void {
  coopCrossroadsContinuationRecoveryPolicy = {
    retryDelayMs: Math.max(
      1,
      Math.trunc(policy.retryDelayMs ?? DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY.retryDelayMs),
    ),
    maxAutomaticRetries: Math.max(
      0,
      Math.trunc(
        policy.maxAutomaticRetries ?? DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY.maxAutomaticRetries,
      ),
    ),
    deadlineMs: Math.max(
      1,
      Math.trunc(policy.deadlineMs ?? DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY.deadlineMs),
    ),
  };
}

export function resetCoopCrossroadsContinuationRecoveryPolicyForTest(): void {
  coopCrossroadsContinuationRecoveryPolicy = DEFAULT_COOP_CROSSROADS_CONTINUATION_RECOVERY_POLICY;
}

interface CoopCrossroadsContinuationRecovery {
  readonly generation: number;
  readonly wave: number;
  readonly turn: number;
  readonly boundaryRevision: number;
  readonly token: number;
  retry: () => void;
  retries: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  terminalRequested: boolean;
}

export class ErCrossroadsPhase extends Phase {
  public readonly phaseName = "ErCrossroadsPhase";

  /**
   * Crossroads is queued from the completed wave's Victory tail. A renderer can expose the next speculative
   * battle before this queued phase starts, so every durable address and callback must retain the immutable
   * construction boundary instead of consulting mutable `currentBattle` after an await.
   */
  private readonly coopSourceWave: number;
  private readonly coopSourceTurn: number;
  private readonly coopSourceBiomeId: BiomeId;
  /** Runtime that constructed this phase; async picker completion may resume under the other harness client. */
  private readonly coopOwningRuntime = getCoopRuntime();

  constructor(sourceWave: number | null = null) {
    super();
    if (sourceWave != null && (!Number.isSafeInteger(sourceWave) || sourceWave < 0)) {
      throw new Error(`[coop-op] Crossroads received invalid source wave ${sourceWave}`);
    }
    const ambientWave = globalScene.currentBattle?.waveIndex ?? -1;
    this.coopSourceWave = sourceWave ?? ambientWave;
    this.coopSourceTurn = globalScene.currentBattle?.turn ?? 0;
    this.coopSourceBiomeId = globalScene.arena.biomeId;
  }

  /** Guards against a double input firing the resolution twice. */
  private resolving = false;

  /** True while a guest-owned choice is parked on the host-committed envelope. */
  private coopCommitPending = false;
  private coopOwnerPromptState: "idle" | "opening" | "open" = "idle";

  /** Co-op (#848): interaction counter pinned at open (-1 = solo / not pinned). */
  private coopStartCounter = -1;
  private coopCommitRecovery: CoopCrossroadsContinuationRecovery | null = null;
  private coopCommitRecoveryToken = 0;

  /** Exact completed-wave identity retained across speculative next-battle projection. */
  public requireCoopSourceWave(): number {
    if (this.coopSourceWave < 0) {
      throw new Error("Crossroads has no valid source-wave identity");
    }
    return this.coopSourceWave;
  }

  start(): void {
    super.start();

    // Co-op (#848): the crossroads ALTERNATES like the reward shop / ME / bargain. The OWNER
    // drives the real Stay/Leave screen; the WATCHER mirrors it and adopts the relayed pick.
    // Solo / non-coop keeps the plain prompt below.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (coopController != null) {
      void this.coopStart(coopController);
      return;
    }

    const biomeName = getBiomeName(globalScene.arena.biomeId);
    const options: OptionSelectItem[] = [
      {
        // Plain "Stay" (keep exploring this biome) - clearer than the biome verb.
        label: "Stay",
        handler: () => {
          this.resolve(false);
          return true;
        },
      },
      {
        label: "Leave",
        handler: () => {
          this.resolve(true);
          return true;
        },
      },
    ];

    // Warn once the player is past the free window: from here, staying makes the
    // locals hostile (enemies grow stronger the longer you linger).
    const overstaying = erHasNotoriety(this.coopSourceWave);
    const prompt = overstaying
      ? `The locals in ${biomeName} grow hostile. Stay anyway, or leave?`
      : `A crossroads in ${biomeName}. Stay (locals turn hostile over time), or leave?`;

    globalScene.ui.showText(prompt, null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, delay: 500 });
    });
  }

  // ---------------------------------------------------------------------------
  // Co-op (#848) owner / watcher / mirror / relay.
  // ---------------------------------------------------------------------------

  /** The crossroads prompt text (owner + watcher render the identical line). */
  private crossroadsPrompt(): string {
    const biomeName = getBiomeName(globalScene.arena.biomeId);
    return erHasNotoriety(this.coopSourceWave)
      ? `The locals in ${biomeName} grow hostile. Stay anyway, or leave?`
      : `A crossroads in ${biomeName}. Stay (locals turn hostile over time), or leave?`;
  }

  /** Decide owner vs watcher off the pinned interaction counter and branch. */
  private async coopStart(controller: CoopSessionController): Promise<void> {
    // #848 test-scoped: a headless multi-wave test never answers the real Stay/Leave prompt. Under vitest
    // (unless the test drives the picker) resolve it DETERMINISTICALLY + SYNCHRONOUSLY, exactly like the
    // pre-#848 co-op bypass: NO interaction-counter tick and NO chained pin. This is required because the
    // authoritative soak's driver drives the guest's reward shop but NOT its crossroads, so only the host
    // would run this phase - a counter tick here would advance the host alone and breach the two-engine
    // LOCKSTEP invariant. Ticking is production behavior (both engines run the phase in lockstep, or the
    // guest runs it via VictoryPhase); the opted-in duo test exercises + asserts that path for real. Live
    // builds (no VITEST) keep the real owner/watcher prompt with the counter tick below. This branch runs
    // FIRST, before the #858 boundary barrier: an async await here would resume OUTSIDE the two-engine
    // harness's per-client ctx swap and advance the WRONG engine.
    if (coopBiomePickerAutoResolvesInTest()) {
      const moveOn = erHasNotoriety(this.coopSourceWave);
      coopLog(
        "reward",
        `crossroads AUTO-RESOLVE (vitest, picker not driven, no counter tick) -> moveOn=${moveOn} (#848)`,
      );
      globalScene.ui.setMode(UiMode.MESSAGE);
      if (moveOn) {
        setErLeaveBiomeNow();
        globalScene.phaseManager.unshiftNew("SelectBiomePhase", this.coopSourceWave);
      } else {
        erMarkBiomeStay(this.coopSourceWave);
      }
      this.end();
      return;
    }
    const spoofed = getCoopRuntime()?.spoof != null;
    // #858 BOUNDARY BARRIER: the every-10-waves biome shop and this every-5-waves crossroads are TWO
    // owner-alternated interactions that fall on the SAME wave boundary. Reciprocally rendezvous here so
    // BOTH clients have LEFT the shop (its interaction terminated on both) before EITHER pins this
    // interaction's counter + splits owner/watcher. Without it, a partner that finished the shop and raced
    // ahead into this crossroads (or whose shop-watch timed out while the owner legitimately still held the
    // market) broadcasts an ADVANCED interaction counter; the lagging client's own shop-terminal advance
    // then CATCHES UP past this interaction's counter (the coop-session `pendingRemote` fold), so it pins
    // the WRONG counter, mismatches the relay seq, times out, and fires the deterministic Stay/Leave
    // fallback ONE-SIDED -> one client leaves + changes biome while the other stays -> biome divergence.
    // The barrier makes the pin below read in LOCKSTEP; timeout retransmits and never authorizes a one-sided
    // pin. Skipped in the hotseat spoof path (no real peer to rendezvous with).
    if (!spoofed && !(await this.coopAwaitBoundaryBarrier())) {
      return;
    }
    if (this.coopStartCounter < 0) {
      this.coopStartCounter = controller.interactionCounter();
    }
    const pinned = this.coopStartCounter;
    const owns = spoofed || controller.isLocalOwnerAtCounter(pinned);
    coopLog(
      "reward",
      `crossroads owner/watcher decision: pinnedStart=${pinned} role=${controller.role} spoof=${spoofed} -> ${owns ? "OWNER" : "WATCHER"} (#848)`,
    );
    if (owns) {
      this.coopOwnerFlow(pinned);
    } else {
      await this.coopWatchFlow(pinned);
    }
  }

  /**
   * Co-op (#858): the reciprocal boundary barrier between the preceding biome-shop interaction and this
   * one. Blocks until the PARTNER has ALSO reached this wave's crossroads (i.e. both clients have left the
   * shop), so neither pins the interaction counter while the other still holds the shop. The point derives
   * from the WAVE only (never the interaction counter - a drifting counter is the very thing this guards),
   * so both clients compute it identically. Lost arrivals retransmit; teardown/error aborts remain closed.
   */
  private async coopAwaitBoundaryBarrier(): Promise<boolean> {
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    if (!this.boundaryStillLive(generation, wave)) {
      return false;
    }
    try {
      const rendezvous = getCoopRendezvous();
      if (rendezvous == null || wave < 0) {
        return true;
      }
      const point = `xroads:${wave}`;
      coopLog("rendezvous", `crossroads boundary barrier RENDEZVOUS ${point} (#858)`);
      const result = await rendezvous.rendezvous(point, getCoopRendezvousWaitMs());
      if (!this.boundaryStillLive(generation, wave)) {
        return false;
      }
      if (result.timedOut) {
        coopWarn(
          "rendezvous",
          `crossroads boundary barrier ${point} ABORTED during teardown/recovery - remaining closed (#858)`,
        );
        return false;
      }
      if (result.authoritativePoint !== undefined && result.authoritativePoint !== point) {
        coopWarn(
          "rendezvous",
          `crossroads boundary ${point} ROUTED AWAY to host-authoritative ${result.authoritativePoint}; closing stale phase`,
        );
        this.end();
        return false;
      }
      if (result.crossPoint !== undefined) {
        coopLog(
          "rendezvous",
          `crossroads boundary ${point} host-authoritative route ACKED (partner had ${result.crossPoint}); proceeding (#858)`,
        );
      }
      return true;
    } catch (e) {
      if (!this.boundaryStillLive(generation, wave)) {
        return false;
      }
      coopWarn("rendezvous", "crossroads boundary barrier threw - FAIL CLOSED (#858)", e);
      return false;
    }
  }

  /** OWNER: drive the real Stay/Leave screen; each pick relays out + applies. */
  private coopOwnerFlow(pinned: number): void {
    if (this.coopOwnerPromptState !== "idle") {
      return;
    }
    this.coopOwnerPromptState = "opening";
    const mirrorSeq = COOP_CROSSROADS_SEQ_BASE + pinned;
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const options: OptionSelectItem[] = [
      {
        label: "Stay",
        handler: () => {
          if (!this.boundaryStillLive(generation, wave)) {
            return false;
          }
          this.coopOwnerCommit(pinned, false);
          return true;
        },
      },
      {
        label: "Leave",
        handler: () => {
          if (!this.boundaryStillLive(generation, wave)) {
            return false;
          }
          this.coopOwnerCommit(pinned, true);
          return true;
        },
      },
    ];
    // The prompt is cosmetic. Opening the authoritative picker never depends on its text callback.
    globalScene.ui.showText(this.crossroadsPrompt());
    void globalScene.ui
      .setModeBoundedWhen(UiMode.OPTION_SELECT, 2_000, () => this.boundaryStillLive(generation, wave), {
        options,
        delay: 500,
      })
      .then(result => {
        if (!this.boundaryStillLive(generation, wave)) {
          return;
        }
        if (result === "superseded") {
          this.coopOwnerPromptState = "idle";
          this.parkCrossroadsCommitRecovery(() => this.coopOwnerFlow(pinned));
          return;
        }
        this.clearCrossroadsCommitRecovery();
        this.coopOwnerPromptState = "open";
        getCoopUiMirror()?.beginSession("owner", UiMode.OPTION_SELECT, mirrorSeq);
        // Crossroads can be the first actionable surface after the every-ten-wave market. Publishing from
        // the real, active picker keeps the retained WAVE_ADVANCE journal closed until a player can act;
        // merely queuing this phase is deliberately insufficient.
        this.notifyCoopContinuationSurfaceReady();
      });
  }

  /** Publish only after the phase's own runtime and scene are installed together. */
  private notifyCoopContinuationSurfaceReady(): void {
    const notify = () => notifyCoopWaveContinuationSurfaceReady(this.coopSourceWave);
    if (this.coopOwningRuntime == null) {
      notify();
      return;
    }
    runWhenCoopRuntimeActive(this.coopOwningRuntime, notify);
  }

  /** OWNER terminal: relay the Stay(0)/Leave(1) choice, then apply it locally. */
  private coopOwnerCommit(pinned: number, moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    getCoopUiMirror()?.endSession();
    const seq = COOP_CROSSROADS_SEQ_BASE + pinned;
    const choice = moveOn ? 1 : 0;
    const operationId = coopBiomeOperationId("CROSSROADS_PICK", seq, pinned);
    const relay = getCoopInteractionRelay();
    const resend = (): void => {
      relay?.sendInteractionChoice(seq, "crossroads", choice);
    };
    try {
      resend();
      coopLog("reward", `crossroads OWNER commit moveOn=${moveOn} pinnedStart=${pinned} (#848)`);
    } catch {
      coopWarn("reward", "crossroads OWNER relay send threw (handled - deterministic resend remains armed) (#848)");
    }
    // Wave-2a: DUAL-RUN - additionally COMMIT the typed Stay/Leave intent through the authoritative
    // operation primitive. No-op when the flag is OFF; the legacy relay above stays the fallback.
    const role = getCoopController()?.role ?? "guest";
    const commit = commitBiomeOwnerIntent({
      kind: "CROSSROADS_PICK",
      seq,
      pinned,
      choice,
      payload: { optionIndex: choice },
      localRole: role,
      wave: this.requireCoopSourceWave(),
      turn: 0,
      boundarySourceBiomeId: this.coopSourceBiomeId,
      boundaryNextWave: this.requireCoopSourceWave() + 1,
      allowedRoutes: [],
      deterministicDestination: null,
    });
    if (isCoopBiomeOperationEnabled() && commit == null) {
      this.parkCrossroadsCommitRecovery(() => this.coopOwnerCommit(pinned, moveOn));
      return;
    }
    const committedMoveOn =
      commit?.payload != null && "optionIndex" in commit.payload ? commit.payload.optionIndex === 1 : moveOn;
    if (coopBiomeCommitRequired(role)) {
      const generation = coopSessionGeneration();
      const wave = this.requireCoopSourceWave();
      armCoopBiomeIntentResend({
        operationId,
        wave,
        phaseName: "ErCrossroadsPhase",
        sessionGeneration: generation,
        resend,
        isCurrent: () =>
          coopSessionGeneration() === generation
          && this.coopSourceWave === wave
          && globalScene.phaseManager.getCurrentPhase() === this,
      });
      this.coopCommitPending = true;
      void this.finishGuestOwnedCrossroadsAfterCommit(operationId, pinned, committedMoveOn);
      return;
    }
    this.coopApply(pinned, committedMoveOn);
  }

  /** WATCHER: open a read-only mirrored copy, await the owner's pick, apply it. (Not reached under the
   *  vitest auto-resolve - coopStart resolves synchronously before the owner/watcher split.) */
  private async coopWatchFlow(pinned: number): Promise<void> {
    const mirrorSeq = COOP_CROSSROADS_SEQ_BASE + pinned;
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    // Read-only copy of the SAME screen for the cursor mirror. The handlers are cosmetic
    // no-ops: the awaited relay is the sole authority (a replayed owner ACTION must never
    // resolve the watcher against its own possibly-drifted cursor).
    const watchOptions: OptionSelectItem[] = [
      { label: "Stay", handler: () => true },
      { label: "Leave", handler: () => true },
    ];
    try {
      // Show the prompt COSMETICALLY (never block the relay-await on a text-advance callback), then
      // open the mirrored menu.
      globalScene.ui.showText(this.crossroadsPrompt());
      const mode = await globalScene.ui.setModeBoundedWhen(
        UiMode.OPTION_SELECT,
        2_000,
        () => this.boundaryStillLive(generation, wave),
        { options: watchOptions, delay: 500 },
      );
      if (!this.boundaryStillLive(generation, wave)) {
        return;
      }
      if (mode === "superseded") {
        this.parkCrossroadsCommitRecovery(() => {
          this.coopWatchFlow(pinned).catch(error =>
            coopWarn("reward", "crossroads WATCHER UI retry threw - remaining closed", error),
          );
        });
        return;
      }
      this.clearCrossroadsCommitRecovery();
      getCoopUiMirror()?.beginSession("watcher", UiMode.OPTION_SELECT, mirrorSeq);
      // The watcher is a real public continuation too. Only the authoritative guest runtime can consume
      // this notification, so owner parity cannot leave the retained wave waiting on the wrong renderer.
      this.notifyCoopContinuationSurfaceReady();
    } catch {
      /* cosmetic - the awaited relay still drives the authoritative apply below */
    }
    const relay = getCoopInteractionRelay();
    // #863: bound the wait with the one-sided ORPHAN backstop (same class as the biome pick). If the OWNER
    // commits Stay/Leave + advances PAST this interaction but its relay never reaches us, dismiss PROMPTLY
    // to the deterministic fallback below instead of freezing the crossroads screen on the 20-min timeout.
    const res =
      relay == null
        ? null
        : await awaitCoopChoiceWithOrphanBackstop(
            relay,
            getCoopController(),
            COOP_CROSSROADS_SEQ_BASE + pinned,
            pinned,
            COOP_CROSSROADS_CHOICE_KINDS,
          );
    if (!this.boundaryStillLive(generation, wave)) {
      getCoopUiMirror()?.endSession();
      return;
    }
    getCoopUiMirror()?.endSession();
    // Wave-2a: gate adoption through the authoritative operation primitive (idempotent + stale-/late-
    // rejecting, the #861 shape). Flag OFF -> pass-through (legacy). A reject falls to the deterministic
    // backstop below, exactly like a relay timeout.
    const role = getCoopController()?.role ?? "guest";
    const operationId = coopBiomeOperationId("CROSSROADS_PICK", COOP_CROSSROADS_SEQ_BASE + pinned, pinned);
    if (coopBiomeCommitRequired(role)) {
      await this.finishCommittedCrossroadsWatcher(operationId, pinned);
      return;
    }
    this.applyCrossroadsWatcherDecision(pinned, operationId, role, res == null ? null : { choice: res.choice }, false);
  }

  private committedCrossroadsChoice(receipt: CoopBiomeCommitReceipt | null, operationId: string): number | null {
    const payload = receipt?.payload as CoopCrossroadsPickPayload | undefined;
    if (
      receipt == null
      || receipt.operationId !== operationId
      || receipt.kind !== "CROSSROADS_PICK"
      || receipt.wave !== this.requireCoopSourceWave()
      || (payload?.optionIndex !== 0 && payload?.optionIndex !== 1)
    ) {
      return null;
    }
    return payload.optionIndex;
  }

  private async finishCommittedCrossroadsWatcher(operationId: string, pinned: number): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const receipt = await awaitCoopBiomeCommitReceipt(operationId);
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }
    const choice = this.committedCrossroadsChoice(receipt, operationId);
    if (choice == null) {
      this.parkCrossroadsCommitRecovery(() => {
        this.finishCommittedCrossroadsWatcher(operationId, pinned).catch(e =>
          coopWarn("reward", "crossroads WATCHER receipt retry threw - remaining closed", e),
        );
      });
      return;
    }
    this.applyCrossroadsWatcherDecision(pinned, operationId, "guest", { choice }, true);
  }

  private applyCrossroadsWatcherDecision(
    pinned: number,
    operationId: string,
    role: "host" | "guest",
    res: CoopBiomeRelayResult | null,
    committed: boolean,
  ): void {
    const decision = adoptBiomeWatcherChoice({
      kind: "CROSSROADS_PICK",
      seq: COOP_CROSSROADS_SEQ_BASE + pinned,
      pinned,
      res,
      localRole: role,
      wave: this.requireCoopSourceWave(),
      turn: 0,
      sourceBiomeId: this.coopSourceBiomeId,
      nextWave: this.requireCoopSourceWave() + 1,
      allowedRoutes: [],
      deterministicDestination: null,
    });
    if (committed && !decision.adopt) {
      coopWarn(
        "reward",
        `crossroads WATCHER refused committed envelope id=${operationId} reason=${decision.reason} - remaining closed`,
      );
      this.parkCrossroadsCommitRecovery(() => {
        this.finishCommittedCrossroadsWatcher(operationId, pinned).catch(e =>
          coopWarn("reward", "crossroads WATCHER adoption retry threw - remaining closed", e),
        );
      });
      return;
    }
    if (role === "host" && isCoopBiomeOperationEnabled() && !decision.adopt) {
      coopWarn(
        "reward",
        `crossroads WATCHER refused uncommitted/invalid intent id=${operationId} reason=${decision.reason} - remaining closed`,
      );
      this.parkCrossroadsCommitRecovery(() => {
        this.coopWatchFlow(pinned).catch(e =>
          coopWarn("reward", "crossroads WATCHER relay retry threw - remaining closed", e),
        );
      });
      return;
    }
    let moveOn: boolean;
    if (decision.adopt) {
      moveOn = decision.choice === 1;
      coopLog("reward", `crossroads WATCHER: owner pick received moveOn=${moveOn} pinnedStart=${pinned} (#848)`);
    } else {
      // ANTI-HANG (#848): disconnect / stall / stale-reject backstop. Both clients fall back to the SAME
      // deterministic auto-resolve (leave once the locals turned hostile), so the fallback cannot desync -
      // it is what both would independently compute off the shared wave index.
      moveOn = erHasNotoriety(this.coopSourceWave);
      coopWarn(
        "reward",
        `crossroads WATCHER: owner pick TIMEOUT/disconnect/reject(${decision.reason}) -> deterministic fallback moveOn=${moveOn} (#848)`,
      );
    }
    const applied = this.coopApply(pinned, moveOn);
    if (committed && applied) {
      releaseCoopBiomeCommitReceipt(operationId);
    }
  }

  private async finishGuestOwnedCrossroadsAfterCommit(
    operationId: string,
    pinned: number,
    moveOn: boolean,
  ): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const receipt = await awaitCoopBiomeCommitReceipt(operationId);
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }
    if (this.committedCrossroadsChoice(receipt, operationId) !== (moveOn ? 1 : 0)) {
      this.coopCommitPending = false;
      this.parkCrossroadsCommitRecovery(() => {
        this.coopCommitPending = true;
        this.finishGuestOwnedCrossroadsAfterCommit(operationId, pinned, moveOn).catch(e =>
          coopWarn("reward", "crossroads OWNER receipt retry threw - remaining closed", e),
        );
      });
      return;
    }
    this.coopCommitPending = false;
    if (this.coopApply(pinned, moveOn)) {
      releaseCoopBiomeCommitReceipt(operationId);
    }
  }

  private parkCrossroadsCommitRecovery(retry: () => void): void {
    getCoopUiMirror()?.endSession();
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }

    const turn = this.coopSourceTurn;
    const boundaryRevision =
      this.coopStartCounter >= 0 ? this.coopStartCounter : Math.max(0, getCoopController()?.interactionCounter() ?? 0);
    let recovery = this.coopCommitRecovery;
    if (
      recovery == null
      || recovery.generation !== generation
      || recovery.wave !== wave
      || recovery.turn !== turn
      || recovery.boundaryRevision !== boundaryRevision
    ) {
      this.clearCrossroadsCommitRecovery();
      recovery = {
        generation,
        wave,
        turn,
        boundaryRevision,
        token: ++this.coopCommitRecoveryToken,
        retry,
        retries: 0,
        retryTimer: null,
        deadlineTimer: null,
        terminalRequested: false,
      };
      this.coopCommitRecovery = recovery;
      const token = recovery.token;
      recovery.deadlineTimer = setTimeout(() => {
        const current = this.coopCommitRecovery;
        if (current?.token !== token) {
          return;
        }
        if (this.crossroadsCommitRecoveryStillLive(current)) {
          this.exhaustCrossroadsCommitRecovery(current, "absolute deadline");
        } else {
          this.clearCrossroadsCommitRecovery();
        }
      }, coopCrossroadsContinuationRecoveryPolicy.deadlineMs);
    } else {
      recovery.retry = retry;
    }

    if (recovery.terminalRequested || recovery.retryTimer != null) {
      return;
    }
    if (recovery.retries >= coopCrossroadsContinuationRecoveryPolicy.maxAutomaticRetries) {
      this.exhaustCrossroadsCommitRecovery(recovery, "exact receipt retries exhausted");
      return;
    }

    // The screen is cosmetic recovery feedback. Supersede/failure cannot consume another exact retry or
    // install an input callback that a player must press before the shared session can make progress.
    globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.crossroadsCommitRecoveryStillLive(recovery))
      .catch(error => coopWarn("reward", "crossroads continuation recovery UI failed (retry remains armed)", error));
    globalScene.ui.showText("Recovering the shared crossroads choice…");

    const token = recovery.token;
    const delay = coopCrossroadsContinuationRecoveryPolicy.retryDelayMs * (recovery.retries + 1);
    recovery.retryTimer = setTimeout(() => {
      const current = this.coopCommitRecovery;
      if (current?.token !== token) {
        return;
      }
      if (!this.crossroadsCommitRecoveryStillLive(current)) {
        this.clearCrossroadsCommitRecovery();
        return;
      }
      current.retryTimer = null;
      current.retries++;
      const exactRetry = current.retry;
      try {
        exactRetry();
      } catch (error) {
        coopWarn("reward", "crossroads continuation exact retry threw - remaining closed", error);
        this.parkCrossroadsCommitRecovery(exactRetry);
      }
    }, delay);
  }

  private crossroadsCommitRecoveryStillLive(recovery: CoopCrossroadsContinuationRecovery): boolean {
    return (
      this.coopCommitRecovery === recovery
      && !recovery.terminalRequested
      && this.boundaryStillLive(recovery.generation, recovery.wave)
    );
  }

  private exhaustCrossroadsCommitRecovery(recovery: CoopCrossroadsContinuationRecovery, detail: string): void {
    if (!this.crossroadsCommitRecoveryStillLive(recovery)) {
      return;
    }
    recovery.terminalRequested = true;
    if (recovery.retryTimer != null) {
      clearTimeout(recovery.retryTimer);
      recovery.retryTimer = null;
    }
    if (recovery.deadlineTimer != null) {
      clearTimeout(recovery.deadlineTimer);
      recovery.deadlineTimer = null;
    }
    coopWarn(
      "reward",
      `crossroads continuation recovery exhausted (${detail}) wave=${recovery.wave} turn=${recovery.turn} revision=${recovery.boundaryRevision}`,
    );
    failCoopSharedSession("The shared crossroads choice could not recover.", {
      boundary: "surface",
      reasonCode: "continuation-failed",
      wave: recovery.wave,
      turn: recovery.turn,
      boundaryRevision: recovery.boundaryRevision,
    });
  }

  private clearCrossroadsCommitRecovery(): void {
    const recovery = this.coopCommitRecovery;
    this.coopCommitRecovery = null;
    this.coopCommitRecoveryToken++;
    if (recovery?.retryTimer != null) {
      clearTimeout(recovery.retryTimer);
    }
    if (recovery?.deadlineTimer != null) {
      clearTimeout(recovery.deadlineTimer);
    }
  }

  override end(): void {
    this.clearCrossroadsCommitRecovery();
    super.end();
  }

  private boundaryStillLive(generation: number, wave: number): boolean {
    return (
      coopSessionGeneration() === generation
      && this.coopSourceWave === wave
      && globalScene.phaseManager.getCurrentPhase() === this
    );
  }

  /**
   * Apply the resolved Stay/Leave on BOTH clients (owner after its pick, watcher after the
   * relay). STAY is the terminal here (advance the shared counter once). LEAVE DEFERS the
   * terminal to the chained SelectBiomePhase - it pins the interaction counter so that phase
   * completes the SAME interaction with the single advance at the map pick.
   */
  private coopApply(pinned: number, moveOn: boolean): boolean {
    if (this.resolving || this.coopCommitPending) {
      return false;
    }
    this.resolving = true;
    try {
      const generation = coopSessionGeneration();
      const wave = this.requireCoopSourceWave();
      void globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.boundaryStillLive(generation, wave));
      if (moveOn) {
        // End the biome now; open the World Map picker ahead of the queued NewBattlePhase. The
        // chained SelectBiomePhase owns the single terminal advance for the whole decision.
        setErLeaveBiomeNow();
        setCoopBiomeInteractionStart(pinned);
        globalScene.phaseManager.unshiftNew("SelectBiomePhase", this.coopSourceWave);
      } else {
        // STAY: arm the overstay anchor (a no-op inside the free window) and terminate the
        // interaction here with the single from-pinned advance.
        erMarkBiomeStay(this.coopSourceWave);
        const controller = getCoopController();
        advanceCoopInteractionForContinuation(pinned);
        if (controller != null && controller.interactionCounter() <= pinned) {
          throw new Error(`Crossroads interaction ${pinned} did not advance`);
        }
      }
      this.end();
      return true;
    } catch (error) {
      coopWarn("reward", `crossroads terminal failed after committed choice pinned=${pinned} moveOn=${moveOn}`, error);
      failCoopSharedSession(`Crossroads terminal could not apply atomically for ${pinned}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Solo.
  // ---------------------------------------------------------------------------

  private resolve(moveOn: boolean): void {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // #record-replay (single-player): capture the crossroads Stay(0)/Leave(1) choice. No-op unless
    // recording (co-op captures via the relay taps instead).
    recordSinglePlayerInteraction("crossroads", moveOn ? 1 : 0);
    globalScene.ui.setMode(UiMode.MESSAGE);

    if (moveOn) {
      // End the biome now: flag the early exit (isNewBiome honors it) and open the
      // World Map node picker ahead of the queued NewBattlePhase.
      setErLeaveBiomeNow();
      globalScene.phaseManager.unshiftNew("SelectBiomePhase", this.coopSourceWave);
    } else {
      // STAY: the run continues in this biome. If this is a deliberate choice to
      // linger PAST the notoriety-free window, arm the overstay anchor - from here
      // the locals grow hostile (enemies climb in level + power the longer you
      // stay). Inside the free window this is a no-op (staying is still free).
      erMarkBiomeStay(this.coopSourceWave);
    }
    this.end();
  }
}
