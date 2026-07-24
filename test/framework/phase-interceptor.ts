import type { BattleScene } from "#app/battle-scene";
import type { Phase } from "#app/phase";
import { PHASE_INTERCEPTOR_COLOR, PHASE_START_COLOR } from "#constants/colors";
import { UiMode } from "#enums/ui-mode";
import { TEST_TIMEOUT } from "#test/constants";
import type { GameManager } from "#test/framework/game-manager";
import type { PromptHandler } from "#test/helpers/prompt-handler";
import { getEnumStr } from "#test/utils/string-utils";
import type { PhaseString } from "#types/phase-types";
import { inspect } from "util";
import chalk from "chalk";
import { vi } from "vitest";

/**
 * The interceptor's current state.
 * Possible values are the following:
 * - `running`: The interceptor is currently running a phase.
 * - `interrupted`: The interceptor has been interrupted by a UI prompt or similar mechanism,
 *    and is waiting for the current phase to end.
 * - `idling`: The interceptor is not currently running a phase and is ready to start a new one.
 */
type StateType = "running" | "interrupted" | "idling";

/**
 * The PhaseInterceptor is a wrapper around the `BattleScene`'s {@linkcode PhaseManager}.
 * It allows tests to exert finer control over the phase system, providing logging, manual advancing, and other helpful utilities.
 */
export class PhaseInterceptor {
  private readonly scene: BattleScene;
  /**
   * A log containing all phases having been executed in FIFO order. \
   * Entries are appended each time {@linkcode run} is called, and can be cleared manually with {@linkcode clearLogs}.
   */
  public readonly log: PhaseString[] = [];
  /**
   * The interceptor's current state.
   * @see {@linkcode StateType}
   * @defaultValue `idling`
   */
  private state: StateType = "idling";
  /** The exact phase object whose public prompt changed {@linkcode state} to `interrupted`. */
  private interruptedPhase: Phase | null = null;
  /** The current target that is being ran to. */
  private target: PhaseString;

  /**
   * Initialize a new PhaseInterceptor.
   * @param scene - The scene to be managed
   * @remarks
   * This overrides {@linkcode PhaseManager.startCurrentPhase} to toggle the interceptor's state
   * instead of immediately starting the next phase.
   */
  // TODO: This should take a `GameManager` instance once multi-scene things become a reality
  // (though our entire Phase system will likely have to be redone anyways)
  constructor(scene: BattleScene) {
    this.scene = scene;
    // Persistently stub out `this.scene.phaseManager.getCurrentPhase`
    // to toggle the interceptor's state (rather than starting a new phase).
    // We do not use `vi.spyOn` as that will reset once the test ends
    this.scene.phaseManager["startCurrentPhase"] = () => {
      this.state = "idling";
      this.interruptedPhase = null;
    };
  }

