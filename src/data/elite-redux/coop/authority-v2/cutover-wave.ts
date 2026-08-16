/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - CUTOVER SURFACE 3 (wave advance + run terminal).
//
// The old wave boundary had three possible authorities: raw waveResolved /
// waveEndState carriers, the durable opSurface.wave journal, and locally-derived
// Phaser tails. This switchboard makes the V2 log the only retained authority.
// Raw carriers remain presentation diagnostics; the legacy operation journal is
// suppressed. The replica adopts the complete host carrier and proves the real
// stated destination before the log retires the entry.
// =============================================================================

import type { AuthorityCommitDisposition } from "#data/elite-redux/coop/authority-v2/authority-log";
import type { CoopAuthorityEntry, CoopFrameContextV2 } from "#data/elite-redux/coop/authority-v2/contract";
import type {
  CoopAuthorityV2Shadow,
  CoopV2ShadowTerminalTap,
  CoopV2ShadowWaveTap,
} from "#data/elite-redux/coop/authority-v2/shadow";

const viteEnv = import.meta.env as unknown as Record<string, string | undefined>;
const COOP_V2_WAVE_ENABLED =
  viteEnv.VITE_COOP_AUTHORITY_V2_WAVE === "on"
  || (typeof process !== "undefined" && process.env?.COOP_AUTHORITY_V2_WAVE === "on");

/** Whether this build advertises the Authority V2 wave/terminal cutover (default OFF). */
export function isCoopV2WaveEnabled(): boolean {
  return COOP_V2_WAVE_ENABLED;
}

export type CoopWaveAuthorityModeV2 = "legacy" | "v2";

export interface CoopWaveAuthorityInputsV2 {
  readonly buildEnabled: boolean;
  readonly negotiated: boolean;
  readonly harnessPresent: boolean;
}

type CoopWaveAdvanceEntry = Extract<CoopAuthorityEntry, { kind: "WAVE_ADVANCE" }>;
type CoopTerminalCommitEntry = Extract<CoopAuthorityEntry, { kind: "TERMINAL_COMMIT" }>;

/** Typed result for a WAVE_ADVANCE authority commit, including an exact deferred image. */
export type CoopV2WaveCommitDisposition =
  | { readonly kind: "committed"; readonly entry: CoopWaveAdvanceEntry }
  | {
      readonly kind: "deferred";
      readonly entry: CoopWaveAdvanceEntry;
      readonly reason: "predecessor-control-not-installed";
    }
  | { readonly kind: "failed"; readonly reason: string };

/** Typed result for a TERMINAL_COMMIT authority commit, including an exact deferred image. */
export type CoopV2TerminalCommitDisposition =
  | { readonly kind: "committed"; readonly entry: CoopTerminalCommitEntry }
  | {
      readonly kind: "deferred";
      readonly entry: CoopTerminalCommitEntry;
      readonly reason: "predecessor-control-not-installed";
    }
  | { readonly kind: "failed"; readonly reason: string };

export type CoopV2WaveTerminalCommitDisposition = CoopV2WaveCommitDisposition | CoopV2TerminalCommitDisposition;

/** Fail closed: legacy authority is retired only when every V2 prerequisite is present. */
export function resolveCoopWaveAuthorityModeV2(inputs: CoopWaveAuthorityInputsV2): CoopWaveAuthorityModeV2 {
  return inputs.buildEnabled && inputs.negotiated && inputs.harnessPresent ? "v2" : "legacy";
}

/** V2 delivery leases replace the durable opSurface.wave retention/resend ledger. */
export function suppressesLegacyWaveOperationAuthority(mode: CoopWaveAuthorityModeV2): boolean {
  return mode === "v2";
}

/** Raw waveResolved and waveEndState frames are presentation-only after cutover. */
export function suppressesLegacyWaveCorrectnessCarrier(mode: CoopWaveAuthorityModeV2): boolean {
  return mode === "v2";
}

