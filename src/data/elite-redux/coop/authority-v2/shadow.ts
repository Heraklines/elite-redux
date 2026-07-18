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
  buildReplacementCommitEntry,
  type ReplacementProposal,
  type ReplacementResolutionMode,
  type ReplacementSuccessor,
  shadowParityOfEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
// The three interaction adapters each export `shadowOfInteractionEntry` (different return shapes); alias
// them so a committed INTERACTION_COMMIT is fingerprinted through whichever adapter recognizes it.
import { shadowOfInteractionEntry as learnShadowOfEntry } from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import { shadowOfInteractionEntry as mysteryShadowOfEntry } from "#data/elite-redux/coop/authority-v2/adapters/interactions-mystery";
import { shadowOfInteractionEntry as rewardShadowOfEntry } from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import {
  buildTurnCommitEntry,
  computeShadowParity,
  type MutationBarrier,
  type TurnCommandTarget,
  type TurnResolutionImage,
} from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import {
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopTerminalMaterialV2,
  type CoopWaveAdvanceDestination,
  type CoopWaveTransitionMaterialV2,
  shadowOfWaveTerminalEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { COOP_FRAME_PROTOCOL_VERSION, type CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { bindFrameContext, type CoopFrameConnectionBindingV2 } from "#data/elite-redux/coop/authority-v2/frame-context";
import { CoopLifecycle } from "#data/elite-redux/coop/authority-v2/lifecycle";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import { validateInboundFrame } from "#data/elite-redux/coop/authority-v2/protocol-validator";
import { type ApplyMaterialFn, applyEntry, type ReplicaApplyDeps } from "#data/elite-redux/coop/authority-v2/replica";
import {
  type CoopRuntimeContextHandle,
  createCoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/runtime-context";
import { type CoopSchedulerImpl, createCoopScheduler } from "#data/elite-redux/coop/authority-v2/scheduler";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

// ---------------------------------------------------------------------------
// Build-feature gate. The shadow harness is fully wired but ADVERTISED only when
// this flag is on. It defaults OFF so a co-op session is BYTE-IDENTICAL to the
// pre-shadow build (the capability is never negotiated -> the harness never builds
// -> no v2 frame is ever sent -> the transport v===2 branch is dead) - the safest
// possible rollout. Flip it ON (env COOP_AUTHORITY_V2_SHADOW=on) on BOTH peers to
// activate the live shadow run.
//
// WHY DEFAULT OFF (rollout note): the single module-level inbound handler below is
// correct for PRODUCTION (one harness per process, frames arrive from the REMOTE
// peer). The CI two-engine duo harness runs BOTH peers in ONE process, so a single
// module-level handler cannot disambiguate the two harnesses' inbound v2 frames.
// The shadow is isolated from legacy (it never touches engine state, every path is
// try/caught), so it cannot break a legacy assertion - but until the duo-harness
// inbound routing is made per-runtime, keep the capability off by default so the
// gate stays provably byte-identical. See the report's contract change requests.
// ---------------------------------------------------------------------------
const COOP_V2_SHADOW_ENABLED = typeof process !== "undefined" && process.env?.COOP_AUTHORITY_V2_SHADOW === "on";

/** Whether this build ADVERTISES the authority-v2 shadow capability (flip on with env COOP_AUTHORITY_V2_SHADOW=on). */
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
}

// ---------------------------------------------------------------------------
// Tap inputs (one per legacy commit point). Each carries the matching adapter
// builder's inputs plus the LEGACY digest to compare against. No frame context:
// the harness stamps its own authenticated context on every entry.
// ---------------------------------------------------------------------------

export interface CoopV2ShadowTurnTap {
  readonly operationId: string;
  readonly capture: TurnResolutionImage;
  readonly nextCommand: TurnCommandTarget;
  readonly legacyDigest: string;
  readonly subsumes?: readonly number[];
  /** Outstanding mutation-barrier tokens at the legacy commit (should be 0 - we tap AFTER legacy settles). */
  readonly pendingTokens?: number;
}

export interface CoopV2ShadowReplacementTap {
  readonly proposal: ReplacementProposal;
  readonly resolution: ReplacementResolutionMode;
  readonly successor: ReplacementSuccessor;
  readonly legacyDigest: string;
  readonly operationId?: string;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowWaveTap {
  readonly operationId: string;
  readonly transition: CoopWaveTransitionMaterialV2;
  readonly destination: CoopWaveAdvanceDestination;
  readonly legacyDigest: string;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowTerminalTap {
  readonly operationId: string;
  readonly terminal: CoopTerminalMaterialV2;
  readonly legacyDigest: string;
  readonly subsumes?: readonly number[];
}

export interface CoopV2ShadowInteractionTap {
  /** The entry the runtime built via the matching interaction adapter builder (reward/mystery/learn). */
  readonly entry: Omit<CoopAuthorityEntry, "revision">;
  readonly legacyDigest: string;
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

  constructor(ledger: CoopShadowControlLedger) {
    this.ledger = ledger;
  }

  project(_ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult {
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

export class CoopAuthorityV2Shadow {
  private readonly ctxHandle: CoopRuntimeContextHandle;
  private readonly ctx: CoopRuntimeContext;
  private readonly frameContext: CoopFrameContextV2;
  private readonly scheduler: CoopSchedulerImpl;
  private readonly ownsScheduler: boolean;
  private readonly log: AuthorityLog;
  private readonly lifecycle: CoopLifecycle;
  private readonly ledger = new CoopShadowControlLedger();
  private readonly projector: CoopControlProjector;
  private readonly replicaDeps: ReplicaApplyDeps;
  private readonly sendFrame: (frame: CoopFrameV2) => void;
  private readonly shadowState = new Map<number, ShadowStateRecord>();

  private disposed = false;
  private committed = 0;
  private admitted = 0;
  private applied = 0;
  private receiptsSent = 0;
  private parityChecks = 0;
  private parityMatches = 0;
  private faults = 0;

  constructor(deps: CoopV2ShadowDeps) {
    const id = deps.identity;
    this.sendFrame = deps.send;
    this.scheduler = deps.scheduler ?? createCoopScheduler();
    this.ownsScheduler = deps.scheduler == null;

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
      ownerId: `authority-v2-shadow:${id.sessionId}:seat${id.localSeatId}`,
    });

    this.projector = new CoopShadowControlProjector(this.ledger);
    this.replicaDeps = {
      applyMaterial: this.shadowApplyMaterial,
      projector: this.projector,
      receipts: { emit: receipt => this.sendReceipt(receipt) },
    };
  }

  // -------------------------------------------------------------------------
  // AUTHORITY side - the taps. Each is fully guarded: a shadow fault is logged
  // and swallowed, never thrown into game code.
  // -------------------------------------------------------------------------

  /** Tap the host's turn-commit emit. Builds a TURN_COMMIT via the turn adapter + records parity. */
  tapTurnCommit(input: CoopV2ShadowTurnTap): CoopAuthorityEntry | null {
    return this.runTap("TURN_COMMIT", () => {
      const barrier: MutationBarrier = { pendingTokens: () => input.pendingTokens ?? 0 };
      const built = buildTurnCommitEntry({
        context: this.frameContext,
        operationId: input.operationId,
        capture: input.capture,
        nextCommand: input.nextCommand,
        barrier,
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      if (built.kind === "barred") {
        coopLog("v2-shadow", `turn-commit BARRED pendingTokens=${built.pendingTokens} op=${input.operationId}`);
        return null;
      }
      const entry = this.commit(built.entry);
      const parity = computeShadowParity(input.legacyDigest, entry);
      this.logParity("TURN_COMMIT", entry.revision, parity.digestsMatch, "materialDigest");
      return entry;
    });
  }

  /** Tap the faint-switch authority commit. Builds a REPLACEMENT_COMMIT via the faint adapter + records parity. */
  tapReplacementCommit(input: CoopV2ShadowReplacementTap): CoopAuthorityEntry | null {
    return this.runTap("REPLACEMENT_COMMIT", () => {
      const built = buildReplacementCommitEntry({
        context: this.frameContext,
        proposal: input.proposal,
        resolution: input.resolution,
        successor: input.successor,
        ...(input.operationId == null ? {} : { operationId: input.operationId }),
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      const entry = this.commit(built);
      const parity = shadowParityOfEntry(entry);
      const v2Digest = parity?.digest ?? entry.material.digest;
      this.logParity("REPLACEMENT_COMMIT", entry.revision, v2Digest === input.legacyDigest, "digest");
      return entry;
    });
  }

  /** Tap the waveResolved broadcast. Builds a WAVE_ADVANCE via the wave-terminal adapter + records parity. */
  tapWaveAdvance(input: CoopV2ShadowWaveTap): CoopAuthorityEntry | null {
    return this.runTap("WAVE_ADVANCE", () => {
      const built = buildWaveAdvanceEntry({
        context: this.frameContext,
        operationId: input.operationId,
        transition: input.transition,
        destination: input.destination,
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      const entry = this.commit(built);
      const shadow = shadowOfWaveTerminalEntry(entry);
      this.logParity("WAVE_ADVANCE", entry.revision, shadow.materialDigest === input.legacyDigest, "materialDigest");
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
        ...(input.subsumes == null ? {} : { subsumes: input.subsumes }),
      });
      const entry = this.commit(built);
      const shadow = shadowOfWaveTerminalEntry(entry);
      this.logParity("TERMINAL_COMMIT", entry.revision, shadow.materialDigest === input.legacyDigest, "materialDigest");
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
      this.logParity("INTERACTION_COMMIT", entry.revision, v2Digest === input.legacyDigest, "materialDigest");
      return entry;
    });
  }

  // -------------------------------------------------------------------------
  // REPLICA side - inbound v2 frames (delivered entries, receipts, tail requests).
  // -------------------------------------------------------------------------

  /**
   * Handle one validated inbound v2 frame. Fully guarded: any fault is logged as a
   * shadow FAULT and swallowed - a malformed or hostile peer can never crash the
   * game through the shadow path. Returns whether the frame was actioned.
   */
  handleInboundFrame(frame: CoopFrameV2): void {
    if (this.disposed) {
      return;
    }
    try {
      switch (frame.t) {
        case "authorityEntry": {
          const entry: CoopAuthorityEntry = { context: frame.ctx, ...frame.body };
          const result = this.log.admit(entry);
          if (result.kind === "admitted") {
            this.admitted += 1;
            const outcome = applyEntry(this.ctx, entry, this.replicaDeps);
            if (outcome.kind === "applied") {
              this.applied += 1;
            }
          }
          break;
        }
        case "authorityReceipt": {
          const receipt: CoopAuthorityReceipt = { context: frame.ctx, ...frame.body };
          this.log.acceptReceipt(receipt);
          break;
        }
        case "tailRequest": {
          this.redeliverTail(frame.body.fromRevision);
          break;
        }
        default:
          // recoveryRequest / recoveryBundle / terminal frames are not part of the shadow exercise
          // (shadow never drives recovery or a classified terminal); log + ignore.
          coopLog("v2-shadow", `inbound ignored frameType=${frame.t}`);
      }
    } catch (error) {
      this.fault(`inbound(${frame.t})`, error);
    }
  }

  // -------------------------------------------------------------------------
  // Cutover stubs (deliverable 5) - shadow-inert, wired for the authoritative flip.
  // -------------------------------------------------------------------------

  /**
   * Register recovery-fence predicates. Shadow-inert no-op: in shadow mode the
   * fence never gates any real progression (legacy owns recovery). The cutover
   * wires these onto the recovery transaction's fence acquisition.
   */
  registerFencePredicates(..._predicates: unknown[]): void {
    // TODO(cutover): install these onto the CoopRecoveryTransaction fence so authoritative
    // recovery freezes command admission / control progression while a bundle is in flight.
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

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Dispose the harness: the log, the lifecycle (aborts the context signal), and the owned scheduler. Idempotent. */
  dispose(reason = "coop-v2-shadow-dispose"): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
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

  /** Commit an entry to the shadow log (which delivers it over the wire) and count it. */
  private commit(entry: Omit<CoopAuthorityEntry, "revision">): CoopAuthorityEntry {
    const committed = this.log.commit(entry);
    this.committed += 1;
    return committed;
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
  private interactionShadowDigest(entry: CoopAuthorityEntry): string | null {
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

  private logParity(kind: string, revision: number, match: boolean, divergentField: string): void {
    this.parityChecks += 1;
    if (match) {
      this.parityMatches += 1;
    }
    coopLog("v2-shadow", `PARITY kind=${kind} rev=${revision} match=${match} field=${match ? "-" : divergentField}`);
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

/** Tap the interaction relay owner-commit (thin, cycle-free). No-op unless a harness is active. */
export function tapCoopV2ShadowInteraction(input: CoopV2ShadowInteractionTap): void {
  activeHarness?.tapInteraction(input);
}

/** Whether a shadow harness is active (an emit seam can gate its input construction on this). */
export function isCoopV2ShadowActive(): boolean {
  return activeHarness != null;
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

/**
 * THE transport boundary for a v===2 frame. Validates via the ONE boundary
 * validator (never the legacy cast). A valid frame is handed to the registered
 * shadow harness inbound handler; a cosmetic drop is logged; a protocol violation
 * is logged LOUDLY. In shadow mode a violation is LOG-ONLY - it must never
 * terminal a session whose mechanics legacy still fully controls. Total over all
 * inputs - never throws back into the transport.
 */
export function routeCoopV2InboundFrame(raw: unknown): CoopV2InboundRouting {
  const result = validateInboundFrame(raw);
  switch (result.kind) {
    case "valid":
      if (inboundHandler != null) {
        try {
          inboundHandler(result.frame);
        } catch (error) {
          coopWarn("v2-shadow", `FAULT route: ${describeError(error)}`);
        }
      }
      return "routed";
    case "cosmetic-drop":
      coopLog("v2", `cosmetic-drop ${result.reason}`);
      return "cosmetic-drop";
    case "protocol-violation":
      // TODO(cutover): AUTHORITATIVE mode wires this to the classified shared terminal
      // (failCoopSharedSession) so a malformed mechanically-relevant frame ends the shared
      // session. In SHADOW mode it is LOG-ONLY: legacy controls all mechanics, so a v2
      // protocol violation is evidence, never a session terminal.
      coopWarn(
        "v2",
        `PROTOCOL VIOLATION frameType=${result.frameType ?? "(unknown)"} issues=[${result.issues.join(", ")}]`,
      );
      return "protocol-violation";
  }
}
