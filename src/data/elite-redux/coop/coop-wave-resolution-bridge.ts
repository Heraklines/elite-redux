/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopCapturePresentation, CoopWaveOutcome } from "#data/elite-redux/coop/coop-transport";

type CoopWaveResolutionBroadcaster = (outcome: CoopWaveOutcome, presentation?: CoopCapturePresentation) => void;

/**
 * The move engine has one forced-flee boundary that must notify co-op wave authority, but importing the
 * complete runtime from the universal move module closes a large game-engine dependency cycle. The runtime
 * installs its broadcaster here when that module is evaluated; battle code depends only on this tiny seam.
 */
let broadcaster: CoopWaveResolutionBroadcaster | null = null;

export function installCoopWaveResolutionBroadcaster(next: CoopWaveResolutionBroadcaster): void {
  broadcaster = next;
}

/** Returns false only when the co-op runtime module has not installed the production bridge. */
export function notifyCoopWaveResolved(outcome: CoopWaveOutcome, presentation?: CoopCapturePresentation): boolean {
  if (broadcaster == null) {
    return false;
  }
  broadcaster(outcome, presentation);
  return true;
}
