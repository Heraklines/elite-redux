import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  canFinalizeCoopBiomeTransitionEncounterPermit,
  consumeCoopBiomeTransitionEncounterPermit,
  finalizeCoopBiomeTransitionEncounterPermit,
  getCoopBiomeTransitionTailPermit,
} from "#data/elite-redux/coop/coop-renderer-gate";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { UiMode } from "#enums/ui-mode";
import { EncounterPhase, materializeCoopAdoptedEnemyField } from "#phases/encounter-phase";

const COOP_NEW_BIOME_INTRO_WATCHDOG_MS = 5_000;
const COOP_NEW_BIOME_TERMINAL_WATCHDOG_MS = 12_000;
const COOP_NEW_BIOME_END_WATCHDOG_MS = 5_000;

export class NewBiomeEncounterPhase extends EncounterPhase {
  public readonly phaseName = "NewBiomeEncounterPhase";
  private coopPermitRecoveryShown = false;
  private coopPresentationRecoveryShown = false;
  private coopGeneration = -1;
  private coopWave = -1;
  private coopBattle: typeof globalScene.currentBattle | null = null;
  private coopRuntime: ReturnType<typeof getCoopRuntime> = null;
  private coopController: ReturnType<typeof getCoopController> = null;
  private coopSessionEpoch = -1;
  private coopAuthoritativeGuest = false;
  private coopOperationId: string | null = null;
  private coopPresentationPreparing = false;
  private coopIntroContinued = false;
  private coopEncounterPrepared = false;
  private coopEncounterHooksScheduled = false;
  private coopMysteryContinuationPending = false;
  private coopMysteryContinuationQueued = false;
  private coopEndInFlight = false;
  private coopCompleted = false;
  private coopInteractivePresentationPending = false;
  private coopPermitRecoveryAttempts = 0;
  private coopPresentationRecoveryAttempts = 0;
  private coopIntroTimer: ReturnType<typeof setTimeout> | null = null;
  private coopTerminalTimer: ReturnType<typeof setTimeout> | null = null;
  private coopEndTimer: ReturnType<typeof setTimeout> | null = null;

  override start(): void {
    const currentlyAuthoritativeGuest = isCoopAuthoritativeGuestGated();
    const currentlyAuthoritativeCoop = this.isBoundedAuthoritativeCoop();
    if (currentlyAuthoritativeCoop && this.coopGeneration < 0) {
      // Capture the exact lifetime before validating or consuming any permit. Every later callback/timer uses it.
      this.coopGeneration = coopSessionGeneration();
      this.coopWave = globalScene.currentBattle?.waveIndex ?? -1;
      this.coopBattle = globalScene.currentBattle;
      this.coopRuntime = getCoopRuntime();
      this.coopController = getCoopController();
      this.coopSessionEpoch = this.coopController?.sessionEpoch ?? -1;
      this.coopAuthoritativeGuest = currentlyAuthoritativeGuest;
    }
    // Once captured, this object is permanently a co-op phase. A teardown may make the *current* runtime
    // predicate false, but a late callback must never reinterpret this retained instance as solo and call
    // super.start/end into the replacement queue.
    const boundedLifetime = this.coopGeneration >= 0;
    if (!boundedLifetime && !currentlyAuthoritativeCoop) {
      super.start();
      return;
    }
    if (!this.coopBoundaryStillLive(false) || this.coopPresentationPreparing) {
      return;
    }
    const destinationBiomeId = globalScene.arena?.biomeId ?? -1;
    const activePermit = getCoopBiomeTransitionTailPermit();
    const consumedPermit =
      activePermit == null
        ? null
        : consumeCoopBiomeTransitionEncounterPermit({ destinationBiomeId, nextWave: this.coopWave });
    if (consumedPermit == null) {
      coopWarn(
        "runtime",
        `NewBiomeEncounterPhase refused guest continuation without exact transition permit destination=${destinationBiomeId} wave=${this.coopWave}`,
      );
      this.parkForAuthoritativePermit(() => this.start());
      return;
    }
    this.coopOperationId = consumedPermit.operationId;
    if (!this.coopAuthoritativeGuest) {
      super.start();
      return;
    }
    this.beginAuthoritativeGuestPresentation();
  }

