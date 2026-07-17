/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - THE FROZEN CONTRACT (2026-07-18)
//
// This file is the single coordination artifact for the authority-v2 build. It
// was frozen by the integration owner from the maintainer-approved architecture
// audit (docs/plans/2026-07-17-coop-authority-stabilization-tracks.md) and MUST
// NOT be edited by foundation/migration lanes. A lane that needs a contract
// change files it with the integration owner; private variants are forbidden.
//
// FROZEN DECISIONS (the six):
//  1. ONE global revision order - every mechanically meaningful progression
//     (turn, replacement, interaction, wave, terminal) is a CoopAuthorityEntry
//     in one monotonically increasing revision domain.
//  2. ONE authority-retention mechanism - CoopAuthorityLog is the sole retained
//     frontier. No independent streamer/journal retention survives cutover.
//  3. ONE exact frame context - CoopFrameContextV2 is mandatory on every
//     mechanically relevant frame. No optional legacy address fields.
//  4. ONE canonical next-control representation - CoopNextControl. The
//     authority STATES the successor control; the replica PROJECTS it. The
//     guest never derives control from its local phase queue.
//  5. ONE recovery transaction model - CoopRecoveryTransaction acquires its
//     fence BEFORE requesting data and applies material + log frontier +
//     control atomically before releasing.
//  6. ONE set of ACK-stage meanings (CoopAckStage):
//       admitted            - the entry is journaled at the replica (stops
//                             delivery retries; nothing else).
//       materialApplied     - canonical state installed; digest matches.
//       controlInstalled    - the stated nextControl exists locally with its
//                             exact owner/address (mechanical, not visual).
//       presentationSettled - optional local rendering completed. NEVER a
//                             retirement requirement for mechanical liveness.
//     RETIREMENT: an entry retires when the required replica has reached
//     admitted + materialApplied + (controlInstalled where nextControl != null).
//     A later entry may supersede an earlier one ONLY by log order under
//     the rule: if revision N+1 is admitted, it either explicitly subsumes N
//     or N has already reached its required stage.
//
// OWNERSHIP RULES (enforced in review):
//  - No new module-global mutable state.
//  - No getCoopRuntime()/globalScene reads after an async boundary in v2 code;
//    every task carries its CoopRuntimeContext.
//  - No new runWhenCoopRuntimeActive call without a migration note.
//  - No surface-specific retry loops; retries belong to the log/leases.
//  - No direct transport.send from migrated phase code (adapters emit entries).
//  - No guest-side derivation of nextControl.
//  - Seat IDs, not host/guest roles, authorize ownership decisions.
//  - Every wait owns an AbortSignal; every timer has an address and owner.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

// ---------------------------------------------------------------------------
// Identity + scheduling
// ---------------------------------------------------------------------------

/** Immutable per-session identity + capabilities injected into every v2 transaction. */
export interface CoopRuntimeContext {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly localSeatId: number;
  readonly authoritySeatId: number;
  readonly membershipRevision: number;

  readonly scene: BattleScene;
  readonly transport: CoopTransport;
  readonly scheduler: CoopScheduler;
  readonly cancellation: AbortSignal;
}

/**
 * The runtime-owned clock/timer surface. Implementations distinguish ACTIVE
 * time classes (connected / disconnected-recovery / suspended / renderer /
 * human-input); mechanical deadlines consume active time, with a separate
 * absolute safety ceiling. All v2 timers go through this - never raw
 * setTimeout - so ownership, addressing, and suspension pause are uniform.
 */
