import { globalScene } from "#app/global-scene";
import type { PhaseMap, PhaseString } from "#types/phase-types";

export abstract class Phase {
  /** A destructively replaced phase may still receive detached async callbacks, but may never shift again. */
  private retired = false;

  /** Start the current phase. */
  public start(): void {}

  /**
   * Retire this phase without advancing the scheduler.
   *
   * Authoritative co-op and recovery can destructively replace a locally inferred phase tree. Calling
   * {@linkcode end} in that situation would let the discarded phase choose another local successor, but
   * simply dropping the object leaks any machine waits or detached continuations it owns. Stateful phases
   * override this hook to cancel those resources; ordinary phases have nothing to retire.
   */
  public retire(): void {
    this.retired = true;
  }

  /** Whether authoritative progression has destructively discarded this phase. */
  protected isRetired(): boolean {
    return this.retired;
  }

  /** End the current phase and start a new one. */
  public end(): void {
    if (this.isRetired()) {
      return;
    }
    globalScene.phaseManager.shiftPhase(this);
  }

  /**
   * The string name of the phase, used to identify the phase type for {@linkcode is}
   *
   * @privateRemarks
   *
   * When implementing a phase, you must set the `phaseName` property to the name of the phase.
   */
  public abstract readonly phaseName: PhaseString;

  /**
   * Check whether this Phase is of the given type without requiring `instanceof`.
   *
   * @param phaseName - The name of the phase to check
   * @returns Whether this Phase is of the provided type.
   *
   * @remarks
   * This does not check for subclasses! It only checks if the phase is *exactly* the given type.
   * This method exists to avoid circular import issues, as using `instanceof` would require importing each phase.
   */
  public is<K extends keyof PhaseMap>(phaseName: K): this is PhaseMap[K] {
    return this.phaseName === phaseName;
  }
}