  /** Retry only the already-authorized presentation seam; never reacquire its retained permit/carrier. */
  private beginAuthoritativeGuestPresentation(): void {
    if (this.coopPresentationPreparing || !this.coopBoundaryStillLive()) {
      return;
    }
    this.coopPresentationPreparing = true;
    void this.prepareCoopAuthoritativeGuestPresentationOnly(() => this.startGuestPresentation()).catch(error => {
      if (!this.coopBoundaryStillLive()) {
        return;
      }
      coopWarn("runtime", "NewBiome authoritative carrier/presentation preparation failed closed", error);
      this.coopPresentationPreparing = false;
      this.parkForAuthoritativePresentation(() => this.beginAuthoritativeGuestPresentation());
    });
  }

  override end(): void {
    if (this.coopCompleted || this.coopEndInFlight) {
      return;
    }
    const boundedLifetime = this.coopGeneration >= 0;
    if (!boundedLifetime && !this.isBoundedAuthoritativeCoop()) {
      super.end();
      return;
    }
    if (!this.coopBoundaryStillLive()) {
      return;
    }
    if (this.coopAuthoritativeGuest) {
      this.completeEncounterEnd();
      return;
    }

    // Host runs the real Encounter terminal hooks once. These hooks are not transactional: a throw may
    // happen after phases or presentation state were already written, so retrying the whole method can
    // duplicate structural work. Fail the shared session instead of replaying an unknown partial prefix.
    this.coopEndInFlight = true;
    try {
      this.coopEndTimer = setTimeout(() => {
        if (!this.coopCompleted && this.coopBoundaryStillLive()) {
          this.completeEncounterEnd();
        }
      }, COOP_NEW_BIOME_END_WATCHDOG_MS);
      super.end();
      this.coopEncounterHooksScheduled = true;
    } catch (error) {
      this.clearAllTimers();
      coopWarn(
        "runtime",
        "NewBiome host encounter terminal hooks failed after entering a non-transactional seam",
        error,
      );
      failCoopSharedSession(`NewBiome host terminal hooks failed for transition ${this.coopOperationId ?? "unknown"}`);
    } finally {
      this.coopEndInFlight = false;
    }
  }

  protected override completeEncounterEnd(): void {
    if (this.coopCompleted || this.coopEndInFlight) {
      return;
    }
    const boundedLifetime = this.coopGeneration >= 0;
    if (!boundedLifetime && !this.isBoundedAuthoritativeCoop()) {
      super.completeEncounterEnd();
      return;
    }
    if (!this.coopBoundaryStillLive()) {
      return;
    }
    const operationId = this.coopOperationId;
    const destinationBiomeId = globalScene.arena?.biomeId ?? -1;
    const nextWave = this.coopWave;
    this.coopEndInFlight = true;
    try {
      if (
        operationId == null
        || !canFinalizeCoopBiomeTransitionEncounterPermit({ operationId, destinationBiomeId, nextWave })
      ) {
        this.parkForAuthoritativePermit(() => this.completeEncounterEnd());
        return;
      }
      if (this.coopAuthoritativeGuest) {
        if (this.coopMysteryContinuationPending && !this.coopMysteryContinuationQueued) {
          // Queue only after the exact permit/destination preflight succeeded. A parked retry therefore
          // cannot accumulate duplicate Mystery phases behind this still-current NewBiome phase.
          globalScene.phaseManager.unshiftNew("MysteryEncounterPhase");
          this.coopMysteryContinuationQueued = true;
        }
        // Shift first. If it throws, no terminal flag or permit mutation occurs and this exact phase can retry.
        this.shiftCoopAuthoritativeGuestPresentationOnly();
      } else {
        // EncounterPhase.end already ran the host's shared hooks; this seam is only their final queue shift.
        if (!this.coopEncounterHooksScheduled) {
          return;
        }
        super.completeEncounterEnd();
      }
      if (finalizeCoopBiomeTransitionEncounterPermit({ operationId, destinationBiomeId, nextWave }) == null) {
        throw new Error(`Exact biome permit ${operationId} disappeared after successful queue shift`);
      }
      this.coopCompleted = true;
      this.clearAllTimers();
    } catch (error) {
      // Phase.end() installs the next phase before invoking its start(). If that start throws, the queue
      // already advanced and this phase can no longer retry, even though the call itself threw. Finalize
      // the exact permit if it is still present, then stop the binary session; never leave a consumed
      // transition permit orphaned behind a different current phase.
      const queueAlreadyAdvanced = globalScene.phaseManager.getCurrentPhase() !== this;
      if (queueAlreadyAdvanced) {
        try {
          if (
            operationId != null
            && finalizeCoopBiomeTransitionEncounterPermit({ operationId, destinationBiomeId, nextWave }) != null
          ) {
            this.coopCompleted = true;
          }
        } catch (finalizeError) {
          coopWarn("runtime", "NewBiome failed to retire its permit after the queue had advanced", finalizeError);
        }
        this.clearAllTimers();
        coopWarn("runtime", "NewBiome next phase threw after the queue had already advanced", error);
        failCoopSharedSession(`NewBiome next phase failed after transition ${operationId ?? "unknown"}`);
        return;
      }
      coopWarn("runtime", "NewBiome queue shift failed before advancing; terminal remains retryable", error);
      this.parkForAuthoritativePermit(() => this.completeEncounterEnd());
    } finally {
      this.coopEndInFlight = false;
    }
  }

