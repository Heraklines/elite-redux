/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 / #486 - Phase D Map system, increment 1: the run-scoped MAP-NODE data
// substrate. This is the pure data layer every map-aware event talks to - it has
// NO UI and NO save dependency (kept deliberately side-effect-free so it is unit
// testable and cannot break the run flow). Later increments add the overlay UI
// (UiMode.ER_MAP), session persistence, and the events that drive it (Observatory,
// Echo Chamber, Informant, Storm, Ultra Wormhole, Treasure-Map fragments).
//
// State is module-level and reset per run via resetErMapNodes() (wired next to the
// other ER per-run resets at run start). Three concerns:
//   - revealed NODES: upcoming biome / landmark options a SCOUT-style event surfaced
//   - a TRAVEL target: a node a travel event lets the player jump to next
//   - TREASURE-MAP fragments: collect a threshold to unlock a guaranteed reward node
// =============================================================================

import { getErPrevBiome, resetErRouting, restoreErRecentBiomes, restoreErRouting } from "#data/elite-redux/er-biome-routing";
import { getErFairyLuckSave, resetErFairyLuck, restoreErFairyLuck } from "#data/elite-redux/er-fairy-luck";
import {
  erBiomeOverstayAnchor,
  getErBiomeLength,
  getErBiomeStartWave,
  resetErBiomeStructure,
  restoreErBiomeStructure,
} from "#data/elite-redux/er-biome-structure";
import type { BiomeId } from "#enums/biome-id";

/** What a revealed node represents. */
export type ErMapNodeKind = "biome" | "treasure" | "landmark";

/** A single revealed point on the run's map. */
export interface ErMapNode {
  /** The biome this node leads to / sits in. */
  biome: BiomeId;
  /** Short player-facing label (English-only; ER custom strings are English). */
  label: string;
  /** What kind of node this is. */
  kind: ErMapNodeKind;
}

/** Collect this many Treasure-Map fragments to unlock a guaranteed reward node. */
export const TREASURE_FRAGMENTS_FOR_REWARD = 3;

let revealedNodes: ErMapNode[] = [];
let travelTarget: BiomeId | null = null;
let authoritativeTravelClassification: { readonly wave: number; readonly target: BiomeId | null } | null = null;
let fragmentCount = 0;
/** ER (#486) The Storm: a WeatherType (numeric enum) the player chose to carry
 * into the NEXT biome, consumed once on that biome's first wave. null = none. */
let carriedWeather: number | null = null;
/** Ordered list of biomes the player has entered this run (the journey chain the
 * World Map draws). Appended on each biome entry; persisted in the run save. */
let biomeHistory: BiomeId[] = [];

/** Clear all map state. Called once at run start (alongside the other ER resets). */
export function resetErMapNodes(): void {
  revealedNodes = [];
  travelTarget = null;
  authoritativeTravelClassification = null;
  fragmentCount = 0;
  biomeHistory = [];
  carriedWeather = null;
  resetErRouting();
  resetErBiomeStructure();
  resetErFairyLuck();
}

/**
 * Record that the player has ENTERED `biome` (called from newArena on run start +
 * every biome transition). De-duped against the last entry so a double newArena
 * for the same biome does not double-log. Bounded so a very long run cannot bloat
 * the save (the World Map shows the most recent stretch).
 */
export function recordErBiomeVisited(biome: BiomeId): void {
  if (biomeHistory[biomeHistory.length - 1] === biome) {
    return;
  }
  biomeHistory.push(biome);
  if (biomeHistory.length > 40) {
    biomeHistory = biomeHistory.slice(-40);
  }
}

/** The ordered biomes visited this run (the World Map's journey chain). */
export function getErBiomeHistory(): readonly BiomeId[] {
  return biomeHistory;
}

/** Drop all revealed "biome" route nodes (keep treasure/landmark). Used when a
 * new biome is entered so the overlay shows the CURRENT onward routes, not stale
 * ones from the biome you just left. */
export function clearErBiomeNodes(): void {
  revealedNodes = revealedNodes.filter(n => n.kind !== "biome");
}

/**
 * Reveal one or more map nodes (a SCOUT-style event surfacing upcoming options).
 * De-duplicates by biome+label so re-revealing is idempotent. Returns how many
 * NEW nodes were added.
 */
