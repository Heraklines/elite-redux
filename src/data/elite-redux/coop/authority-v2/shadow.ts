/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - WIRING (SHADOW MODE). The integration harness that runs the
// completed v2 foundation + adapters ALONGSIDE the live legacy netcode, computing
// the authoritative progression INDEPENDENTLY and comparing it to what legacy
// committed - WITHOUT authorizing any progression itself.
//
// SHADOW-MODE INVARIANTS (the ship-safety contract):
//   - Legacy controls ALL mechanics. v2 never installs a control surface into the
//     real engine, never advances a wave, never seals a terminal: the shadow
//     control PROJECTOR records into an in-memory ledger only (never the scene's
//     phase manager), and the shadow material APPLIER records into an in-memory
//     shadow state only (never engine state).
//   - v2 CANNOT authorize progression. A parity mismatch is LOGGED, never acted on.
//   - EVERY tap is wrapped in try/catch: a shadow fault logs "[coop:v2-shadow] FAULT"
//     and NEVER throws back into game code. The redelivery + receipt egress paths
//     are guarded the same way, so a scheduler tick or a receipt emit can never
//     unwind into the engine either.
//
// WHAT A TAP DOES (the full protocol exercise per legacy commit point):
//   1. build the v2 entry via the matching adapter builder (the authority side),
//   2. commit it to the shadow AuthorityLog - which DELIVERS it over the real v2
//      frame channel, so the REPLICA side admits it, applies it against its shadow
//      state, projects its stated control into the ledger, and signs receipts back;
//      the authority side accepts those receipts and retires the entry (zero orphan
//      timers) - a genuine end-to-end run of the ONE authoritative log,
//   3. compute shadow parity via the adapter's shadow seam vs the legacy digest and
//      log ONE line: "[coop:v2-shadow] PARITY kind=... rev=... match=... field=...".
//
// This file is the wiring lane's harness, not a foundation module: it bridges the
// engine-free foundation to the live transport/scene. It still holds NO module-
// global mutable state on the HARNESS itself (all state is per-instance), reads NO
// ambient runtime (every capability is injected), and imports NOTHING from the
// legacy co-op netcode - the runtime injects the transport send seam and the scene.
// The one module-level value here is the transport inbound ROUTING seam (a single
// registered handler), which lives at the legacy boundary, not inside the harness.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import {
  buildCommandOpenEntry,
  type CoopCommandOpenMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import {
  buildReplacementCommitEntry,
  type ReplacementAuthorityCarrier,
  type ReplacementProposal,
  type ReplacementResolutionMode,
  type ReplacementSuccessor,
  replacementImageDigest,
  shadowParityOfEntry,
  toReplacementCommitImage,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
// The three interaction adapters each export `shadowOfInteractionEntry` (different return shapes); alias
// them so a committed INTERACTION_COMMIT is fingerprinted through whichever adapter recognizes it. The
// per-surface builders are imported directly so the relay-primitive interaction tap routes each pick to
// its MATCHING adapter builder (deliverable 3) instead of forcing a generic reward entry.
import {
  buildAbilityPickInteractionEntry,
  buildColosseumBoardInteractionEntry,
  buildLearnMoveBatchInteractionEntry,
  buildLearnMoveInteractionEntry,
  buildStormglassInteractionEntry,
  shadowOfInteractionEntry as learnShadowOfEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import {
  buildCatchFullDecisionEntry,
  buildMysteryOptionPickEntry,
  buildMysteryTerminalEntry,
  type CoopInteractionAddress,
  shadowOfInteractionEntry as mysteryShadowOfEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-mystery";
import {
  buildBiomeInteractionEntry,
  buildMarketInteractionEntry,
  buildRewardInteractionEntry,
  type CoopBiomeSelectionV2,
  type CoopMarketActionV2,
  type CoopRewardChoiceV2,
  shadowOfInteractionEntry as rewardShadowOfEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import {
  buildTurnCommitEntry,
  computeShadowParity,
  computeTurnCommitDigest,
  type MutationBarrier,
  type TurnCommandFrontier,
  type TurnResolutionImage,
} from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import {
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopTerminalMaterialV2,
  type CoopWaveAdvanceDestination,
  type CoopWaveTransitionMaterialV2,
  digestOfMaterial,
  shadowOfWaveTerminalEntry,
  terminalSubsumes,
  waveBoundarySubsumes,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopAuthorityPeerBindingV2,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopReplicaMechanicalStage,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { COOP_FRAME_PROTOCOL_VERSION, type CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  assertFrameContextV2,
  bindFrameContext,
  type CoopFrameConnectionBindingV2,
} from "#data/elite-redux/coop/authority-v2/frame-context";
import { CoopLifecycle } from "#data/elite-redux/coop/authority-v2/lifecycle";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import {
  type CoopV2InteractionProposalLease,
  type CoopV2ProposalLeaseArmResult,
  CoopV2ProposalLeaseManager,
} from "#data/elite-redux/coop/authority-v2/proposal-lease";
import {
  type CoopInboundFrameResultV2,
  validateInboundFrame,
} from "#data/elite-redux/coop/authority-v2/protocol-validator";
import type { CoopRecoveryBundle } from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import {
  CoopRecoveryChannelV2,
  type CoopRecoveryChannelV2Diagnostics,
  type CoopRecoveryFencePredicatesV2,
} from "#data/elite-redux/coop/authority-v2/recovery-channel";
import {
  type ApplyMaterialFn,
  type ApplyMaterialResult,
  applyEntry,
  type ReplicaApplyDeps,
  type ReplicaApplyOutcome,
  type ReplicaApplyResume,
} from "#data/elite-redux/coop/authority-v2/replica";
import {
  type CoopRuntimeContextHandle,
  createCoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/runtime-context";
import { type CoopSchedulerImpl, createCoopScheduler } from "#data/elite-redux/coop/authority-v2/scheduler";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

// ---------------------------------------------------------------------------
// Build-feature gate. The shadow harness is fully wired but ADVERTISED only when
// this flag is on. It now defaults ON - the MILESTONE-1 shadow-evidence enabler:
// the wiring is complete (the three remaining taps are live) and the duo-harness
// blocker is closed (inbound routing is per-runtime via the transport's own
// onV2Frame seam, so two harnesses in ONE process no longer collide on a single
// module-level handler). Default ON only ADVERTISES the capability; it still takes
// BOTH peers negotiating `authority.v2shadow` to activate a live shadow run, and a
// single-engine / solo session never negotiates it - so those paths are untouched.
// Set env COOP_AUTHORITY_V2_SHADOW=off to force the advertisement off (the old
// provably byte-identical rollback).
//
// SHIP-SAFETY (unchanged by the flip): even when advertised + negotiated, the
// shadow NEVER touches engine state, every tap + egress path is try/caught, and a
// parity mismatch or protocol violation is LOG-ONLY. Legacy still controls ALL
// mechanics; the shadow only computes + compares alongside it.
// ---------------------------------------------------------------------------
const COOP_V2_SHADOW_ENABLED = typeof process === "undefined" || process.env?.COOP_AUTHORITY_V2_SHADOW !== "off";

/** Whether this build ADVERTISES the authority-v2 shadow capability (default ON; force off with env COOP_AUTHORITY_V2_SHADOW=off). */
export function isCoopV2ShadowEnabled(): boolean {
  return COOP_V2_SHADOW_ENABLED;
}

// ---------------------------------------------------------------------------
// Immutable per-session identity the harness binds its frame context from. The
// runtime resolves this from the session controller/binding; the node-pure test
// supplies it directly. Every field mirrors CoopFrameContextV2's requirements
// (non-empty identity strings + non-negative safe-integer coordinates).
// ---------------------------------------------------------------------------

export interface CoopV2ShadowIdentity {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly localSeatId: number;
  readonly authoritySeatId: number;
  readonly membershipRevision: number;
  readonly seatMapId: string;
  readonly connectionGeneration: number;
  /** Exact remote seat/channel generations for this membership snapshot. */
  readonly peerBindings: readonly CoopAuthorityPeerBindingV2[];
}

/** Read-only head of the authority's one global mechanical log. */
export interface CoopV2AuthorityFrontier {
  readonly revision: number;
  readonly operationId: string;
  readonly nextControl: CoopNextControl;
}

/**
 * The LIVE replica seams (cutover surface 1). When injected, the harness's replica pipeline routes a
 * CUTOVER-kind delivered entry through these REAL engine verbs instead of its in-memory shadow ones. The
 * ownership predicates make the boundary explicit: `null` falls through only for an unowned kind; an owned
 * kind may never obtain a mechanical receipt from shadow bookkeeping. Absent => the
 * harness is pure shadow (byte-identical to the pre-cutover build). Defined here (where the harness
 * consumes it) so the engine-free cutover switchboard imports it from the harness without a cycle.
 */
export interface CoopV2LiveReplicaSeams {
  /**
   * Whether this live cutover owns the entry kind. Once owned, `null` from
   * applyMaterial is an invalid seam result, never permission to
   * let the shadow ledger manufacture materialApplied.
   */
  ownsEntry(entry: CoopAuthorityEntry): boolean;
  /**
   * Whether this live cutover owns the successor control kind. Once owned,
   * `null` from projectControl must not sign a shadow controlInstalled receipt.
   */
  ownsControl(control: NonNullable<CoopNextControl>): boolean;
  /**
   * Reserve the authority-local ledger claim before an owned entry is visible on the wire. `null` refuses
   * the commit without consuming a revision. The returned closure restores the exact prior ledger if the
   * log cannot finalize publication.
   */
  prepareAuthorityEntry?(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): (() => void) | null;
  /** Retry/prove the authority's real successor after the immutable entry has been published. */
  authorityEntryCommitted?(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): void;
  /**
   * Notify the runtime-owned control ledger after the ordered log newly admits an entry and before its
   * materializer runs. This consumes the exact prior UI/wait lease; false is an authority invariant fault.
   */
  admitEntry?(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean;
  /**
   * Release an exact local interaction surface that prevents the currently-admitted predecessor from
   * reaching materialApplied. This is invoked only for an authenticated later entry that the ordered log
   * classified as a gap. It may close that entry's address-exact modal terminal, but MUST NOT install the
   * later entry's canonical state, project its successor, advance a ledger cursor, or emit a receipt.
   *
   * Replacement is the motivating causal chain: TURN_COMMIT revision N presents a faint picker; the
   * REPLACEMENT_COMMIT at N+1 is the committed answer that closes it. Refusing to inspect N+1 until N
   * materializes creates a cycle. This seam breaks only the modal edge while preserving strict state order.
   * `null` means the live cutover does not own this entry kind.
   */
  releaseBlockedPredecessor?(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean | null;
  /**
   * Install material into REAL engine state. `"deferred"` is healthy engine pacing, `false` is structural
   * rejection, and `null` is permitted only when {@link ownsEntry} is false.
   */
  applyMaterial(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): ApplyMaterialResult | null;
  /** Project control onto the REAL phase manager, or `null` only when {@link ownsControl} is false. */
  projectControl(ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult | null;
}

/**
 * Complete live recovery verbs. These are separate from entry cutover seams so
 * a recovery can never fall through to shadow bookkeeping and manufacture
 * mechanical proof for an engine state it did not install.
 */
export interface CoopV2LiveRecoverySeams {
  /** Authority: return null until the engine is at a complete capture boundary. */
  captureMaterial(ctx: CoopRuntimeContext): CoopAuthoritativeMaterial | null;
  /** Replica: transactionally apply + checksum-verify the complete material image. */
  applyMaterial(ctx: CoopRuntimeContext, material: CoopAuthoritativeMaterial): boolean | Promise<boolean>;
  /** Adopt the validated recovery frontier into the ordinary runtime control ledger. */
  prepareControl(ctx: CoopRuntimeContext, bundle: CoopRecoveryBundle): boolean;
  /** Replica: prove the host-stated successor on the real engine, never in the shadow ledger. */
  projectControl(ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult;
  /** Enter the retained shared terminal synchronously on any recovery invariant failure. */
  onTerminal(reason: string): void;
  /** Release the parked engine boundary only after the recovery fence is open. */
  onRecovered(): void;
}

/** Everything the harness needs beyond its own foundation objects, all injected. */
export interface CoopV2ShadowDeps {
  readonly identity: CoopV2ShadowIdentity;
  /** Forwarded verbatim into the v2 runtime context (never touched in shadow mode). */
  readonly scene: BattleScene;
  /** Forwarded verbatim into the v2 runtime context (never touched in shadow mode). */
  readonly transport: CoopTransport;
  /** Outbound v2 frame egress - the runtime backs this by the real transport; the test loops it to a peer. */
  readonly send: (frame: CoopFrameV2) => void;
  /** Optional injected scheduler (a deterministic fake for tests); default a real scheduler the harness owns. */
  readonly scheduler?: CoopSchedulerImpl;
  /**
   * Optional LIVE replica seams (cutover surface 1). When present, a delivered CUTOVER-kind entry is applied
   * against REAL engine state + the real phase manager instead of the in-memory shadow ledger. Absent =>
   * pure shadow. An owned entry/control cannot silently fall through when its live verb returns null.
   */
  readonly liveReplica?: CoopV2LiveReplicaSeams;
  /** Optional complete live recovery seam. Absent means recovery frames are unsupported and never shadow-applied. */
  readonly liveRecovery?: CoopV2LiveRecoverySeams;
  /**
   * Authoritative-cutover protocol violations must enter the runtime's retained shared terminal. Omitted
   * by pure-shadow/node harnesses, where violations remain evidence-only and cannot affect legacy mechanics.
   */
  readonly onProtocolViolation?: (violation: Extract<CoopInboundFrameResultV2, { kind: "protocol-violation" }>) => void;
}

// ---------------------------------------------------------------------------
// Tap inputs (one per legacy commit point). Each carries the matching adapter
// builder's inputs plus the LEGACY digest to compare against. No frame context:
// the harness stamps its own authenticated context on every entry.
// ---------------------------------------------------------------------------

/** Where the turn tap's successor came from (deliverable 2 - never a silent degrade). */
export type CoopV2ShadowSuccessorSeatSource = "owner-field" | "local-role-fallback" | "none-non-command-boundary";

export interface CoopV2ShadowTurnTap {
  readonly operationId: string;
  readonly capture: TurnResolutionImage;
  readonly nextCommandFrontier: TurnCommandFrontier | null;
  readonly nextReplacementControl?: Extract<CoopNextControl, { kind: "REPLACEMENT" }> | null;
  /** The raw legacy comparand token (the host full-state checksum) - a DIFFERENT scheme, kept for the log. */
  readonly legacyDigest: string;
  /**
   * The LEGACY turn image (the resolution + checkpoint legacy committed). When present the shadow fingerprints
   * it through the SAME turn digest as the v2 entry, so parity compares like-for-like (v2 entry digest vs
   * v2-digest-of-legacy-image) and a divergence means the STATES differ, not the encodings (deliverable 1).
   */
  readonly legacyImage?: TurnResolutionImage;
  /** Whether the stated next-command owner seat is the REAL field-seat owner or a best-effort fallback. */
  readonly successorSeatSource?: CoopV2ShadowSuccessorSeatSource;
  readonly subsumes?: readonly number[];
  /** Outstanding mutation-barrier tokens at the legacy commit (should be 0 - we tap AFTER legacy settles). */
  readonly pendingTokens?: number;
}

export interface CoopV2ShadowReplacementTap {
  readonly proposal: ReplacementProposal;
  readonly resolution: ReplacementResolutionMode;
  readonly successor: ReplacementSuccessor;
  /** Complete post-summon authority image. Required by live cutover, omitted by shadow-only taps. */
  readonly authorityCarrier?: ReplacementAuthorityCarrier;
  /** The raw legacy comparand token (the legacy op id) - a DIFFERENT scheme, kept for the log. */
  readonly legacyDigest: string;
  /**
   * The LEGACY replacement image (the proposal + resolution the legacy carrier committed). When present the
   * shadow fingerprints it through the faint adapter's OWN image digest, so parity compares like-for-like
   * (v2 entry digest vs v2-digest-of-legacy-image) - a divergence means the resolved STATES differ, not the
   * encodings (deliverable 1).
   */
  readonly legacyImage?: {
    readonly proposal: ReplacementProposal;
    readonly resolution: ReplacementResolutionMode;
    readonly authorityCarrier?: ReplacementAuthorityCarrier;
  };
  readonly operationId?: string;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowWaveTap {
  readonly operationId: string;
  readonly transition: CoopWaveTransitionMaterialV2;
  readonly destination: CoopWaveAdvanceDestination;
  readonly legacyDigest: string;
  /** The LEGACY wave-transition image; when present it is fingerprinted through the wave adapter's digest. */
  readonly legacyImage?: CoopWaveTransitionMaterialV2;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowTerminalTap {
  readonly operationId: string;
  readonly terminal: CoopTerminalMaterialV2;
  readonly legacyDigest: string;
  /** The LEGACY terminal image; when present it is fingerprinted through the terminal adapter's digest. */
  readonly legacyImage?: CoopTerminalMaterialV2;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowInteractionTap {
  /** The entry the runtime built via the matching interaction adapter builder (reward/mystery/learn). */
  readonly entry: Omit<CoopAuthorityEntry, "revision">;
  readonly legacyDigest: string;
  /**
   * The LEGACY interaction entry (built via the matching adapter). When present the shadow fingerprints it
   * through the SAME interaction shadow seam, so parity compares like-for-like (deliverable 1).
   */
  readonly legacyImage?: Omit<CoopAuthorityEntry, "revision"> | CoopAuthorityEntry;
}

/**
 * Interaction tap from the relay owner-commit, expressed as PRIMITIVES (the relay has no adapter-shaped
 * entry, epoch, wave, or context). The harness builds the reward INTERACTION_COMMIT from these + its own
 * authenticated context. `wave` defaults to the last wave a turn/replacement/wave tap observed; `ownerSeatId`
 * is the sender's seat (0 host / 1 guest, matching the legacy stream convention).
 */
export interface CoopV2ShadowInteractionChoiceTap {
  readonly seq: number;
  readonly kind: string;
  readonly choice: number;
  readonly data?: readonly number[];
  readonly ownerSeatId: number;
  readonly wave?: number;
  /** Optional legacy comparand; absent -> a stable relay-derived token (parity logs match=false). */
  readonly legacyDigest?: string;
}

/** Live counters for the taps + the protocol round-trip (asserted directly in the node-pure test). */
export interface CoopV2ShadowDiagnostics {
  readonly committed: number;
  readonly admitted: number;
  readonly applied: number;
  readonly receiptsSent: number;
  readonly parityChecks: number;
  readonly parityMatches: number;
  readonly faults: number;
  readonly retained: number;
  readonly pendingTimers: number;
  readonly controlLedgerSize: number;
  readonly shadowStateSize: number;
  readonly disposed: boolean;
  readonly recovery: CoopRecoveryChannelV2Diagnostics | null;
}

// ---------------------------------------------------------------------------
// The installed-control ledger (deliverable 5). Backed by the log's
// controlInstalled receipts: the shadow projector records a controlId here the
// moment the replica pipeline would sign controlInstalled for it. In shadow mode
// it ONLY records - the cutover wires this to the real projected-control set.
// ---------------------------------------------------------------------------

export class CoopShadowControlLedger {
  private readonly installed = new Set<string>();

  /** Record that the stated control `controlId` has been (shadow-)installed. */
  record(controlId: string): void {
    this.installed.add(controlId);
  }

  /** Whether `controlId` is already recorded (idempotency for a redelivered entry). */
  has(controlId: string): boolean {
    return this.installed.has(controlId);
  }

  get size(): number {
    return this.installed.size;
  }

  list(): string[] {
    return [...this.installed];
  }

  clear(): void {
    this.installed.clear();
  }
}

/**
 * The shadow control projector. It NEVER touches the scene's phase manager (that
 * is legacy's job in shadow mode) - it validates the stated control and records
 * its controlId into the installed-control ledger, so controlInstalled is signed
 * against the ledger, not the engine. Decision-free (like the real projector): it
 * projects the stated control, it does not choose one.
 */
class CoopShadowControlProjector implements CoopControlProjector {
  private readonly ledger: CoopShadowControlLedger;
  /** Optional live projector consulted FIRST (cutover); a `null` return falls through to the shadow ledger. */
  private readonly live: CoopV2LiveReplicaSeams | null;

  constructor(ledger: CoopShadowControlLedger, live: CoopV2LiveReplicaSeams | null) {
    this.ledger = ledger;
    this.live = live;
  }

  project(ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult {
    // Cutover: a live projector installs the stated control on the REAL phase manager. A `null` result falls
    // through only when the seam explicitly says it does not own this control kind.
    const liveResult = this.live?.projectControl(ctx, control) ?? null;
    if (liveResult != null) {
      // Mirror the installed controlId into the ledger too, so a redelivered entry is idempotent and the
      // shadow diagnostics still count it - the live install is authoritative, the ledger is bookkeeping.
      if (liveResult.kind === "installed" || liveResult.kind === "already-installed") {
        this.ledger.record(liveResult.controlId);
      }
      return liveResult;
    }
    if (this.live?.ownsControl(control) === true) {
      return {
        kind: "rejected",
        reason: `live cutover owned ${control.kind} but did not return a control-install verdict`,
      };
    }
    const projectable = control as ProjectableControl;
    const validation = validateNextControl(projectable);
    if (!validation.ok) {
      return { kind: "rejected", reason: validation.reason };
    }
    const controlId = controlIdOf(projectable);
    if (this.ledger.has(controlId)) {
      return { kind: "already-installed", controlId };
    }
    this.ledger.record(controlId);
    return { kind: "installed", controlId };
  }
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/** One shadow-state record: what the replica pipeline admitted + applied for a revision. */
interface ShadowStateRecord {
  readonly revision: number;
  readonly operationId: string;
  readonly kind: CoopAuthorityEntry["kind"];
  readonly digest: string;
}

interface AuthorityPeerStageWaiter {
  readonly operationId: string;
  readonly stage: CoopReplicaMechanicalStage;
  readonly resolve: (reached: boolean) => void;
  cancelTimeout: () => void;
}

export class CoopAuthorityV2Shadow {
  private readonly ctxHandle: CoopRuntimeContextHandle;
  private readonly ctx: CoopRuntimeContext;
  private runtimeContext: CoopRuntimeContext;
  private frameContext: CoopFrameContextV2;
  private peerBindings: readonly CoopAuthorityPeerBindingV2[];
  private readonly scheduler: CoopSchedulerImpl;
  private readonly ownsScheduler: boolean;
  private readonly log: AuthorityLog;
  private readonly lifecycle: CoopLifecycle;
  private readonly ledger = new CoopShadowControlLedger();
  private readonly projector: CoopControlProjector;
  private readonly recoveryChannel: CoopRecoveryChannelV2 | null;
  private readonly replicaDeps: ReplicaApplyDeps;
  private readonly sendFrame: (frame: CoopFrameV2) => void;
  /** Live replica seams (cutover surface 1); null in pure shadow mode. Consulted FIRST by the applier/projector. */
  private readonly liveReplica: CoopV2LiveReplicaSeams | null;
  private readonly onProtocolViolation:
    | ((violation: Extract<CoopInboundFrameResultV2, { kind: "protocol-violation" }>) => void)
    | undefined;
  private readonly shadowState = new Map<number, ShadowStateRecord>();
  /**
   * Replica entries that are admitted but still waiting on their real material/control boundary.
   *
   * Authority redelivery remains the durable retry owner. This bounded local reference only lets an engine
   * chokepoint (for example, the exact frame a reward UI becomes actionable) retry immediately instead of
   * racing a fast user against the next 250ms delivery lease. The ordered ledger permits at most one
   * mechanically incomplete revision, so this cannot become a second journal.
   */
  private readonly pendingReplicaEntries = new Map<number, CoopAuthorityEntry>();
  /** V2-native phase barriers resolved exclusively from authenticated authority-log receipt quorum. */
  private readonly authorityPeerStageWaiters = new Set<AuthorityPeerStageWaiter>();
  /** Guest proposals retained until their exact ordered V2 result is admitted. Never progression authority. */
  private readonly proposalLeases: CoopV2ProposalLeaseManager;
  private nextAuthorityPeerStageWaiterId = 1;

  private disposed = false;
  private committed = 0;
  private admitted = 0;
  private applied = 0;
  private receiptsSent = 0;
  private parityChecks = 0;
  private parityMatches = 0;
  private faults = 0;
  /** The most recent wave a turn/replacement/wave/terminal tap observed; the interaction-choice tap (which
   *  has no wave of its own at the relay seam) addresses its shadow reward window against it. */
  private lastObservedWave = 0;
  /** The most recent turn a turn/replacement/wave tap observed; the interaction-choice tap addresses a
   *  mystery interaction (which needs a positive turn coordinate) against it. Defaults to 1 (a valid turn). */
  private lastObservedTurn = 1;
  /** Unsubscribe for the per-instance transport inbound seam (see the constructor); called on dispose. */
  private transportV2Unsub: (() => void) | null = null;

  constructor(deps: CoopV2ShadowDeps) {
    const id = deps.identity;
    this.sendFrame = deps.send;
    this.scheduler = deps.scheduler ?? createCoopScheduler();
    this.ownsScheduler = deps.scheduler == null;
    this.proposalLeases = new CoopV2ProposalLeaseManager(this.scheduler);

    this.ctxHandle = createCoopRuntimeContext({
      runtimeId: id.runtimeId,
      sessionId: id.sessionId,
      runId: id.runId,
      epoch: id.epoch,
      localSeatId: id.localSeatId,
      authoritySeatId: id.authoritySeatId,
      membershipRevision: id.membershipRevision,
      scene: deps.scene,
      transport: deps.transport,
      scheduler: this.scheduler,
    });
    this.ctx = this.ctxHandle.context;
    this.runtimeContext = this.ctx;
    this.peerBindings = id.peerBindings;

    const connection: CoopFrameConnectionBindingV2 = {
      seatMapId: id.seatMapId,
      connectionGeneration: id.connectionGeneration,
    };
    // Throws CoopFrameContextError on a malformed identity - the caller (runtime) catches it, so a bad
    // identity simply means no shadow harness for this session (fail closed, never a game-code throw).
    this.frameContext = bindFrameContext(this.ctx, connection);

    this.lifecycle = new CoopLifecycle(this.ctx, reason => this.ctxHandle.dispose(reason));
    this.log = new AuthorityLog({
      localContext: this.frameContext,
      scheduler: this.scheduler,
      send: wire => this.emitWire(wire),
      peerBindings: id.peerBindings,
      ownerId: `authority-v2-shadow:${id.sessionId}:seat${id.localSeatId}`,
    });

    this.liveReplica = deps.liveReplica ?? null;
    this.onProtocolViolation = deps.onProtocolViolation;
    this.projector = new CoopShadowControlProjector(this.ledger, this.liveReplica);
    const liveRecovery = deps.liveRecovery;
    this.recoveryChannel =
      liveRecovery == null
        ? null
        : new CoopRecoveryChannelV2({
            frame: () => this.frameContext,
            peerBindings: () => this.peerBindings,
            context: () => this.runtimeContext,
            log: this.log,
            projector: { project: (ctx, control) => liveRecovery.projectControl(ctx, control) },
            send: frame => this.sendFrame(frame),
            captureMaterial: ctx => liveRecovery.captureMaterial(ctx),
            applyMaterial: (ctx, material) => liveRecovery.applyMaterial(ctx, material),
            prepareControl: (ctx, bundle) => liveRecovery.prepareControl(ctx, bundle),
            onTerminal: reason => liveRecovery.onTerminal(reason),
            onRecovered: () => liveRecovery.onRecovered(),
          });
    const harness = this;
    this.replicaDeps = {
      applyMaterial: (ctx, entry) => this.applyMaterialRouted(ctx, entry),
      projector: this.projector,
      receipts: { emit: receipt => this.sendReceipt(receipt) },
      get receiptContext() {
        return harness.frameContext;
      },
      recordStage: (entry, stage) => this.log.recordReplicaStage(entry, stage),
    };

    // Per-runtime inbound routing: register THIS harness's inbound handler on its OWN transport endpoint.
    // Concrete loopback/WebRTC endpoints never borrow the module-level compatibility handler: an endpoint
    // without a receiver rejects V2 delivery, preventing one runtime from consuming another's frame. A bare
    // legacy test stub may omit the optional seam and explicitly install the module-level handler instead.
    // Both paths use the SAME boundary validator (never a cast).
    this.transportV2Unsub =
      deps.transport.onV2Frame?.(raw =>
        routeCoopV2InboundFrameTo(raw, frame => this.handleInboundFrame(frame), deps.onProtocolViolation),
      ) ?? null;
  }

  // -------------------------------------------------------------------------
  // AUTHORITY side - the taps. Each is fully guarded: a shadow fault is logged
  // and swallowed, never thrown into game code.
  // -------------------------------------------------------------------------

  /** Tap the host's turn-commit emit. Builds a TURN_COMMIT via the turn adapter + records parity. */
  tapTurnCommit(input: CoopV2ShadowTurnTap): CoopAuthorityEntry | null {
    const observedWave = input.nextCommandFrontier?.wave ?? input.capture.wave;
    const observedTurn = input.nextCommandFrontier?.resolvedTurn ?? input.capture.turn;
    if (typeof observedWave === "number" && Number.isSafeInteger(observedWave) && observedWave >= 1) {
      this.lastObservedWave = observedWave;
    }
    if (typeof observedTurn === "number" && Number.isSafeInteger(observedTurn) && observedTurn >= 1) {
      this.lastObservedTurn = observedTurn;
    }
    return this.runTap("TURN_COMMIT", () => {
      const barrier: MutationBarrier = { pendingTokens: () => input.pendingTokens ?? 0 };
      const built = buildTurnCommitEntry({
        context: this.frameContext,
        operationId: input.operationId,
        capture: input.capture,
        nextCommandFrontier: input.nextCommandFrontier,
        ...(input.nextReplacementControl === undefined ? {} : { nextReplacementControl: input.nextReplacementControl }),
        barrier,
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      if (built.kind === "barred") {
        coopLog("v2-shadow", `turn-commit BARRED pendingTokens=${built.pendingTokens} op=${input.operationId}`);
        return null;
      }
      const entry = this.commit(built.entry);
      // Deliverable 1: when the caller supplies the legacy turn IMAGE, fingerprint it through the SAME turn
      // digest so parity compares like-for-like (v2 entry digest vs v2-digest-of-legacy-image). Otherwise the
      // raw legacy token (the host full-state checksum) is a different scheme and structurally diverges.
      const comparand = input.legacyImage == null ? input.legacyDigest : computeTurnCommitDigest(input.legacyImage);
      const parity = computeShadowParity(comparand, entry);
      // Deliverable 2: name whether the stated next-command successor seat was the REAL field-seat owner or a
      // best-effort local-role fallback, so a degraded successor is recorded, never silently accepted.
      const note = input.successorSeatSource == null ? undefined : `successor=${input.successorSeatSource}`;
      this.logParity("TURN_COMMIT", entry.revision, parity.digestsMatch, "materialDigest", note);
      return entry;
    });
  }

  /**
   * Commit the explicit boundary that opens command authority after an ordered
   * wave/interaction wait. The complete state is captured at the real
   * post-entry-effects CommandPhase chokepoint, not derived from the old wave.
   */
  tapCommandOpen(input: {
    readonly operationId: string;
    readonly material: CoopCommandOpenMaterialV2;
    readonly command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>;
    readonly subsumes?: readonly number[];
  }): CoopAuthorityEntry | null {
    this.lastObservedWave = input.material.wave;
    this.lastObservedTurn = input.material.turn;
    return this.runTap("CONTROL_COMMIT", () => {
      const entry = this.commit(
        buildCommandOpenEntry({
          context: this.frameContext,
          operationId: input.operationId,
          material: input.material,
          command: input.command,
          ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
        }),
      );
      this.logParity("CONTROL_COMMIT", entry.revision, true, "materialDigest");
      return entry;
    });
  }

  /** Tap the faint-switch authority commit. Builds a REPLACEMENT_COMMIT via the faint adapter + records parity. */
  tapReplacementCommit(input: CoopV2ShadowReplacementTap): CoopAuthorityEntry | null {
    this.lastObservedWave = input.proposal.sourceAddress.wave;
    if (input.proposal.sourceAddress.turn >= 1) {
      this.lastObservedTurn = input.proposal.sourceAddress.turn;
    }
    return this.runTap("REPLACEMENT_COMMIT", () => {
      const built = buildReplacementCommitEntry({
        context: this.frameContext,
        proposal: input.proposal,
        resolution: input.resolution,
        successor: input.successor,
        ...(input.authorityCarrier == null ? {} : { authorityCarrier: input.authorityCarrier }),
        ...(input.operationId == null ? {} : { operationId: input.operationId }),
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      const entry = this.commit(built);
      const parity = shadowParityOfEntry(entry);
      const v2Digest = parity?.digest ?? entry.material.digest;
      // Deliverable 1: fingerprint the LEGACY replacement image through the faint adapter's OWN image digest
      // so parity compares like-for-like; the raw legacy op id stays only as the fallback token.
      const comparand =
        input.legacyImage == null
          ? input.legacyDigest
          : replacementImageDigest(
              toReplacementCommitImage(
                input.legacyImage.proposal,
                input.legacyImage.resolution,
                input.legacyImage.authorityCarrier,
              ),
            );
      this.logParity("REPLACEMENT_COMMIT", entry.revision, v2Digest === comparand, "digest");
      return entry;
    });
  }

  /** Tap the waveResolved broadcast. Builds a WAVE_ADVANCE via the wave-terminal adapter + records parity. */
  tapWaveAdvance(input: CoopV2ShadowWaveTap): CoopAuthorityEntry | null {
    this.lastObservedWave = input.transition.wave;
    if (input.transition.turn >= 1) {
      this.lastObservedTurn = input.transition.turn;
    }
    return this.runTap("WAVE_ADVANCE", () => {
      const built = buildWaveAdvanceEntry({
        context: this.frameContext,
        operationId: input.operationId,
        transition: input.transition,
        destination: input.destination,
        subsumes: input.subsumes ?? waveBoundarySubsumes(this.log.retained(), input.transition.wave),
      });
      const entry = this.commit(built);
      const shadow = shadowOfWaveTerminalEntry(entry);
      // Deliverable 1: fingerprint the LEGACY transition image through the wave adapter's OWN digest.
      const comparand = input.legacyImage == null ? input.legacyDigest : digestOfMaterial(input.legacyImage);
      this.logParity("WAVE_ADVANCE", entry.revision, shadow.materialDigest === comparand, "materialDigest");
      return entry;
    });
  }

  /** Tap the game-over / terminal path. Builds a TERMINAL_COMMIT via the wave-terminal adapter + records parity. */
  tapTerminal(input: CoopV2ShadowTerminalTap): CoopAuthorityEntry | null {
    return this.runTap("TERMINAL_COMMIT", () => {
      const built = buildTerminalCommitEntry({
        context: this.frameContext,
        operationId: input.operationId,
        terminal: input.terminal,
        subsumes: input.subsumes ?? terminalSubsumes(this.log.retained()),
      });
      const entry = this.commit(built);
      const shadow = shadowOfWaveTerminalEntry(entry);
      // Deliverable 1: fingerprint the LEGACY terminal image through the terminal adapter's OWN digest.
      const comparand = input.legacyImage == null ? input.legacyDigest : digestOfMaterial(input.legacyImage);
      this.logParity("TERMINAL_COMMIT", entry.revision, shadow.materialDigest === comparand, "materialDigest");
      return entry;
    });
  }

  /** Tap the interaction relay owner-commit. Commits the pre-built INTERACTION_COMMIT + records parity. */
  tapInteraction(input: CoopV2ShadowInteractionTap): CoopAuthorityEntry | null {
    return this.runTap("INTERACTION_COMMIT", () => {
      const entry = this.commit(input.entry);
      // The adapter shadow seams live across three interaction adapters (reward/market/biome,
      // mystery/catch/revival, learn/ability/bargain/colosseum/stormglass); consult each in turn so a
      // recognized interaction is fingerprinted through its OWN seam, then compare against legacy.
      const v2Digest = this.interactionShadowDigest(entry) ?? entry.material.digest;
      // Deliverable 1: when the caller supplies the LEGACY interaction entry, fingerprint it through the SAME
      // interaction shadow seam so parity compares like-for-like; otherwise fall back to the raw legacy token.
      const comparand =
        input.legacyImage == null
          ? input.legacyDigest
          : (this.interactionShadowDigest(input.legacyImage) ?? input.legacyImage.material.digest);
      this.logParity("INTERACTION_COMMIT", entry.revision, v2Digest === comparand, "materialDigest");
      return entry;
    });
  }

  /**
   * Tap the interaction relay owner-commit from PRIMITIVES (the relay seam carries no adapter-shaped entry
   * of its own - it has no epoch/wave/context, which live on the harness). Builds a generic REWARD
   * INTERACTION_COMMIT via the reward adapter: the owner's relayed pick becomes a reward "pick" (optionIndex
   * = choice, subPicks = data), addressed against the harness epoch + the last observed wave + the relayed
   * seq as the per-window action ordinal. Records ONE parity check. The relay seam excludes faint-switch /
   * revival kinds (those are the REPLACEMENT tap's domain), so this never double-taps a faint replacement.
   */
  tapInteractionChoice(input: CoopV2ShadowInteractionChoiceTap): CoopAuthorityEntry | null {
    // A live Authority V2 cutover reuses this harness's ONE mechanical log. A lossy relay choice is only
    // shadow telemetry and must never consume a revision beside live TURN/REPLACEMENT/WAVE entries; the
    // complete immutable interaction-envelope path below is the sole INTERACTION_COMMIT authority. Pure
    // shadow sessions retain the historical adapter exercise because their log owns no mechanics.
    if (this.liveReplica != null) {
      coopLog(
        "v2-shadow",
        `TELEMETRY interaction-choice kind=${input.kind} seq=${input.seq} (mechanical commit suppressed)`,
      );
      return null;
    }
    return this.runTap("INTERACTION_COMMIT", () => {
      // Deliverable 3: route the relayed pick to its MATCHING adapter builder by kind, so the committed entry
      // is surface-correct (its material digest is that surface's scheme) instead of a generic reward entry
      // for every between-wave pick. A lossy pick that cannot form valid surface material falls back to the
      // generic reward entry - never a FAULT.
      const { built, surface } = this.routeInteractionChoice(input);
      const entry = this.commit(built);
      const v2Digest = this.interactionShadowDigest(entry) ?? entry.material.digest;
      // No independent legacy digest exists at the relay seam (the legacy carrier is not v2-digested), so the
      // comparand is a stable relay-derived token: parity logs match=false until the legacy carrier is
      // fingerprinted the same way. The evidence this tap yields is the surface-correct entry + the end-to-end
      // round-trip; the parity line records the routed SURFACE + relay KIND so a reviewer can judge routing.
      const legacyDigest = input.legacyDigest ?? `relay:${input.kind}:${input.choice}`;
      this.logParity(
        "INTERACTION_COMMIT",
        entry.revision,
        v2Digest === legacyDigest,
        "materialDigest",
        `surface=${surface} kind=${input.kind}`,
      );
      return entry;
    });
  }

  /**
   * Route one relayed interaction pick (deliverable 3) to the MATCHING adapter builder by its relay kind,
   * using only the relay-carried primitives (seq / kind / choice / data / ownerSeatId) plus the harness's own
   * epoch + last-observed wave/turn. The relay seam is lossy - it carries no move / species identity and its
   * `choice` is often a NEGATIVE sentinel (LEAVE=-1, REROLL=-2, ability-outcome=-3, ME-handoff=-1000) - so a
   * surface whose required identity is genuinely absent is built with a documented placeholder, and a pick
   * that still cannot form valid surface material (or an unknown kind) falls back to the generic reward entry
   * with its kind recorded. Every builder call is guarded, so a lossy pick can never FAULT the tap.
   */
  private routeInteractionChoice(input: CoopV2ShadowInteractionChoiceTap): {
    built: Omit<CoopAuthorityEntry, "revision">;
    surface: string;
  } {
    const context = this.frameContext;
    const epoch = this.frameContext.sessionEpoch;
    const wave = input.wave ?? this.lastObservedWave;
    const turn = this.lastObservedTurn;
    const ownerSeatId = input.ownerSeatId;
    const choice = input.choice;
    const data = input.data == null ? [] : input.data.filter(value => Number.isSafeInteger(value));
    const sentinel = choice < 0;
    const seqOrdinal = input.seq >= 0 ? input.seq : 0;
    // A wire-safe synthetic operationId for the learn/mystery builders that require an explicit identity.
    const relayOpId = `IX/RELAY/${input.kind}/e${epoch}/w${wave}/t${turn}/s${ownerSeatId}/q${input.seq}`;
    const shadowSuccessor = (operationId: string): Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }> => ({
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: operationId,
      epoch,
      wave,
      turn,
      allowedKinds: ["TURN_COMMIT", "REPLACEMENT_COMMIT", "INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
    });

    const generic = (): { built: Omit<CoopAuthorityEntry, "revision">; surface: string } => {
      // The relay seam carries no separate legacy species; `1` is a documented placeholder used only where the
      // surface material requires a positive identity the relay does not supply (parity is match=false here).
      const rewardChoice: CoopRewardChoiceV2 = sentinel
        ? { kind: "leave" }
        : { kind: "pick", optionIndex: choice, subPicks: data };
      return {
        built: buildRewardInteractionEntry({
          context,
          operationId: relayOpId,
          address: { epoch, wave, ownerSeatId, actionOrdinal: input.seq },
          material: { kind: "reward", wave, ownerSeatId, choice: rewardChoice, terminal: true },
          successor: shadowSuccessor(relayOpId),
        }),
        surface: `reward/generic(${input.kind})`,
      };
    };

    try {
      switch (input.kind) {
        // --- interactions-reward: MARKET (the between-wave biome shop). ---
        case "biomeShop": {
          const action: CoopMarketActionV2 = sentinel
            ? { kind: "leave" }
            : {
                kind: "buy",
                slot: choice,
                outcome: { kind: "applied", moneyAfter: data[1] ?? 0, targetPartySlot: data[0] ?? null },
              };
          return {
            built: buildMarketInteractionEntry({
              context,
              operationId: relayOpId,
              address: { epoch, wave, ownerSeatId, actionOrdinal: input.seq },
              material: { kind: "market", wave, ownerSeatId, action, terminal: sentinel },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "market",
          };
        }
        // --- interactions-reward: BIOME pick + crossroads (the between-wave route picks). ---
        case "biomePick": {
          const selection: CoopBiomeSelectionV2 = {
            kind: "biome-pick",
            sourceBiomeId: 0,
            biomeId: data[0] ?? 0,
            nodeIndex: choice >= -1 ? choice : -1,
            nextWave: wave + 1,
          };
          return {
            built: buildBiomeInteractionEntry({
              context,
              operationId: relayOpId,
              address: { epoch, wave, ownerSeatId, selection: "biome-pick" },
              material: { kind: "biome", wave, ownerSeatId, selection },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "biome/biome-pick",
          };
        }
        case "crossroads": {
          if (choice !== 0 && choice !== 1) {
            break; // not a valid Stay/Leave option index -> generic
          }
          const selection: CoopBiomeSelectionV2 = { kind: "crossroads-pick", optionIndex: choice };
          return {
            built: buildBiomeInteractionEntry({
              context,
              operationId: relayOpId,
              address: { epoch, wave, ownerSeatId, selection: "crossroads-pick" },
              material: { kind: "biome", wave, ownerSeatId, selection },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "biome/crossroads",
          };
        }
        // --- interactions-learn: ability / colosseum / stormglass / learn-move (single + batch). ---
        case "abilityPicker":
          return {
            built: buildAbilityPickInteractionEntry({
              context,
              operationId: relayOpId,
              ownerSeatId,
              data,
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "learn/ability-pick",
          };
        case "coloPick": {
          const round = data[0] ?? 0;
          if ((choice !== 0 && choice !== 1) || round < 0 || round > 49) {
            break; // not a valid Colosseum decision -> generic
          }
          return {
            built: buildColosseumBoardInteractionEntry({
              context,
              operationId: relayOpId,
              ownerSeatId,
              board: { type: "decision", pinned: seqOrdinal, round, index: choice },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "learn/colosseum-decision",
          };
        }
        case "stormglass": {
          if (choice < 0 || choice >= 5) {
            break; // out-of-range weather index -> generic
          }
          return {
            built: buildStormglassInteractionEntry({
              context,
              operationId: relayOpId,
              ownerSeatId,
              weatherIndex: choice,
              weather: data[0] ?? 0,
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "learn/stormglass",
          };
        }
        case "learnMove":
          // The relay carries only the forget-slot choice; partySlot / moveId identity are not on the seam, so
          // they are documented placeholders (partySlot 0, a positive moveId) - the entry is surface-correct.
          return {
            built: buildLearnMoveInteractionEntry({
              context,
              operationId: relayOpId,
              ownerSeatId,
              choice: {
                phase: "decision",
                partySlot: 0,
                moveId: data[0] != null && data[0] > 0 ? data[0] : 1,
                forgetSlot: choice,
                maxMoveCount: 4,
              },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "learn/learn-move",
          };
        case "learnMoveBatch":
          return {
            built: buildLearnMoveBatchInteractionEntry({
              context,
              operationId: relayOpId,
              ownerSeatId,
              choice: { phase: "decision", partySlot: 0, assignments: pairwiseSafe(data), fallback: sentinel },
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "learn/learn-move-batch",
          };
        // --- interactions-mystery: ME option pick / terminal + catch-full. ---
        case "me":
        case "meSub":
        case "meBtn": {
          const address: CoopInteractionAddress = { epoch, wave, turn, interactionSeq: seqOrdinal, ownerSeatId };
          if (sentinel) {
            // A LEAVE / handoff sentinel closes the encounter: route to the terminal, not an option pick.
            return {
              built: buildMysteryTerminalEntry({
                context,
                address,
                outcome: "leave",
                operationId: relayOpId,
                successor: shadowSuccessor(relayOpId),
              }),
              surface: "mystery/me-terminal",
            };
          }
          const step = data[0] != null && data[0] >= 0 ? data[0] : 0;
          return {
            built: buildMysteryOptionPickEntry({
              context,
              address,
              optionIndex: choice,
              step,
              operationId: relayOpId,
              successor: shadowSuccessor(relayOpId),
            }).entry,
            surface: "mystery/me-option-pick",
          };
        }
        case "catchFull": {
          const address: CoopInteractionAddress = { epoch, wave, turn, interactionSeq: seqOrdinal, ownerSeatId };
          const keep = choice >= 0 && choice < 6;
          return {
            built: buildCatchFullDecisionEntry({
              context,
              address,
              decision: keep ? "keep" : "release",
              partySlot: keep ? choice : -1,
              // The caught species is not on the relay seam; `1` is a documented placeholder identity.
              speciesId: 1,
              operationId: relayOpId,
              successor: shadowSuccessor(relayOpId),
            }),
            surface: "mystery/catch-full",
          };
        }
        default:
          break;
      }
    } catch {
      // A lossy pick that cannot form valid surface material (a malformed field for the routed adapter) falls
      // back to the generic reward entry - a controlled fallback, never a FAULT. The kind stays recorded.
      return generic();
    }
    return generic();
  }

  // -------------------------------------------------------------------------
  // REPLICA side - inbound v2 frames (delivered entries, receipts, tail requests).
  // -------------------------------------------------------------------------

  /**
   * Handle one validated inbound v2 frame. Fully guarded: any internal fault is
   * logged and swallowed at this callback boundary; validation/protocol failures
   * are classified before this method and the authoritative runtime's injected
   * violation hook enters the retained shared terminal.
   */
  handleInboundFrame(frame: CoopFrameV2): void {
    if (this.disposed) {
      return;
    }
    try {
      switch (frame.t) {
        case "authorityEntry": {
          const entry: CoopAuthorityEntry = { context: frame.ctx, ...frame.body };
          this.applyReplicaEntry(entry);
          break;
        }
        case "authorityReceipt": {
          const receipt: CoopAuthorityReceipt = { context: frame.ctx, ...frame.body };
          const verdict = this.log.acceptReceiptDetailed(receipt);
          const detail =
            verdict.kind === "rejected"
              ? `rejected reason=${verdict.reason}`
              : verdict.kind === "duplicate"
                ? `duplicate highestStage=${verdict.highestStage}`
                : `advanced retired=${verdict.retired} waiting=[${verdict.waitingForSeatIds.join(",")}]`;
          coopLog(
            "v2-authority",
            `receipt rev=${receipt.revision} op=${receipt.operationId} stage=${receipt.stage} `
              + `sender=${receipt.context.senderSeatId} `
              + `generation=${receipt.context.connectionGeneration} ${detail}`,
          );
          if (verdict.kind !== "rejected") {
            this.flushAuthorityPeerStageWaiters();
          }
          break;
        }
        case "tailRequest": {
          this.redeliverTail(frame.body.fromRevision);
          break;
        }
        case "recoveryRequest":
        case "recoveryBundle":
        case "recoveryApplied": {
          if (this.recoveryChannel == null) {
            this.reportUnsupportedRecoveryFrame(frame.t);
            break;
          }
          this.recoveryChannel.handleFrame(frame);
          break;
        }
        default:
          // The shared-terminal supervisor owns terminal frames. The shadow
          // harness never interprets a second terminal protocol.
          coopLog("v2-shadow", `inbound ignored frameType=${frame.t}`);
      }
    } catch (error) {
      this.fault(`inbound(${frame.t})`, error);
    }
  }

  /**
   * Wait for every authenticated replica to reach a real V2 mechanical stage for one exact operation.
   *
   * The authority log owns the truth and retains/redelivers the entry. This waiter adds no authority and no
   * resend path; it is only a bounded continuation notification for a host phase that must not tear down
   * before peer material exists.
   */
  waitForAuthorityPeerStage(
    operationId: string,
    stage: CoopReplicaMechanicalStage,
    timeoutMs = 30_000,
  ): Promise<boolean> {
    if (
      this.disposed
      || this.frameContext.senderSeatId !== this.frameContext.authoritySeatId
      || typeof operationId !== "string"
      || operationId.length === 0
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs <= 0
    ) {
      return Promise.resolve(false);
    }
    if (this.log.peerStageQuorum(operationId, stage)) {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const waiter: AuthorityPeerStageWaiter = {
        operationId,
        stage,
        resolve,
        cancelTimeout: () => {},
      };
      const waiterId = this.nextAuthorityPeerStageWaiterId++;
      waiter.cancelTimeout = this.scheduler.schedule(
        {
          ownerId: `authority-v2:peer-stage:${this.frameContext.sessionEpoch}:${waiterId}`,
          address: operationId,
          reason: `wait for peer ${stage}`,
        },
        timeoutMs,
        "connected",
        () => this.settleAuthorityPeerStageWaiter(waiter, false),
      );
      this.authorityPeerStageWaiters.add(waiter);
      // Covers a synchronous receipt delivered between the caller's commit return and waiter construction.
      this.flushAuthorityPeerStageWaiters();
    });
  }

  /** Retain one non-authority human proposal until its exact V2 result enters the ordered log. */
  retainInteractionProposal(input: CoopV2InteractionProposalLease): CoopV2ProposalLeaseArmResult {
    if (this.disposed || this.frameContext.senderSeatId === this.frameContext.authoritySeatId) {
      return "invalid";
    }
    return this.proposalLeases.arm(input);
  }

  private flushAuthorityPeerStageWaiters(): void {
    for (const waiter of [...this.authorityPeerStageWaiters]) {
      if (this.log.peerStageQuorum(waiter.operationId, waiter.stage)) {
        this.settleAuthorityPeerStageWaiter(waiter, true);
      }
    }
  }

  private settleAuthorityPeerStageWaiter(waiter: AuthorityPeerStageWaiter, reached: boolean): void {
    if (!this.authorityPeerStageWaiters.delete(waiter)) {
      return;
    }
    waiter.cancelTimeout();
    waiter.resolve(reached);
  }

  /**
   * Retry every mechanically incomplete admitted replica entry at a real engine chokepoint.
   *
   * This is an eager pace signal, not a retention system: the authority lease still redelivers until the
   * signed terminal receipt arrives, and the replica ledger still decides the exact resume stage. Returning
   * the number completed makes the hook observable without exposing entry material.
   */
  retryPendingReplicaEntries(): number {
    if (this.disposed) {
      return 0;
    }
    let completed = 0;
    for (const entry of [...this.pendingReplicaEntries.values()].sort((a, b) => a.revision - b.revision)) {
      try {
        if (this.applyReplicaEntry(entry)) {
          completed += 1;
        }
      } catch (error) {
        this.fault(`retryReplica(${entry.revision})`, error);
      }
    }
    return completed;
  }

  // -------------------------------------------------------------------------
  // Cutover stubs (deliverable 5) - shadow-inert, wired for the authoritative flip.
  // -------------------------------------------------------------------------

  recoveryFencePredicates(): CoopRecoveryFencePredicatesV2 | null {
    return this.recoveryChannel?.fencePredicates() ?? null;
  }

  /** Exact recovery phase-start fence; separate from human command admission during control proof. */
  recoveryControlSurfaceStartFrozen(): boolean {
    return this.recoveryChannel?.controlSurfaceStartFrozen() ?? false;
  }

  recover(reason: string): Promise<"recovered" | "terminalized"> | null {
    return this.recoveryChannel?.recover(reason) ?? null;
  }

  /** The installed-control ledger (deliverable 5) - the shadow projector's record of controlInstalled. */
  get controlLedger(): CoopShadowControlLedger {
    return this.ledger;
  }

  /**
   * The authenticated frame context the harness stamps on every entry it builds. Exposed so a caller
   * that builds an INTERACTION_COMMIT via the matching interaction adapter builder (the interaction relay
   * owner-commit site) stamps the SAME context the harness would - so the peer admits it.
   */
  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.frameContext;
  }

  /**
   * Return a structural copy of the exact authority-log head. This is a query
   * over the one log, not a second cursor; callers use it only to avoid minting
   * a redundant control-open entry when the predecessor already states the
   * same command frontier.
   */
  authorityFrontier(): CoopV2AuthorityFrontier | null {
    const head = this.log.diagnostics().headRevision;
    if (head === 0) {
      return null;
    }
    const slice = this.log.recoverySlice(head);
    if (slice == null || slice.frontier !== head || slice.frontierOperationId == null || slice.nextControl == null) {
      return null;
    }
    return {
      revision: head,
      operationId: slice.frontierOperationId,
      nextControl: structuredClone(slice.nextControl),
    };
  }

  /**
   * Preserve the one global log across an authenticated hot rejoin while rotating its channel axes.
   *
   * The session/run/epoch/seat-map/seat roles are immutable. Only membership revision and local/peer
   * connection generations may advance. AuthorityLog performs the fail-closed validation and re-addresses
   * retained/unfinished entries without resetting revisions or accepted mechanical stages.
   */
  rebindIdentity(identity: CoopV2ShadowIdentity): number {
    const next = assertFrameContextV2({
      sessionId: identity.sessionId,
      runId: identity.runId,
      sessionEpoch: identity.epoch,
      seatMapId: identity.seatMapId,
      membershipRevision: identity.membershipRevision,
      senderSeatId: identity.localSeatId,
      authoritySeatId: identity.authoritySeatId,
      connectionGeneration: identity.connectionGeneration,
    });
    const prior = this.frameContext;
    const priorRuntimeContext = this.runtimeContext;
    const priorPeerBindings = this.peerBindings;
    const nextRuntimeContext = Object.freeze({
      ...this.ctx,
      membershipRevision: identity.membershipRevision,
    });
    // AuthorityLog may synchronously redeliver on loopback. Publish the receiving context first so a receipt
    // that re-enters before rebindConnection returns is checked and signed against the replacement channel.
    this.frameContext = Object.freeze({ ...next });
    this.runtimeContext = nextRuntimeContext;
    this.peerBindings = identity.peerBindings;
    let redelivered: number;
    try {
      redelivered = this.log.rebindConnection(next, identity.peerBindings);
    } catch (error) {
      this.frameContext = prior;
      this.runtimeContext = priorRuntimeContext;
      this.peerBindings = priorPeerBindings;
      throw error;
    }
    this.recoveryChannel?.rebind();
    const proposalsRedelivered = this.proposalLeases.resendRetained();
    if (redelivered > 0) {
      coopLog(
        "v2-recovery",
        `rebound seat=${identity.localSeatId} membership=${identity.membershipRevision} `
          + `generation=${identity.connectionGeneration} redelivered=${redelivered}`,
      );
    }
    if (proposalsRedelivered > 0) {
      coopLog(
        "v2-proposal",
        `rebound seat=${identity.localSeatId} generation=${identity.connectionGeneration} `
          + `redelivered=${proposalsRedelivered}`,
      );
    }
    return redelivered;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Dispose the harness: the log, the lifecycle (aborts the context signal), and the owned scheduler. Idempotent. */
  dispose(reason = "coop-v2-shadow-dispose"): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const waiter of [...this.authorityPeerStageWaiters]) {
      this.settleAuthorityPeerStageWaiter(waiter, false);
    }
    this.proposalLeases.dispose();
    // Drop the per-instance transport inbound registration first, so no late frame routes into a
    // half-disposed harness (handleInboundFrame also self-guards on `disposed`).
    try {
      this.transportV2Unsub?.();
    } catch (error) {
      this.fault("dispose(transportV2Unsub)", error);
    }
    this.transportV2Unsub = null;
    try {
      this.recoveryChannel?.dispose(reason);
    } catch (error) {
      this.fault("dispose(recoveryChannel)", error);
    }
    try {
      this.log.dispose(reason);
    } catch (error) {
      this.fault("dispose(log)", error);
    }
    try {
      this.lifecycle.disposeAll(reason);
    } catch (error) {
      this.fault("dispose(lifecycle)", error);
    }
    if (this.ownsScheduler) {
      this.scheduler.dispose();
    }
    this.shadowState.clear();
    this.pendingReplicaEntries.clear();
    this.ledger.clear();
  }

  diagnostics(): CoopV2ShadowDiagnostics {
    return {
      committed: this.committed,
      admitted: this.admitted,
      applied: this.applied,
      receiptsSent: this.receiptsSent,
      parityChecks: this.parityChecks,
      parityMatches: this.parityMatches,
      faults: this.faults,
      retained: this.disposed ? 0 : this.log.retained().length,
      pendingTimers: this.scheduler.pendingTimerCount,
      controlLedgerSize: this.ledger.size,
      shadowStateSize: this.shadowState.size,
      disposed: this.disposed,
      recovery: this.recoveryChannel?.diagnostics() ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Run a tap body under a fault boundary: any throw becomes a logged FAULT, never propagated. */
  private runTap(kind: string, body: () => CoopAuthorityEntry | null): CoopAuthorityEntry | null {
    if (this.disposed) {
      return null;
    }
    try {
      return body();
    } catch (error) {
      this.fault(`tap(${kind})`, error);
      return null;
    }
  }

  /**
   * Admit/apply one authority entry through the single ordered replica pipeline.
   *
   * Returns true only when this call newly reaches the entry's required mechanical stage. Both transport
   * delivery and eager real-surface wakes use this exact path, so receipt order and idempotency cannot drift.
   */
  private applyReplicaEntry(entry: CoopAuthorityEntry): boolean {
    const result = this.log.admit(entry);
    this.logReplicaAdmission(entry, result.kind);
    if (result.kind === "rejected") {
      this.reportOwnedReplicaViolation(entry, `entry.${result.reason}`);
      return false;
    }
    if (result.kind === "gap") {
      // A later authenticated replacement may carry the exact terminal needed to let the currently
      // admitted turn finish its presentation/finalize path. Release only that local modal edge; the
      // gap entry remains unadmitted and emits no receipt until ordinary ordered redelivery reaches it.
      // The live seam's address/owner checks make unrelated future entries inert.
      this.releaseBlockedPredecessor(entry);
      return false;
    }
    if (result.kind === "staleEpoch") {
      return false;
    }
    if (entry.kind === "INTERACTION_COMMIT") {
      // Admission into the one ordered log is the first authoritative proof
      // that this exact proposal was accepted. Close its non-mechanical resend
      // lease before materialization; redelivery of the entry now owns liveness.
      this.proposalLeases.observeCommitted(entry.operationId);
    }
    if (result.kind === "admitted") {
      if (this.liveReplica?.admitEntry?.(this.runtimeContext, entry) === false) {
        this.reportOwnedReplicaViolation(entry, "entry.control-ledger-admission-refused");
        return false;
      }
      this.admitted += 1;
      this.pendingReplicaEntries.set(entry.revision, entry);
    } else if (result.kind === "duplicate-pending-material" || result.kind === "duplicate-pending-control") {
      this.pendingReplicaEntries.set(entry.revision, entry);
    }
    const resume =
      result.kind === "duplicate-pending-control"
        ? "materialApplied"
        : result.kind === "duplicate-complete"
          ? "controlInstalled"
          : "admitted";
    const outcome = applyEntry(this.runtimeContext, entry, this.replicaDeps, resume);
    this.logReplicaApply(entry, resume, outcome);
    if (outcome.kind === "materialRejected" || outcome.kind === "controlRejected") {
      this.reportOwnedReplicaViolation(entry, `${outcome.kind}.${outcome.reason}`);
    }
    if (outcome.kind !== "applied") {
      return false;
    }
    this.pendingReplicaEntries.delete(entry.revision);
    if (result.kind === "duplicate-complete") {
      return false;
    }
    this.applied += 1;
    return true;
  }

  /** Commit an entry to the shadow log (which delivers it over the wire) and count it. */
  private commit(entry: Omit<CoopAuthorityEntry, "revision">): CoopAuthorityEntry {
    const committed = this.log.commit(
      entry,
      this.liveReplica == null
        ? undefined
        : candidate => {
            if (!this.liveReplica?.ownsEntry(candidate)) {
              // A partially negotiated cutover still runs the remaining kinds through the pure shadow
              // pipeline. Supplying a prepare callback makes AuthorityLog require a rollback closure, so
              // an unowned entry must explicitly reserve "nothing" instead of returning null (which means
              // an owned authority-local reservation was refused). No live ledger is touched here.
              return () => {};
            }
            return this.liveReplica.prepareAuthorityEntry?.(this.runtimeContext, candidate) ?? null;
          },
    );
    this.committed += 1;
    if (this.liveReplica?.ownsEntry(committed) === true) {
      this.liveReplica.authorityEntryCommitted?.(this.runtimeContext, committed);
    }
    return committed;
  }

  /**
   * The routed material applier: in CUTOVER mode a live seam installs a cutover-kind entry into REAL engine
   * state (`null` falls through only for an explicitly unowned kind). In pure shadow mode the
   * live seam is absent, so this is exactly the in-memory shadow applier - byte-identical to before.
   */
  private applyMaterialRouted(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): ApplyMaterialResult {
    if (this.recoveryChannel?.fencePredicates().isMaterializationFrozen() === true) {
      return "deferred";
    }
    const live = this.liveReplica?.applyMaterial(ctx, entry) ?? null;
    if (live != null) {
      // Record observability only after real material applied. Deferred/rejected work must never inflate the
      // shadowStateSize counter into claiming a mechanically-applied revision.
      if (live === true) {
        this.shadowApplyMaterial(ctx, entry);
      }
      return live;
    }
    if (this.liveReplica?.ownsEntry(entry) === true) {
      return false;
    }
    return this.shadowApplyMaterial(ctx, entry);
  }

  /** Structural failure on a cut-over kind is a shared protocol terminal, never an infinite retained stall. */
  private reportOwnedReplicaViolation(entry: CoopAuthorityEntry, issue: string): void {
    if (this.liveReplica?.ownsEntry(entry) !== true) {
      return;
    }
    reportProtocolViolation(
      {
        kind: "protocol-violation",
        frameType: "authorityEntry",
        issues: [issue],
      },
      this.onProtocolViolation,
    );
  }

  private reportUnsupportedRecoveryFrame(frameType: CoopFrameV2["t"]): void {
    reportProtocolViolation(
      {
        kind: "protocol-violation",
        frameType,
        issues: ["recovery.receiver-not-installed"],
      },
      this.onProtocolViolation,
    );
  }

  /**
   * Best-effort causal predecessor release for a validated gap entry. This intentionally has no shadow
   * fallback: pure shadow has no real modal to release, while a live owned entry must pass its exact
   * surface checks. No return value can advance replica truth; ordered applyEntry remains the sole receipt
   * and ledger path.
   */
  private releaseBlockedPredecessor(entry: CoopAuthorityEntry): void {
    if (this.liveReplica?.ownsEntry(entry) !== true || this.liveReplica.releaseBlockedPredecessor == null) {
      return;
    }
    try {
      const released = this.liveReplica.releaseBlockedPredecessor(this.runtimeContext, entry);
      coopLog(
        "v2-replica",
        `gap-release rev=${entry.revision} kind=${entry.kind} result=${released == null ? "unowned" : released}`,
      );
    } catch (error) {
      this.fault(`releaseBlockedPredecessor(rev=${entry.revision})`, error);
    }
  }

  /** Compact ordered-ledger evidence: enough to diagnose a stall without dumping canonical material. */
  private logReplicaAdmission(entry: CoopAuthorityEntry, result: string): void {
    const diagnostics = this.log.diagnostics();
    coopLog(
      "v2-replica",
      `admit rev=${entry.revision} kind=${entry.kind} result=${result} `
        + `frontier=${diagnostics.receivedThrough}/${diagnostics.appliedThrough}/`
        + `${diagnostics.controlInstalledThrough}`,
    );
  }

  /** Record the exact live-apply stage/reason; payloads remain out of logs. */
  private logReplicaApply(entry: CoopAuthorityEntry, resume: ReplicaApplyResume, outcome: ReplicaApplyOutcome): void {
    const detail = outcome.kind === "applied" ? ` control=${outcome.controlId ?? "none"}` : ` reason=${outcome.reason}`;
    const diagnostics = this.log.diagnostics();
    coopLog(
      "v2-replica",
      `apply rev=${entry.revision} kind=${entry.kind} resume=${resume} outcome=${outcome.kind}${detail} `
        + `frontier=${diagnostics.receivedThrough}/${diagnostics.appliedThrough}/`
        + `${diagnostics.controlInstalledThrough}`,
    );
  }

  /** The shadow material applier: record the admitted entry into shadow state (never engine state). */
  private readonly shadowApplyMaterial: ApplyMaterialFn = (_ctx, entry) => {
    this.shadowState.set(entry.revision, {
      revision: entry.revision,
      operationId: entry.operationId,
      kind: entry.kind,
      digest: entry.material.digest,
    });
    return true;
  };

  /** Map a log wire onto a v2 frame and send it (guarded: a transport throw is a FAULT, never propagated). */
  private emitWire(wire: CoopAuthorityWire): void {
    try {
      if (wire.kind === "deliver") {
        this.sendFrame(deliverFrame(wire.entry));
      } else {
        this.sendFrame(tailRequestFrame(wire.context, wire.missingFrom));
      }
    } catch (error) {
      this.fault(`emitWire(${wire.kind})`, error);
    }
  }

  /** Send a replica receipt as a v2 authorityReceipt frame (guarded). */
  private sendReceipt(receipt: CoopAuthorityReceipt): void {
    try {
      this.sendFrame(receiptFrame(receipt));
      this.receiptsSent += 1;
    } catch (error) {
      this.fault("sendReceipt", error);
    }
  }

  /** Authority: re-deliver every retained entry at or after `fromRevision` (a replica gap request). */
  private redeliverTail(fromRevision: number): void {
    for (const entry of this.log.retained()) {
      if (entry.revision >= fromRevision) {
        this.emitWire({ kind: "deliver", entry });
      }
    }
  }

  /** Fingerprint an interaction entry through whichever interaction adapter recognizes it, or null. */
  private interactionShadowDigest(entry: Omit<CoopAuthorityEntry, "revision"> | CoopAuthorityEntry): string | null {
    const reward = rewardShadowOfEntry(entry);
    if (reward != null) {
      return reward.materialDigest;
    }
    const mystery = mysteryShadowOfEntry(entry);
    if (mystery != null) {
      return mystery.digest;
    }
    const learn = learnShadowOfEntry(entry);
    if (learn != null) {
      return learn.digest;
    }
    return null;
  }

  private logParity(kind: string, revision: number, match: boolean, divergentField: string, note?: string): void {
    this.parityChecks += 1;
    if (match) {
      this.parityMatches += 1;
    }
    const suffix = note == null ? "" : ` ${note}`;
    coopLog(
      "v2-shadow",
      `PARITY kind=${kind} rev=${revision} match=${match} field=${match ? "-" : divergentField}${suffix}`,
    );
  }

  private fault(where: string, error: unknown): void {
    this.faults += 1;
    coopWarn("v2-shadow", `FAULT ${where}: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Frame construction (log wire / receipt -> v2 envelope). The entry/receipt
// bodies OMIT context (the envelope carries the one authenticated context).
// ---------------------------------------------------------------------------

function deliverFrame(entry: CoopAuthorityEntry): CoopFrameV2 {
  const { context, ...body } = entry;
  return { v: COOP_FRAME_PROTOCOL_VERSION, t: "authorityEntry", ctx: context, body };
}

function receiptFrame(receipt: CoopAuthorityReceipt): CoopFrameV2 {
  const { context, ...body } = receipt;
  return { v: COOP_FRAME_PROTOCOL_VERSION, t: "authorityReceipt", ctx: context, body };
}

function tailRequestFrame(ctx: CoopFrameContextV2, fromRevision: number): CoopFrameV2 {
  return { v: COOP_FRAME_PROTOCOL_VERSION, t: "tailRequest", ctx, body: { fromRevision } };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reshape a flat safe-integer relay array into `[learnableId, forgetSlot]` pairs for a batch level-up
 * decision. A trailing odd element is dropped (the relay carries no partner for it). Empty in / odd-length in
 * yields the pairs it can form - the batch adapter validates each pair, so a malformed shape falls the tap
 * back to the generic reward entry rather than committing garbage.
 */
function pairwiseSafe(values: readonly number[]): (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    pairs.push([values[i], values[i + 1]] as const);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// TRANSPORT INBOUND ROUTING SEAM (legacy boundary). The transport receive path
// intercepts a decoded object with v===2 and calls routeCoopV2InboundFrame; the
// runtime registers the live harness's inbound handler here at assembly and
// clears it at teardown. A single registered handler (one live session) - the
// only module-level state in this file, and it lives at the legacy boundary, not
// inside the engine-free harness.
// ---------------------------------------------------------------------------

let inboundHandler: ((frame: CoopFrameV2) => void) | null = null;

/**
 * The live harness for the active session (set alongside the inbound handler at runtime assembly, cleared
 * at teardown). It lets the emit seams that are NOT in the runtime module (the turn-commit stream, the
 * faint-switch authority commit, the interaction relay owner-commit) tap WITHOUT importing the runtime -
 * avoiding an import cycle. Every thin tap free function below is a pure no-op when it is null (the
 * capability-off ship-safety boundary).
 */
let activeHarness: CoopAuthorityV2Shadow | null = null;

/** Register the live harness as the active tap target. */
export function setActiveCoopV2Shadow(harness: CoopAuthorityV2Shadow): void {
  activeHarness = harness;
}

/** Clear the active harness (teardown). Only clears when `harness` matches (or omitted). */
export function clearActiveCoopV2Shadow(harness?: CoopAuthorityV2Shadow): void {
  if (harness == null || activeHarness === harness) {
    activeHarness = null;
  }
}

/** Tap the host's turn-commit emit (thin, cycle-free). No-op unless a harness is active. */
export function tapCoopV2ShadowTurnCommit(input: CoopV2ShadowTurnTap): void {
  activeHarness?.tapTurnCommit(input);
}

/** Tap the faint-switch authority commit (thin, cycle-free). No-op unless a harness is active. */
export function tapCoopV2ShadowReplacementCommit(input: CoopV2ShadowReplacementTap): void {
  activeHarness?.tapReplacementCommit(input);
}

/** Tap the interaction relay owner-commit with a pre-built entry (thin, cycle-free). No-op unless active. */
export function tapCoopV2ShadowInteraction(input: CoopV2ShadowInteractionTap): void {
  activeHarness?.tapInteraction(input);
}

/**
 * Tap the interaction relay owner-commit from PRIMITIVES (thin, cycle-free). The emit seam (the relay's
 * `sendInteractionChoice`) has no adapter-shaped entry / epoch / wave / context, so it passes the raw pick
 * and the harness (which owns the context) builds the shadow reward entry. No-op unless a harness is active.
 */
export function tapCoopV2ShadowInteractionChoice(input: CoopV2ShadowInteractionChoiceTap): void {
  activeHarness?.tapInteractionChoice(input);
}

/** Whether a shadow harness is active (an emit seam can gate its input construction on this). */
export function isCoopV2ShadowActive(): boolean {
  return activeHarness != null;
}

/**
 * The active harness's authenticated session epoch, or `null` when no harness is active. Exposed so an emit
 * seam that must build a v2 address (a positive session epoch) WITHOUT the surface's own op-state - e.g. the
 * faint-switch REPLACEMENT tap in a lane where the op surface is rolled back - can source the epoch the same
 * authenticated way the harness stamps it, instead of reaching into ambient op state.
 */
export function activeCoopV2ShadowSessionEpoch(): number | null {
  return activeHarness?.authenticatedFrameContext.sessionEpoch ?? null;
}

/** Register the live harness's inbound handler (runtime assembly). */
export function registerCoopV2ShadowInbound(handler: (frame: CoopFrameV2) => void): void {
  inboundHandler = handler;
}

/** Clear the registered inbound handler (runtime teardown). Idempotent; only clears when `handler` matches (or omitted). */
export function clearCoopV2ShadowInbound(handler?: (frame: CoopFrameV2) => void): void {
  if (handler == null || inboundHandler === handler) {
    inboundHandler = null;
  }
}

/** The classification a routed inbound frame received. */
export type CoopV2InboundRouting = "routed" | "cosmetic-drop" | "protocol-violation";
type CoopV2ProtocolViolation = Extract<CoopInboundFrameResultV2, { kind: "protocol-violation" }>;

/**
 * THE transport boundary for a v===2 frame. Validates via the ONE boundary
 * validator (never the legacy cast). A valid frame is handed to the registered
 * harness inbound handler; a cosmetic drop is logged; a protocol violation is
 * logged loudly. Pure-shadow callers omit a violation hook and therefore retain
 * evidence-only behavior. Authoritative-cutover runtimes inject a hook that enters
 * the retained shared terminal. Total over all inputs: never throws into transport.
 */
export function routeCoopV2InboundFrame(raw: unknown): CoopV2InboundRouting {
  return routeValidatedInboundFrame(raw, inboundHandler);
}

/**
 * Validate and reject a v2 frame delivered to a concrete transport endpoint
 * that has no instance receiver. Concrete transports support `onV2Frame`, so
 * falling back to another endpoint's realm-global handler would cross session
 * ownership in same-process rigs (and can feed an authority its own entry).
 */
export function rejectCoopV2InboundFrameWithoutReceiver(raw: unknown): CoopV2InboundRouting {
  return routeValidatedInboundFrame(raw, null);
}

/**
 * Route a raw inbound v2 frame to a SPECIFIC harness's inbound handler - the per-instance transport seam
 * (contract change request 2). Same validation + classification as {@linkcode routeCoopV2InboundFrame}, but
 * targeted at the passed handler instead of the module-level one, so two harnesses in one process each admit
 * only the frames delivered on THEIR OWN transport endpoint.
 */
export function routeCoopV2InboundFrameTo(
  raw: unknown,
  handler: (frame: CoopFrameV2) => void,
  onProtocolViolation?: (violation: CoopV2ProtocolViolation) => void,
): CoopV2InboundRouting {
  return routeValidatedInboundFrame(raw, handler, onProtocolViolation);
}

/** The shared validate-then-route body for both the module-level handler and the per-instance seam. */
function routeValidatedInboundFrame(
  raw: unknown,
  handler: ((frame: CoopFrameV2) => void) | null,
  onProtocolViolation?: (violation: CoopV2ProtocolViolation) => void,
): CoopV2InboundRouting {
  const result = validateInboundFrame(raw);
  switch (result.kind) {
    case "valid":
      if (handler == null) {
        const violation: CoopV2ProtocolViolation = {
          kind: "protocol-violation",
          frameType: result.frame.t,
          issues: ["receiver.not-installed"],
        };
        reportProtocolViolation(violation, onProtocolViolation);
        return "protocol-violation";
      }
      try {
        handler(result.frame);
      } catch (error) {
        coopWarn("v2-shadow", `FAULT route: ${describeError(error)}`);
      }
      return "routed";
    case "cosmetic-drop":
      coopLog("v2", `cosmetic-drop ${result.reason}`);
      return "cosmetic-drop";
    case "protocol-violation":
      reportProtocolViolation(result, onProtocolViolation);
      return "protocol-violation";
  }
}

function reportProtocolViolation(
  violation: CoopV2ProtocolViolation,
  onProtocolViolation?: (violation: CoopV2ProtocolViolation) => void,
): void {
  coopWarn(
    "v2",
    `PROTOCOL VIOLATION frameType=${violation.frameType ?? "(unknown)"} issues=[${violation.issues.join(", ")}]`,
  );
  try {
    onProtocolViolation?.(violation);
  } catch (error) {
    coopWarn("v2-shadow", `FAULT protocol terminal route: ${describeError(error)}`);
  }
}
