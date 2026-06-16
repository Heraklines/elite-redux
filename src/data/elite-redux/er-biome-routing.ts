/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - World Map routing (Part III s11). Turns the fixed "pick from the
// biome's hardcoded links" transition into a BRANCHING NODE GRAPH:
//
//   - The current biome's normal links are the BASE nodes.
//   - On top of those, OTHER biomes can appear as unexpected adjacent nodes,
//     each at a ~50% roll (capped), so "not every run has the same topography".
//   - The biome you JUST came from is the ONLY exclusion - everything else is fair.
//   - How many of the rolled nodes are actually REVEALED is gated by your Map
//     Upgrade tier (the stacked, renamed old "Map" item). Base Map shows a
//     subset; each upgrade reveals more.
//
// This module is the pure routing/data layer. SelectBiomePhase consumes
// rollErNextBiomeNodes() to build the player's choice. It deliberately does NOT
// touch wave counts or the run finale - biome BOUNDARIES still fall where the
// engine already puts them; only the DESTINATION choice is reworked. Variable
// biome length + the every-5 Crossroads are a separate, later slice.
//
// Run-scoped state (the previous biome) is serialized additively via game-data.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { MapModifier } from "#modifiers/modifier";
import { randSeedInt } from "#utils/common";

/** Percent chance each candidate "unexpected" biome appears as an extra node. */
const EXTRA_NODE_CHANCE = 50;
/** Hard cap on how many extra (non-link) nodes a single transition can roll. */
const MAX_EXTRA_NODES = 3;
/** Visible nodes at Map Upgrade tier 0 (base Map). Each upgrade reveals +1. */
const BASE_VISIBLE_NODES = 2;

/**
 * Whether the branching node graph drives biome transitions this run. Gated to
 * classic, non-daily, non-random-biome runs - and, for now, to dev/staging
 * builds (the same gate as the dev test suite) so it ships to the testing site
 * for verification before it ever reaches a production run. Flip the dev gate
 * once it is play-verified.
 */
export function erBiomeRoutingActive(): boolean {
  const env = import.meta.env as unknown as { DEV?: boolean; VITE_DEV_TOOLS?: string };
  const devBuild = !!env.DEV || env.VITE_DEV_TOOLS === "1";
  const gm = globalScene?.gameMode;
  return devBuild && !!gm && gm.isClassic && !gm.isDaily && !gm.hasRandomBiomes;
}

/** The biome the player travelled FROM into the current one (the only exclusion). */
let prevBiome: BiomeId | null = null;

/**
 * Record a biome entry. Called from newArena on every biome change (and run
 * start). `from` is the biome being left (null at run start).
 */
export function erRecordBiomeEntry(from: BiomeId | null): void {
  prevBiome = from;
  // Event-revealed routes are per-biome: clear them as we enter the new biome.
  eventRevealedBiomes = [];
}

/** The biome the player just came from (excluded from the next node options). */
export function getErPrevBiome(): BiomeId | null {
  return prevBiome;
}

/**
 * The next-biome node set rolled when the CURRENT biome was entered. Stored so
 * (a) the map overlay can show the player's onward routes mid-biome, and (b) the
 * eventual transition (SelectBiomePhase) reuses the SAME set the overlay showed,
 * instead of re-rolling to a different one.
 */
let pendingNodes: ErRouteNode[] = [];

/** Stash the rolled next-biome nodes for the current biome. */
export function setErPendingNodes(nodes: ErRouteNode[]): void {
  pendingNodes = nodes;
}

/** The stored next-biome nodes (empty if none rolled yet this biome). */
export function getErPendingNodes(): ErRouteNode[] {
  return pendingNodes;
}

/**
 * Biomes a mystery event has revealed as onward routes for the CURRENT biome's
 * exit (rendered blue + selectable in the route picker). Reset on every biome
 * entry - an event reveal is only good for the next hop.
 */
let eventRevealedBiomes: BiomeId[] = [];

/**
 * Mark `biome` as a mystery-event-revealed onward route: it renders blue and
 * selectable in the next route picker. De-duped; also lights up the already-built
 * pending node set so a reveal mid-biome shows up immediately.
 */
export function addErEventRevealedNode(biome: BiomeId): void {
  if (!eventRevealedBiomes.includes(biome)) {
    eventRevealedBiomes.push(biome);
  }
  if (pendingNodes.length > 0 && !pendingNodes.some(n => n.biome === biome)) {
    pendingNodes.push({ biome, revealed: true, source: "event" });
  }
}

/** Clear routing state at the start of a new run (module state outlives a run). */
export function resetErRouting(): void {
  prevBiome = null;
  pendingNodes = [];
  eventRevealedBiomes = [];
}

/** Serialized previous-biome for the run save (additive; undefined when unset). */
export function getErRoutingState(): number | undefined {
  return prevBiome == null ? undefined : prevBiome;
}

/** Restore previous-biome from a loaded run save. */
export function restoreErRouting(value: number | undefined): void {
  prevBiome = value == null ? null : (value as BiomeId);
}

/** Total Map Upgrade tier = summed stacks of the (renamed) Map item held. */
export function erMapUpgradeTier(): number {
  return globalScene
    .findModifiers(m => m instanceof MapModifier)
    .reduce((sum, m) => sum + m.getStackCount(), 0);
}

/** Biomes that are never valid travel destinations on the graph. */
const NON_TRAVEL_BIOMES: ReadonlySet<BiomeId> = new Set([BiomeId.TOWN, BiomeId.END]);

/** Resolve the current biome's hardcoded links to concrete biome ids. */
function baseLinks(current: BiomeId): BiomeId[] {
  const links = allBiomes.get(current)?.biomeLinks ?? [];
  return links
    .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
    .map(b => (Array.isArray(b) ? b[0] : b) as BiomeId);
}

