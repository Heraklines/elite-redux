/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopWaveProgressionPresentationV2 } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";

export interface CoopWaveProgressionPresentationObservation {
  readonly stage: "authority-recorded" | "renderer-completed" | "renderer-failed";
  readonly wave: number;
  readonly seq: number;
  readonly event: CoopWaveProgressionPresentationV2;
  readonly reason?: string;
}

type CoopWaveProgressionPresentationObserver = (observation: CoopWaveProgressionPresentationObservation) => void;

let observer: CoopWaveProgressionPresentationObserver | null = null;

/** Install the exact-SHA browser observer. Normal application bundles leave this unset. */
export function setCoopWaveProgressionPresentationObserver(next: CoopWaveProgressionPresentationObserver | null): void {
  observer = next;
}

/** Emit diagnostic presentation evidence without making CI telemetry a progression dependency. */
export function observeCoopWaveProgressionPresentation(observation: CoopWaveProgressionPresentationObservation): void {
  if (observer == null) {
    return;
  }
  try {
    observer({ ...observation, event: structuredClone(observation.event) });
  } catch {
    // The retained WAVE_ADVANCE material remains authoritative even if its read-only observer fails.
  }
}
