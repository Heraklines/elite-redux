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

import type { CoopAuthorityEntry, CoopControlInstallResult } from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlAllowsSuccessorEntry,
  controlIdOf,
  controlsEqual,
  type ProjectableControl,
} from "#data/elite-redux/coop/authority-v2/next-control";

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
        };
  } | null;
}

function controlOf(entry: CoopAuthorityEntry): CoopV2ClaimedControl {
  return entry.nextControl;
}

/** Per-runtime global control ledger; never shared between the two in-process browser engines. */
export class CoopV2ControlLedger {
  private readonly claims = new Map<string, InteractionControlClaim>();
  private activeControlId: string | null = null;

  /**
   * Atomically reserve an authority-authored entry before it is published. This is the local half of the
   * global commit transaction: predecessor consumption, successor registration, and the authority's already
   * applied material fact either become visible together or the exact prior ledger is restored.
   */
  prepareAuthorityEntry(entry: CoopAuthorityEntry): (() => void) | null {
    const priorClaims = this.cloneClaims();
    const priorActiveControlId = this.activeControlId;
    const restore = (): void => {
      this.claims.clear();
      for (const [controlId, claim] of priorClaims) {
        this.claims.set(controlId, claim);
      }
      this.activeControlId = priorActiveControlId;
    };
    if (!this.admitSuccessor(entry) || !this.registerEntry(entry) || !this.markMaterialApplied(entry)) {
      restore();
      return null;
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
    const control = controlOf(entry);
    if (
      control.kind === "AWAIT_SUCCESSOR"
      && (control.afterOperationId !== entry.operationId || control.epoch !== entry.context.sessionEpoch)
    ) {
      return false;
    }
    const controlId = controlIdOf(control);
    const prior = this.claims.get(controlId);
    if (prior != null) {
      return (
        prior.revision === entry.revision
        && prior.sourceOperationId === entry.operationId
        && controlsEqual(prior.control, control)
      );
    }
    this.claims.set(controlId, {
      revision: entry.revision,
      sourceOperationId: entry.operationId,
      sourceEntry: structuredClone(entry),
      control: structuredClone(control),
      materialApplied: false,
      superseded: false,
      installed: null,
    });
    return true;
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
    const active =
      (this.activeControlId == null ? null : this.claims.get(this.activeControlId)) ?? this.latestUnsupersededClaim();
    if (active == null) {
      return true;
    }
    if (active.installed == null || entry.revision !== active.revision + 1) {
      return false;
    }
    if (!controlAllowsSuccessorEntry(active.control, active.sourceOperationId, entry)) {
      return false;
    }
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
    this.activeControlId = null;
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
}

/** @deprecated Transitional test/import alias; production owns one global V2 control ledger. */
export { CoopV2ControlLedger as CoopV2InteractionControlLedger };
