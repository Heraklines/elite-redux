/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Mono Color challenge support (#388).
//
// The ROM ships an official dex color for EVERY species (er-species-colors.ts,
// keyed by ER species id). This module resolves them onto pokerogue species
// ids so the MonoColorChallenge can ask "what color is this species?" in one
// lookup. Multiple ER records can map to one pokerogue id (forms/megas); the
// FIRST (lowest ER id = the base record) wins.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_COLOR_NAMES, ER_SPECIES_COLORS } from "#data/elite-redux/er-species-colors";

/** Display hex for each dex color (challenge UI text markup). */
export const ER_COLOR_HEX: Readonly<Record<(typeof ER_COLOR_NAMES)[number], string>> = {
  RED: "#f05868",
  GREEN: "#78c850",
  BLUE: "#6890f0",
  WHITE: "#ffffff",
  BROWN: "#b07030",
  YELLOW: "#f8d030",
  PURPLE: "#a868c0",
  PINK: "#f8a0c8",
  GRAY: "#a0a0a0",
  BLACK: "#707070",
};

let COLOR_BY_POKEROGUE_ID: Map<number, number> | null = null;

function colorMap(): Map<number, number> {
  if (COLOR_BY_POKEROGUE_ID !== null) {
    return COLOR_BY_POKEROGUE_ID;
  }
  const map = new Map<number, number>();
  for (const [erIdStr, colorIdx] of Object.entries(ER_SPECIES_COLORS)) {
    const pk = ER_ID_MAP.species[Number(erIdStr)];
    if (pk !== undefined && !map.has(pk)) {
      map.set(pk, colorIdx);
    }
  }
  COLOR_BY_POKEROGUE_ID = map;
  return map;
}

/**
 * The ER dex-color index (into {@linkcode ER_COLOR_NAMES}) of a pokerogue
 * species id, or `undefined` for species ER does not know.
 */
export function erDexColorIndexOf(speciesId: number): number | undefined {
  return colorMap().get(speciesId);
}

/** True if `speciesId`'s dex color matches `colorIndex` (0-9). */
export function erSpeciesMatchesColor(speciesId: number, colorIndex: number): boolean {
  return erDexColorIndexOf(speciesId) === colorIndex;
}
