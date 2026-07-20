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
//       admitted            - the entry is journaled at the replica (receipt
//                             only; delivery continues until mechanical proof).
//       materialApplied     - canonical state installed; digest matches.
//       controlInstalled    - the stated nextControl exists locally with its
//                             exact owner/address (mechanical, not visual).
//       presentationSettled - optional local rendering completed. NEVER a
//                             retirement requirement for mechanical liveness.
//     RETIREMENT: an entry retires when the required replica has reached
//     admitted + materialApplied + controlInstalled. Every mechanical entry has
//     a successor; AWAIT_SUCCESSOR is the explicit installed ordered-wait state.
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
import type { CoopOperationKind } from "#data/elite-redux/coop/coop-operation-envelope";
import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
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

/** Authenticated remote seat binding frozen into an authority-log instance for this membership generation. */
export interface CoopAuthorityPeerBindingV2 {
  readonly seatId: number;
  readonly connectionGeneration: number;
}

// ADJUDICATION (integration owner, 2026-07-18, Lane 5 change request): `seatMapId` and
// `connectionGeneration` are NOT fields of the immutable per-session CoopRuntimeContext -
// connectionGeneration increments per channel replacement (reconnect) without a new session
// context. The CANONICAL construction is frame-context.ts's two-parameter
// `bindFrameContext(ctx, connection: CoopFrameConnectionBindingV2)`; a hardcoded generation
// would mis-route frames across reconnects.

// ---------------------------------------------------------------------------
// The authoritative log
// ---------------------------------------------------------------------------

export type CoopAuthorityEntryKind =
  | "TURN_COMMIT"
  | "REPLACEMENT_COMMIT"
  | "INTERACTION_COMMIT"
  | "CONTROL_COMMIT"
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
  /** Present exactly at controlInstalled. Every mechanical entry has a stated successor control. */
  readonly controlId?: string;
}

/**
 * The ONE retained authoritative log (frozen decision 2). Engine-free: no
 * Phaser imports in implementations. The authority side commits + retains +
 * redelivers until retirement; the replica side admits in order, detects
 * duplicates/gaps, requests tails, and reports receipts.
 */
export interface CoopAuthorityLog {
  /**
   * AUTHORITY: commit the next entry (assigns the next global revision).
   *
   * A live engine may reserve the exact local successor claim before the entry
   * becomes visible on the wire. Returning `null` rejects the commit without
   * consuming a revision; the returned rollback is used if publication cannot
   * be finalized after reservation.
   */
  commit(
    entry: Omit<CoopAuthorityEntry, "revision">,
    prepare?: (entry: CoopAuthorityEntry) => (() => void) | null,
  ): CoopAuthorityEntry;
  /** AUTHORITY: receipt intake; returns whether the entry newly retired. */
  acceptReceipt(receipt: CoopAuthorityReceipt): boolean;
  /** AUTHORITY: retained-but-unretired entries in revision order. */
  retained(): readonly CoopAuthorityEntry[];
  /** REPLICA: classify + admit one delivered entry. */
  admit(entry: CoopAuthorityEntry): CoopAdmitResult;
  /** REPLICA: record a stage only after the corresponding live engine action succeeded. */
  recordReplicaStage(entry: CoopAuthorityEntry, stage: CoopReplicaMechanicalStage): boolean;
  /** REPLICA: highest validated-and-journaled revision. */
  receivedThrough(): number;
  /** REPLICA: highest revision whose canonical material really applied. */
  appliedThrough(): number;
  /** REPLICA: highest revision mechanically complete through its stated successor control. */
  controlInstalledThrough(): number;
  /** BOTH: adopt a proven snapshot high-water and, when supplied, its exact terminal control address. */
  adoptFrontier(
    revision: number,
    terminal?: { readonly operationId: string; readonly nextControl: CoopNextControl },
  ): void;
  /** BOTH: dispose every timer/lease this log owns. */
  dispose(reason: string): void;
}

export type CoopAdmitResult =
  | { readonly kind: "admitted" }
  | { readonly kind: "duplicate-pending-material" }
  | { readonly kind: "duplicate-pending-control" }
  | { readonly kind: "duplicate-complete" }
  | { readonly kind: "gap"; readonly missingFrom: number }
  | { readonly kind: "staleEpoch" }
  | { readonly kind: "rejected"; readonly reason: string };