  /** Host-only shared encounter setup. The authoritative guest never reaches this override. */
  protected override doEncounter(): void {
    if (
      this.coopAuthoritativeGuest
      || (this.coopGeneration >= 0 && !this.coopBoundaryStillLive())
      || (this.coopGeneration < 0 && this.isBoundedAuthoritativeCoop() && !this.coopBoundaryStillLive())
    ) {
      return;
    }
    try {
      globalScene.playBgm(undefined, true);
      if (!this.coopEncounterPrepared) {
        for (const pokemon of globalScene.getPlayerParty()) {
          if (pokemon) {
            pokemon.resetBattleAndWaveData();
            if (pokemon.isOnField()) {
              applyAbAttrs("PostBiomeChangeAbAttr", { pokemon });
            }
          }
        }
        this.coopEncounterPrepared = true;
      }
      this.startPresentationIntro(false);
    } catch (error) {
      // Battle/wave reset and PostBiomeChange abilities are mechanical and non-transactional. A partially
      // applied prefix cannot be made safe by advancing the presentation watchdog.
      this.clearAllTimers();
      coopWarn("runtime", "NewBiome host mechanical preparation failed closed", error);
      failCoopSharedSession(`NewBiome host preparation failed for transition ${this.coopOperationId ?? "unknown"}`);
    }
  }

  private startGuestPresentation(): void {
    if (!this.coopBoundaryStillLive()) {
      return;
    }
    this.coopPresentationPreparing = false;
    try {
      globalScene.playBgm(undefined, true);
      this.startPresentationIntro(true);
    } catch (error) {
      coopWarn("runtime", "NewBiome guest presentation setup threw; terminal watchdog will recover", error);
      this.armTerminalWatchdog(true);
    }
  }

  private startPresentationIntro(authoritativeGuest: boolean): void {
    const enemyField = globalScene.getEnemyField();
    const moveTargets: any[] = [globalScene.arenaEnemy, enemyField];
    const mysteryEncounter = globalScene.currentBattle?.mysteryEncounter?.introVisuals;
    if (mysteryEncounter) {
      moveTargets.push(mysteryEncounter);
    }
    const targets = moveTargets.flat();
    const finalX = targets.map((target: { x?: number }) => (typeof target.x === "number" ? target.x + 300 : null));
    const continueIntro = (): void => {
      if (this.coopIntroContinued || (this.isBoundedAuthoritativeCoop() && !this.coopBoundaryStillLive())) {
        return;
      }
      this.coopIntroContinued = true;
      // Arm the terminal recovery before clearing the intro watchdog or touching fallible presentation APIs.
      this.armTerminalWatchdog(authoritativeGuest);
      this.clearTimer("intro");
      try {
        globalScene.tweens.killTweensOf(targets);
        targets.forEach((target: { setX?: (x: number) => void; x?: number }, index: number) => {
          const x = finalX[index];
          if (x == null) {
            return;
          }
          if (typeof target.setX === "function") {
            target.setX(x);
          } else {
            target.x = x;
          }
        });
        if (authoritativeGuest) {
          // Presentation-only: the complete carrier supplied every shared object and value.
          materializeCoopAdoptedEnemyField();
          const message = globalScene.currentBattle.isBattleMysteryEncounter()
            ? "A mysterious encounter appeared!"
            : this.getEncounterMessage();
          try {
            globalScene.ui.showText(message, null, () => this.finishAuthoritativeGuestPresentation(), 1_500, true);
          } catch {
            this.finishAuthoritativeGuestPresentation();
          }
        } else {
          // Human-owned dialogue is not a timeout. The callback chain is lifetime-fenced, and the mechanical
          // watchdog is suspended while a real trainer/ME surface is awaiting input. Use the unified
          // presentation-boundary predicate (true for solo, the retained co-op boundary for authoritative
          // co-op) so a SOLO new-biome intro is not gated on coopBoundaryStillLive() - which is always false
          // off co-op (coopGeneration < 0), stalling doEncounterCommon before it ends the wave-11 encounter.
          this.doEncounterCommon(
            false,
            () => this.isEncounterPresentationBoundaryLive(),
            waiting => this.setInteractivePresentationWaiting(waiting),
          );
        }
      } catch (error) {
        coopWarn("runtime", "NewBiome presentation operation threw; terminal watchdog will recover", error);
      }
    };
    if (this.isBoundedAuthoritativeCoop()) {
      this.coopIntroTimer = setTimeout(() => {
        if (this.coopBoundaryStillLive()) {
          continueIntro();
        }
      }, COOP_NEW_BIOME_INTRO_WATCHDOG_MS);
    }
    globalScene.tweens.add({ targets, x: "+=300", duration: 2_000, onComplete: continueIntro });
  }

