/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY V2 - ADDRESS-EXACT GLOBAL CONTROL LEDGER.
//
// A UI mode is not a global control proof: unrelated phases reuse PARTY, CONFIRM,
// OPTION_SELECT, and MESSAGE. This runtime-owned ledger binds one authenticated
// INTERACTION_COMMIT revision to its immutable successor and, for executable
// controls, to the exact live phase + handler objects that were actionable.
//
// The ledger is engine-free. The runtime supplies opaque phase/handler tokens
// and a public-surface observation; recovery and ordinary delivery call the same
// install method. A request can therefore never become controlInstalled merely
// because a phase was queued or because some handler happened to be active.
// =============================================================================

import {
  boundarySupersessionAllowsSuccessorEntry,
  type CoopBoundarySupersessionEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  type AuthorityEntryProofScope,
  authorityEntryProofScopeOf,
  consumeReplicaEntryProofScope,
  revokeAuthorityEntryProofScope,
} from "#data/elite-redux/coop/authority-v2/authority-log";
import type { CoopAuthorityEntry, CoopControlInstallResult } from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlAllowsSuccessorEntry,
  controlIdOf,
  controlsEqual,
  type ProjectableControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopRewardSurfaceIdentity } from "#data/elite-redux/coop/coop-transport";

export type CoopV2InteractionControl = Extract<
  ProjectableControl,
  { kind: "SHARED_INTERACTION" | "REPLACEMENT" | "AWAIT_SUCCESSOR" }
>;
export type CoopV2ClaimedControl = ProjectableControl;

export interface CoopV2InteractionSurfaceObservation {
  /** Exact operation address declared by this live phase generation. */
  readonly operationId: string | null;
  readonly phaseName: string;
  readonly uiMode: number;
  readonly phaseToken: object;
  readonly handlerToken: object;
  readonly handlerActive: boolean;
  /** Stronger than a keepalive: the current handler would act on human input now. */
  readonly actionable: boolean;
}

/**
 * Exact authority-side ingress lease for a human choice owned by another seat.
 *
 * This is deliberately separate from a watcher UI observation. The mechanical
 * authority does not own the remote player's public picker; its actionable
 * control surface is the addressed relay waiter that can consume that owner's
 * proposal. A transport connection, buffered keepalive, or unaddressed waiter
 * is not sufficient.
 */
export interface CoopV2AuthorityProposalWaitObservation {
  /** Immutable SHARED_INTERACTION address whose remote owner may propose. */
  readonly controlOperationId: string;
  /** Relay sequence derived from that immutable interaction capsule. */
  readonly relaySequence: number;
  /** Closed set of wire choice kinds this waiter may consume. */
  readonly acceptedKinds: readonly string[];
  /** Exact nested reward address, null for an ordinary reward, absent for non-reward surfaces. */
  readonly expectedRewardSurface?: CoopRewardSurfaceIdentity | null | undefined;
  /** Opaque identity of this exact live waiter generation. */
  readonly waiterToken: object;
  /** False after timeout, supersession, cancellation, or recovery fencing. */
  readonly active: boolean;
}

interface InteractionControlClaim {
  readonly revision: number;
  readonly sourceOperationId: string;
  /**
   * Exact immutable entry that authored this successor. Executable shared interactions cannot be
   * reconstructed from a control address alone after recovery destroys the old Phaser phase tree.
   */
  readonly sourceEntry: CoopAuthorityEntry | null;
  readonly control: CoopV2ClaimedControl;
  materialApplied: boolean;
  superseded: boolean;
  installed: {
    readonly controlId: string;
    readonly observation:
      | { readonly kind: "ordered-wait" }
      | { readonly kind: "mechanical" }
      | {
          readonly kind: "executable";
          readonly phaseName: string;
          readonly uiMode: number;
          readonly phaseToken: object;
          readonly handlerToken: object;
        }
      | {
          readonly kind: "watcher";
          readonly phaseName: string;
          readonly uiMode: number;
          readonly phaseToken: object;
          readonly handlerToken: object;
        }
      | {
          readonly kind: "authority-proposal-wait";
          readonly relaySequence: number;
          readonly acceptedKinds: readonly string[];
          readonly expectedRewardSurface?: CoopRewardSurfaceIdentity | null | undefined;
          readonly waiterToken: object;
        };
  } | null;
}

interface ControlLedgerSnapshot {
  readonly entry: CoopAuthorityEntry;
  readonly claims: Map<string, InteractionControlClaim>;
  readonly authenticatedSources: Map<number, CoopAuthorityEntry>;
  readonly activeControlId: string | null;
}

function controlOf(entry: CoopAuthorityEntry): CoopV2ClaimedControl {
  return entry.nextControl;
}

function isBoundaryEntry(entry: CoopAuthorityEntry): boolean {
  return entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT";
}

