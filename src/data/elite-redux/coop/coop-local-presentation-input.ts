/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Presentation-only phases whose public prompts are intentionally local to each browser.
 *
 * These phases neither choose shared mechanics nor emit an Authority V2 intent. Each client must
 * therefore be able to dismiss its own prompt even while the ordered interaction log is waiting for
 * another successor. Keep this registry cycle-free: renderer admission, production input, and the
 * sealed browser observer all consume the same classification.
 */
export const COOP_LOCAL_PRESENTATION_INPUT_PHASES: ReadonlySet<string> = new Set(["ScanIvsPhase"]);

export function isCoopLocalPresentationInputPhase(phaseName: string | null | undefined): boolean {
  return phaseName != null && COOP_LOCAL_PRESENTATION_INPUT_PHASES.has(phaseName);
}
