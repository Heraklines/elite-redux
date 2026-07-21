/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - CUTOVER SURFACE 2 (faint/replacement).
//
// A replacement has two distinct moments:
//   1. the authority resolves the owner's proposal while the faint picker is open;
//   2. SwitchSummonPhase finishes and a COMPLETE post-summon carrier exists.
//
// Committing at (1) authenticates only the pick and recreates the live legacy
// split-brain: the guest still needs a separately-retained battleCheckpoint to
// materialize party order, field membership, HP/status, moves/PP, items, arena
// state, and the successor command surface. This switchboard therefore STAGES the
// typed resolution at (1), then commits it at (2) with the complete carrier. Once
// committed, the V2 log is the sole retained/redelivered authority; the legacy
// operation journal and replacement-checkpoint retry/ACK loops are not a second
// authority.
//
// The controller owns its pending map per runtime. The one module-level reference
// below is only the active-runtime selector used by cycle-free legacy seams; the
// duo harness swaps it whenever it swaps runtimes.
// =============================================================================

import type { ReplacementAuthorityCarrier } from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import {
  replacementImageDigest,
  replacementOperationId,
  toReplacementCommitImage,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import type {
  CoopAuthorityEntry,
  CoopCommandControlTarget,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopAuthorityV2Shadow, CoopV2ShadowReplacementTap } from "#data/elite-redux/coop/authority-v2/shadow";

const viteEnv = import.meta.env as unknown as Record<string, string | undefined>;
const COOP_V2_REPLACEMENT_ENABLED =
  viteEnv.VITE_COOP_AUTHORITY_V2_REPLACEMENT === "on"
  || (typeof process !== "undefined" && process.env?.COOP_AUTHORITY_V2_REPLACEMENT === "on");

/** Whether this build advertises the Authority V2 replacement cutover (default OFF). */
export function isCoopV2ReplacementEnabled(): boolean {
  return COOP_V2_REPLACEMENT_ENABLED;
}

export type CoopReplacementAuthorityMode = "legacy" | "v2";

export interface CoopReplacementAuthorityInputs {
  readonly buildEnabled: boolean;
  readonly negotiated: boolean;
  readonly harnessPresent: boolean;
}

/** Fail closed: every prerequisite must be true before legacy replacement authority can be retired. */
export function resolveCoopReplacementAuthorityMode(
  inputs: CoopReplacementAuthorityInputs,
): CoopReplacementAuthorityMode {
  return inputs.buildEnabled && inputs.negotiated && inputs.harnessPresent ? "v2" : "legacy";
}

/** The legacy operation-journal terminal is replaced by the staged+committed V2 transaction. */
export function suppressesLegacyFaintOperationAuthority(mode: CoopReplacementAuthorityMode): boolean {
  return mode === "v2";
}

/** The legacy battleCheckpoint retention/resend loop is replaced by the V2 log delivery lease. */
export function suppressesLegacyReplacementResend(mode: CoopReplacementAuthorityMode): boolean {
  return mode === "v2";
}

/** A guest recovery request is satisfied by V2 redelivery, never a second retained checkpoint authority. */
export function suppressesLegacyReplacementRequest(mode: CoopReplacementAuthorityMode): boolean {
  return mode === "v2";
}

/** Legacy staged ACKs produced by the mechanical compatibility seam do not own V2 retirement. */
export function suppressesLegacyReplacementAckProgression(mode: CoopReplacementAuthorityMode): boolean {
  return mode === "v2";
}

type StagedReplacementTap = Omit<CoopV2ShadowReplacementTap, "authorityCarrier" | "successor" | "legacyImage"> & {
  readonly legacyImage?: Omit<NonNullable<CoopV2ShadowReplacementTap["legacyImage"]>, "authorityCarrier">;
};

export interface CoopV2ReplacementCommitBatch {
  readonly authorityCarrier: ReplacementAuthorityCarrier;
  /** Exact currently-executable replacement head authored by the preceding mechanical entry. */
  readonly activeControl: Extract<CoopNextControl, { kind: "REPLACEMENT" }>;
  /** Exact mechanical successor command frontier after the final same-boundary faint is materialized. */
  readonly commands: readonly CoopCommandControlTarget[];
}

export type CoopV2ReplacementBatchResult =
  | { readonly kind: "no-pending" }
  | { readonly kind: "committed"; readonly entries: readonly CoopAuthorityEntry[] }
  | { readonly kind: "failed-clean" };

export class CoopV2ReplacementCutover {
  private readonly harness: CoopAuthorityV2Shadow;
  private readonly pending = new Map<string, { readonly digest: string; readonly tap: StagedReplacementTap }>();
  private disposed = false;

  constructor(harness: CoopAuthorityV2Shadow) {
    this.harness = harness;
  }

  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.harness.authenticatedFrameContext;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Stage one resolved proposal without committing authority before SwitchSummonPhase. Idempotent for the
   * same immutable answer; a conflicting answer for the same window is rejected rather than overwritten.
   */
  stageHostReplacement(input: StagedReplacementTap): boolean {
    if (this.disposed) {
      return false;
    }
    const operationId =
      input.operationId ?? replacementOperationId(input.proposal.sourceAddress, input.proposal.ownerSeatId);
    const digest = replacementImageDigest(toReplacementCommitImage(input.proposal, input.resolution));
    const prior = this.pending.get(operationId);
    if (prior != null) {
      return prior.digest === digest;
    }
    this.pending.set(operationId, {
      digest,
      tap: {
        ...input,
        operationId,
        ...(input.legacyImage == null
          ? {}
          : {
              legacyImage: {
                proposal: input.legacyImage.proposal,
                resolution: input.legacyImage.resolution,
              },
            }),
      },
    });
    return true;
  }

  /**
   * Commit exactly the active proposal whose post-summon carrier just materialized. Same-turn multi-faints
   * are an ordered chain: this entry installs the next executable REPLACEMENT head, while the final entry
   * states the complete post-summon COMMAND frontier at the carrier's actual (possibly N+1) battle address.
   */
  commitStagedHostReplacements(batch: CoopV2ReplacementCommitBatch): CoopV2ReplacementBatchResult {
    if (this.disposed) {
      return { kind: "failed-clean" };
    }
    const carrierWave = batch.authorityCarrier.wave;
    const carrierTurn = batch.authorityCarrier.turn;
    const carrierEpoch = batch.authorityCarrier.epoch;
    if (
      typeof carrierEpoch !== "number"
      || typeof carrierWave !== "number"
      || typeof carrierTurn !== "number"
      || !Number.isSafeInteger(carrierEpoch)
      || !Number.isSafeInteger(carrierWave)
      || !Number.isSafeInteger(carrierTurn)
      || carrierEpoch <= 0
      || carrierWave <= 0
      || carrierTurn <= 0
    ) {
      return { kind: "failed-clean" };
    }
    const active = batch.activeControl;
    const staged = this.pending.get(active.operationId);
    if (staged == null) {
      return { kind: "no-pending" };
    }
    const current = staged.tap;
    const source = current.proposal.sourceAddress;
    if (
      source.epoch !== active.epoch
      || source.wave !== active.wave
      || source.turn !== active.turn
      || source.occurrence !== active.occurrence
      || source.fieldIndex !== active.fieldIndex
      || current.proposal.ownerSeatId !== active.ownerSeatId
      || source.epoch !== carrierEpoch
      || source.wave !== carrierWave
      || (source.turn !== carrierTurn && source.turn + 1 !== carrierTurn)
    ) {
      return { kind: "failed-clean" };
    }
    const [next, ...remaining] = active.remaining;
    const successor =
      next == null
        ? batch.commands.length === 0
          ? ({ kind: "terminal" } as const)
          : ({
              kind: "resume-command-frontier",
              epoch: carrierEpoch,
              wave: carrierWave,
              turn: carrierTurn,
              commands: batch.commands,
            } as const)
        : ({
            kind: "next-replacement",
            control: {
              kind: "REPLACEMENT",
              ...next,
              remaining,
            },
          } as const);
    const entry = this.harness.tapReplacementCommit({
      ...current,
      authorityCarrier: batch.authorityCarrier,
      successor,
      legacyImage: {
        proposal: current.proposal,
        resolution: current.resolution,
        authorityCarrier: batch.authorityCarrier,
      },
    });
    if (entry == null) {
      return { kind: "failed-clean" };
    }
    this.pending.delete(active.operationId);
    return { kind: "committed", entries: [entry] };
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
  }
}

let activeCutover: CoopV2ReplacementCutover | null = null;

export function setActiveCoopV2ReplacementCutover(cutover: CoopV2ReplacementCutover): void {
  activeCutover = cutover;
}

export function clearActiveCoopV2ReplacementCutover(cutover?: CoopV2ReplacementCutover): void {
  if (cutover == null || activeCutover === cutover) {
    activeCutover = null;
  }
}

export function getActiveCoopV2ReplacementCutover(): CoopV2ReplacementCutover | null {
  return activeCutover;
}

export function isCoopV2ReplacementCutoverActive(): boolean {
  return activeCutover != null;
}

export function activeCoopReplacementAuthorityMode(): CoopReplacementAuthorityMode {
  return activeCutover == null ? "legacy" : "v2";
}