function sameRewardSurface(
  left: CoopRewardSurfaceIdentity | null | undefined,
  right: CoopRewardSurfaceIdentity | null | undefined,
): boolean {
  if (left == null || right == null) {
    return left === right;
  }
  return left.ordinal === right.ordinal && left.surfaceId === right.surfaceId;
}

/** Hard live-proof bound aligned with the authority log default; overflow refuses rather than evicts evidence. */
export const COOP_V2_AUTHENTICATED_SOURCE_CAPACITY = 512;

/** Per-runtime global control ledger; never shared between the two in-process browser engines. */
export class CoopV2ControlLedger {
  private readonly claims = new Map<string, InteractionControlClaim>();
  /** Address reuse may replace a claim, so immutable source authentication has its own revision keyspace. */
  private readonly authenticatedSources = new Map<number, CoopAuthorityEntry>();
  private readonly authenticatedSourceCapacity: number;
  private activeControlId: string | null = null;
  /** Holds the exact pre-admission state until the paired registerEntry succeeds or rolls it back. */
  private pendingAdmissionRollback: ControlLedgerSnapshot | null = null;

  constructor(authenticatedSourceCapacity = COOP_V2_AUTHENTICATED_SOURCE_CAPACITY) {
    if (!Number.isSafeInteger(authenticatedSourceCapacity) || authenticatedSourceCapacity <= 0) {
      throw new Error("CoopV2ControlLedger requires a positive authenticated-source capacity");
    }
    this.authenticatedSourceCapacity = authenticatedSourceCapacity;
  }

  /**
   * Atomically reserve an authority-authored entry before it is published. This is the local half of the
   * global commit transaction: predecessor consumption, successor registration, and the authority's already
   * applied material fact either become visible together or the exact prior ledger is restored.
   */
  prepareAuthorityEntry(entry: CoopAuthorityEntry): (() => void) | null {
    const priorClaims = this.cloneClaims();
    const priorAuthenticatedSources = this.cloneAuthenticatedSources();
    const priorActiveControlId = this.activeControlId;
    const restore = (): void => {
      this.claims.clear();
      for (const [controlId, claim] of priorClaims) {
        this.claims.set(controlId, claim);
      }
      this.authenticatedSources.clear();
      for (const [revision, source] of priorAuthenticatedSources) {
        this.authenticatedSources.set(revision, source);
      }
      this.activeControlId = priorActiveControlId;
      this.pendingAdmissionRollback = null;
    };
    const proofScope = authorityEntryProofScopeOf(entry);
    const authorityProofScope = proofScope?.kind === "authority-retained" ? proofScope : null;
    const proofSources = authorityProofScope == null ? null : this.mergeProofSources(authorityProofScope, entry);
    try {
      if (
        (authorityProofScope != null
          && (proofSources == null || !this.reconcileAuthenticatedSources(proofSources, entry)))
        || !this.admitAndRegisterEntry(entry)
        || !this.markMaterialApplied(entry)
      ) {
        restore();
        return null;
      }
    } catch (error) {
      restore();
      revokeAuthorityEntryProofScope(entry);
      throw error;
    }
    let live = true;
    return () => {
      if (!live) {
        return;
      }
      live = false;
      restore();
    };
  }