export function revealMapNodes(nodes: ErMapNode[]): number {
  let added = 0;
  for (const node of nodes) {
    if (!revealedNodes.some(existing => existing.biome === node.biome && existing.label === node.label)) {
      revealedNodes.push({ ...node });
      added += 1;
    }
  }
  return added;
}

/** The nodes revealed so far this run (read-only snapshot for the overlay UI). */
export function getRevealedMapNodes(): readonly ErMapNode[] {
  return revealedNodes;
}

/** True if anything has been revealed (drives whether the overlay has content). */
export function hasRevealedMapNodes(): boolean {
  return revealedNodes.length > 0;
}

/**
 * Mark a biome as the player's chosen travel target (a Storm / Wormhole / Echo
 * Chamber travel reward). The run flow consumes it at the next biome-choice.
 */
export function setMapTravelTarget(biome: BiomeId): void {
  travelTarget = biome;
}

/** Read the pending travel target without consuming authority-owned transition state. */
export function getMapTravelTarget(): BiomeId | null {
  return travelTarget;
}

/** Exact host-carrier classification for SelectBiome; local event writes cannot alter it. */
export function setAuthoritativeMapTravelClassification(wave: number, target: BiomeId | null): void {
  authoritativeTravelClassification = Number.isSafeInteger(wave) && wave >= 0 ? { wave, target } : null;
}

export function getAuthoritativeMapTravelClassification(wave: number): {
  readonly ready: boolean;
  readonly target: BiomeId | null;
} {
  return authoritativeTravelClassification?.wave === wave
    ? { ready: true, target: authoritativeTravelClassification.target }
    : { ready: false, target: null };
}

export function restoreAuthoritativeMapTravelClassification(
  classification: { readonly wave: number; readonly target: BiomeId | null } | null,
): void {
  authoritativeTravelClassification = classification == null ? null : { ...classification };
}

export function snapshotAuthoritativeMapTravelClassification(): {
  readonly wave: number;
  readonly target: BiomeId | null;
} | null {
  return authoritativeTravelClassification == null ? null : { ...authoritativeTravelClassification };
}

/** Clear only the exact host-committed travel destination; stale/local mismatches remain fail-visible. */
export function clearMapTravelTarget(expected: BiomeId): boolean {
  if (travelTarget !== expected) {
    return false;
  }
  travelTarget = null;
  return true;
}

/** Take and clear the pending travel target, if any. */
export function consumeMapTravelTarget(): BiomeId | null {
  const target = travelTarget;
  travelTarget = null;
  authoritativeTravelClassification = null;
  return target;
}

/** Carry a weather (WeatherType numeric enum) into the next biome (#486 The Storm). */
export function setErCarriedWeather(weather: number): void {
  carriedWeather = weather;
}

/** Take and clear the carried weather, applied once on the next biome's entry. */
export function consumeErCarriedWeather(): number | null {
  const w = carriedWeather;
  carriedWeather = null;
  return w;
}

/** Add (or, with a negative n, spend) Treasure-Map fragments. Clamped at 0. Returns the new total. */
export function addTreasureFragments(n: number): number {
  fragmentCount = Math.max(0, fragmentCount + n);
  return fragmentCount;
}

/** How many Treasure-Map fragments the player currently holds. */
export function getTreasureFragments(): number {
  return fragmentCount;
}

/**
 * If the player has enough fragments for a reward, spend a set and return true
 * (the Beach "X Marks the Spot" payout). Otherwise return false and spend nothing.
 */
export function consumeTreasureFragmentsForReward(): boolean {
  if (fragmentCount >= TREASURE_FRAGMENTS_FOR_REWARD) {
    fragmentCount -= TREASURE_FRAGMENTS_FOR_REWARD;
    return true;
  }
  return false;
}

// --- Session persistence ----------------------------------------------------
// The whole substrate is plain JSON-safe data (biome is a numeric enum, label a
// string, kind a string literal), so the save payload is just a snapshot of the
// three pieces of state. Restoring is defensive: a legacy save with no field, or
// a malformed one, leaves a clean (reset) map rather than throwing on load.