  /**
   * Method to transition to a target phase.
   * @param target - The name of the {@linkcode Phase} to transition to
   * @param runTarget - Whether or not to run the target phase before resolving; default `true`
   * @returns A Promise that resolves once `target` has been reached.
   * @remarks
   * This will not resolve for _any_ reason until the target phase has been reached.
   * @example
   * ```ts
   * await game.phaseInterceptor.to("MoveEffectPhase", false);
   * ```
   */
  public async to(target: PhaseString, runTarget = true): Promise<void> {
    this.target = target;

    const pm = this.scene.phaseManager;

    let currentPhase = pm.getCurrentPhase();
    let didLog = false;
    let targetWasAlreadyInterrupted = false;

    // NB: This has to use an interval to wait for UI prompts to activate
    // since our UI code effectively stalls when waiting for input.
    // This entire function can likely be made synchronous once UI code is moved to a separate scene.
    try {
      await vi.waitUntil(
        async () => {
          currentPhase = pm.getCurrentPhase();
          // A predecessor can synchronously shift into and start an interactive target before its own
          // `start()` returns. In that race PromptHandler marks us interrupted while the phase manager is
          // already sitting on the requested target. A stop-before-target caller must regain control so it
          // can drive that public UI; waiting for the target to end creates an impossible dependency cycle.
          // Observe this invocation's immutable target. `this.target` is only the PromptHandler routing
          // slot and can be replaced by a nested/asynchronous interceptor request while this wait is
          // still unwinding. Letting that shared slot define arrival strands the original caller on an
          // interactive phase it has already reached.
          if (currentPhase.phaseName === target) {
            if (!runTarget || this.state !== "interrupted") {
              return true;
            }
            // A previous/public driver can deliberately open the exact interactive target before a shared
            // helper asks to run to it (the continuous Mystery journey does this so it can first prove the
            // owner surface). That target has already run as far as the interceptor contract permits. Treat
            // only the same phase OBJECT recorded by checkMode as reached; a matching name with stale global
            // state is not sufficient, and re-running the phase would duplicate its presentation/authority.
            if (this.interruptedPhase === currentPhase) {
              targetWasAlreadyInterrupted = true;
              return true;
            }
          }

          // If we were interrupted by a UI prompt on an intermediate phase (or a run-target caller reached
          // an interactive target), the calling code must queue inputs to end that phase manually.
          if (this.state === "interrupted") {
            if (!didLog) {
              this.doLog("PhaseInterceptor.to: Waiting for phase to end after being interrupted!");
              didLog = true;
            }
            return false;
          }

          // Current phase is different; run and wait for it to finish.
          await this.run(currentPhase);
          return false;
        },
        { interval: 0, timeout: TEST_TIMEOUT },
      );
    } catch (err) {
      // A timeout here is a soft-lock / freeze: the target phase was never reached
      // because something is waiting on input that never came. Surface the CURRENT
      // phase + active UI mode + interceptor state so the hang is diagnosable
      // instead of a bare "Timed out in waitUntil".
      const stuck = pm.getCurrentPhase();
      const stuckPhase = stuck?.phaseName ?? "(none)";
      // An asynchronous phase/UI transition can settle on the exact stop-before target in the same timer
      // turn that expires `waitUntil`. Re-read the phase after the timeout before classifying a softlock:
      // the requested public surface being current is the complete contract of a stop-before call.
      if (!runTarget && stuckPhase === target) {
        this.doLog(`PhaseInterceptor.to: Recovered exact ${target} arrival at timeout boundary`);
        return;
      }
      const uiMode = getEnumStr(UiMode, this.scene.ui.getMode());
      throw new Error(
        `PhaseInterceptor.to("${target}") did not reach its target (soft-lock / freeze?): `
          + `stuck at phase "${stuckPhase}", UI mode ${uiMode}, interceptor state "${this.state}".`
          + ` runTarget=${runTarget}, promptTarget="${this.target}".`
          + `\nOriginal: ${err instanceof Error ? err.message : inspect(err)}`,
      );
    }

    // We hit the target; run as applicable and wrap up.
    if (!runTarget) {
      this.doLog(`PhaseInterceptor.to: Stopping before running ${target}`);
      return;
    }

    if (targetWasAlreadyInterrupted) {
      this.doLog(`PhaseInterceptor.to: Reusing already-open ${target} public surface`);
      return;
    }

    await this.run(currentPhase);
    this.doLog(
      `PhaseInterceptor.to: Stopping ${this.state === "interrupted" ? `after reaching ${getEnumStr(UiMode, this.scene.ui.getMode())} during` : "on completion of"} ${target}`,
    );
  }