/**
 * Why a REVEALED node is on the graph - drives the map picker's node colour:
 *   base    = your normal routes (shown by the base Map)  -> default gold
 *   upgrade = an extra route a Map Upgrade tier revealed  -> green
 *   event   = a route a mystery event surfaced            -> blue
 * Hidden ("???") nodes have no meaningful source - they always render dim.
 */
export type ErNodeSource = "base" | "upgrade" | "event";

/** A node on the routing graph: a destination biome + whether the player can see it. */
export interface ErRouteNode {
  biome: BiomeId;
  /** True if revealed (selectable); false = hidden silhouette (needs more Map Upgrade). */
  revealed: boolean;
  /** Why this node is shown (drives its colour); defaults to "base" when absent. */
  source?: ErNodeSource;
}

/**
 * Roll the branching next-biome node set for a transition out of `current`,
 * having arrived from `prev`. Returns the nodes in display order with their
 * reveal state already resolved against the player's Map Upgrade tier.
 *
 * Determinism: relies on the seeded RNG (randSeedInt), so a given transition is
 * stable across save/reload like every other ER roll.
 */
export function rollErNextBiomeNodes(current: BiomeId, prev: BiomeId | null): ErRouteNode[] {
  // Base = the biome's real links, minus the biome we just came from.
  const chosen: BiomeId[] = [];
  const seen = new Set<BiomeId>([current]);
  if (prev != null) {
    seen.add(prev);
  }
  for (const b of baseLinks(current)) {
    if (!seen.has(b) && !NON_TRAVEL_BIOMES.has(b)) {
      seen.add(b);
      chosen.push(b);
    }
  }

  // Extras: any OTHER real biome can show up unexpectedly, each at ~50%, capped.
  let extras = 0;
  for (const b of allBiomes.keys()) {
    if (extras >= MAX_EXTRA_NODES) {
      break;
    }
    if (seen.has(b) || NON_TRAVEL_BIOMES.has(b)) {
      continue;
    }
    if (randSeedInt(100) < EXTRA_NODE_CHANCE) {
      seen.add(b);
      chosen.push(b);
      extras++;
    }
  }

  // Always offer at least one destination (fall back to a random link if the
  // rolls somehow stripped everything but the excluded previous biome).
  if (chosen.length === 0) {
    const fallback = baseLinks(current).find(b => !NON_TRAVEL_BIOMES.has(b)) ?? BiomeId.PLAINS;
    chosen.push(fallback);
  }

  // Visibility: base Map reveals BASE_VISIBLE_NODES; each Map Upgrade tier +1. The
  // first node is always revealed so the player can never be soft-locked. A node
  // revealed only because of the upgrade band is tagged "upgrade" (green); the
  // base-visible ones are "base" (gold). Hidden ones render dim "???".
  const visibleCount = Math.max(1, BASE_VISIBLE_NODES + erMapUpgradeTier());
  const nodes: ErRouteNode[] = chosen.map((biome, i) => ({
    biome,
    revealed: i < visibleCount,
    source: i < BASE_VISIBLE_NODES ? "base" : "upgrade",
  }));
  // Merge any mystery-event-revealed routes for this biome (always shown, blue),
  // de-duped against the rolled set.
  for (const biome of eventRevealedBiomes) {
    if (!nodes.some(n => n.biome === biome)) {
      nodes.push({ biome, revealed: true, source: "event" });
    }
  }
  return nodes;
}

// --- Interaction grammar (#502) -------------------------------------------
// The biome's "keep exploring here" VERB, surfaced as the STAY action label on
// the every-5-wave Crossroads panel (maintainer ruling: lock the grammar verbs
// to the Crossroads + matching biome ME options). Grouped by biome character;
// anything unmapped falls back to a neutral "Press on".
const BIOME_CROSSROADS_VERB = new Map<BiomeId, string>([
  // DELVE - go deeper underground / underwater.
  [BiomeId.CAVE, "Delve deeper"],
  [BiomeId.ICE_CAVE, "Delve deeper"],
  [BiomeId.FAIRY_CAVE, "Delve deeper"],
  [BiomeId.SEABED, "Delve deeper"],
  [BiomeId.ABYSS, "Delve deeper"],
  [BiomeId.RUINS, "Delve deeper"],
  // FORAGE - push through living growth.
  [BiomeId.FOREST, "Forage on"],
  [BiomeId.JUNGLE, "Forage on"],
  [BiomeId.GRASS, "Forage on"],
  [BiomeId.TALL_GRASS, "Forage on"],
  [BiomeId.MEADOW, "Forage on"],
  // SCOUT - read the open ground ahead.
  [BiomeId.PLAINS, "Scout ahead"],
  [BiomeId.MOUNTAIN, "Scout ahead"],
  [BiomeId.BADLANDS, "Scout ahead"],
  [BiomeId.DESERT, "Scout ahead"],
  [BiomeId.WASTELAND, "Scout ahead"],
  [BiomeId.SNOWY_FOREST, "Scout ahead"],
  // MARKET - settlements you browse.
  [BiomeId.TOWN, "Browse on"],
  [BiomeId.METROPOLIS, "Browse on"],
  [BiomeId.SLUM, "Browse on"],
  [BiomeId.ISLAND, "Browse on"],
  // Waterline - wade along the shore/shallows.
  [BiomeId.SEA, "Wade on"],
  [BiomeId.LAKE, "Wade on"],
  [BiomeId.BEACH, "Wade on"],
  [BiomeId.SWAMP, "Wade on"],
]);

/** The Crossroads "stay and keep exploring" action label for a biome. */
export function erBiomeCrossroadsVerb(biomeId: BiomeId): string {
  return BIOME_CROSSROADS_VERB.get(biomeId) ?? "Press on";
}