/** The guest adopts the V2 transition directly; it must not re-admit it through the legacy op guest. */
export function suppressesLegacyWaveWatcherAdoption(mode: CoopWaveAuthorityModeV2): boolean {
  return mode === "v2";
}

export class CoopV2WaveCutover {
  private readonly harness: CoopAuthorityV2Shadow;
  private pending:
    | {
        readonly kind: "wave";
        readonly input: CoopV2ShadowWaveTap;
        readonly entry: CoopWaveAdvanceEntry;
      }
    | {
        readonly kind: "terminal";
        readonly input: CoopV2ShadowTerminalTap;
        readonly entry: CoopTerminalCommitEntry;
      }
    | null = null;
  private disposed = false;

  constructor(harness: CoopAuthorityV2Shadow) {
    this.harness = harness;
  }

  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.harness.authenticatedFrameContext;
  }

  /** Commit one settled non-terminal wave boundary with a lossless disposition. */
  commitHostWaveDetailed(input: CoopV2ShadowWaveTap): CoopV2WaveCommitDisposition {
    if (this.disposed) {
      return { kind: "failed", reason: "wave cutover is disposed" };
    }
    if (this.pending != null) {
      if (this.pending.kind !== "wave" || !sameWaveTap(this.pending.input, input)) {
        return { kind: "failed", reason: "a different boundary reused an exact deferred authority commit" };
      }
      return this.retryDeferredHostWaveDetailed();
    }
    const disposition = narrowWaveDisposition(this.harness.commitWaveAdvanceDetailed(input));
    if (disposition.kind === "deferred") {
      this.pending = { kind: "wave", input: structuredClone(input), entry: disposition.entry };
    }
    return disposition;
  }

  /** Commit one settled non-terminal wave boundary as the sole retained authority. */
  commitHostWave(input: CoopV2ShadowWaveTap): CoopAuthorityEntry | null {
    const disposition = this.commitHostWaveDetailed(input);
    return disposition.kind === "committed" ? disposition.entry : null;
  }

  /** Commit one run terminal with a lossless disposition. */
  commitHostTerminalDetailed(input: CoopV2ShadowTerminalTap): CoopV2TerminalCommitDisposition {
    if (this.disposed) {
      return { kind: "failed", reason: "wave cutover is disposed" };
    }
    if (this.pending != null) {
      if (this.pending.kind !== "terminal" || !sameTerminalTap(this.pending.input, input)) {
        return { kind: "failed", reason: "a different boundary reused an exact deferred authority commit" };
      }
      return this.retryDeferredHostTerminalDetailed();
    }
    const disposition = narrowTerminalDisposition(this.harness.commitTerminalDetailed(input));
    if (disposition.kind === "deferred") {
      this.pending = { kind: "terminal", input: structuredClone(input), entry: disposition.entry };
    }
    return disposition;
  }

  /** Commit one run terminal as the sole retained authority. */
  commitHostTerminal(input: CoopV2ShadowTerminalTap): CoopAuthorityEntry | null {
    const disposition = this.commitHostTerminalDetailed(input);
    return disposition.kind === "committed" ? disposition.entry : null;
  }

  /** Retry the exact deferred wave image; no builder or revision allocation runs again. */
  retryDeferredHostWaveDetailed(): CoopV2WaveCommitDisposition {
    if (this.disposed) {
      return { kind: "failed", reason: "wave cutover is disposed" };
    }
    if (this.pending == null || this.pending.kind !== "wave") {
      return { kind: "failed", reason: "wave cutover has no deferred wave boundary" };
    }
    const prior = this.pending;
    const disposition = narrowWaveDisposition(this.harness.retryDeferredWaveAdvanceDetailed(prior.input));
    if (disposition.kind === "deferred") {
      this.pending = { ...prior, entry: disposition.entry };
    } else {
      this.pending = null;
    }
    return disposition;
  }

  /** Compatibility retry wrapper; detailed callers should inspect deferred vs failed explicitly. */
  retryDeferredHostWave(): CoopAuthorityEntry | null {
    const disposition = this.retryDeferredHostWaveDetailed();
    return disposition.kind === "committed" ? disposition.entry : null;
  }

  /** Retry the exact deferred terminal image; no builder or revision allocation runs again. */
  retryDeferredHostTerminalDetailed(): CoopV2TerminalCommitDisposition {
    if (this.disposed) {
      return { kind: "failed", reason: "wave cutover is disposed" };
    }
    if (this.pending == null || this.pending.kind !== "terminal") {
      return { kind: "failed", reason: "wave cutover has no deferred terminal boundary" };
    }
    const prior = this.pending;
    const disposition = narrowTerminalDisposition(this.harness.retryDeferredTerminalDetailed(prior.input));
    if (disposition.kind === "deferred") {
      this.pending = { ...prior, entry: disposition.entry };
    } else {
      this.pending = null;
    }
    return disposition;
  }

  /** Compatibility retry wrapper; detailed callers should inspect deferred vs failed explicitly. */
  retryDeferredHostTerminal(): CoopAuthorityEntry | null {
    const disposition = this.retryDeferredHostTerminalDetailed();
    return disposition.kind === "committed" ? disposition.entry : null;
  }

  /** Retry whichever one exact wave/terminal boundary is currently deferred. */
  retryDeferredHostBoundaryDetailed(): CoopV2WaveTerminalCommitDisposition {
    if (this.pending?.kind === "wave") {
      return this.retryDeferredHostWaveDetailed();
    }
    if (this.pending?.kind === "terminal") {
      return this.retryDeferredHostTerminalDetailed();
    }
    return { kind: "failed", reason: "wave cutover has no deferred boundary" };
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }
}