  /**
   * Bind an admitted/locally-committed immutable entry before its materializer runs. Conflicting reuse of a
   * control address is rejected; identical redelivery is idempotent.
   */
  registerEntry(entry: CoopAuthorityEntry): boolean {
    let priorAdmission = this.pendingAdmissionRollback;
    if (priorAdmission != null && priorAdmission.entry !== entry) {
      this.restoreSnapshot(priorAdmission);
      this.pendingAdmissionRollback = null;
      revokeAuthorityEntryProofScope(priorAdmission.entry);
      priorAdmission = null;
    }
    const rollback = priorAdmission ?? {
      entry,
      claims: this.cloneClaims(),
      authenticatedSources: this.cloneAuthenticatedSources(),
      activeControlId: this.activeControlId,
    };
    const fail = (): boolean => {
      this.restoreSnapshot(rollback);
      this.pendingAdmissionRollback = null;
      revokeAuthorityEntryProofScope(entry);
      return false;
    };
    const control = controlOf(entry);
    if (
      control.kind === "AWAIT_SUCCESSOR"
      && (control.afterOperationId !== entry.operationId || control.epoch !== entry.context.sessionEpoch)
    ) {
      return fail();
    }
    const proofScope = authorityEntryProofScopeOf(entry);
    if (isBoundaryEntry(entry) && !this.hasLiveBoundaryProof(entry, proofScope)) {
      return fail();
    }
    if (priorAdmission == null) {
      const active =
        (this.activeControlId == null ? null : this.claims.get(this.activeControlId)) ?? this.latestUnsupersededClaim();
      if (active != null) {
        if (entry.revision !== active.revision + 1) {
          return fail();
        }
        const ordinarySuccessorAllowed = controlAllowsSuccessorEntry(active.control, active.sourceOperationId, entry);
        if (ordinarySuccessorAllowed && active.installed == null) {
          return fail();
        }
        if (
          !ordinarySuccessorAllowed
          && (active.sourceEntry == null || !this.allowsBoundarySupersession(active.sourceEntry, entry))
        ) {
          return fail();
        }
      }
    }
    if (proofScope?.kind === "authority-retained") {
      const proofSources = this.mergeProofSources(proofScope, entry);
      if (proofSources == null || !this.reconcileAuthenticatedSources(proofSources, entry)) {
        return fail();
      }
    } else if (
      proofScope?.kind === "replica-dense-frontier"
      && (!proofScope.isActive()
        || !sameAuthenticatedSource(proofScope.source, entry)
        || proofScope.source.context.membershipRevision !== entry.context.membershipRevision
        || proofScope.source.context.connectionGeneration !== entry.context.connectionGeneration
        || !this.reconcileAuthenticatedSources(proofScope.authenticatedSources, entry))
    ) {
      return fail();
    }
    const authenticatedSource = this.authenticatedSources.get(entry.revision);
    if (!this.canRegisterAuthenticatedSource(authenticatedSource, entry)) {
      // Never evict an older revision: AuthorityLog may still retain it as exact boundary evidence.
      return fail();
    }
    const controlId = controlIdOf(control);
    const prior = this.claims.get(controlId);
    if (prior != null) {
      const duplicate =
        prior.revision === entry.revision
        && prior.sourceOperationId === entry.operationId
        && controlsEqual(prior.control, control);
      if (duplicate) {
        if (prior.superseded) {
          // A redelivery of an old address must not reopen a superseded lease generation.
          return fail();
        }
        // Refresh only the authenticated channel axes after hot rejoin; mechanical identity was checked above.
        this.authenticatedSources.set(entry.revision, structuredClone(entry));
        if (proofScope != null) {
          consumeReplicaEntryProofScope(entry, proofScope);
        }
        this.pendingAdmissionRollback = null;
        return true;
      }
      // A modal interaction can temporarily supersede command control and then return to the exact same
      // wave/turn/seat frontier. That is a NEW lease generation even though its semantic control address is
      // identical. Keep active/unsuperseded address reuse fail-closed, but replace a provably superseded
      // older claim with the immediately admitted newer revision. Otherwise a legal
      // Command -> Interaction -> AWAIT_SUCCESSOR -> Command chain is permanently unrepresentable.
      if (!prior.superseded || entry.revision <= prior.revision) {
        return fail();
      }
    }
    const sourceEntry = structuredClone(entry);
    this.authenticatedSources.set(entry.revision, sourceEntry);
    this.claims.set(controlId, {
      revision: entry.revision,
      sourceOperationId: entry.operationId,
      sourceEntry: structuredClone(sourceEntry),
      control: structuredClone(control),
      materialApplied: false,
      superseded: false,
      installed: null,
    });
    if (proofScope != null) {
      consumeReplicaEntryProofScope(entry, proofScope);
    }
    this.pendingAdmissionRollback = null;
    return true;
  }

  /**
   * Admit and register one immutable entry as a single exception-safe ledger transaction.
   *
   * `admitSuccessor` may revoke the live predecessor before `registerEntry` clones and records the new
   * claim. Any throw from either half restores the exact pre-admission snapshot and revokes the one-shot
   * entry proof before propagating the fault to the shared terminal owner.
   */
  admitAndRegisterEntry(entry: CoopAuthorityEntry): boolean {
    const rollback = this.pendingAdmissionRollback ?? {
      entry,
      claims: this.cloneClaims(),
      authenticatedSources: this.cloneAuthenticatedSources(),
      activeControlId: this.activeControlId,
    };
    try {
      return this.admitSuccessor(entry) && this.registerEntry(entry);
    } catch (error) {
      this.restoreSnapshot(this.pendingAdmissionRollback ?? rollback);
      this.pendingAdmissionRollback = null;
      revokeAuthorityEntryProofScope(entry);
      throw error;
    }
  }

  /** Mark only the exact registered revision materially complete. */
  markMaterialApplied(entry: CoopAuthorityEntry): boolean {
    const control = controlOf(entry);
    const claim = this.claims.get(controlIdOf(control));
    if (
      claim == null
      || claim.revision !== entry.revision
      || claim.sourceOperationId !== entry.operationId
      || !controlsEqual(claim.control, control)
    ) {
      return false;
    }
    claim.materialApplied = true;
    return true;
  }

