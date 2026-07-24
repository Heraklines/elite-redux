/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Immutable diagnostic view of one runtime's authoritative-mutation barrier. */
export interface CoopMutationLedgerSnapshot {
  /** Changes whenever a mutation token is acquired, settled, or the runtime is reset. */
  readonly generation: number;
  /** Every phase/callback that can still change the authoritative image. */
  readonly pendingTokens: number;
  /** Stable, sorted labels for fail-closed diagnostics and bug reports. */
  readonly activeLabels: readonly string[];
}

/** One idempotent lease over an in-flight authoritative mutation. */
export interface CoopMutationToken {
  readonly id: number;
  readonly label: string;
  readonly openedGeneration: number;
  settle(): boolean;
}

interface ActiveMutation {
  readonly label: string;
  readonly openedGeneration: number;
}

/**
 * Runtime-owned barrier for the exact fully-settled turn boundary.
 *
 * A token is acquired before an engine phase starts and is held across every await/tween/callback until
 * that phase actually leaves the scheduler. Non-phase mutation work may acquire a token explicitly too.
 * Turn capture requires both zero active tokens and an unchanged generation across serialization.
 */
export class CoopMutationLedger {
  private readonly activeTokens = new Map<number, ActiveMutation>();
  private nextTokenId = 1;
  private currentGeneration = 0;

  begin(label: string): CoopMutationToken {
    const normalized = label.trim();
    if (normalized.length === 0) {
      throw new Error("co-op mutation tokens require a non-empty label");
    }
    const id = this.nextTokenId++;
    const openedGeneration = ++this.currentGeneration;
    this.activeTokens.set(id, { label: normalized, openedGeneration });
    let settled = false;
    return Object.freeze({
      id,
      label: normalized,
      openedGeneration,
      settle: (): boolean => {
        if (settled || !this.activeTokens.delete(id)) {
          return false;
        }
        settled = true;
        this.currentGeneration++;
        return true;
      },
    });
  }

  snapshot(): CoopMutationLedgerSnapshot {
    return Object.freeze({
      generation: this.currentGeneration,
      pendingTokens: this.activeTokens.size,
      activeLabels: Object.freeze([...this.activeTokens.values()].map(token => token.label).sort()),
    });
  }

  /** Runtime teardown invalidates every stale token without letting one settle into a successor session. */
  reset(): void {
    if (this.activeTokens.size > 0) {
      this.activeTokens.clear();
    }
    this.currentGeneration++;
  }
}

let activeLedger: CoopMutationLedger | null = null;

/** Install the ledger belonging to the process's currently selected co-op runtime. */
export function setActiveCoopMutationLedger(ledger: CoopMutationLedger | null): void {
  activeLedger = ledger;
}

/**
 * Acquire a token against the currently selected runtime.
 *
 * The returned token closes over its exact ledger, so settling remains destination-correct even if a
 * two-engine harness or runtime replacement changes the process-global active runtime in the meantime.
 */
export function beginActiveCoopMutation(label: string): CoopMutationToken | null {
  return activeLedger?.begin(label) ?? null;
}