  /**
   * Advance until the first phase in `targets` is reached, without starting that phase.
   *
   * This is useful at authoritative branch points where the phase queue, rather than the
   * test driver, decides whether play continues (for example CommandPhase versus a
   * post-victory SelectModifierPhase). Requiring one guessed target at such a branch turns
   * a correct alternate route into a misleading timeout.
   */
  public async toFirst(targets: readonly PhaseString[]): Promise<PhaseString> {
    if (targets.length === 0) {
      throw new Error("PhaseInterceptor.toFirst requires at least one target phase");
    }
    const targetSet = new Set(targets);
    // PromptHandler only needs a single target while intermediate phases run. The selected
    // terminal is deliberately not started, so it cannot itself interrupt on a UI prompt.
    this.target = targets[0];
    const pm = this.scene.phaseManager;
    let currentPhase = pm.getCurrentPhase();
    try {
      await vi.waitUntil(
        async () => {
          currentPhase = pm.getCurrentPhase();
          // Same synchronous interactive-target race as `to(..., false)`: `toFirst` is explicitly a
          // stop-before-driving primitive, so an already-open branch target is a successful arrival.
          if (targetSet.has(currentPhase.phaseName)) {
            return true;
          }
          if (this.state === "interrupted") {
            return false;
          }
          await this.run(currentPhase);
          return false;
        },
        { interval: 0, timeout: TEST_TIMEOUT },
      );
    } catch (err) {
      const stuckPhase = pm.getCurrentPhase()?.phaseName ?? "(none)";
      const uiMode = getEnumStr(UiMode, this.scene.ui.getMode());
      throw new Error(
        `PhaseInterceptor.toFirst([${targets.join(", ")}]) did not reach a target (soft-lock / freeze?): `
          + `stuck at phase "${stuckPhase}", UI mode ${uiMode}, interceptor state "${this.state}".`
          + `\nOriginal: ${err instanceof Error ? err.message : inspect(err)}`,
      );
    }
    return currentPhase.phaseName;
  }

  /**
   * Internal wrapper method to start a phase and wait until it finishes.
   * @param currentPhase - The {@linkcode Phase} to run
   * @returns A Promise that resolves when the phase has completed running.
   */
  private async run(currentPhase: Phase): Promise<void> {
    try {
      this.state = "running";
      this.interruptedPhase = null;
      this.logPhase(currentPhase.phaseName);
      // The interceptor replaces PhaseManager.startCurrentPhase, but it must not bypass the production
      // Authority V2 mutation boundary that lives immediately before phase.start(). A phase token remains
      // held across this async wait and any public UI interruption until PhaseManager.shiftPhase retires it.
      this.scene.phaseManager.prepareCurrentPhaseForStart();
      currentPhase.start();
      await vi.waitUntil(() => this.state !== "running", { interval: 50, timeout: TEST_TIMEOUT });
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Unknown error occurred while running phase ${currentPhase.phaseName}!\nError: ${inspect(error)}`);
    }
  }

  /**
   * If this is at the target phase, unlock the interceptor and
   * return control back to the caller once the calling phase has finished.
   * @remarks
   * This should not be called by anything other than {@linkcode PromptHandler}.
   */
  public checkMode(): void {
    const currentPhase = this.scene.phaseManager.getCurrentPhase();
    if (!currentPhase.is(this.target) || this.state === "interrupted") {
      // Wrong phase / already interrupted = do nothing
      return;
    }

    // Interrupt the phase and return control to the caller
    this.state = "interrupted";
    this.interruptedPhase = currentPhase;
  }

  /**
   * Skip the next upcoming phase.
   * @throws Error if currently running a phase.
   * @remarks
   * This function should be used for skipping phases _not yet started_.
   * To end ones already in the process of running, use {@linkcode GameManager.endPhase}.
   * @example
   * await game.phaseInterceptor.to("LoginPhase", false);
   * game.phaseInterceptor.shiftPhase(); // skips LoginPhase without starting it
   */
  public shiftPhase(): void {
    const phaseName = this.scene.phaseManager.getCurrentPhase().phaseName;
    if (this.state !== "idling") {
      throw new Error(`PhaseInterceptor.shiftPhase attempted to skip phase ${phaseName} mid-execution!`);
    }
    this.doLog(`Skipping current phase: ${phaseName}`);
    this.scene.phaseManager.shiftPhase();
  }

  /**
   * Method to log the start of a phase.
   * Called in place of {@linkcode PhaseManager.startCurrentPhase} to allow for manual intervention.
   * @param phaseName - The name of the phase to log
   */
  private logPhase(phaseName: PhaseString): void {
    console.log(`%cStart Phase: ${phaseName}`, `color:${PHASE_START_COLOR}`);
    this.log.push(phaseName);
  }

  /**
   * Clear all prior phase logs.
   */
  public clearLogs(): void {
    this.log.splice(0, this.log.length);
  }

  /**
   * Wrapper function to add coral coloration to phase logs.
   * @param args - Arguments to original logging function
   */
  private doLog(...args: unknown[]): void {
    console.log(chalk.hex(PHASE_INTERCEPTOR_COLOR)(...args));
  }
}
