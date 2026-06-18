/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - Phase D map-event helpers. The scene-aware glue the map events share
// (reveal the onward routes, reveal a landmark, pick a travel destination). Kept
// OUT of er-map-nodes.ts so that module stays pure/side-effect-free and unit
// testable - this is where globalScene / allBiomes / RNG live.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { addErEventRevealedNode, revealAllErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { type ErMapNode, revealMapNodes, setMapTravelTarget } from "#data/elite-redux/er-map-nodes";
import type { BiomeId } from "#enums/biome-id";
import { getBiomeName, randSeedItem } from "#utils/common";

/** The current biome's onward biome links, normalized (weighted tuples flattened). */
function onwardBiomes(): BiomeId[] {
  const links = allBiomes.get(globalScene.arena.biomeId)?.biomeLinks ?? [];
  return links.map(link => (Array.isArray(link) ? link[0] : link) as BiomeId);
}

/**
 * Reveal the current biome's onward links onto the World Map as Route nodes.
 * Returns how many NEW nodes were added. Optionally also reveal extra nodes
 * (e.g. a landmark the event surfaces).
 */
export function chartOnwardRoutes(extra: ErMapNode[] = []): number {
  // Flip every hidden ROLLED onward node to revealed - this is what the World Map
  // overlay + route picker actually read, so the Observatory truly "charts the
  // whole area" (not just the always-visible base nodes).
  revealAllErPendingNodes();
  const routes: ErMapNode[] = onwardBiomes().map(biome => ({
    biome,
    label: getBiomeName(biome),
    kind: "biome",
  }));
  return revealMapNodes([...routes, ...extra]);
}

/** Reveal a single landmark node onto the map. Also surfaces it as a selectable
 * BLUE event route in the next biome picker (so an event-revealed place is an
 * actual onward choice, colour-coded by its source). */
export function revealLandmark(biome: BiomeId, label: string): void {
  revealMapNodes([{ biome, label, kind: "landmark" }]);
  addErEventRevealedNode(biome);
}

/**
 * Pick a random onward biome and set it as the pending travel target (the next
 * biome transition will route there). Returns the chosen biome, or null if the
 * current biome has no onward links to choose from.
 */
export function setRandomTravelTarget(): BiomeId | null {
  const options = onwardBiomes();
  if (options.length === 0) {
    return null;
  }
  const target = randSeedItem(options);
  setMapTravelTarget(target);
  return target;
}