/** A serializable snapshot of the run's map state for the session save. */
export interface ErMapSaveData {
  nodes: ErMapNode[];
  travelTarget: BiomeId | null;
  fragments: number;
  /** ER (#486) routing: the biome the player last came from (next-node exclusion). */
  prevBiome?: number | null;
  /** ER (#486) structure: the current biome's rolled length in waves (null = vanilla cadence). */
  biomeLength?: number | null;
  /** ER (#486) structure: the wave the current biome was entered on. */
  biomeStartWave?: number;
  /** ER (#504) notoriety: the wave the player armed overstay (chose to linger past
   * the free window), or null/undefined if they never did. */
  biomeOverstayAnchor?: number | null;
  /** ER (#542) Fairy's Boon: active temporary luck bonus + the wave it expires on. */
  fairyLuckBonus?: number;
  fairyLuckExpiry?: number;
  /** ER (#486) World Map: the ordered biomes visited this run (the journey chain). */
  biomeHistory?: number[];
  /** ER (#486) The Storm: a WeatherType to carry into the next biome (pending). */
  carriedWeather?: number;
}

/** Snapshot the current map state for the session save (#486 increment 2). */
export function getErMapSaveData(): ErMapSaveData {
  return {
    nodes: revealedNodes.map(node => ({ ...node })),
    travelTarget,
    fragments: fragmentCount,
    prevBiome: getErPrevBiome(),
    biomeLength: getErBiomeLength(),
    biomeStartWave: getErBiomeStartWave(),
    biomeOverstayAnchor: erBiomeOverstayAnchor(),
    fairyLuckBonus: getErFairyLuckSave().bonus,
    fairyLuckExpiry: getErFairyLuckSave().expiryWave,
    biomeHistory: [...biomeHistory],
    ...(carriedWeather != null ? { carriedWeather } : {}),
  };
}

/**
 * Restore map state from a session save. Tolerant of undefined (older saves) and
 * of partially-malformed payloads - anything unusable is dropped, never thrown.
 * Always resets first so a reload can't accumulate stale state.
 */
export function restoreErMapState(data: ErMapSaveData | undefined | null, currentWaveIndex = 1): void {
  resetErMapNodes();
  if (!data) {
    return;
  }
  if (Array.isArray(data.nodes)) {
    revealMapNodes(
      data.nodes.filter(
        (node): node is ErMapNode =>
          node != null && typeof node.label === "string" && typeof node.biome === "number",
      ),
    );
  }
  if (typeof data.travelTarget === "number") {
    travelTarget = data.travelTarget;
  }
  if (typeof data.fragments === "number" && data.fragments > 0) {
    fragmentCount = Math.floor(data.fragments);
  }
  restoreErRouting(typeof data.prevBiome === "number" ? data.prevBiome : undefined);
  restoreErBiomeStructure(
    typeof data.biomeLength === "number" ? data.biomeLength : null,
    // ER (#504 fix): a save lacking biomeStartWave (older staging save) must NOT
    // fall back to wave 1 - that anchor makes wavesSinceEnteredBiome enormous and
    // pins biome notoriety to its max. Anchor to the CURRENT wave instead (zero
    // overstay), which self-heals on the next biome transition.
    typeof data.biomeStartWave === "number" ? data.biomeStartWave : currentWaveIndex,
    // Restore the deliberate-overstay anchor. Absent (older save) = null = no
    // notoriety, which is the safe default (the player was not penalized).
    typeof data.biomeOverstayAnchor === "number" ? data.biomeOverstayAnchor : null,
  );
  restoreErFairyLuck(
    typeof data.fairyLuckBonus === "number" ? data.fairyLuckBonus : null,
    typeof data.fairyLuckExpiry === "number" ? data.fairyLuckExpiry : null,
  );
  if (Array.isArray(data.biomeHistory)) {
    biomeHistory = data.biomeHistory.filter((b): b is number => typeof b === "number").slice(-40) as BiomeId[];
    // Replay the history tail into the routing no-loopback trail so a reload can't
    // reset the "can't go back to the last 2 biomes" rule. Drop the last entry
    // (the current biome, which the roll already excludes) so the trail holds the
    // PRIOR biomes the player came from.
    restoreErRecentBiomes(biomeHistory.slice(0, -1));
  }
  if (typeof data.carriedWeather === "number") {
    carriedWeather = data.carriedWeather;
  }
}
