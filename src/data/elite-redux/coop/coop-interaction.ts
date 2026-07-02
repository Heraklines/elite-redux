/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op INTERACTION primitive (#633 M3 - authoritative session replication redesign;
// see docs/plans/2026-07-02-coop-authoritative-replication-redesign.md, section 3.5).
//
// ONE lifecycle every shared interactive screen plugs into (reward shop, mystery
// encounter, move-learn, evolution branch, give-to-partner, and any future
// faction/domain/format screen):
//
//     OWNER drives the UI -> AUTHORITY applies the outcome -> state replicates to all.
//
// The KEY property (the whole reason M3 exists): NON-owner clients apply NOTHING. They
// spectate; the authority is the SOLE mutator; everyone else converges via the replicated
// state (the generic snapshot + cues from M2/M3). This DELETES the "identical pool / state"
// assumption behind the old ME pump + reward-relay (desyncs #2/#718): a watcher no longer
// re-rolls a pool or re-runs the choice against its own state, so it can never diverge.
//
// N-READY: `ownerId` / `authorityId` are player ids (0..N-1), not a binary host/guest, so
// the same primitive covers 2-player now and 3-way (triples) later with no code change.
//
// ENGINE-FREE: the mutate / replicate / transport are the injected `CoopInteractionContext`,
// so the orchestration is unit-testable headlessly over a mock ctx (exactly like the other
// co-op relays). This module is ADDITIVE - it is wired to nothing yet; the per-interaction
// migrations onto it are the later, individually-verified M3 sub-steps.
// =============================================================================

/** A co-op player seat id (0..N-1). The authority (the sole engine) is a specific id, conventionally 0. */
export type CoopPlayerId = number;

/**
 * One shared interactive screen. The OWNER drives it (collects the human's choice); the AUTHORITY
 * applies the resolved outcome to authoritative state; everyone else spectates + converges via the
 * replicated state. `TOutcome` is the serializable choice result (relayed owner -> authority).
 */
export interface CoopInteraction<TOutcome> {
  /** Monotonic id both clients agree on (the interaction counter), so both sides mean the same screen. */
  readonly id: number;
  /** The player who DRIVES this interaction (shows the real UI + collects the human choice). */
  readonly ownerId: CoopPlayerId;
  /** OWNER ONLY: show the real UI + resolve the human's choice. Never invoked on a non-owner. */
  driveLocally(): Promise<TOutcome>;
  /** NON-owner: render the read-only spectator view (+ optional owner-cursor mirror). Optional. */
  showSpectatorView?(): void;
}

/**
 * The injected surface {@linkcode runCoopInteraction} drives the lifecycle through. Every method is an
 * engine / transport seam so the orchestration stays pure + headlessly testable. In production these are
 * thin adapters over the co-op transport + the authoritative state apply + the M2/M3 state replication.
 */
export interface CoopInteractionContext<TOutcome> {
  /** This client's player id. */
  readonly localId: CoopPlayerId;
  /** The SOLE-authority player id (the host / engine); the only client that mutates authoritative state. */
  readonly authorityId: CoopPlayerId;
  /** OWNER -> AUTHORITY: relay the resolved outcome for interaction `id` (only when the owner is not the authority). */
  sendOutcome(id: number, outcome: TOutcome): void;
  /** AUTHORITY: await the owner's relayed outcome; resolves `null` on timeout / owner-gone. */
  awaitOutcome(id: number, timeoutMs?: number): Promise<TOutcome | null>;
  /** AUTHORITY ONLY: apply the outcome to the authoritative session state (the ONE mutation site). */
  applyOutcome(id: number, outcome: TOutcome): void;
  /** AUTHORITY ONLY: replicate the resulting state (snapshot + cues) to all renderers so they converge. */
  replicateState(id: number): void;
  /** A safe DEFAULT outcome the authority applies when the owner never answered (timeout). Optional. */
  defaultOutcome?(id: number): TOutcome | null;
  /** AUTHORITY: signal that interaction `id` advanced, closing it on all clients (keeps lockstep). Optional. */
  signalAdvance?(id: number): void;
  /** NON-authority: block until the authority signals `id` advanced. Optional (default: no wait). */
  awaitAdvance?(id: number, timeoutMs?: number): Promise<void>;
}

/**
 * Run ONE {@linkcode CoopInteraction} to completion under the owner-drives -> authority-applies ->
 * replicate model. Returns the AUTHORITATIVE outcome that was applied (or `null` if none was - a pure
 * spectator, or an owner-timeout with no default). Never throws for a role it is not: only the OWNER
 * calls {@linkcode CoopInteraction.driveLocally}, and only the AUTHORITY calls
 * {@linkcode CoopInteractionContext.applyOutcome} / {@linkcode CoopInteractionContext.replicateState}.
 *
 * Steps:
 *   1. OWNER resolves the human choice + relays it (unless it IS the authority). NON-owners spectate.
 *   2. AUTHORITY takes the outcome (its own, or awaited from the owner; a timeout -> the safe default),
 *      APPLIES it once (the sole mutation), REPLICATES the result to all, then signals advance.
 *   3. NON-authority renderers apply NOTHING - they converge via the replicated state - and wait out the
 *      authority's advance signal so the interaction closes in lockstep.
 */
export async function runCoopInteraction<TOutcome>(
  interaction: CoopInteraction<TOutcome>,
  ctx: CoopInteractionContext<TOutcome>,
): Promise<TOutcome | null> {
  const { id, ownerId } = interaction;
  const isOwner = ctx.localId === ownerId;
  const isAuthority = ctx.localId === ctx.authorityId;

  // 1. OWNER drives the real UI + resolves the outcome; NON-owners render the read-only spectator view.
  let ownOutcome: TOutcome | null = null;
  if (isOwner) {
    ownOutcome = await interaction.driveLocally();
    // Relay to the authority - unless we ARE the authority, in which case we apply it directly below.
    if (!isAuthority) {
      ctx.sendOutcome(id, ownOutcome);
    }
  } else {
    interaction.showSpectatorView?.();
  }

  // 2. AUTHORITY is the SOLE mutator: resolve the outcome (own / awaited / default), apply, replicate, advance.
  if (isAuthority) {
    let outcome: TOutcome | null = ownOutcome;
    if (!isOwner) {
      outcome = await ctx.awaitOutcome(id);
      if (outcome == null) {
        // The owner never answered (timeout / gone): apply a safe default so the run never hangs.
        outcome = ctx.defaultOutcome?.(id) ?? null;
      }
    }
    if (outcome != null) {
      ctx.applyOutcome(id, outcome); // ONLY the authority mutates authoritative state.
      ctx.replicateState(id); // -> all renderers converge (generic snapshot + cues), applying nothing themselves.
    }
    ctx.signalAdvance?.(id); // close the interaction on every client, keeping lockstep.
    return outcome;
  }

  // 3. NON-authority renderers apply NOTHING; they converge via the replicated state. Wait out the
  //    authority's advance so the interaction closes in lockstep, then return (an owner-renderer returns
  //    what it drove; a pure spectator returns null).
  await ctx.awaitAdvance?.(id);
  return ownOutcome;
}