export interface CoopScheduler {
  /** Monotonic active-time milliseconds for the given time class. */
  now(timeClass: CoopTimeClass): number;
  /** Schedule under an owner + address; returns a cancel handle. */
  schedule(owner: CoopTimerOwner, delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void;
  /** Cancel every timer belonging to an owner (teardown/lease release). */
  cancelOwner(ownerId: string): void;
}

export type CoopTimeClass = "connected" | "recovery" | "renderer" | "humanInput" | "absolute";

export interface CoopTimerOwner {
  readonly ownerId: string;
  readonly address: string;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Frame context (mandatory on every mechanically relevant v2 frame)
// ---------------------------------------------------------------------------

export interface CoopFrameContextV2 {
  readonly sessionId: string;
  readonly runId: string;
  readonly sessionEpoch: number;
  readonly seatMapId: string;
  readonly membershipRevision: number;
  readonly senderSeatId: number;
  readonly authoritySeatId: number;
  readonly connectionGeneration: number;
}

// ---------------------------------------------------------------------------
// The authoritative log
// ---------------------------------------------------------------------------

export type CoopAuthorityEntryKind =
  | "TURN_COMMIT"
  | "REPLACEMENT_COMMIT"
  | "INTERACTION_COMMIT"
  | "WAVE_ADVANCE"
  | "TERMINAL_COMMIT";

/**
 * Opaque-to-the-log authoritative material. Adapters define concrete payloads;
 * the log treats it as an immutable, JSON-serializable value with a digest.
 */
export interface CoopAuthoritativeMaterial {
  readonly digest: string;
  readonly payload: unknown;
}

/** One committed, retained, exactly-once authoritative progression step. */
export interface CoopAuthorityEntry {
  readonly context: CoopFrameContextV2;
  /** Global revision - THE one ordering domain (frozen decision 1). */
  readonly revision: number;
  readonly operationId: string;
  readonly kind: CoopAuthorityEntryKind;
  readonly material: CoopAuthoritativeMaterial;
  /** The canonical successor control state (frozen decision 4). */
  readonly nextControl: CoopNextControl;
  /** Revisions this entry explicitly subsumes (supersession by log order). */
  readonly subsumes: readonly number[];
}

export type CoopAckStage = "admitted" | "materialApplied" | "controlInstalled" | "presentationSettled";

/** Replica-signed progress evidence for one entry (stage meanings frozen above). */
export interface CoopAuthorityReceipt {
  readonly context: CoopFrameContextV2;
  readonly revision: number;
  readonly operationId: string;
  readonly stage: CoopAckStage;
  /** Present when stage >= controlInstalled and nextControl != null. */
  readonly controlId?: string;
}

/**
 * The ONE retained authoritative log (frozen decision 2). Engine-free: no
 * Phaser imports in implementations. The authority side commits + retains +
 * redelivers until retirement; the replica side admits in order, detects
 * duplicates/gaps, requests tails, and reports receipts.
 */
export interface CoopAuthorityLog {
  /** AUTHORITY: commit the next entry (assigns the next global revision). */
  commit(entry: Omit<CoopAuthorityEntry, "revision">): CoopAuthorityEntry;
  /** AUTHORITY: receipt intake; returns whether the entry newly retired. */
  acceptReceipt(receipt: CoopAuthorityReceipt): boolean;
  /** AUTHORITY: retained-but-unretired entries in revision order. */
  retained(): readonly CoopAuthorityEntry[];
  /** REPLICA: classify + admit one delivered entry. */
  admit(entry: CoopAuthorityEntry): CoopAdmitResult;
  /** REPLICA: the applied-through revision frontier. */
  appliedThrough(): number;
  /** BOTH: adopt a proven snapshot high-water (recovery). */
  adoptFrontier(revision: number): void;
  /** BOTH: dispose every timer/lease this log owns. */
  dispose(reason: string): void;
}

export type CoopAdmitResult =
  | { readonly kind: "admitted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "gap"; readonly missingFrom: number }
  | { readonly kind: "staleEpoch" }
  | { readonly kind: "rejected"; readonly reason: string };

// ---------------------------------------------------------------------------
// Canonical next control (frozen decision 4)
// ---------------------------------------------------------------------------

export type CoopNextControl =
  | {
      readonly kind: "COMMAND";
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly ownerSeatId: number;
      readonly pokemonId: number;
    }
  | {
      readonly kind: "REPLACEMENT";
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly occurrence: number;
      readonly fieldIndex: number;
      readonly ownerSeatId: number;
    }
  | { readonly kind: "REWARD"; readonly operationId: string; readonly ownerSeatId: number }
  | { readonly kind: "BIOME"; readonly operationId: string; readonly ownerSeatId: number }
  | { readonly kind: "MYSTERY"; readonly operationId: string; readonly ownerSeatId: number }
  | { readonly kind: "TERMINAL"; readonly terminalId: string }
  | null;

export type CoopControlInstallResult =
  | { readonly kind: "installed"; readonly controlId: string }
  | { readonly kind: "already-installed"; readonly controlId: string }
  | { readonly kind: "deferred"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * Projects a host-stated control state into the local engine (Phaser). It
 * NEVER decides which control is appropriate - the entry already did. A
 * deferred result is re-projected by the log's pacing machinery; it is engine
 * pacing, never a session terminal by itself.
 */
export interface CoopControlProjector {
  project(ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult;
}

// ---------------------------------------------------------------------------
// Recovery (frozen decision 5)
// ---------------------------------------------------------------------------

export type CoopRecoveryPhase =
  | "fence-acquired"
  | "frontier-captured"
  | "requested"
  | "validated"
  | "material-applied"
  | "frontier-installed"
  | "control-installed"
  | "acked"
  | "released"
  | "terminalized";

/**
 * One atomic recovery transaction. The fence is acquired BEFORE the request:
 * command admission, phase/control progression, retained materialization, and
 * authority-wait creation are frozen until release or terminalization.
 */
export interface CoopRecoveryTransaction {
  readonly ctx: CoopRuntimeContext;
  readonly phase: CoopRecoveryPhase;
  readonly capturedFrontier: number;
  run(): Promise<"recovered" | "terminalized">;
  abort(reason: string): void;
}
