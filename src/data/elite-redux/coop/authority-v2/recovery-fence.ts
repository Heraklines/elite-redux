/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - RECOVERY FENCE (Lane 4)
//
// The fence primitive behind frozen decision 5 (CoopRecoveryTransaction). It is
// acquired BEFORE a snapshot is requested and stays held for the whole atomic
// apply, so that while a recovery is in flight NONE of the four progression
// surfaces can advance:
//
//   1. command admission            - the replica must not admit new commands.
//   2. phase / control progression  - no phase/control may advance the frontier.
//   3. retained-entry materialization- the log must not materialize retained
//                                      entries under the recovering replica.
//   4. new authority-wait creation   - no fresh authority wait may be armed.
//
// This is exactly the class of defect the v1 recovery hit: the v1 fence was
// entered AFTER the network result, so local progression staled the snapshot
// the protocol then correctly refused ("recovery refused then terminal"). The
// fence closes that window by construction.
//
// ENGINE-FREE: this module is pure state + subscriptions. It exposes the four
// freeze PREDICATES as hooks the integration owner wires into the real
// admission / phase / materialization / wait sites; the fence never reaches
// into an engine itself. No Phaser, no globalScene, no module-global state -
// every fence is an isolated instance owned by its transaction's context.
// =============================================================================

/**
 * open     - nothing frozen; progression flows normally (no live recovery).
 * held     - a recovery transaction owns the fence; all four surfaces frozen.
 * terminal - the session died during recovery; the freeze is PERMANENT (never
 *            a silent park - progression never resumes from here).
 */
export type CoopRecoveryFenceState = "open" | "held" | "terminal";

/** Immutable snapshot handed to subscribers on every transition. */
export interface CoopRecoveryFenceView {
  readonly state: CoopRecoveryFenceState;
  readonly commandAdmissionFrozen: boolean;
  readonly progressionFrozen: boolean;
  readonly materializationFrozen: boolean;
  readonly authorityWaitCreationFrozen: boolean;
  /** Present once the fence has been terminalized. */
  readonly terminalReason?: string;
}

/**
 * The recovery fence. `acquire` is the single-live-transaction guard: it moves
 * `open -> held` and returns true exactly once; a second acquire against a held
 * or terminal fence returns false (never a throw), so a duplicate transaction is
 * rejected rather than corrupting the live one.
 */
export interface CoopRecoveryFence {
  readonly state: CoopRecoveryFenceState;
  readonly terminalReason: string | undefined;

  /** open -> held. Returns true only on the transition; false if already held/terminal. */
  acquire(): boolean;
  /** held -> open (happy path). No-op on open; a terminal fence NEVER re-opens. */
  release(): void;
  /** any -> terminal. Records the reason and freezes permanently. Idempotent. */
  terminalize(reason: string): void;

  // The four freeze predicates the integration owner wires at the real sites.
  // Every surface is frozen whenever the fence is not `open`.
  isCommandAdmissionFrozen(): boolean;
  isProgressionFrozen(): boolean;
  isMaterializationFrozen(): boolean;
  isAuthorityWaitCreationFrozen(): boolean;

  /** Snapshot of the current fence view (for hooks that want the whole shape). */
  view(): CoopRecoveryFenceView;
  /** Subscribe to transitions; returns an unsubscribe handle. Fires on change only. */
  subscribe(listener: (view: CoopRecoveryFenceView) => void): () => void;
}

export function createRecoveryFence(): CoopRecoveryFence {
  let state: CoopRecoveryFenceState = "open";
  let terminalReason: string | undefined;
  const listeners = new Set<(view: CoopRecoveryFenceView) => void>();

  const frozen = (): boolean => state !== "open";

  const view = (): CoopRecoveryFenceView => ({
    state,
    commandAdmissionFrozen: frozen(),
    progressionFrozen: frozen(),
    materializationFrozen: frozen(),
    authorityWaitCreationFrozen: frozen(),
    // exactOptionalPropertyTypes: only present once terminalized.
    ...(terminalReason === undefined ? {} : { terminalReason }),
  });

  const notify = (): void => {
    const snapshot = view();
    for (const listener of [...listeners]) {
      // A rogue subscriber must not desync the fence for the others.
      try {
        listener(snapshot);
      } catch {
        // Subscribers are advisory observers; swallowing keeps the fence honest.
      }
    }
  };

  return {
    get state() {
      return state;
    },
    get terminalReason() {
      return terminalReason;
    },
    acquire(): boolean {
      if (state !== "open") {
        return false;
      }
      state = "held";
      notify();
      return true;
    },
    release(): void {
      // A terminal fence is a permanent freeze; only a held fence re-opens.
      if (state !== "held") {
        return;
      }
      state = "open";
      notify();
    },
    terminalize(reason: string): void {
      if (state === "terminal") {
        return;
      }
      state = "terminal";
      terminalReason = reason;
      notify();
    },
    isCommandAdmissionFrozen: frozen,
    isProgressionFrozen: frozen,
    isMaterializationFrozen: frozen,
    isAuthorityWaitCreationFrozen: frozen,
    view,
    subscribe(listener: (view: CoopRecoveryFenceView) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