  /**
   * Consume the preceding control at exact next-entry admission. AuthorityLog independently enforces the
   * same successor constraint; this clears the UI lease before the new material/projector is allowed to run.
   */
  admitSuccessor(entry: CoopAuthorityEntry): boolean {
    if (this.pendingAdmissionRollback != null) {
      if (this.pendingAdmissionRollback.entry === entry) {
        if (isBoundaryEntry(entry) && !this.hasLiveBoundaryProof(entry, authorityEntryProofScopeOf(entry))) {
          const rollback = this.pendingAdmissionRollback;
          this.restoreSnapshot(rollback);
          this.pendingAdmissionRollback = null;
          revokeAuthorityEntryProofScope(entry);
          return false;
        }
        return true;
      }
      const stale = this.pendingAdmissionRollback;
      this.restoreSnapshot(stale);
      this.pendingAdmissionRollback = null;
      revokeAuthorityEntryProofScope(stale.entry);
    }
    const proofScope = authorityEntryProofScopeOf(entry);
    if (isBoundaryEntry(entry) && !this.hasLiveBoundaryProof(entry, proofScope)) {
      revokeAuthorityEntryProofScope(entry);
      return false;
    }
    const active =
      (this.activeControlId == null ? null : this.claims.get(this.activeControlId)) ?? this.latestUnsupersededClaim();
    if (active == null) {
      return true;
    }
    if (entry.revision !== active.revision + 1) {
      revokeAuthorityEntryProofScope(entry);
      return false;
    }
    const ordinarySuccessorAllowed = controlAllowsSuccessorEntry(active.control, active.sourceOperationId, entry);
    // Ordinary progression consumes a live installed control; an uninstalled predecessor is still a local
    // prepare deferral, not permission to publish the next entry.
    if (ordinarySuccessorAllowed && active.installed == null) {
      revokeAuthorityEntryProofScope(entry);
      return false;
    }
    // A stale wave/terminal boundary is the deliberate exception to the installed-control prerequisite:
    // its exact retained/proven source-entry + canonical subsumes proof is what releases the circular wait.
    // No generic successor reaches this branch, and any later prepare failure restores this claim snapshot.
    if (
      !ordinarySuccessorAllowed
      && (active.sourceEntry == null || !this.allowsBoundarySupersession(active.sourceEntry, entry))
    ) {
      revokeAuthorityEntryProofScope(entry);
      return false;
    }
    this.pendingAdmissionRollback = {
      entry,
      claims: this.cloneClaims(),
      authenticatedSources: this.cloneAuthenticatedSources(),
      activeControlId: this.activeControlId,
    };
    active.superseded = true;
    this.activeControlId = null;
    return true;
  }

  /**
   * Install/prove a successor. An executable surface needs the exact actionable phase+handler observation;
   * a sequencing wait installs no UI and consequently grants no human input.
   */
  project(
    control: CoopV2InteractionControl,
    observation: CoopV2InteractionSurfaceObservation | null,
    localSeatId = control.kind === "SHARED_INTERACTION" || control.kind === "REPLACEMENT" ? control.ownerSeatId : -1,
  ): CoopControlInstallResult {
    const controlId = controlIdOf(control);
    const claim = this.claims.get(controlId);
    if (claim == null || claim.superseded || !controlsEqual(claim.control, control)) {
      return { kind: "rejected", reason: `no authenticated interaction claim owns ${controlId}` };
    }
    if (!claim.materialApplied) {
      return { kind: "deferred", reason: `interaction material is not applied for ${controlId}` };
    }
    if (control.kind === "AWAIT_SUCCESSOR") {
      const alreadyInstalled = claim.installed != null;
      if (!alreadyInstalled) {
        claim.installed = { controlId, observation: { kind: "ordered-wait" } };
      }
      this.activeControlId = controlId;
      return alreadyInstalled ? { kind: "already-installed", controlId } : { kind: "installed", controlId };
    }
    const isOwner = localSeatId === control.ownerSeatId;
    if (control.kind === "REPLACEMENT" && !isOwner) {
      const alreadyInstalled = claim.installed != null;
      if (!alreadyInstalled) {
        claim.installed = { controlId, observation: { kind: "ordered-wait" } };
      }
      this.activeControlId = controlId;
      return alreadyInstalled ? { kind: "already-installed", controlId } : { kind: "installed", controlId };
    }
    if (observation == null || !observation.handlerActive || (isOwner && !observation.actionable)) {
      return {
        kind: "deferred",
        reason: isOwner
          ? `exact owner interaction handler is not actionable for ${controlId}`
          : `exact watcher interaction handler is not active for ${controlId}`,
      };
    }
    if (observation.operationId !== control.operationId) {
      return {
        kind: "deferred",
        reason:
          `live interaction address ${observation.operationId ?? "(missing)"}`
          + ` does not match ${control.operationId}`,
      };
    }
    const installed = claim.installed;
    if (installed?.observation.kind === "authority-proposal-wait") {
      // A cosmetic authority-side phase can become visible after the exact
      // remote ingress was armed. It must never replace that stronger proof
      // with a watcher UI token.
      this.activeControlId = controlId;
      return { kind: "already-installed", controlId };
    }
    if (installed?.observation.kind === (isOwner ? "executable" : "watcher")) {
      if (installed.observation.phaseToken === observation.phaseToken) {
        // One semantic interaction can legitimately advance across public handlers (for example LearnMove
        // CONFIRM -> SUMMARY) without changing its operation or phase generation. An explicit ready proof
        // may rebind that SAME phase token to its new contract-checked handler. A different phase token is
        // still a new generation and can never inherit the old control lease.
        claim.installed = {
          controlId,
          observation: {
            kind: isOwner ? "executable" : "watcher",
            phaseName: observation.phaseName,
            uiMode: observation.uiMode,
            phaseToken: observation.phaseToken,
            handlerToken: observation.handlerToken,
          },
        };
        this.activeControlId = controlId;
        return { kind: "already-installed", controlId };
      }
      return { kind: "deferred", reason: `the actionable phase/handler generation changed for ${controlId}` };
    }
    claim.installed = {
      controlId,
      observation: {
        kind: isOwner ? "executable" : "watcher",
        phaseName: observation.phaseName,
        uiMode: observation.uiMode,
        phaseToken: observation.phaseToken,
        handlerToken: observation.handlerToken,
      },
    };
    this.activeControlId = controlId;
    return { kind: "installed", controlId };
  }