/** Replica stages that advance mechanical truth; receipt admission alone never does. */
export type CoopReplicaMechanicalStage = "materialApplied" | "controlInstalled";

// ---------------------------------------------------------------------------
// Canonical next control (frozen decision 4)
// ---------------------------------------------------------------------------

/**
 * One independently-controlled active battler in a command frontier.
 *
 * A frontier is deliberately a set of addressed battlers rather than one
 * host/guest owner tag. Doubles, triples, and future six-seat battles can expose
 * several simultaneous command surfaces, including more than one battler owned
 * by the same seat.
 */
export interface CoopCommandControlTarget {
  readonly ownerSeatId: number;
  readonly pokemonId: number;
  readonly fieldIndex: number;
}

/** Exact human replacement picker authorized by the mechanical log. */
export interface CoopReplacementControlAddress {
  readonly operationId: string;
  readonly ownerSeatId: number;
  readonly epoch: number;
  readonly wave: number;
  readonly turn: number;
  /** Authority-issued per-turn faint-event sequence. */
  readonly occurrence: number;
  /** Field slot within the fainted side (player or Showdown remote-human side). */
  readonly fieldIndex: number;
}

export type CoopNextControl =
  | {
      readonly kind: "COMMAND_FRONTIER";
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      /** Every living player battler that must reach its real CommandPhase. */
      readonly commands: readonly CoopCommandControlTarget[];
    }
  | ({ readonly kind: "REPLACEMENT" } & CoopReplacementControlAddress)
  | { readonly kind: "REWARD"; readonly operationId: string; readonly ownerSeatId: number }
  | { readonly kind: "BIOME"; readonly operationId: string; readonly ownerSeatId: number }
  | { readonly kind: "MYSTERY"; readonly operationId: string; readonly ownerSeatId: number }
  | {
      /**
       * Exact shared-input surface authorized after immutable interaction material applies. The operation
       * class selects a closed projector registration; operationId and owner make the address exact.
       */
      readonly kind: "SHARED_INTERACTION";
      readonly operationId: string;
      readonly ownerSeatId: number;
      /** Exact mechanical coordinate of the public surface. */
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly surfaceClass: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">;
      /** Exact UI/projection subtype; a broad surface class is never sufficient control proof. */
      readonly operationKind: Exclude<CoopOperationKind, "FAINT_SWITCH" | "WAVE_ADVANCE">;
      /**
       * Closed mechanical-result constraint authored with this control. This is deliberately independent
       * from `operationKind`: the phase proving a Mystery catch-full picker is CATCH_FULL, while the next
       * mechanical result is an ME presentation/terminal after its non-authoritative choice proposal.
       */
      readonly successor: {
        readonly operationKinds: readonly Exclude<CoopOperationKind, "FAINT_SWITCH" | "WAVE_ADVANCE">[];
        /**
         * Exact permitted operation addresses when they are predictable at presentation construction.
         * Null is an explicit address wildcard over the closed `operationKinds`, never a local successor.
         */
        readonly operationIds: readonly string[] | null;
      };
    }
  | {
      /**
       * No UI is authorized by this entry. The replica is parked at this exact source address until the
       * immediately-following ordered entry has one of the stated kinds. This is an explicit sequencing
       * contract, never a nullable/locally-derived tail and never an executable input surface.
       */
      readonly kind: "AWAIT_SUCCESSOR";
      readonly afterOperationId: string;
      readonly epoch: number;
      readonly wave: number;
      readonly turn: number;
      readonly allowedKinds: readonly CoopAuthorityEntryKind[];
      /**
       * Whether one of the stated kinds may be addressed at exactly wave N+1, turn 1. False keeps the wait
       * within its source wave. This is explicit because reward/market terminals cross the wave boundary,
       * while turn/replacement and mid-interaction waits must not.
       */
      readonly allowNextWaveStart: boolean;
      /** Exact next operation when predictable (for example a chained faint); null is an explicit wildcard. */
      readonly expectedOperationId: string | null;
    }
  | { readonly kind: "TERMINAL"; readonly terminalId: string };

/**
 * Recovery alone may describe the empty revision-zero frontier, which has no predecessor entry and therefore
 * no successor control. A committed mechanical entry must always use {@linkcode CoopNextControl}.
 */
export type CoopRecoveryNextControl = CoopNextControl | null;

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