  private armTerminalWatchdog(authoritativeGuest: boolean): void {
    if (!this.isBoundedAuthoritativeCoop() || this.coopTerminalTimer != null || this.coopCompleted) {
      return;
    }
    this.coopTerminalTimer = setTimeout(() => {
      if (this.coopCompleted || !this.coopBoundaryStillLive()) {
        return;
      }
      if (this.coopInteractivePresentationPending) {
        // Never skip a real player's dialogue and never let its late callback mutate the replacement phase.
        return;
      }
      if (authoritativeGuest) {
        try {
          materializeCoopAdoptedEnemyField();
        } catch (error) {
          coopWarn("runtime", "NewBiome watchdog could not finish cosmetic enemy materialization", error);
        }
        this.finishAuthoritativeGuestPresentation();
        return;
      }
      this.end();
    }, COOP_NEW_BIOME_TERMINAL_WATCHDOG_MS);
  }

  /**
   * Finish the renderer-only new-biome intro without skipping a host-authored Mystery surface. Ordinary
   * encounters continue to the queued command tail; a Mystery carrier must first enter the normal guest
   * MysteryEncounterPhase divert, which replaces local simulation with CoopReplayMePhase.
   */
  private finishAuthoritativeGuestPresentation(): void {
    if (!this.coopBoundaryStillLive()) {
      return;
    }
    // The presentation-only guest deliberately never constructs or initializes the local encounter object.
    // Defer queueing until completeEncounterEnd has revalidated the exact transition permit; the normal
    // MysteryEncounterPhase divert then replaces local simulation with CoopReplayMePhase.
    this.coopMysteryContinuationPending = globalScene.currentBattle.isBattleMysteryEncounter();
    this.end();
  }