function narrowWaveDisposition(disposition: AuthorityCommitDisposition): CoopV2WaveCommitDisposition {
  if (disposition.kind === "committed") {
    return disposition.entry.kind === "WAVE_ADVANCE"
      ? (disposition as CoopV2WaveCommitDisposition)
      : { kind: "failed", reason: "AuthorityLog returned a non-wave boundary" };
  }
  if (disposition.kind === "deferred") {
    return disposition.entry.kind === "WAVE_ADVANCE"
      ? (disposition as CoopV2WaveCommitDisposition)
      : { kind: "failed", reason: "AuthorityLog deferred a non-wave boundary" };
  }
  return disposition;
}

function narrowTerminalDisposition(disposition: AuthorityCommitDisposition): CoopV2TerminalCommitDisposition {
  if (disposition.kind === "committed") {
    return disposition.entry.kind === "TERMINAL_COMMIT"
      ? (disposition as CoopV2TerminalCommitDisposition)
      : { kind: "failed", reason: "AuthorityLog returned a non-terminal boundary" };
  }
  if (disposition.kind === "deferred") {
    return disposition.entry.kind === "TERMINAL_COMMIT"
      ? (disposition as CoopV2TerminalCommitDisposition)
      : { kind: "failed", reason: "AuthorityLog deferred a non-terminal boundary" };
  }
  return disposition;
}

function sameWaveTap(left: CoopV2ShadowWaveTap, right: CoopV2ShadowWaveTap): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTerminalTap(left: CoopV2ShadowTerminalTap, right: CoopV2ShadowTerminalTap): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

let activeCutover: CoopV2WaveCutover | null = null;

export function setActiveCoopV2WaveCutover(cutover: CoopV2WaveCutover): void {
  activeCutover = cutover;
}

export function clearActiveCoopV2WaveCutover(cutover?: CoopV2WaveCutover): void {
  if (cutover == null || activeCutover === cutover) {
    activeCutover = null;
  }
}

/** Cycle-free gate consumed by legacy phase/operation seams. */
export function isCoopV2WaveCutoverActive(): boolean {
  return activeCutover != null;
}

export function getActiveCoopV2WaveCutover(): CoopV2WaveCutover | null {
  return activeCutover;
}

export function activeCoopWaveAuthorityModeV2(): CoopWaveAuthorityModeV2 {
  return activeCutover == null ? "legacy" : "v2";
}
