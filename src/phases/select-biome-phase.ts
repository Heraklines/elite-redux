import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  adoptBiomeWatcherChoice,
  armCoopBiomeIntentResend,
  awaitCoopBiomeCommitReceipt,
  awaitCoopBiomeTransitionCommitReceipt,
  type CoopBiomeCommitReceipt,
  type CoopBiomeOperationBinding,
  type CoopBiomeRelayResult,
  captureCoopBiomeOperationBinding,
  commitAuthoritativeBiomeTransition,
  commitBiomeAuthoritativeResult,
  commitBiomeOwnerIntent,
  coopAuthoritativeBiomeTransitionOperationId,
  coopBiomeCommitRequired,
  coopBiomeOperationId,
  getCoopBiomeTransitionCommitReceipt,
  isCoopBiomeOperationEnabled,
  releaseCoopBiomeCommitReceipt,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  clearCoopBiomeInteractionStart,
  coopBiomeInteractionInProgress,
  coopBiomeInteractionStartValue,
  coopBiomePickerAutoResolvesInTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { awaitCoopChoiceWithOrphanBackstop } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopBiomePickPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import { getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  advanceCoopInteractionForContinuation,
  coopSessionGeneration,
  enterCoopV2BiomeControlBoundary,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRendezvous,
  getCoopRuntime,
  getCoopUiMirror,
  notifyCoopV2InteractionSurfaceReady,
  notifyCoopWaveContinuationSurfaceReady,
  resolveCoopRetainedWaveContinuationIdentity,
  runWhenCoopRuntimeActive,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_PICK_CHOICE_KINDS, COOP_BIOME_PICK_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { coopInteractionOwnerSeat } from "#data/elite-redux/coop/coop-session";
import type { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import {
  type ErRouteNode,
  erBiomeRoutingActive,
  erPendingNodesReady,
  getErPendingNodes,
  getErPrevBiome,
  rollErNextBiomeNodes,
} from "#data/elite-redux/er-biome-routing";
import {
  clearMapTravelTarget,
  consumeMapTravelTarget,
  getAuthoritativeMapTravelClassification,
  getMapTravelTarget,
} from "#data/elite-redux/er-map-nodes";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { MapModifier, MoneyInterestModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, getBiomeName, randSeedInt, randSeedItem } from "#utils/common";
import { enumValueToKey } from "#utils/enums";

interface CoopBiomeContinuationRecoveryPolicy {
  readonly retryDelayMs: number;
  readonly maxAutomaticRetries: number;
  readonly deadlineMs: number;
}

const DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY: CoopBiomeContinuationRecoveryPolicy = {
  retryDelayMs: 250,
  maxAutomaticRetries: 2,
  // Each exact receipt wait is already capped at 60s. Two automatic re-awaits leave a full reconnect
  // window while this independent ceiling guarantees that a callback which never settles cannot park forever.
  deadlineMs: 125_000,
};

let coopBiomeContinuationRecoveryPolicy = DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY;

/** Keep production recovery generous while allowing production-shaped tests to prove exhaustion quickly. */
export function setCoopBiomeContinuationRecoveryPolicyForTest(
  policy: Partial<CoopBiomeContinuationRecoveryPolicy>,
): void {
  coopBiomeContinuationRecoveryPolicy = {
    retryDelayMs: Math.max(
      1,
      Math.trunc(policy.retryDelayMs ?? DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY.retryDelayMs),
    ),
    maxAutomaticRetries: Math.max(
      0,
      Math.trunc(policy.maxAutomaticRetries ?? DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY.maxAutomaticRetries),
    ),
    deadlineMs: Math.max(
      1,
      Math.trunc(policy.deadlineMs ?? DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY.deadlineMs),
    ),
  };
}

export function resetCoopBiomeContinuationRecoveryPolicyForTest(): void {
  coopBiomeContinuationRecoveryPolicy = DEFAULT_COOP_BIOME_CONTINUATION_RECOVERY_POLICY;
}

interface CoopBiomeContinuationRecovery {
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

export class SelectBiomePhase extends BattlePhase {
  public readonly phaseName = "SelectBiomePhase";
  /** Exact Authority V2 operation whose public map handler this phase proves. */
  public coopV2ControlOperationId: string | null = null;
  /** Immutable wave that created this biome transition; never re-read from a speculative next Battle. */
  private coopSourceWave: number | null;
  /**
   * Construction-time fallback for non-WAVE map sources (Crossroads, moves, abilities and MEs). A retained
   * transaction, when present, still wins at start; capturing this now prevents an awaited UI/network seam
   * from re-addressing the map through a speculative next Battle.
   */
  private readonly coopConstructionWave: number;
  /** Immutable settlement turn that authored this map control; V2 projection supplies it explicitly. */
  private readonly coopSourceTurn: number;

  /**
   * Co-op (#848): the interaction counter to advance ONCE at the terminal, or -1 when this
   * transition ticks no alternation counter. Set when this phase participates in a biome
   * interaction: a chained crossroads-Leave (always, so the deferred crossroads terminal lands
   * here) or a multi-node World-Map pick (pinned at the picker). A purely-deterministic natural
   * transition with no picker leaves it -1 and never ticks the shared counter.
   */
  private coopAdvancePinned = -1;
  /** Co-op (#848): whether this phase completes a deferred crossroads-Leave interaction. */
  private coopChained = false;
  /**
   * Co-op (#864): whether the LOCAL client OWNS this biome interaction (so it must RELAY the chosen
   * biome to the watcher). Set for a natural multi-node pick (in {@linkcode coopBiomePickFlow}) AND for a
   * chained crossroads-Leave (from the pinned counter's parity, in {@linkcode start}). When true, EVERY
   * terminal - the World-Map pick, a deterministic single-node / travel-target / random resolution, or
   * an anti-hang fallback - relays through the single funnel in {@linkcode setNextBiomeAndEnd}, so the
   * owner can NEVER travel one-sided-silently (the #864 P0: the owner changed biome without emitting the
   * biomePick relay, freezing the watcher on the map screen).
   */
  private coopIsBiomeOwner = false;
  /** Co-op (#864): the revealed onward node set (owner side), so the funnel can carry the picked INDEX
   *  alongside the biome id. Null for a deterministic terminal that never built a node set. */
  private coopRevealed: ErRouteNode[] | null = null;
  /** Co-op (#864): guards the single owner biomePick relay send against a double-fire (idempotent). */
  private coopBiomeRelaySent = false;
  /** Host-derived terminal allowed to use nodeIndex=-1; null means a revealed-route picker must match. */
  private coopDeterministicDestination: BiomeId | null = null;
  /** Prevent a double UI terminal while this guest is parked on the host-committed BIOME_PICK envelope. */
  private coopCommitPending = false;
  private coopRouteRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private coopRouteRetryAttempts = 0;
  private coopRouteRecoveryShown = false;
  private coopCommitRecovery: CoopBiomeContinuationRecovery | null = null;
  private coopCommitRecoveryToken = 0;
  /** The local transition terminal is applied once even when immutable-result publication must retry. */
  private coopAppliedTerminal: { readonly destination: BiomeId; readonly operationId?: string } | null = null;
  /** Runtime/durability selectors captured before any rendezvous, timer, or Phaser UI callback can resume. */
  private coopBiomeOperationBinding: CoopBiomeOperationBinding | null = null;
  /** Exact runtime retained across UI/network callbacks in the two-engine topology. */
  private readonly coopOwningRuntime = getCoopRuntime();

  constructor(coopSourceWave: number | null = null, coopSourceTurn: number | null = null) {
    super();
    if (coopSourceTurn != null && (!Number.isSafeInteger(coopSourceTurn) || coopSourceTurn < 0)) {
      throw new Error(`[coop-op] SelectBiomePhase received invalid source turn ${coopSourceTurn}`);
    }
    this.coopSourceWave = coopSourceWave;
    this.coopConstructionWave = coopSourceWave ?? globalScene.currentBattle?.waveIndex ?? -1;
    this.coopSourceTurn = coopSourceTurn ?? globalScene.currentBattle?.turn ?? 0;
  }

  /** Bind the exact chained-map successor before recovery releases this phase. */
  public installCoopV2BiomeProjection(
    operationId: string,
    sourceWave: number,
    sourceTurn: number = this.coopSourceTurn,
  ): boolean {
    if (
      operationId.length === 0
      || !Number.isSafeInteger(sourceWave)
      || sourceWave < 0
      || (this.coopSourceWave != null && this.coopSourceWave !== sourceWave)
      || sourceTurn !== this.coopSourceTurn
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopSourceWave = sourceWave;
    this.coopV2ControlOperationId = operationId;
    return true;
  }

  /** Capture one durable address before any UI/network await can observe a newer ambient battle. */
  private requireCoopSourceWave(): number {
    if (this.coopSourceWave != null) {
      return this.coopSourceWave;
    }
    // Explicit source addresses (VictoryPhase and retained callers) win immediately. Otherwise prefer the
    // one unresolved retained transaction, but permit a genuinely absent candidate because SelectBiome is
    // also a public continuation for non-wave operations. The resolver still returns invalid for one
    // malformed or multiple ambiguous candidates, which must fail closed rather than use this fallback.
    const identity = resolveCoopRetainedWaveContinuationIdentity(true, true);
    if (identity.kind === "invalid") {
      throw new Error(identity.reason);
    }
    this.coopSourceWave = identity.kind === "retained" ? identity.address.wave : this.coopConstructionWave;
    if (!Number.isSafeInteger(this.coopSourceWave) || this.coopSourceWave < 0) {
      throw new Error(
        `[coop-op] SelectBiomePhase cannot capture source wave from construction=${this.coopConstructionWave}`,
      );
    }
    return this.coopSourceWave;
  }

  private requireCoopBiomeOperationBinding(): CoopBiomeOperationBinding {
    this.coopBiomeOperationBinding ??= captureCoopBiomeOperationBinding();
    return this.coopBiomeOperationBinding;
  }

  private requireCoopBiomeOperationRole(): "host" | "guest" {
    const role = this.requireCoopBiomeOperationBinding().opState.localRole;
    if (role == null) {
      throw new Error("[coop-op] surface=biome continuation binding has no local role");
    }
    return role;
  }

  start() {
    super.start();

    let currentWaveIndex: number;
    try {
      currentWaveIndex = this.requireCoopSourceWave();
    } catch (error) {
      coopWarn("reward", "SelectBiome could not capture its retained source wave - remaining closed", error);
      failCoopSharedSession("The shared World Map transition lost its source address.");
      return;
    }

    const authoritativeGuest = isCoopAuthoritativeGuestGated();
    if (!authoritativeGuest) {
      globalScene.resetSeed();
    }

    const gameMode = globalScene.gameMode;
    const currentBiome = globalScene.arena.biomeId;
    const nextWaveIndex = currentWaveIndex + 1;

    // Co-op (#848): a crossroads LEAVE deferred its owner-alternated terminal to this phase (the
    // whole Stay/Leave->biome decision is ONE interaction). Adopt its pin so this phase advances the
    // shared counter exactly once at its terminal, whatever biome path it resolves through below.
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (coopController != null) {
      try {
        const binding = this.requireCoopBiomeOperationBinding();
        if (binding.opState.localRole !== coopController.role) {
          throw new Error(
            `[coop-op] surface=biome captured role=${binding.opState.localRole ?? "none"} does not match controller=${coopController.role}`,
          );
        }
      } catch (error) {
        coopWarn("reward", "SelectBiome could not capture its owning operation runtime - remaining closed", error);
        failCoopSharedSession("The shared World Map transition lost its runtime binding.");
        return;
      }
    }
    // #848 test-scoped: under vitest (unless the test drives the picker) the biome pick auto-resolves like
    // the pre-#848 co-op bypass - see the guarded return below. In that mode this phase must NOT tick the
    // interaction counter (the authoritative soak's driver never runs the guest's biome pick, so a tick
    // would advance the host alone and breach two-engine LOCKSTEP), so skip adopting the chained pin.
    const coopAutoResolve = coopController != null && coopBiomePickerAutoResolvesInTest();
    if (coopController != null && !coopAutoResolve && coopBiomeInteractionInProgress()) {
      this.coopChained = true;
      this.coopAdvancePinned = coopBiomeInteractionStartValue();
      // Co-op (#864): the crossroads pinned the counter + already decided the owner; adopt that ownership
      // NOW (before any deterministic terminal runs) so a chained Leave that resolves to a single-node /
      // travel-target biome (never opening the picker) STILL relays the biome to the watcher instead of
      // travelling one-sided-silently.
      this.coopIsBiomeOwner = coopController.isLocalOwnerAtCounter(this.coopAdvancePinned);
    }

    if (
      (gameMode.isClassic && gameMode.isWaveFinal(nextWaveIndex + 9))
      || (gameMode.isDaily && gameMode.isWaveFinal(nextWaveIndex))
      || (gameMode.hasShortBiomes && !(nextWaveIndex % 50))
    ) {
      this.setDeterministicNextBiomeAndEnd(BiomeId.END);
      return;
    }

    // ER (#486): a travel event (The Storm / Ultra Wormhole / Echo Chamber) may
    // have set a destination from a revealed map node. Honor it for this single
    // transition, ahead of the normal biome links - but never over the run finale
    // (handled above, which returns before we consume the target).
    const travelClassification = authoritativeGuest ? getAuthoritativeMapTravelClassification(currentWaveIndex) : null;
    // A chained Crossroads Leave already pins one exact biome boundary. Its retained terminal can be
    // either the interactive BIOME_PICK address or the wave-scoped deterministic address, so a renderer
    // with a late/missing travel-classification carrier must still enter that bounded receipt path. The
    // exact commit (never local target/RNG) resolves any host-vs-renderer route-classification difference.
    if (
      authoritativeGuest
      && getCoopBiomeTransitionCommitReceipt({ sourceWave: currentWaveIndex }, this.requireCoopBiomeOperationBinding())
        != null
    ) {
      this.awaitAuthoritativeDeterministicBiome();
      return;
    }
    if (authoritativeGuest && travelClassification?.ready !== true && !this.coopChained) {
      this.parkForAuthoritativeRoutes(currentWaveIndex);
      return;
    }
    const travelTarget = authoritativeGuest
      ? (travelClassification?.target ?? null)
      : coopController?.netcodeMode === "authoritative"
        ? getMapTravelTarget()
        : consumeMapTravelTarget();
    if (travelTarget != null) {
      this.setDeterministicNextBiomeAndEnd(travelTarget);
      return;
    }

    // #848 test-scoped: auto-resolve the biome DETERMINISTICALLY off the just-reset shared wave seed with
    // NO counter tick (coopAdvancePinned stays -1), exactly like the pre-#848 co-op bypass - so the
    // driver-based soak (which does not drive the guest's biome pick) stays in two-engine lockstep. The
    // real owner/watcher/mirror picker below runs in production + the opted-in duo test.
    if (coopAutoResolve) {
      if (authoritativeGuest) {
        this.awaitAuthoritativeDeterministicBiome();
      } else {
        this.setDeterministicNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      }
      return;
    }

    // ER (#486): the branching World Map graph. Build the next-biome node set
    // (base links + 50%-rolled unexpected adjacents, minus the biome we came
    // from, with reveal gated by Map Upgrade tier) and let the player choose.
    if (erBiomeRoutingActive()) {
      // Reuse the nodes rolled + shown on the map when this biome was entered, so
      // the chooser matches the overlay. Fall back to a fresh roll (e.g. run start).
      const pending = getErPendingNodes();
      if (isCoopAuthoritativeGuestGated() && (!erPendingNodesReady() || pending.length === 0)) {
        this.parkForAuthoritativeRoutes(currentWaveIndex);
        return;
      }
      const nodes = pending.length > 0 ? pending : rollErNextBiomeNodes(currentBiome, getErPrevBiome());
      const revealed = nodes.filter(n => n.revealed);
      if (revealed.length === 0) {
        coopWarn("reward", "World Map authority exposed no revealed route; transition remains closed");
        if (coopController == null) {
          this.setDeterministicNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
        } else {
          this.parkBiomeCommitRecovery(() => this.start());
        }
        return;
      }
      if (revealed.length > 1) {
        // Co-op (#848): the ER World Map route pick is an owner-alternated, MIRRORED interaction -
        // the OWNER drives the real picker + streams its cursor, the WATCHER opens a read-only copy
        // and adopts the owner's relayed biome. Restore the CORE mechanic co-op used to amputate.
        if (coopController != null) {
          // #858: the counter is pinned INSIDE coopBiomePickFlow, AFTER the boundary barrier (for a natural
          // pick) - never here, where a partner racing ahead from the preceding biome-shop interaction could
          // drift it. A chained crossroads-Leave already set coopAdvancePinned above (its crossroads entry
          // barriered) and coopBiomePickFlow keeps it.
          void this.coopBiomePickFlow(coopController, revealed, currentBiome);
          return;
        }
        // Present the choice as the branching World Map node picker (#486). Only the
        // REVEALED nodes are offered - the extra (green) "upgrade" node appears ONLY
        // when a Map Upgrade item actually reveals it; we no longer surface locked
        // "???" placeholders, so a player with no Map Upgrade never sees an
        // upgrade slot (the #542 fix for "I get the map-upgrade node regardless").
        // Use the full World Map screen (journey chain + biome thumbnails) as the
        // route chooser, in pick mode - the same view the J hotkey shows, but here
        // the onward tiles are selectable (#486: "let me pick from the world map").
        globalScene.ui.setMode(UiMode.ER_MAP, {
          nodes: revealed,
          origin: currentBiome,
          onSelect: (biome: BiomeId) => {
            // #record-replay (single-player): capture the World-Map biome pick (no-op unless recording).
            recordSinglePlayerInteraction("biome", biome);
            this.setNextBiomeAndEnd(biome);
          },
        });
      } else {
        this.setDeterministicNextBiomeAndEnd(revealed[0].biome);
      }
      return;
    }

    if (gameMode.hasRandomBiomes) {
      if (authoritativeGuest) {
        this.awaitAuthoritativeDeterministicBiome();
      } else {
        this.setDeterministicNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
      }
      return;
    }

    // Vanilla link weighting is still a route derivation. The authoritative renderer waits for the host's
    // exact BIOME_PICK instead of consuming seed state or filtering weighted links locally.
    if (authoritativeGuest) {
      this.awaitAuthoritativeDeterministicBiome();
      return;
    }

    const { biomeLinks } = allBiomes.get(currentBiome);
    if (biomeLinks.length > 1) {
      const biomes: BiomeId[] = biomeLinks
        .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
        .map(b => (Array.isArray(b) ? b[0] : b));

      // Co-op (#848): the vanilla biome-link picker is NOT the ER World Map; rather than open an
      // unmirrored prompt in co-op, auto-resolve it deterministically (both clients share the wave
      // seed, so randSeedItem lands identically). No alternation tick (no picker shown).
      if (coopController == null && biomes.length > 1 && globalScene.findModifier(m => m instanceof MapModifier)) {
        const biomeSelectItems = biomes.map(b => {
          return {
            label: getBiomeName(b),
            handler: () => {
              globalScene.ui.setMode(UiMode.MESSAGE);
              // #record-replay (single-player): capture the biome-link pick (no-op unless recording).
              recordSinglePlayerInteraction("biome", b);
              this.setNextBiomeAndEnd(b);
              return true;
            },
          } satisfies OptionSelectItem as OptionSelectItem;
        });
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options: biomeSelectItems,
          delay: 1000,
        });
      } else {
        this.setDeterministicNextBiomeAndEnd(randSeedItem(biomes));
      }
      return;
    }

    if (biomeLinks.length === 1) {
      if (Array.isArray(biomeLinks[0])) {
        console.warn(
          "Biomes with a link to a single other biome should not have a weight assigned to the link.\n",
          "Biome:",
          enumValueToKey(BiomeId, allBiomes.get(currentBiome).biomeId),
          "| Links:",
          biomeLinks,
        );
        // @ts-expect-error: failsafe for invalid biome links structure
        biomeLinks[0] = biomeLinks[0][0];
      }
      this.setDeterministicNextBiomeAndEnd(biomeLinks[0] as BiomeId);
      return;
    }

    this.setDeterministicNextBiomeAndEnd(this.generateNextBiome(nextWaveIndex));
  }

  // ---------------------------------------------------------------------------
  // Co-op (#848) owner-alternated + mirrored ER World Map route pick.
  // ---------------------------------------------------------------------------

  /** Decide owner vs watcher off the pinned interaction counter and branch. */
  private async coopBiomePickFlow(
    controller: CoopSessionController,
    revealed: ErRouteNode[],
    origin: BiomeId,
  ): Promise<void> {
    // #848 test-scoped: a headless multi-wave test never picks a World-Map node. Under vitest (unless the
    // test drives the picker) AUTO-RESOLVE SYNCHRONOUSLY + deterministically on BOTH engines (generateNext
    // Biome off the just-reset shared wave seed -> identical biome -> both advance the pinned counter once,
    // staying in lockstep). Synchronous by design: an async relay/timer here would resume OUTSIDE the two-
    // engine harness's per-client ctx swap and advance the wrong engine. Production keeps the real
    // owner/watcher picker below with no timeout. (start() already returned for auto-resolve, so this branch
    // is defensive; it runs BEFORE the #858 boundary barrier to keep the auto-resolve path synchronous.)
    if (coopBiomePickerAutoResolvesInTest()) {
      const biome = this.generateNextBiome(this.requireCoopSourceWave() + 1);
      coopLog("reward", `biome pick AUTO-RESOLVE (vitest, picker not driven) -> biome=${BiomeId[biome]} (#848)`);
      this.setDeterministicNextBiomeAndEnd(biome);
      return;
    }
    const spoofed = getCoopRuntime()?.spoof != null;
    // #858 BOUNDARY BARRIER: for a NATURAL biome-end pick (NOT chained from a crossroads Leave - that already
    // barriered at its own crossroads entry) the preceding every-10-waves biome-shop interaction must
    // terminate on BOTH clients before this interaction pins its counter. Same one-sided-fallback ->
    // biome-divergence guard as the crossroads (see ErCrossroadsPhase.coopAwaitBoundaryBarrier): a partner
    // that finished the shop and raced ahead could otherwise drift the lagging client's counter (the
    // coop-session pendingRemote fold) past this interaction, mismatching the relay seq and forcing a
    // one-sided deterministic fallback. Skipped when chained (already barriered) or spoofed (no real peer).
    if (!this.coopChained && !spoofed && !(await this.coopAwaitBoundaryBarrier())) {
      return;
    }
    if (this.coopAdvancePinned < 0) {
      // Natural biome-end multi-node pick: pin its own counter AFTER the boundary barrier, in lockstep.
      this.coopAdvancePinned = controller.interactionCounter();
    }
    const pinned = this.coopAdvancePinned;
    const controlOperationId = coopBiomeOperationId(
      "BIOME_PICK",
      COOP_BIOME_PICK_SEQ_BASE + pinned,
      pinned,
      this.requireCoopBiomeOperationBinding(),
    );
    this.coopV2ControlOperationId = controlOperationId;
    const owns = spoofed || controller.isLocalOwnerAtCounter(pinned);
    // Co-op (#864): record ownership + the node set so the single terminal funnel (setNextBiomeAndEnd)
    // relays whatever biome the owner ends up travelling to - the picker pick OR a fallback.
    this.coopIsBiomeOwner = owns;
    this.coopRevealed = revealed;
    coopLog(
      "reward",
      `biome pick owner/watcher decision: pinnedStart=${pinned} role=${controller.role} spoof=${spoofed} chained=${this.coopChained} -> ${owns ? "OWNER" : "WATCHER"} (#848)`,
    );
    const openExactSurface = (): void => {
      if (owns) {
        this.coopBiomePickOwner(revealed, origin, pinned);
      } else {
        this.coopBiomePickWatch(revealed, origin, pinned).catch(error =>
          coopWarn("reward", `biome pick WATCHER ${pinned} rejected after its Authority V2 control opened`, error),
        );
      }
    };
    // A chained crossroads-Leave already authored this exact BIOME_PICK interaction-open as its result
    // successor (and barriered at its own crossroads entry), so its control is already in the ordered log.
    // A NATURAL biome-end pick has no such predecessor: like ErCrossroadsPhase it must author its OWN
    // interaction-open before exposing input, or the owner's live ER_MAP handler installs no shared control
    // and isCoopV2InteractionHumanInputFrozen() never clears. The authority commits the CONTROL_COMMIT now;
    // a replica parks this exact phase until that ordered entry materializes, then resumes here.
    if (this.coopChained) {
      openExactSurface();
      return;
    }
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const controlBoundary = enterCoopV2BiomeControlBoundary({
      operationId: controlOperationId,
      ownerSeatId: coopInteractionOwnerSeat(pinned),
      sourceWave: wave,
      sourceTurn: this.coopSourceTurn,
      phaseToken: this,
      resume: () => {
        if (this.boundaryStillLive(generation, wave)) {
          openExactSurface();
        }
      },
    });
    if (controlBoundary === "failed") {
      failCoopSharedSession(`natural biome pick ${pinned} could not obtain its Authority V2 input control`);
      return;
    }
    if (controlBoundary === "deferred") {
      return;
    }
    openExactSurface();
  }

  /**
   * Co-op (#858): the reciprocal boundary barrier between the preceding biome-shop interaction and a NATURAL
   * biome-end pick. Blocks until the partner has ALSO reached this wave's biome choice (both left the shop),
   * so neither pins the interaction counter while the other still holds the shop. The point derives from the
   * WAVE only (never the drifting counter), so both compute it identically. Lost arrivals retransmit;
   * teardown/error aborts remain closed rather than pinning a counter independently.
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
      const point = `biomepick:${wave}`;
      coopLog("rendezvous", `biome-pick boundary barrier RENDEZVOUS ${point} (#858)`);
      const result = await rendezvous.rendezvous(point, getCoopRendezvousWaitMs());
      if (!this.boundaryStillLive(generation, wave)) {
        return false;
      }
      if (result.timedOut) {
        coopWarn(
          "rendezvous",
          `biome-pick boundary barrier ${point} ABORTED during teardown/recovery - remaining closed (#858)`,
        );
        return false;
      }
      if (result.authoritativePoint !== undefined && result.authoritativePoint !== point) {
        coopWarn(
          "rendezvous",
          `biome-pick boundary ${point} ROUTED AWAY to host-authoritative ${result.authoritativePoint}; closing stale phase`,
        );
        this.end();
        return false;
      }
      if (result.crossPoint !== undefined) {
        coopLog(
          "rendezvous",
          `biome-pick boundary ${point} host-authoritative route ACKED (partner had ${result.crossPoint}); proceeding (#858)`,
        );
      }
      return true;
    } catch (e) {
      if (!this.boundaryStillLive(generation, wave)) {
        return false;
      }
      coopWarn("rendezvous", "biome-pick boundary barrier threw - FAIL CLOSED (#858)", e);
      return false;
    }
  }

  /** OWNER: drive the real ER_MAP picker + stream its cursor; relay the chosen biome, then apply. */
  private coopBiomePickOwner(revealed: ErRouteNode[], origin: BiomeId, pinned: number): void {
    const mirrorSeq = COOP_BIOME_PICK_SEQ_BASE + pinned;
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    globalScene.ui
      .setModeBoundedWhen(UiMode.ER_MAP, 2_000, () => this.boundaryStillLive(generation, wave), {
        nodes: revealed,
        origin,
        onSelect: (biome: BiomeId) => {
          if (!this.boundaryStillLive(generation, wave)) {
            return;
          }
          getCoopUiMirror()?.endSession();
          this.coopBiomeOwnerCommit(pinned, biome);
        },
      })
      .then(result => {
        if (!this.boundaryStillLive(generation, wave)) {
          return;
        }
        if (result === "superseded") {
          this.parkBiomeCommitRecovery(() => this.coopBiomePickOwner(revealed, origin, pinned));
          return;
        }
        // Relay the owner's live cursor only after the bounded map transition is genuinely active.
        this.clearBiomeCommitRecovery();
        getCoopUiMirror()?.beginSession("owner", UiMode.ER_MAP, mirrorSeq);
        // A retained biome boundary is continuation-safe only once this exact phase owns a live, actionable
        // ER_MAP handler. Phase construction and the completed rendezvous are not public surfaces. The runtime
        // revalidates phase, mode, handler activity and source wave before releasing retained authority.
        this.publishCoopBiomeSurfaceWhenActionable(generation, wave);
      });
  }

  /** OWNER terminal: hand the chosen biome to the single funnel, which relays it + advances (#864). */
  private coopBiomeOwnerCommit(pinned: number, biome: BiomeId): void {
    coopLog("reward", `biome pick OWNER picked biome=${BiomeId[biome]} pinnedStart=${pinned} (#848)`);
    // The relay + counter advance now happen in setNextBiomeAndEnd (the SINGLE terminal), so this pick
    // and every other owner terminal (deterministic / fallback) relay identically - #864.
    this.setNextBiomeAndEnd(biome);
  }

  /** WATCHER: open a read-only mirrored copy, await the owner's biome, apply it authoritatively. (Not
   *  reached under the vitest auto-resolve - coopBiomePickFlow resolves synchronously before the split.) */
  private async coopBiomePickWatch(revealed: ErRouteNode[], origin: BiomeId, pinned: number): Promise<void> {
    const mirrorSeq = COOP_BIOME_PICK_SEQ_BASE + pinned;
    const generation = coopSessionGeneration();
    const boundaryWave = this.requireCoopSourceWave();
    try {
      const mode = await globalScene.ui.setModeBoundedWhen(
        UiMode.ER_MAP,
        2_000,
        () => this.boundaryStillLive(generation, boundaryWave),
        {
          nodes: revealed,
          origin,
          // Read-only: a replayed owner ACTION must never resolve the watcher against its own cursor.
          // The awaited relay below is the sole authority.
          onSelect: () => {
            /* cosmetic no-op */
          },
        },
      );
      if (!this.boundaryStillLive(generation, boundaryWave)) {
        return;
      }
      if (mode === "superseded") {
        this.parkBiomeCommitRecovery(() => {
          this.coopBiomePickWatch(revealed, origin, pinned).catch(error =>
            coopWarn("reward", "biome pick WATCHER UI retry threw - remaining closed", error),
          );
        });
        return;
      }
      this.clearBiomeCommitRecovery();
      getCoopUiMirror()?.beginSession("watcher", UiMode.ER_MAP, mirrorSeq);
      // The watcher exposes the same real map handler, but its onSelect is deliberately inert and authority
      // remains the awaited owner relay below. Publishing here proves the renderer has an executable public
      // continuation without granting it any mechanical decision authority.
      this.publishCoopBiomeSurfaceWhenActionable(generation, boundaryWave);
    } catch {
      coopWarn("reward", "biome pick WATCHER map failed to open (still awaiting relay) (#848)");
    }
    const relay = getCoopInteractionRelay();
    // #863: bound the wait with the one-sided ORPHAN backstop. If the OWNER commits its pick + advances
    // PAST this interaction but its relay never reaches us (the live wave-10 "partner chose map, I'm stuck
    // in the map screen"), dismiss PROMPTLY to the deterministic fallback below instead of freezing on the
    // 20-min relay timeout. A buffered/in-flight owner pick still wins, so the correct biome is preferred.
    const res =
      relay == null
        ? null
        : await awaitCoopChoiceWithOrphanBackstop(
            relay,
            getCoopController(),
            COOP_BIOME_PICK_SEQ_BASE + pinned,
            pinned,
            COOP_BIOME_PICK_CHOICE_KINDS,
          );
    if (!this.boundaryStillLive(generation, boundaryWave)) {
      getCoopUiMirror()?.endSession();
      return;
    }
    getCoopUiMirror()?.endSession();
    // Wave-2a: gate adoption through the authoritative operation primitive (idempotent by operationId,
    // stale-/late-rejecting a pick from an earlier interaction or a prior epoch - the #861 shape). When the
    // flag is OFF this passes the relay through verbatim (legacy fallback); a reject falls to the
    // deterministic backstop below exactly like a relay timeout.
    const role = this.requireCoopBiomeOperationRole();
    const operationId = coopBiomeOperationId(
      "BIOME_PICK",
      COOP_BIOME_PICK_SEQ_BASE + pinned,
      pinned,
      this.requireCoopBiomeOperationBinding(),
    );
    if (coopBiomeCommitRequired(role, this.requireCoopBiomeOperationBinding())) {
      await this.finishCommittedBiomeWatcher(revealed, operationId, pinned);
      return;
    }
    await this.applyBiomeWatcherDecision(
      revealed,
      operationId,
      pinned,
      role,
      res == null ? null : { choice: res.choice, data: res.data, operationId: res.operationId },
      false,
    );
  }

  private committedBiomePayload(
    receipt: CoopBiomeCommitReceipt | null,
    operationId: string,
    expectedDestination?: BiomeId,
  ): CoopBiomePickPayload | null {
    const wave = this.requireCoopSourceWave();
    const payload = receipt?.payload as CoopBiomePickPayload | undefined;
    if (
      receipt == null
      || receipt.operationId !== operationId
      || receipt.kind !== "BIOME_PICK"
      || receipt.wave !== wave
      || payload?.sourceBiomeId !== globalScene.arena.biomeId
      || payload.nextWave !== wave + 1
      || (expectedDestination != null && payload.biomeId !== expectedDestination)
    ) {
      return null;
    }
    return payload;
  }

  private async finishCommittedBiomeWatcher(
    revealed: ErRouteNode[],
    operationId: string,
    pinned: number,
  ): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const address = { sourceWave: wave, interactivePinned: pinned } as const;
    const receipt =
      getCoopBiomeTransitionCommitReceipt(address, this.requireCoopBiomeOperationBinding())
      ?? (await awaitCoopBiomeTransitionCommitReceipt(address, this.requireCoopBiomeOperationBinding()));
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }
    const deterministicOperationId = coopAuthoritativeBiomeTransitionOperationId(
      wave,
      this.requireCoopBiomeOperationBinding(),
    );
    const exactOperationId = receipt?.operationId ?? "";
    const payload = this.committedBiomePayload(receipt, exactOperationId);
    const interactive = exactOperationId === operationId && payload?.nodeIndex !== -1;
    const deterministic = exactOperationId === deterministicOperationId && payload?.nodeIndex === -1;
    if (payload == null || (!interactive && !deterministic)) {
      this.parkBiomeCommitRecovery(() => {
        this.finishCommittedBiomeWatcher(revealed, operationId, pinned).catch(e =>
          coopWarn("reward", "biome pick WATCHER receipt retry threw - remaining closed", e),
        );
      });
      return;
    }
    if (deterministic && receipt != null) {
      await this.applyDeterministicBiomeWatcherReceipt(
        receipt,
        payload,
        generation,
        wave,
        revealed,
        operationId,
        pinned,
      );
      return;
    }
    await this.applyBiomeWatcherDecision(
      revealed,
      operationId,
      pinned,
      "guest",
      { choice: payload.nodeIndex, data: [payload.biomeId] },
      true,
    );
  }

  /**
   * A host travel target or a one-node route can resolve deterministically while the renderer had already
   * opened the mirrored map from stale route metadata. The retained wave-addressed receipt wins: close the
   * cosmetic map and project only its exact destination, without synthesizing a picker action or advancing
   * a different interaction.
   */
  private async applyDeterministicBiomeWatcherReceipt(
    receipt: CoopBiomeCommitReceipt,
    payload: CoopBiomePickPayload,
    generation: number,
    wave: number,
    revealed: ErRouteNode[],
    interactiveOperationId: string,
    pinned: number,
  ): Promise<void> {
    try {
      const mode = await globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, () =>
        this.boundaryStillLive(generation, wave),
      );
      if (!this.boundaryStillLive(generation, wave)) {
        return;
      }
      if (mode === "superseded") {
        this.parkBiomeCommitRecovery(() => {
          this.finishCommittedBiomeWatcher(revealed, interactiveOperationId, pinned).catch(error =>
            coopWarn("reward", "deterministic biome watcher teardown retry threw - remaining closed", error),
          );
        });
        return;
      }
    } catch (error) {
      coopWarn("reward", "deterministic biome watcher map teardown failed (continuing exact commit)", error);
    }
    this.coopDeterministicDestination = payload.biomeId as BiomeId;
    if (
      this.applyNextBiomeAndEnd(payload.biomeId as BiomeId, {
        operationId: receipt.operationId,
        authoritativeProjection: true,
      })
    ) {
      releaseCoopBiomeCommitReceipt(receipt.operationId, this.requireCoopBiomeOperationBinding());
    }
  }

  private async applyBiomeWatcherDecision(
    revealed: ErRouteNode[],
    operationId: string,
    pinned: number,
    role: "host" | "guest",
    committedRes: CoopBiomeRelayResult | null,
    committed: boolean,
  ): Promise<void> {
    const generation = coopSessionGeneration();
    const boundaryWave = this.requireCoopSourceWave();
    const decision = adoptBiomeWatcherChoice(
      {
        kind: "BIOME_PICK",
        seq: COOP_BIOME_PICK_SEQ_BASE + pinned,
        pinned,
        res: committedRes,
        localRole: role,
        wave: boundaryWave,
        turn: this.coopSourceTurn,
        sourceBiomeId: globalScene.arena.biomeId,
        nextWave: boundaryWave + 1,
        allowedRoutes: revealed.map(node => node.biome),
        deterministicDestination: this.coopDeterministicDestination,
        armLocalTail: role === "host",
      },
      this.requireCoopBiomeOperationBinding(),
    );
    if (committed && !decision.adopt) {
      coopWarn(
        "reward",
        `biome pick WATCHER refused committed envelope id=${operationId} reason=${decision.reason} - remaining closed`,
      );
      this.parkBiomeCommitRecovery(() => {
        this.finishCommittedBiomeWatcher(revealed, operationId, pinned).catch(e =>
          coopWarn("reward", "biome pick WATCHER adoption retry threw - remaining closed", e),
        );
      });
      return;
    }
    if (isCoopAuthoritativeGuestGated() && !decision.adopt) {
      this.parkBiomeCommitRecovery(() => {
        this.coopBiomePickWatch(revealed, globalScene.arena.biomeId, pinned).catch(e =>
          coopWarn("reward", "biome pick authoritative WATCHER retry threw - remaining closed", e),
        );
      });
      return;
    }
    if (role === "host" && isCoopBiomeOperationEnabled() && !decision.adopt) {
      coopWarn(
        "reward",
        `biome pick WATCHER refused uncommitted/invalid intent id=${operationId} reason=${decision.reason} - remaining closed`,
      );
      this.parkBiomeCommitRecovery(() => {
        this.coopBiomePickWatch(revealed, globalScene.arena.biomeId, pinned).catch(e =>
          coopWarn("reward", "biome pick WATCHER relay retry threw - remaining closed", e),
        );
      });
      return;
    }
    const adopted = decision.adopt ? { choice: decision.choice, data: decision.data } : null;
    let biome: BiomeId;
    if (adopted != null && adopted.data != null && adopted.data.length > 0) {
      biome = adopted.data[0] as BiomeId;
      coopLog("reward", `biome pick WATCHER: owner biome=${BiomeId[biome]} received pinnedStart=${pinned} (#848)`);
    } else if (adopted != null && adopted.choice >= 0 && adopted.choice < revealed.length) {
      biome = revealed[adopted.choice].biome;
      coopLog("reward", `biome pick WATCHER: owner idx=${adopted.choice} -> biome=${BiomeId[biome]} (#848)`);
    } else {
      // ANTI-HANG (#848): disconnect / stall backstop. Fall back to the SAME deterministic roll both
      // clients compute off the just-reset shared wave seed, so the fallback cannot desync.
      biome = this.generateNextBiome(boundaryWave + 1);
      coopWarn(
        "reward",
        `biome pick WATCHER: owner pick TIMEOUT/disconnect -> deterministic fallback biome=${BiomeId[biome]} (#848)`,
      );
    }
    // Tear the map back down before the biome-switch flow runs, then apply.
    try {
      const mode = await globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, () =>
        this.boundaryStillLive(generation, boundaryWave),
      );
      if (!this.boundaryStillLive(generation, boundaryWave)) {
        return;
      }
      if (mode === "superseded") {
        this.parkBiomeCommitRecovery(() => {
          this.applyBiomeWatcherDecision(revealed, operationId, pinned, role, committedRes, committed).catch(error =>
            coopWarn("reward", "biome pick teardown retry threw - remaining closed", error),
          );
        });
        return;
      }
    } catch (e) {
      coopWarn("reward", "biome pick WATCHER map teardown failed (continuing committed transition)", e);
    }
    const applied = this.setNextBiomeAndEnd(
      biome,
      decision.adopt
        ? {
            operationId: decision.operationId ?? operationId,
            authorityCommit: decision.requiresAuthorityCommit === true,
            authoritativeProjection: decision.authoritativeProjection === true,
          }
        : undefined,
    );
    if (committed && applied) {
      releaseCoopBiomeCommitReceipt(operationId, this.requireCoopBiomeOperationBinding());
    }
  }

  /**
   * Prove both retained authorities from the exact live World Map handler. A chained Crossroads result names
   * BIOME_PICK as its V2 successor, so publishing only the older wave-continuation lease leaves that result
   * retained and makes the following biome result an illegal concurrent reservation.
   */
  private publishCoopBiomeSurfaceWhenActionable(generation: number, wave: number): void {
    const publish = (): void => {
      if (!this.boundaryStillLive(generation, wave)) {
        return;
      }
      const handler = globalScene.ui.getHandler() as
        | {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          }
        | undefined;
      const actionable =
        globalScene.ui.getMode() === UiMode.ER_MAP
        && handler?.active === true
        && handler.isCoopV2InputActionable?.() === true;
      if (!actionable) {
        setTimeout(() => {
          if (this.coopOwningRuntime == null) {
            publish();
          } else {
            runWhenCoopRuntimeActive(this.coopOwningRuntime, publish);
          }
        }, 10);
        return;
      }
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
      notifyCoopWaveContinuationSurfaceReady(wave);
    };
    if (this.coopOwningRuntime == null) {
      publish();
    } else {
      runWhenCoopRuntimeActive(this.coopOwningRuntime, publish);
    }
  }

  private generateNextBiome(waveIndex: number): BiomeId {
    return waveIndex % 50 === 0 ? BiomeId.END : globalScene.generateRandomBiome(waveIndex);
  }

  private boundaryStillLive(generation: number, wave: number): boolean {
    return (
      coopSessionGeneration() === generation
      && this.coopSourceWave === wave
      && globalScene.phaseManager.getCurrentPhase() === this
    );
  }

  /** Renderer routes come only from the carrier. Poll finitely, then expose a fenced recovery action. */
  private parkForAuthoritativeRoutes(wave: number): void {
    if (this.coopRouteRetryTimer != null || this.coopRouteRecoveryShown) {
      return;
    }
    const generation = coopSessionGeneration();
    const retry = (): void => {
      this.coopRouteRetryTimer = null;
      if (!this.boundaryStillLive(generation, wave)) {
        return;
      }
      if (getCoopBiomeTransitionCommitReceipt({ sourceWave: wave }, this.requireCoopBiomeOperationBinding()) != null) {
        this.coopRouteRetryAttempts = 0;
        this.coopRouteRecoveryShown = false;
        this.clearBiomeCommitRecovery();
        this.awaitAuthoritativeDeterministicBiome();
        return;
      }
      const classificationReady =
        !isCoopAuthoritativeGuestGated() || getAuthoritativeMapTravelClassification(wave).ready;
      if (classificationReady && erPendingNodesReady() && getErPendingNodes().length > 0) {
        this.coopRouteRetryAttempts = 0;
        this.coopRouteRecoveryShown = false;
        this.clearBiomeCommitRecovery();
        this.start();
        return;
      }
      this.coopRouteRetryAttempts++;
      if (this.coopRouteRetryAttempts < 10) {
        this.coopRouteRetryTimer = setTimeout(retry, 500);
        return;
      }
      this.coopRouteRecoveryShown = true;
      this.parkBiomeCommitRecovery(() => {
        this.coopRouteRecoveryShown = false;
        this.coopRouteRetryAttempts = 0;
        this.parkForAuthoritativeRoutes(wave);
      });
    };
    this.coopRouteRetryTimer = setTimeout(retry, 500);
  }

  override end(): void {
    if (this.coopRouteRetryTimer != null) {
      clearTimeout(this.coopRouteRetryTimer);
      this.coopRouteRetryTimer = null;
    }
    this.clearBiomeCommitRecovery();
    super.end();
  }

  private setDeterministicNextBiomeAndEnd(nextBiome: BiomeId): void {
    this.coopDeterministicDestination = nextBiome;
    const controller = getCoopController();
    if (globalScene.gameMode.isCoop && controller?.netcodeMode === "authoritative") {
      if (controller.role === "guest") {
        this.awaitAuthoritativeDeterministicBiome();
        return;
      }
      const sourceWave = this.requireCoopSourceWave();
      const role = this.requireCoopBiomeOperationRole();
      if (role !== controller.role) {
        failCoopSharedSession("The shared World Map transition changed runtime ownership.");
        return;
      }
      const commit = commitAuthoritativeBiomeTransition(
        {
          sourceWave,
          sourceBiomeId: globalScene.arena.biomeId,
          destinationBiomeId: nextBiome,
          turn: this.coopSourceTurn,
          localRole: role,
        },
        this.requireCoopBiomeOperationBinding(),
      );
      const canonical = commit?.payload as CoopBiomePickPayload | undefined;
      if (
        commit == null
        || canonical == null
        || canonical.nodeIndex !== -1
        || canonical.sourceBiomeId !== globalScene.arena.biomeId
        || canonical.nextWave !== sourceWave + 1
      ) {
        this.parkBiomeCommitRecovery(() => this.setDeterministicNextBiomeAndEnd(nextBiome));
        return;
      }
      this.coopDeterministicDestination = canonical.biomeId as BiomeId;
      this.applyNextBiomeAndEnd(canonical.biomeId as BiomeId, {
        operationId: commit.operationId,
        authorityCommit: commit.revision === 0,
      });
      return;
    }
    this.setNextBiomeAndEnd(nextBiome);
  }

  /** Renderer half of a host-owned transition: consume the exact retained terminal for this boundary. */
  private awaitAuthoritativeDeterministicBiome(): void {
    if (this.coopCommitPending) {
      return;
    }
    this.coopCommitPending = true;
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const sourceBiome = globalScene.arena.biomeId;
    const address = {
      sourceWave: wave,
      interactivePinned: this.coopAdvancePinned >= 0 ? this.coopAdvancePinned : undefined,
    } as const;
    if (coopAuthoritativeBiomeTransitionOperationId(wave, this.requireCoopBiomeOperationBinding()) == null) {
      this.coopCommitPending = false;
      this.parkBiomeCommitRecovery(() => this.awaitAuthoritativeDeterministicBiome());
      return;
    }
    const existing = getCoopBiomeTransitionCommitReceipt(address, this.requireCoopBiomeOperationBinding());
    if (existing != null) {
      this.consumeAuthoritativeBiomeReceipt(existing, generation, wave, sourceBiome);
      return;
    }
    void awaitCoopBiomeTransitionCommitReceipt(address, this.requireCoopBiomeOperationBinding())
      .then(receipt => {
        this.consumeAuthoritativeBiomeReceipt(receipt, generation, wave, sourceBiome);
      })
      .catch(error => {
        if (!this.boundaryStillLive(generation, wave)) {
          return;
        }
        this.coopCommitPending = false;
        coopWarn("reward", "deterministic biome authority wait threw - remaining closed", error);
        this.parkBiomeCommitRecovery(() => this.awaitAuthoritativeDeterministicBiome());
      });
  }

  private consumeAuthoritativeBiomeReceipt(
    receipt: CoopBiomeCommitReceipt | null,
    generation: number,
    wave: number,
    sourceBiome: BiomeId,
  ): void {
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }
    const payload = receipt?.payload as CoopBiomePickPayload | undefined;
    const deterministicOperationId = coopAuthoritativeBiomeTransitionOperationId(
      wave,
      this.requireCoopBiomeOperationBinding(),
    );
    const interactiveOperationId =
      this.coopAdvancePinned >= 0
        ? coopBiomeOperationId(
            "BIOME_PICK",
            COOP_BIOME_PICK_SEQ_BASE + this.coopAdvancePinned,
            this.coopAdvancePinned,
            this.requireCoopBiomeOperationBinding(),
          )
        : null;
    const deterministic = receipt?.operationId === deterministicOperationId && payload?.nodeIndex === -1;
    const interactive = receipt?.operationId === interactiveOperationId && payload != null && payload.nodeIndex >= 0;
    if (
      receipt?.kind !== "BIOME_PICK"
      || receipt.wave !== wave
      || payload?.sourceBiomeId !== sourceBiome
      || payload.nextWave !== wave + 1
      || (!deterministic && !interactive)
    ) {
      this.coopCommitPending = false;
      this.parkBiomeCommitRecovery(() => this.awaitAuthoritativeDeterministicBiome());
      return;
    }
    this.coopCommitPending = false;
    if (interactive && this.coopAdvancePinned >= 0) {
      const revealed = getErPendingNodes().filter(node => node.revealed);
      void this.applyBiomeWatcherDecision(
        revealed,
        receipt.operationId,
        this.coopAdvancePinned,
        "guest",
        { choice: payload.nodeIndex, data: [payload.biomeId] },
        true,
      );
      return;
    }
    this.coopDeterministicDestination = payload.biomeId as BiomeId;
    if (
      this.applyNextBiomeAndEnd(payload.biomeId as BiomeId, {
        operationId: receipt.operationId,
        authoritativeProjection: true,
      })
    ) {
      releaseCoopBiomeCommitReceipt(receipt.operationId, this.requireCoopBiomeOperationBinding());
    }
  }

  private setNextBiomeAndEnd(
    nextBiome: BiomeId,
    completion?: {
      readonly operationId: string;
      readonly authorityCommit?: boolean;
      readonly authoritativeProjection?: boolean;
    },
  ): boolean {
    if (this.coopCommitPending) {
      return false;
    }
    // SOLO fast path (P0 hotfix, live 2026-07-16): with no co-op session there is no operation
    // runtime, and requireCoopBiomeOperationRole() below THROWS from the P33 binding capture
    // ("no runtime installed for surface=biome"). Every multi-option biome pick funnels through
    // here, so the throw froze every SOLO endless run at the wave-10 map pick (the picker's
    // onSelect died uncaught and the phase never ended). Solo needs none of the relay/commit
    // machinery - apply the biome directly, exactly the pre-P33 behavior.
    if (!globalScene.gameMode.isCoop) {
      return this.applyNextBiomeAndEnd(nextBiome, completion);
    }
    // Runtime loss during a genuine shared run is categorically different from solo. Applying this
    // choice locally would create a one-sided biome transition and defer the visible failure until a
    // later wave. The retained terminal cannot be signalled after the runtime is gone, so the shared
    // terminal helper performs its immediate orphan fallback and this phase stays parked.
    if (getCoopController() == null) {
      failCoopSharedSession("A shared World Map choice lost its authoritative runtime.", {
        boundary: "recovery",
        reasonCode: "recovery-exhausted",
        wave: globalScene.currentBattle?.waveIndex,
        turn: globalScene.currentBattle?.turn,
      });
      return false;
    }
    // The owner sends only an intent here. A guest-owned choice must not mutate interest/heal/map/arena or
    // advance the interaction until the host's committed journal envelope returns and arms the exact tail.
    const relay = this.coopRelayOwnerBiome(nextBiome);
    if (relay.rejected) {
      this.coopBiomeRelaySent = false;
      this.parkBiomeCommitRecovery(() => this.setNextBiomeAndEnd(nextBiome));
      return false;
    }
    const operationId = relay.operationId;
    const authoritativeNextBiome = relay.destination;
    const role = this.requireCoopBiomeOperationRole();
    if (operationId != null && coopBiomeCommitRequired(role, this.requireCoopBiomeOperationBinding())) {
      const generation = coopSessionGeneration();
      const wave = this.requireCoopSourceWave();
      void globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.boundaryStillLive(generation, wave));
      settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime);
      this.coopCommitPending = true;
      void this.finishGuestOwnedBiomeAfterCommit(operationId, authoritativeNextBiome);
      return false;
    }
    return this.applyNextBiomeAndEnd(
      authoritativeNextBiome,
      completion
        ?? (operationId == null
          ? undefined
          : {
              operationId,
              authorityCommit: relay.requiresAuthorityCommit,
            }),
    );
  }

  private async finishGuestOwnedBiomeAfterCommit(operationId: string, nextBiome: BiomeId): Promise<void> {
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    const receipt = await awaitCoopBiomeCommitReceipt(operationId, this.requireCoopBiomeOperationBinding());
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }
    if (this.committedBiomePayload(receipt, operationId, nextBiome) == null) {
      coopWarn(
        "reward",
        `biome pick OWNER committed identity mismatch id=${operationId} wave=${wave} source=${globalScene.arena.biomeId} destination=${nextBiome} - remaining closed`,
      );
      this.coopCommitPending = false;
      this.parkBiomeCommitRecovery(() => {
        this.coopCommitPending = true;
        this.finishGuestOwnedBiomeAfterCommit(operationId, nextBiome).catch(e =>
          coopWarn("reward", "biome pick OWNER receipt retry threw - remaining closed", e),
        );
      });
      return;
    }
    this.coopCommitPending = false;
    if (
      this.applyNextBiomeAndEnd(nextBiome, {
        operationId,
        authoritativeProjection: true,
      })
    ) {
      releaseCoopBiomeCommitReceipt(operationId, this.requireCoopBiomeOperationBinding());
    }
  }

  private parkBiomeCommitRecovery(retry: () => void): void {
    getCoopUiMirror()?.endSession();
    const generation = coopSessionGeneration();
    const wave = this.requireCoopSourceWave();
    if (!this.boundaryStillLive(generation, wave)) {
      return;
    }

    const turn = globalScene.currentBattle?.turn ?? 0;
    const boundaryRevision =
      this.coopAdvancePinned >= 0
        ? this.coopAdvancePinned
        : Math.max(0, getCoopController()?.interactionCounter() ?? 0);
    let recovery = this.coopCommitRecovery;
    if (
      recovery == null
      || recovery.generation !== generation
      || recovery.wave !== wave
      || recovery.turn !== turn
      || recovery.boundaryRevision !== boundaryRevision
    ) {
      this.clearBiomeCommitRecovery();
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
        if (this.biomeCommitRecoveryStillLive(current)) {
          this.exhaustBiomeCommitRecovery(current, "absolute deadline");
        } else {
          this.clearBiomeCommitRecovery();
        }
      }, coopBiomeContinuationRecoveryPolicy.deadlineMs);
    } else {
      // A later exact-receipt failure may provide a more specific re-await closure. Keep one supervisor and
      // one timer, but always retry the newest fenced continuation rather than an obsolete callback.
      recovery.retry = retry;
    }

    if (recovery.terminalRequested || recovery.retryTimer != null) {
      return;
    }
    if (recovery.retries >= coopBiomeContinuationRecoveryPolicy.maxAutomaticRetries) {
      this.exhaustBiomeCommitRecovery(recovery, "exact receipt retries exhausted");
      return;
    }

    // MESSAGE is presentation only. A superseded/failed UI transition neither consumes another attempt nor
    // blocks the exact receipt retry, so a cosmetic callback can never become a continuation softlock.
    globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.biomeCommitRecoveryStillLive(recovery))
      .catch(error => coopWarn("reward", "biome continuation recovery UI failed (retry remains armed)", error));
    globalScene.ui.showText("Recovering the shared World Map transition…");

    const token = recovery.token;
    const delay = coopBiomeContinuationRecoveryPolicy.retryDelayMs * (recovery.retries + 1);
    recovery.retryTimer = setTimeout(() => {
      const current = this.coopCommitRecovery;
      if (current?.token !== token) {
        return;
      }
      if (!this.biomeCommitRecoveryStillLive(current)) {
        this.clearBiomeCommitRecovery();
        return;
      }
      current.retryTimer = null;
      current.retries++;
      const exactRetry = current.retry;
      try {
        exactRetry();
      } catch (error) {
        coopWarn("reward", "biome continuation exact retry threw - remaining closed", error);
        this.parkBiomeCommitRecovery(exactRetry);
      }
    }, delay);
  }

  private biomeCommitRecoveryStillLive(recovery: CoopBiomeContinuationRecovery): boolean {
    return (
      this.coopCommitRecovery === recovery
      && !recovery.terminalRequested
      && this.boundaryStillLive(recovery.generation, recovery.wave)
    );
  }

  private exhaustBiomeCommitRecovery(recovery: CoopBiomeContinuationRecovery, detail: string): void {
    if (!this.biomeCommitRecoveryStillLive(recovery)) {
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
      `biome continuation recovery exhausted (${detail}) wave=${recovery.wave} turn=${recovery.turn} revision=${recovery.boundaryRevision}`,
    );
    failCoopSharedSession("The shared World Map transition could not recover.", {
      boundary: "surface",
      reasonCode: "continuation-failed",
      wave: recovery.wave,
      turn: recovery.turn,
      boundaryRevision: recovery.boundaryRevision,
    });
  }

  private clearBiomeCommitRecovery(): void {
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

  /** Apply the transition only after authority is established (or immediately for host/solo/legacy). */
  private applyNextBiomeAndEnd(
    nextBiome: BiomeId,
    completion?: {
      readonly operationId: string;
      readonly authorityCommit?: boolean;
      readonly authoritativeProjection?: boolean;
    },
  ): boolean {
    try {
      if (
        this.coopAppliedTerminal != null
        && (this.coopAppliedTerminal.destination !== nextBiome
          || this.coopAppliedTerminal.operationId !== completion?.operationId)
      ) {
        throw new Error(
          `Biome terminal conflict existing=${this.coopAppliedTerminal.destination}:${this.coopAppliedTerminal.operationId ?? "none"} next=${nextBiome}:${completion?.operationId ?? "none"}`,
        );
      }
      if (this.coopAppliedTerminal != null) {
        if (completion?.operationId != null) {
          settleCoopV2InteractionOperation(completion.operationId, this.coopOwningRuntime);
        }
        if (
          completion?.authorityCommit === true
          && commitBiomeAuthoritativeResult(completion.operationId, undefined, this.requireCoopBiomeOperationBinding())
            == null
        ) {
          this.parkBiomeCommitRecovery(() => this.applyNextBiomeAndEnd(nextBiome, completion));
          return false;
        }
        this.end();
        return true;
      }
      const gameMode = globalScene.gameMode;
      const currentWaveIndex = this.requireCoopSourceWave();
      const nextWaveIndex = currentWaveIndex + 1;
      // A travel reward is consumed only after authority establishes the destination. Once an authoritative
      // operation lands, clear any local target (even a stale wrong one) so it cannot poison the next picker.
      if (gameMode.isCoop && getCoopController()?.netcodeMode === "authoritative") {
        consumeMapTravelTarget();
      } else {
        clearMapTravelTarget(nextBiome);
      }

      if (completion?.authoritativeProjection === true || isCoopAuthoritativeGuestGated()) {
        // The renderer owns no between-biome run mutation. The committed BIOME_PICK already armed the exact
        // transition permit; queue only its presentation tail and wait for the next complete host carrier.
        globalScene.phaseManager.unshiftNew("SwitchBiomePhase", nextBiome, currentWaveIndex);
        if (this.coopAdvancePinned >= 0) {
          const controller = getCoopController();
          advanceCoopInteractionForContinuation(this.coopAdvancePinned);
          if (controller != null && controller.interactionCounter() <= this.coopAdvancePinned) {
            throw new Error(`Biome interaction ${this.coopAdvancePinned} did not advance`);
          }
          if (this.coopChained) {
            clearCoopBiomeInteractionStart();
          }
        }
        this.coopAppliedTerminal =
          completion == null
            ? { destination: nextBiome }
            : { destination: nextBiome, operationId: completion.operationId };
        if (completion?.operationId != null) {
          settleCoopV2InteractionOperation(completion.operationId, this.coopOwningRuntime);
        }
        this.end();
        return true;
      }

      // ER (#486): with variable biome length the biome start is no longer at %10+1,
      // and SelectBiomePhase runs at every REAL biome transition (pushed when
      // isNewBiome()). Money interest still fires per biome start under the gate;
      // vanilla / daily / endless only reach this block at %10===1.
      if (erBiomeRoutingActive() || nextWaveIndex % 10 === 1) {
        globalScene.applyModifiers(MoneyInterestModifier, true);
        // ER: the biome REST (full heal, or its challenge-substituted reward) is on the
        // every-10-GLOBAL-wave cadence - NOT on every World-Map biome leave. With
        // variable biome length / Crossroads a biome can END off the 10-wave boundary;
        // healing there handed out a free full-heal "just for leaving the biome". Gate
        // it to the 10-wave tick (a biome-ending x0 wave). Mid-biome x0 waves heal via
        // VictoryPhase (#504, which skips biome-ending waves so there is no double-heal).
        if (nextWaveIndex % 10 === 1) {
          const healStatus = new BooleanHolder(true);
          applyChallenges(ChallengeType.PARTY_HEAL, healStatus);
          if (healStatus.value) {
            globalScene.phaseManager.unshiftNew("PartyHealPhase", false);
          } else {
            globalScene.phaseManager.unshiftNew(
              "SelectModifierPhase",
              undefined,
              undefined,
              gameMode.isFixedBattle(currentWaveIndex)
                ? gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings
                : undefined,
            );
          }
        }
      }
      // Co-op (#864): the SINGLE owner-relay funnel. If the LOCAL client owns this biome interaction, relay
      // the biome it is travelling to - WHATEVER terminal produced it (the World-Map pick, a deterministic
      // single-node / travel-target / random resolution, or an anti-hang fallback). The watcher applies this
      // biome VERBATIM, so the owner can never travel one-sided-silently and the two clients can never land in
      // different biomes. Idempotent (coopBiomeRelaySent) so the picker pick + this funnel never double-send.
      globalScene.phaseManager.unshiftNew("SwitchBiomePhase", nextBiome, currentWaveIndex);
      // Co-op (#848): terminate the biome interaction with the single from-pinned advance (idempotent,
      // #837). Fires when this phase participated in an interaction: a chained crossroads-Leave (always)
      // or a multi-node World-Map pick. A purely-deterministic natural transition never ticks the counter.
      if (this.coopAdvancePinned >= 0) {
        const controller = getCoopController();
        advanceCoopInteractionForContinuation(this.coopAdvancePinned);
        if (controller != null && controller.interactionCounter() <= this.coopAdvancePinned) {
          throw new Error(`Biome interaction ${this.coopAdvancePinned} did not advance`);
        }
        if (this.coopChained) {
          clearCoopBiomeInteractionStart();
        }
      }
      this.coopAppliedTerminal =
        completion == null
          ? { destination: nextBiome }
          : { destination: nextBiome, operationId: completion.operationId };
      if (completion?.operationId != null) {
        settleCoopV2InteractionOperation(completion.operationId, this.coopOwningRuntime);
      }
      if (
        completion?.authorityCommit === true
        && commitBiomeAuthoritativeResult(completion.operationId, undefined, this.requireCoopBiomeOperationBinding())
          == null
      ) {
        this.parkBiomeCommitRecovery(() => this.applyNextBiomeAndEnd(nextBiome, completion));
        return false;
      }
      this.end();
      return true;
    } catch (error) {
      coopWarn("reward", `biome transition terminal failed destination=${BiomeId[nextBiome] ?? nextBiome}`, error);
      if (globalScene.gameMode?.isCoop && getCoopController()?.netcodeMode === "authoritative") {
        failCoopSharedSession(`Biome transition terminal could not apply atomically to ${nextBiome}`);
        return false;
      }
      // Solo and legacy behavior is unchanged: this method historically propagated terminal failures to
      // the phase manager. There is no shared binary session to stop, so swallowing would strand solo play.
      throw error;
    }
  }

  /**
   * Co-op (#864): the OWNER relays the biome it is travelling to, so the watcher adopts it verbatim. Called
   * from the single terminal {@linkcode setNextBiomeAndEnd}, so EVERY owner terminal relays identically -
   * the World-Map pick AND any deterministic / fallback resolution. No-op unless the local client owns this
   * biome interaction (a natural multi-node pick, or a chained crossroads-Leave), the counter is pinned, and
   * the relay has not already fired. Never throws (the watcher heals on the #863 orphan backstop / timeout).
   */
  private coopRelayOwnerBiome(nextBiome: BiomeId): {
    readonly operationId: string | null;
    readonly destination: BiomeId;
    readonly rejected: boolean;
    readonly requiresAuthorityCommit: boolean;
  } {
    if (!this.coopIsBiomeOwner || this.coopAdvancePinned < 0 || this.coopBiomeRelaySent) {
      return { operationId: null, destination: nextBiome, rejected: false, requiresAuthorityCommit: false };
    }
    this.coopBiomeRelaySent = true;
    const idx = this.coopRevealed?.findIndex(n => n.biome === nextBiome) ?? -1;
    const seq = COOP_BIOME_PICK_SEQ_BASE + this.coopAdvancePinned;
    const operationId = coopBiomeOperationId(
      "BIOME_PICK",
      seq,
      this.coopAdvancePinned,
      this.requireCoopBiomeOperationBinding(),
    );
    const relay = getCoopInteractionRelay();
    const resend = (): void => {
      relay?.sendInteractionChoice(seq, "biomePick", idx, [nextBiome], undefined, operationId);
    };
    try {
      // Carry both the index AND the biome id: the watcher applies the biome verbatim, so a divergent
      // revealed-list order (or a deterministic terminal with no node set, idx=-1) can never land it in a
      // different biome than the owner.
      resend();
      coopLog(
        "reward",
        `biome pick OWNER relay biome=${BiomeId[nextBiome]} idx=${idx} pinnedStart=${this.coopAdvancePinned} (#864)`,
      );
      // Wave-2a: DUAL-RUN - additionally COMMIT the typed intent through the authoritative operation
      // primitive (the host validates + commits exactly once). No-op when the flag is OFF; the legacy relay
      // above is the fallback and stays live either way.
    } catch {
      coopWarn("reward", "biome pick OWNER relay send threw (handled - deterministic resend remains armed) (#864)");
    }
    // Commit independently of the legacy relay send: a relay exception must not suppress the authoritative
    // operation that can recover it.
    const role = this.requireCoopBiomeOperationRole();
    const sourceWave = this.requireCoopSourceWave();
    const commit = commitBiomeOwnerIntent(
      {
        kind: "BIOME_PICK",
        seq,
        pinned: this.coopAdvancePinned,
        choice: idx,
        payload: {
          sourceBiomeId: globalScene.arena.biomeId,
          biomeId: nextBiome,
          nodeIndex: idx,
          nextWave: sourceWave + 1,
        },
        localRole: role,
        wave: sourceWave,
        turn: this.coopSourceTurn,
        boundarySourceBiomeId: globalScene.arena.biomeId,
        boundaryNextWave: sourceWave + 1,
        allowedRoutes: this.coopRevealed?.map(node => node.biome) ?? [],
        deterministicDestination: this.coopDeterministicDestination,
        armLocalTail: role === "host",
      },
      this.requireCoopBiomeOperationBinding(),
    );
    if (isCoopBiomeOperationEnabled() && commit == null) {
      return { operationId: null, destination: nextBiome, rejected: true, requiresAuthorityCommit: false };
    }
    if (coopBiomeCommitRequired(role, this.requireCoopBiomeOperationBinding())) {
      const generation = coopSessionGeneration();
      armCoopBiomeIntentResend(
        {
          operationId,
          wave: sourceWave,
          phaseName: "SelectBiomePhase",
          sessionGeneration: generation,
          resend,
          isCurrent: () => this.boundaryStillLive(generation, sourceWave),
        },
        this.requireCoopBiomeOperationBinding(),
      );
    }
    const canonical = commit?.payload as CoopBiomePickPayload | undefined;
    return {
      operationId: commit?.operationId ?? operationId,
      destination: (canonical?.biomeId ?? nextBiome) as BiomeId,
      rejected: false,
      requiresAuthorityCommit: role === "host" && commit?.revision === 0,
    };
  }
}
