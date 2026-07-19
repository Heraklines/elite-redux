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
  private disposed = false;

  constructor(harness: CoopAuthorityV2Shadow) {
    this.harness = harness;
  }

  get authenticatedFrameContext(): CoopFrameContextV2 {
    return this.harness.authenticatedFrameContext;
  }

  /** Commit one settled non-terminal wave boundary as the sole retained authority. */
  commitHostWave(input: CoopV2ShadowWaveTap): CoopAuthorityEntry | null {
    return this.disposed ? null : this.harness.tapWaveAdvance(input);
  }

  /** Commit one run terminal as the sole retained authority. */
  commitHostTerminal(input: CoopV2ShadowTerminalTap): CoopAuthorityEntry | null {
    return this.disposed ? null : this.harness.tapTerminal(input);
  }

  dispose(): void {
    this.disposed = true;
  }
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
