/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op OPERATION <-> DURABILITY BRIDGE (Wave-2e authoritative run-state migration;
// see docs/plans/2026-07-10-coop-authoritative-run-state-migration.md, §4.1/§4.2/§4.6).
//
// This is the SEAM the parallel-lane merge left open (§4.6): Wave-2a/b built the
// operation envelope (coop-operation-runtime.ts) and the durability journal
// (coop-durability.ts) in parallel, with a documented plug-in point - "the durability
// manager is a wired but passive scaffold UNTIL the envelope commit path calls
// runtime.durability.commit(...)". Wave-2e closes it.
//
// WHAT IT DOES:
//   - COMMIT -> JOURNAL (committer). A migrated surface adapter, after the sole-authority
//     CoopOperationHost COMMITS an op (revision++, §1.5), calls {@linkcode journalCoopCommittedEnvelope}
//     with the authoritative envelope. That JOURNALS the committed op (so it can be resent /
//     replayed, §4.1/§4.2) and broadcasts it on the additive `envelope` wire arm (§1.1). The
//     legacy relay carrier keeps firing in dual-run (§5.1) - the journal rides ALONGSIDE it, it
//     does not replace it.
//   - REPLAY -> APPLY (receiver). {@linkcode coopOperationDurabilityHooks} hands the durability
//     manager an `extractKey`/`apply` pair. `extractKey` recognizes an inbound `envelope` frame and
//     keys it `(class, revision)`; `apply` routes the replayed committed envelope INTO the surface's
//     idempotent guest applier (invariant 5, §1.6) - NOT around it - so a journal resend / reconnect
//     tail reconstructs + re-applies the op exactly as the live relay-adopt path would, deduped by
//     operationId. The manager's own ACK (`coopAck`) + reconnect (`coopResync`) arms (§4.2/§4.4) are
//     the generic durability channel; the doc's envelope-specialized `envelopeAck`/`reconnectSync`
//     names are RETIRED in favor of them (Wave-2e wire consolidation).
//
// JOURNALED CLASS. Each migrated surface is one journaled class keyed by its SURFACE-LOCAL dense
// revision (§8.2 - the global dense revision lands only when every surface is migrated). The class is
// DERIVED from the envelope's `logicalPhase` so no new wire field is needed:
//   - BIOME_SELECT                     -> "op:biome"  (coop-biome-operation.ts)
//   - REWARD_SELECT / SHOP             -> "op:reward" (coop-reward-operation.ts - one host serves both)
//   - MYSTERY_ENCOUNTER                -> "op:me"     (coop-me-operation.ts)
// The reward shop and biome market share ONE host + ONE surface-local revision (§8.2.1), so both
// phases map to the SAME class - its revision stream stays dense across a reward-then-market run.
//
// FLAGS (§5, adjudication (b)). The plug respects EVERY flag: the manager exists only when
// {@linkcode isCoopDurabilityEnabled}; {@linkcode setCoopOperationDurability} is called with it, so
// {@linkcode journalCoopCommittedEnvelope} is a no-op when durability is OFF; and each adapter's
// commit / apply seam is itself gated by its per-surface flag, so a surface flag OFF = pure legacy
// dual-run (no journaling for it). Flag OFF anywhere = today's behavior.
//
// ENGINE-FREE. Types + the active-manager reference + a tiny applier registry; no globalScene / phases
// / Phaser. The surface adapters REGISTER their appliers at import (one-way: adapters -> this module),
// so there is no circular import.
// =============================================================================

import type { CoopDurabilityHooks, CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1, CoopLogicalPhase } from "#data/elite-redux/coop/coop-operation-envelope";

/** The journaled durability class for a committed op, DERIVED from its logical phase (§4.1). */
export function coopOperationClassForPhase(phase: CoopLogicalPhase): string | null {
  switch (phase) {
    case "BIOME_SELECT":
      return "op:biome";
    case "REWARD_SELECT":
    case "SHOP":
      return "op:reward";
    case "MYSTERY_ENCOUNTER":
      return "op:me";
    default:
      return null; // control-plane phases that are not (yet) a migrated operation surface
  }
}

/**
 * A surface's guest-side applier: route a replayed committed envelope INTO the surface's idempotent
 * guest applier (invariant 5). Returns true iff the op was NEWLY applied (false = a duplicate / late
 * re-delivery that was a no-op, or the surface flag is OFF). Registered by each adapter at import.
 */
export type CoopOperationEnvelopeApplier = (envelope: CoopAuthoritativeEnvelopeV1) => boolean;

/** The active session's durability manager, or null when durability is OFF / no session (set at assembly). */
let activeDurability: CoopDurabilityManager | null = null;

/** Per-class guest appliers (adapters register at import; keyed by {@linkcode coopOperationClassForPhase}). */
const appliers = new Map<string, CoopOperationEnvelopeApplier>();

/**
 * Test/diagnostic observability: the committed envelopes this client has NEWLY APPLIED via the journal
 * (resend / reconnect tail), in order. The convergence proof asserts a cut op arrives here. Bounded
 * implicitly by a run's op count; reset on session boundaries via {@linkcode resetCoopOperationJournalLog}.
 */
const journalApplied: CoopAuthoritativeEnvelopeV1[] = [];

/**
 * Install (or clear) the active session's durability manager. Called from `assembleCoopRuntime` with the
 * flag-gated manager (null when durability is OFF), and cleared on `clearCoopRuntime`. When null,
 * {@linkcode journalCoopCommittedEnvelope} is a no-op (legacy dual-run only).
 */
export function setCoopOperationDurability(manager: CoopDurabilityManager | null): void {
  activeDurability = manager;
}

/** Whether the operation commit path currently journals (durability manager installed). */
export function isCoopOperationJournalActive(): boolean {
  return activeDurability != null;
}

/**
 * COMMIT -> JOURNAL (§4.1/§4.2). Called by a migrated surface adapter immediately after its
 * CoopOperationHost COMMITS an op. Journals the committed envelope (for resend / reconnect replay) and
 * broadcasts it on the `envelope` wire arm. No-op when durability is OFF or the phase is not a migrated
 * operation surface. Never throws (a failure must fall back to the legacy relay carrier, dual-run).
 */
export function journalCoopCommittedEnvelope(envelope: CoopAuthoritativeEnvelopeV1): void {
  const manager = activeDurability;
  if (manager == null) {
    return;
  }
  const cls = coopOperationClassForPhase(envelope.logicalPhase);
  if (cls == null) {
    return;
  }
  try {
    manager.commit(cls, envelope.revision, { t: "envelope", envelope });
  } catch {
    // Journaling is a durability BACKSTOP over the legacy relay carrier (still firing in dual-run); a
    // failure here must never break the live commit. The relay + the deep-gap snapshot remain the fallback.
  }
}

/**
 * Register a surface's guest applier (adapters call this at import; one-way dep). Keyed by the journaled
 * class ({@linkcode coopOperationClassForPhase}). Idempotent for the same class (last registration wins).
 */
export function registerCoopOperationApplier(cls: string, applier: CoopOperationEnvelopeApplier): void {
  appliers.set(cls, applier);
}

/**
 * The `extractKey`/`apply` hooks the durability manager needs to carry the operation envelope as one
 * journaled class per surface (§4.6). `extractKey` recognizes the `envelope` frame + keys it
 * `(class, revision)`; `apply` routes the replayed envelope into the surface's idempotent guest applier
 * (invariant 5) and records a NEWLY-applied op for the convergence proof. A phase with no migrated class,
 * or an envelope for a surface with no registered applier, is ignored (the manager treats it as not-a-op).
 */
export function coopOperationDurabilityHooks(): CoopDurabilityHooks {
  return {
    extractKey: msg => {
      if (msg.t === "envelope") {
        const cls = coopOperationClassForPhase(msg.envelope.logicalPhase);
        return cls == null ? null : { cls, seq: msg.envelope.revision };
      }
      return null;
    },
    apply: entry => {
      if (entry.msg.t !== "envelope") {
        return;
      }
      const envelope = entry.msg.envelope;
      const applier = appliers.get(entry.cls);
      if (applier == null) {
        return;
      }
      if (applier(envelope)) {
        journalApplied.push(envelope);
      }
    },
  };
}

/** The committed envelopes NEWLY applied via the journal this session (proof observability). */
export function getCoopOperationJournalApplied(): readonly CoopAuthoritativeEnvelopeV1[] {
  return journalApplied;
}

/** Drop the journal-applied log (session boundary / test hygiene). Does NOT clear the applier registry. */
export function resetCoopOperationJournalLog(): void {
  journalApplied.length = 0;
}
