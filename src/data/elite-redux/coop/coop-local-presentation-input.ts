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

/**
 * Presentation prompts that are local only in one exact UI mode. EvolutionPhase can also open a
 * mechanically shared OPTION_SELECT for branched evolutions, so admitting the whole phase would
 * bypass Authority V2 at precisely the wrong surface.
 */
export const COOP_LOCAL_PRESENTATION_INPUT_SURFACES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["EvolutionPhase", new Set(["EVOLUTION_SCENE"])],
  ["CoopWaveProgressionReplayPhase", new Set(["EVOLUTION_SCENE"])],
  ["FormChangePhase", new Set(["EVOLUTION_SCENE"])],
  ["CoopFormChangeCutsceneReplayPhase", new Set(["EVOLUTION_SCENE"])],
]);

export function isCoopLocalPresentationInputPhase(phaseName: string | null | undefined): boolean {
  return phaseName != null && COOP_LOCAL_PRESENTATION_INPUT_PHASES.has(phaseName);
}

export function isCoopLocalPresentationInputSurface(
  phaseName: string | null | undefined,
  uiMode: string | null | undefined,
): boolean {
  if (isCoopLocalPresentationInputPhase(phaseName)) {
    return true;
  }
  return (
    phaseName != null && uiMode != null && COOP_LOCAL_PRESENTATION_INPUT_SURFACES.get(phaseName)?.has(uiMode) === true
  );
}