  /**
   * Prove the authority's exact proposal-ingress surface for a remote-owned interaction.
   *
   * The runtime derives `relaySequence` and `acceptedKinds` from the immutable
   * projection capsule before calling this method. The ledger then binds that
   * verified address to one live waiter token. It never grants local human
   * input, and it cannot be used for a locally-owned control.
   */
  projectAuthorityProposalWait(
    control: Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }>,
    observation: CoopV2AuthorityProposalWaitObservation,
    localSeatId: number,
  ): CoopControlInstallResult {
    const controlId = controlIdOf(control);
    const claim = this.claims.get(controlId);
    if (claim == null || claim.superseded || !controlsEqual(claim.control, control)) {
      return { kind: "rejected", reason: `no authenticated remote interaction claim owns ${controlId}` };
    }
    if (!claim.materialApplied) {
      return { kind: "deferred", reason: `remote interaction material is not applied for ${controlId}` };
    }
    if (localSeatId === control.ownerSeatId) {
      return { kind: "rejected", reason: `owner seat ${localSeatId} cannot install a remote proposal wait` };
    }
    if (
      !observation.active
      || observation.controlOperationId !== control.operationId
      || !Number.isSafeInteger(observation.relaySequence)
      || observation.relaySequence < 0
      || observation.acceptedKinds.length === 0
      || observation.acceptedKinds.some(kind => typeof kind !== "string" || kind.length === 0)
      || new Set(observation.acceptedKinds).size !== observation.acceptedKinds.length
      || (observation.expectedRewardSurface != null
        && (!Number.isSafeInteger(observation.expectedRewardSurface.ordinal)
          || observation.expectedRewardSurface.ordinal < 0
          || typeof observation.expectedRewardSurface.surfaceId !== "string"
          || observation.expectedRewardSurface.surfaceId.length === 0))
    ) {
      return { kind: "deferred", reason: `exact remote proposal waiter is not active for ${controlId}` };
    }
    const installed = claim.installed?.observation;
    if (installed?.kind === "authority-proposal-wait") {
      if (
        installed.waiterToken === observation.waiterToken
        && installed.relaySequence === observation.relaySequence
        && installed.acceptedKinds.length === observation.acceptedKinds.length
        && installed.acceptedKinds.every((kind, index) => kind === observation.acceptedKinds[index])
        && sameRewardSurface(installed.expectedRewardSurface, observation.expectedRewardSurface)
      ) {
        this.activeControlId = controlId;
        return { kind: "already-installed", controlId };
      }
      return { kind: "deferred", reason: `remote proposal waiter generation changed for ${controlId}` };
    }
    if (installed != null) {
      return { kind: "deferred", reason: `a different control proof already owns ${controlId}` };
    }
    claim.installed = {
      controlId,
      observation: {
        kind: "authority-proposal-wait",
        relaySequence: observation.relaySequence,
        acceptedKinds: [...observation.acceptedKinds],
        expectedRewardSurface:
          observation.expectedRewardSurface == null
            ? observation.expectedRewardSurface
            : { ...observation.expectedRewardSurface },
        waiterToken: observation.waiterToken,
      },
    };
    this.activeControlId = controlId;
    return { kind: "installed", controlId };
  }

  /** Retire only the exact remote waiter generation that timed out or was cancelled. */
  revokeAuthorityProposalWait(
    control: Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }>,
    waiterToken: object,
  ): boolean {
    const controlId = controlIdOf(control);
    const claim = this.claims.get(controlId);
    if (
      claim == null
      || claim.superseded
      || !controlsEqual(claim.control, control)
      || claim.installed?.observation.kind !== "authority-proposal-wait"
      || claim.installed.observation.waiterToken !== waiterToken
    ) {
      return false;
    }
    claim.installed = null;
    if (this.activeControlId === controlId) {
      this.activeControlId = null;
    }
    return true;
  }

  /** Whether this exact unsuperseded control is owned by a live remote-input waiter proof. */
  isAuthorityProposalWaitInstalled(
    control: Extract<CoopV2InteractionControl, { kind: "SHARED_INTERACTION" }>,
  ): boolean {
    const claim = this.claims.get(controlIdOf(control));
    return (
      claim != null
      && !claim.superseded
      && controlsEqual(claim.control, control)
      && claim.installed?.observation.kind === "authority-proposal-wait"
    );
  }

  /**
   * Authenticate any non-interaction projector through the same entry/material claim. The installer may
   * consult engine-specific state, but it cannot manufacture a receipt for an unclaimed, superseded, or
   * not-yet-materialized successor, and its returned address must equal the immutable control address.
   */
  projectMechanical(
    control: Exclude<CoopV2ClaimedControl, CoopV2InteractionControl>,
    install: () => CoopControlInstallResult,
  ): CoopControlInstallResult {
    const controlId = controlIdOf(control);
    const claim = this.claims.get(controlId);
    if (claim == null || claim.superseded || !controlsEqual(claim.control, control)) {
      return { kind: "rejected", reason: `no authenticated global control claim owns ${controlId}` };
    }
    if (!claim.materialApplied) {
      return { kind: "deferred", reason: `authoritative material is not applied for ${controlId}` };
    }
    if (claim.installed?.observation.kind === "mechanical") {
      this.activeControlId = controlId;
      return { kind: "already-installed", controlId };
    }
    const result = install();
    if ((result.kind === "installed" || result.kind === "already-installed") && result.controlId !== controlId) {
      return {
        kind: "rejected",
        reason: `mechanical projector installed ${result.controlId}, expected ${controlId}`,
      };
    }
    if (result.kind === "installed" || result.kind === "already-installed") {
      claim.installed = { controlId, observation: { kind: "mechanical" } };
      this.activeControlId = controlId;
    }
    return result;
  }

  /** Whether a physical human input is authorized at this exact live phase/handler generation. */
  allowsHumanInput(localSeatId: number, observation: CoopV2InteractionSurfaceObservation | null): boolean {
    if (this.activeControlId == null || observation == null) {
      return false;
    }
    const claim = this.claims.get(this.activeControlId);
    const installed = claim?.installed?.observation;
    return (
      (claim?.control.kind === "SHARED_INTERACTION" || claim?.control.kind === "REPLACEMENT")
      && claim.control.ownerSeatId === localSeatId
      && installed?.kind === "executable"
      && installed.phaseToken === observation.phaseToken
      && installed.handlerToken === observation.handlerToken
      && installed.phaseName === observation.phaseName
      && installed.uiMode === observation.uiMode
      && observation.handlerActive
      && observation.actionable
    );
  }

  get activeControl(): CoopV2ClaimedControl | null {
    if (this.activeControlId == null) {
      return null;
    }
    return this.claims.get(this.activeControlId)?.control ?? null;
  }

  /** Highest registered interaction successor, used to retry a deferred authority-local public surface. */
  get latestControl(): CoopV2ClaimedControl | null {
    return this.latestUnsupersededClaim()?.control ?? null;
  }

  /** Exact immutable entry behind one unsuperseded control, used by ordinary and recovery projection. */
  sourceEntryOf(control: CoopV2ClaimedControl): CoopAuthorityEntry | null {
    const claim = this.claims.get(controlIdOf(control));
    return claim != null && !claim.superseded && controlsEqual(claim.control, control)
      ? structuredClone(claim.sourceEntry)
      : null;
  }

  /** Whether the exact unsuperseded control's immutable material has really applied. */
  isMaterialApplied(control: CoopV2ClaimedControl): boolean {
    const claim = this.claims.get(controlIdOf(control));
    return claim != null && !claim.superseded && claim.materialApplied && controlsEqual(claim.control, control);
  }

  /**
   * Adopt the terminal entry of a validated recovery tail. The snapshot replaces every older control
   * generation atomically; only this exact frontier claim survives and it starts materially applied but
   * uninstalled so the ordinary projector must prove the real current surface.
   */
  adoptRecoveryFrontier(entry: CoopAuthorityEntry | null): boolean {
    this.clear();
    return entry == null || this.adoptRecoveryControl(entry.revision, entry.operationId, entry.nextControl, entry);
  }

  /**
   * Replace every old engine-generation proof with one materially-applied, deliberately uninstalled claim.
   *
   * A non-interaction frontier may be reconstructed from its typed control plus the recovered battle image.
   * A SHARED_INTERACTION is deliberately stricter: its phase-local immutable presentation must be supplied
   * as the exact source entry, or recovery would have to guess from ambient state.
   */
  adoptRecoveryControl(
    revision: number,
    sourceOperationId: string,
    control: CoopV2ClaimedControl,
    sourceEntry: CoopAuthorityEntry | null = null,
  ): boolean {
    this.clear();
    if (
      !Number.isSafeInteger(revision)
      || revision <= 0
      || sourceOperationId.length === 0
      || (control.kind === "AWAIT_SUCCESSOR" && control.afterOperationId !== sourceOperationId)
      || (control.kind === "SHARED_INTERACTION" && sourceEntry == null)
      || (sourceEntry != null
        && (sourceEntry.revision !== revision
          || sourceEntry.operationId !== sourceOperationId
          || !controlsEqual(sourceEntry.nextControl, control)))
    ) {
      return false;
    }
    if (sourceEntry != null) {
      this.authenticatedSources.set(revision, structuredClone(sourceEntry));
    }
    const controlId = controlIdOf(control);
    this.claims.set(controlId, {
      revision,
      sourceOperationId,
      sourceEntry: sourceEntry == null ? null : structuredClone(sourceEntry),
      control: structuredClone(control),
      materialApplied: true,
      superseded: false,
      installed: null,
    });
    return true;
  }

  clear(): void {
    this.claims.clear();
    this.authenticatedSources.clear();
    this.activeControlId = null;
    this.pendingAdmissionRollback = null;
  }

  /** Bounded proof count exposed for lifecycle/capacity diagnostics without leaking source material. */
  get authenticatedSourceCount(): number {
    return this.authenticatedSources.size;
  }

  private restoreSnapshot(snapshot: ControlLedgerSnapshot): void {
    this.claims.clear();
    for (const [controlId, claim] of snapshot.claims) {
      this.claims.set(controlId, claim);
    }
    this.authenticatedSources.clear();
    for (const [revision, source] of snapshot.authenticatedSources) {
      this.authenticatedSources.set(revision, source);
    }
    this.activeControlId = snapshot.activeControlId;
  }

  private latestUnsupersededClaim(): InteractionControlClaim | null {
    let latest: InteractionControlClaim | null = null;
    for (const claim of this.claims.values()) {
      if (!claim.superseded && (latest == null || claim.revision > latest.revision)) {
        latest = claim;
      }
    }
    return latest;
  }

  /**
   * The authority log proves the exact retained list. The local ledger resolves
   * every claimed revision from its independent authenticated revision archive,
   * so reusable control-address replacement cannot erase boundary evidence.
   */
  private allowsBoundarySupersession(
    predecessor: CoopBoundarySupersessionEntry,
    successor: CoopBoundarySupersessionEntry,
  ): boolean {
    const proofScope = authorityEntryProofScopeOf(successor as CoopAuthorityEntry);
    if (proofScope?.kind === "replica-dense-frontier") {
      // This privilege is attached by AuthorityLog.admit to this exact object identity only. The log has
      // supplied the complete retained frontier; numeric cursor bounds are never enough for a bypass.
      return (
        proofScope.isActive()
        && sameAuthenticatedSource(proofScope.source, successor as CoopAuthorityEntry)
        && proofScope.source.context.membershipRevision === successor.context.membershipRevision
        && proofScope.source.context.connectionGeneration === successor.context.connectionGeneration
        && boundarySupersessionAllowsSuccessorEntry(predecessor, successor, proofScope.trustedSources)
      );
    }
    if (proofScope?.kind !== "authority-retained") {
      return false;
    }
    const trusted = this.mergeProofSources(proofScope, successor as CoopAuthorityEntry);
    return trusted != null && boundarySupersessionAllowsSuccessorEntry(predecessor, successor, trusted);
  }

  /** Boundary kinds are never self-authenticating, including when recovery left no active predecessor claim. */
  private hasLiveBoundaryProof(entry: CoopAuthorityEntry, proofScope: AuthorityEntryProofScope | null): boolean {
    if (proofScope?.kind === "authority-retained") {
      return true;
    }
    return (
      proofScope?.kind === "replica-dense-frontier"
      && proofScope.isActive()
      && sameAuthenticatedSource(proofScope.source, entry)
      && proofScope.source.context.membershipRevision === entry.context.membershipRevision
      && proofScope.source.context.connectionGeneration === entry.context.connectionGeneration
    );
  }

  /** Merge only the exact initially approved boundary list into the current live-retention snapshot. */
  private mergeProofSources(
    scope: Extract<AuthorityEntryProofScope, { readonly kind: "authority-retained" }>,
    candidate: CoopAuthorityEntry,
  ): readonly CoopAuthorityEntry[] | null {
    const boundarySources = scope.boundarySources;
    if (
      boundarySources != null
      && (boundarySources.length !== candidate.subsumes.length
        || boundarySources.some((source, index) => source.revision !== candidate.subsumes[index]))
    ) {
      return null;
    }
    const merged = new Map<number, CoopAuthorityEntry>();
    for (const source of [...scope.retainedSources, ...(boundarySources ?? [])]) {
      const prior = merged.get(source.revision);
      if (prior != null && !sameAuthenticatedSource(prior, source)) {
        return null;
      }
      if (prior == null) {
        merged.set(source.revision, source);
        continue;
      }
      const sourceIsNewer =
        source.context.membershipRevision >= prior.context.membershipRevision
        && source.context.connectionGeneration >= prior.context.connectionGeneration;
      const priorIsNewer =
        prior.context.membershipRevision >= source.context.membershipRevision
        && prior.context.connectionGeneration >= source.context.connectionGeneration;
      if (!sourceIsNewer && !priorIsNewer) {
        return null;
      }
      if (sourceIsNewer) {
        merged.set(source.revision, source);
      }
    }
    return [...merged.values()];
  }

  /**
   * Replace history with AuthorityLog's exact live proof set. This is the only pruning path for ordinary
   * chains: no age/capacity eviction guesses whether a still-retained revision is safe to discard.
   */
  private reconcileAuthenticatedSources(
    retainedSources: readonly CoopAuthorityEntry[],
    candidate: CoopAuthorityEntry,
  ): boolean {
    if (retainedSources.length > this.authenticatedSourceCapacity) {
      return false;
    }
    const next = new Map<number, CoopAuthorityEntry>();
    for (const source of retainedSources) {
      if (next.has(source.revision)) {
        return false;
      }
      const prior = this.authenticatedSources.get(source.revision);
      if (prior != null) {
        if (!sameAuthenticatedSource(prior, source)) {
          return false;
        }
        const sourceIsNewer =
          source.context.membershipRevision >= prior.context.membershipRevision
          && source.context.connectionGeneration >= prior.context.connectionGeneration;
        const priorIsNewer =
          prior.context.membershipRevision >= source.context.membershipRevision
          && prior.context.connectionGeneration >= source.context.connectionGeneration;
        if (!sourceIsNewer && !priorIsNewer) {
          return false;
        }
        next.set(source.revision, structuredClone(sourceIsNewer ? source : prior));
        continue;
      }
      next.set(source.revision, structuredClone(source));
    }
    const retainedCandidate = next.get(candidate.revision);
    if (
      retainedCandidate == null
      || !sameAuthenticatedSource(retainedCandidate, candidate)
      || retainedCandidate.context.membershipRevision !== candidate.context.membershipRevision
      || retainedCandidate.context.connectionGeneration !== candidate.context.connectionGeneration
    ) {
      return false;
    }
    this.authenticatedSources.clear();
    for (const [revision, source] of next) {
      this.authenticatedSources.set(revision, source);
    }
    return true;
  }

  private canRegisterAuthenticatedSource(prior: CoopAuthorityEntry | undefined, entry: CoopAuthorityEntry): boolean {
    if (prior == null) {
      return this.authenticatedSources.size < this.authenticatedSourceCapacity;
    }
    return this.canRefreshAuthenticatedSource(prior, entry);
  }

  private canRefreshAuthenticatedSource(prior: CoopAuthorityEntry, entry: CoopAuthorityEntry): boolean {
    return (
      sameAuthenticatedSource(prior, entry)
      && entry.context.membershipRevision >= prior.context.membershipRevision
      && entry.context.connectionGeneration >= prior.context.connectionGeneration
    );
  }

  /** Snapshot mutable claim flags while preserving the opaque live phase/handler identities by reference. */
  private cloneClaims(): Map<string, InteractionControlClaim> {
    return new Map(
      [...this.claims].map(([controlId, claim]) => [
        controlId,
        {
          ...claim,
          sourceEntry: claim.sourceEntry == null ? null : structuredClone(claim.sourceEntry),
          control: structuredClone(claim.control),
          installed:
            claim.installed == null
              ? null
              : {
                  ...claim.installed,
                  observation: { ...claim.installed.observation },
                },
        },
      ]),
    );
  }

  private cloneAuthenticatedSources(): Map<number, CoopAuthorityEntry> {
    return new Map([...this.authenticatedSources].map(([revision, source]) => [revision, structuredClone(source)]));
  }
}

function sameAuthenticatedSource(left: CoopAuthorityEntry, right: CoopAuthorityEntry): boolean {
  return (
    left.revision === right.revision
    && left.operationId === right.operationId
    && left.kind === right.kind
    && left.material.digest === right.material.digest
    && JSON.stringify(left.material.payload) === JSON.stringify(right.material.payload)
    && controlsEqual(left.nextControl, right.nextControl)
    && left.subsumes.length === right.subsumes.length
    && left.subsumes.every((revision, index) => revision === right.subsumes[index])
    && left.context.sessionId === right.context.sessionId
    && left.context.runId === right.context.runId
    && left.context.sessionEpoch === right.context.sessionEpoch
    && left.context.seatMapId === right.context.seatMapId
    && left.context.senderSeatId === right.context.senderSeatId
    && left.context.authoritySeatId === right.context.authoritySeatId
  );
}

/** @deprecated Transitional test/import alias; production owns one global V2 control ledger. */
export { CoopV2ControlLedger as CoopV2InteractionControlLedger };