  /** Missing authority never advances; reconnect/replay may restore the exact permit/carrier and retry. */
  private parkForAuthoritativePermit(retry: () => void): void {
    if (this.coopPermitRecoveryShown || !this.coopBoundaryStillLive(false)) {
      return;
    }
    this.coopPermitRecoveryAttempts++;
    if (this.coopPermitRecoveryAttempts > 2) {
      failCoopSharedSession(
        `The shared new-biome encounter lost its exact permit after bounded recovery at wave ${this.coopWave}.`,
      );
      return;
    }
    this.coopPermitRecoveryShown = true;
    void globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.coopBoundaryStillLive(false))
      .then(result => {
        if (!this.coopBoundaryStillLive(false)) {
          return;
        }
        if (result === "superseded") {
          this.coopPermitRecoveryShown = false;
          this.parkForAuthoritativePermit(retry);
          return;
        }
        globalScene.ui.showText(
          "Could not confirm the shared new-biome encounter. Reconnect, then confirm to retry.",
          null,
          () => {
            if (!this.coopBoundaryStillLive(false)) {
              return;
            }
            this.coopPermitRecoveryShown = false;
            retry();
          },
          null,
          true,
        );
      })
      .catch(error => {
        if (!this.coopBoundaryStillLive(false)) {
          return;
        }
        this.coopPermitRecoveryShown = false;
        coopWarn("runtime", "NewBiome recovery surface failed to open", error);
        this.parkForAuthoritativePermit(retry);
      });
  }

  /** A transient atlas/UI failure retains the adopted carrier and retries presentation only. */
  private parkForAuthoritativePresentation(retry: () => void): void {
    if (this.coopPresentationRecoveryShown || !this.coopBoundaryStillLive()) {
      return;
    }
    this.coopPresentationRecoveryAttempts++;
    if (this.coopPresentationRecoveryAttempts > 2) {
      failCoopSharedSession(
        `The authoritative new-biome presentation remained incomplete after bounded recovery at wave ${this.coopWave}.`,
      );
      return;
    }
    this.coopPresentationRecoveryShown = true;
    void globalScene.ui
      .setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.coopBoundaryStillLive())
      .then(result => {
        if (!this.coopBoundaryStillLive()) {
          return;
        }
        if (result === "superseded") {
          this.coopPresentationRecoveryShown = false;
          this.parkForAuthoritativePresentation(retry);
          return;
        }
        globalScene.ui.showText(
          "Could not render the shared new-biome encounter. Confirm to retry.",
          null,
          () => {
            if (!this.coopBoundaryStillLive()) {
              return;
            }
            this.coopPresentationRecoveryShown = false;
            retry();
          },
          null,
          true,
        );
      })
      .catch(error => {
        if (!this.coopBoundaryStillLive()) {
          return;
        }
        this.coopPresentationRecoveryShown = false;
        coopWarn("runtime", "NewBiome presentation recovery surface failed to open", error);
        this.parkForAuthoritativePresentation(retry);
      });
  }

  /** Keep a mechanical recovery timer from overtaking a live human-owned dialogue surface. */
  private setInteractivePresentationWaiting(waiting: boolean): void {
    if (!this.coopBoundaryStillLive()) {
      return;
    }
    this.coopInteractivePresentationPending = waiting;
    if (waiting) {
      this.clearTimer("terminal");
    } else {
      this.armTerminalWatchdog(this.coopAuthoritativeGuest);
    }
  }

  /** EncounterPhase's asset/UI promise chain must share this exact retained transition lifetime. */
  protected override isEncounterPresentationBoundaryLive(): boolean {
    // A SOLO run (and any non-bounded, non-authoritative-co-op phase) has no retained co-op
    // transition lifetime, so its coopBoundaryStillLive() is always false (coopGeneration < 0).
    // Gating EncounterPhase.runEncounter's async presentation chain on that would early-return it,
    // so the first wave of the new biome never presents - the solo wave-11 biome-transition softlock.
    // Only a bounded authoritative co-op phase ties the shared chain to the retained co-op boundary;
    // solo falls back to the base "always live" boundary.
    if (!this.isBoundedAuthoritativeCoop()) {
      return super.isEncounterPresentationBoundaryLive();
    }
    return this.coopBoundaryStillLive();
  }

  private coopBoundaryStillLive(requirePermit = true): boolean {
    if (
      this.coopGeneration < 0
      || coopSessionGeneration() !== this.coopGeneration
      || getCoopRuntime() !== this.coopRuntime
      || getCoopController() !== this.coopController
      || this.coopController?.sessionEpoch !== this.coopSessionEpoch
      || globalScene.gameMode?.isCoop !== true
      || getCoopController()?.netcodeMode !== "authoritative"
      || globalScene.currentBattle !== this.coopBattle
      || globalScene.currentBattle?.waveIndex !== this.coopWave
      || globalScene.phaseManager.getCurrentPhase() !== this
    ) {
      return false;
    }
    if (!requirePermit || this.coopOperationId == null) {
      return true;
    }
    return getCoopBiomeTransitionTailPermit()?.operationId === this.coopOperationId;
  }

  private isBoundedAuthoritativeCoop(): boolean {
    return (
      this.coopGeneration >= 0 || (globalScene.gameMode.isCoop && getCoopController()?.netcodeMode === "authoritative")
    );
  }

  private clearTimer(which: "intro" | "terminal" | "end"): void {
    const timer =
      which === "intro" ? this.coopIntroTimer : which === "terminal" ? this.coopTerminalTimer : this.coopEndTimer;
    if (timer != null) {
      clearTimeout(timer);
      if (which === "intro") {
        this.coopIntroTimer = null;
      } else if (which === "terminal") {
        this.coopTerminalTimer = null;
      } else {
        this.coopEndTimer = null;
      }
    }
  }

  private clearAllTimers(): void {
    this.clearTimer("intro");
    this.clearTimer("terminal");
    this.clearTimer("end");
  }
}
