/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenge per-run gates (LEAF module).
//
// A community challenge can FORCE a run difficulty (skipping the post-team
// difficulty chooser) and/or restrict the starter grid to a whitelist of root
// species. Those two gates are read from very different layers - the difficulty
// short-circuit lives in starter-select-ui-handler `tryStart`, the species
// whitelist in challenge-utils `checkStarterValidForChallenge` - so the state
// lives here in a LEAF module that imports nothing but the `ErDifficulty` type.
// That keeps `challenge-utils.ts` <-> launch free of any circular-import risk.
//
// Both gates are run-scoped: `resetCommunityRunState()` clears them on returning
// to the title (so a community card never leaks a forced difficulty / whitelist
// into a later normal Custom Challenge run).
// =============================================================================

import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";

/** The founder's qualifying run for a DRAFT community challenge (draft id + its config). */
export interface FounderRunState {
  readonly draftId: string;
  readonly config: CommunityChallengeConfig;
}

let forcedDifficulty: ErDifficulty | null = null;
let allowedSpecies: Set<number> | null = null;
// The run is the founder's qualifying play of a draft they just created: a legit
// classic victory auto-publishes the draft. UNLIKE the two gates above this is NOT
// consumed at launch - it rides the whole run and is serialized with the SESSION save
// (so a mid-run save + reload still auto-publishes on the eventual win).
let founderChallenge: FounderRunState | null = null;

/** Force the run difficulty so starter-select skips the chooser and launches directly. */
export function setForcedCommunityDifficulty(d: ErDifficulty): void {
  forcedDifficulty = d;
}

/** The forced community difficulty, or null when no community card is being launched. */
export function getForcedCommunityDifficulty(): ErDifficulty | null {
  return forcedDifficulty;
}

/** Clear the forced difficulty (called once consumed by tryStart). */
export function clearForcedCommunityDifficulty(): void {
  forcedDifficulty = null;
}

/** Restrict the starter grid to these root species ids; null / empty = no whitelist. */
export function setCommunityAllowedSpecies(ids: number[] | null): void {
  allowedSpecies = ids && ids.length > 0 ? new Set(ids) : null;
}

/** true when no whitelist OR the root species id is whitelisted. */
export function communitySpeciesAllowed(rootSpeciesId: number): boolean {
  return allowedSpecies === null || allowedSpecies.has(rootSpeciesId);
}

/** Tag the current run as the founder's qualifying run for a draft challenge (null = clear). */
export function setFounderRunState(state: FounderRunState | null): void {
  founderChallenge = state;
}

/** The founder run-state for the current run, or null. Serialized with the session save. */
export function getFounderRunState(): FounderRunState | null {
  return founderChallenge;
}

/** Reset all gates (returning to the title / starting fresh). */
export function resetCommunityRunState(): void {
  forcedDifficulty = null;
  allowedSpecies = null;
  founderChallenge = null;
}
