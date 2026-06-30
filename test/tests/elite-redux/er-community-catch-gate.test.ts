/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Community Challenge - allowedSpecies catch gate.
//
// A custom community challenge restricts the run to a whitelist of ROOT species.
// That whitelist must gate not only the starter grid but also mid-run catches:
// an off-list wild mon is caught (dex-registered) but NOT added to the team,
// mirroring the usage-tier roster gate. The catch sites (attempt-capture-phase /
// encounter-pokemon-utils) AND `communitySpeciesAllowed(root)` into the
// POKEMON_ADD_TO_PARTY result, and the whitelist must survive a session
// save/reload (it gates the WHOLE run, not just starter-select) - otherwise the
// gate silently stops after a reload. This verifies the predicate + that exact
// round-trip (the same JSON the session save performs).
// =============================================================================

import {
  communitySpeciesAllowed,
  getCommunityAllowedSpecies,
  resetCommunityRunState,
  setCommunityAllowedSpecies,
} from "#data/elite-redux/er-community-run-state";
import { afterEach, describe, expect, it } from "vitest";

describe("ER Community Challenge - allowedSpecies catch gate", () => {
  afterEach(() => resetCommunityRunState());

  it("no whitelist -> every species is allowed (normal / open-seed runs)", () => {
    expect(getCommunityAllowedSpecies()).toBeNull();
    expect(communitySpeciesAllowed(1)).toBe(true);
    expect(communitySpeciesAllowed(9999)).toBe(true);
  });

  it("with a whitelist, only listed root species are allowed (off-list is blocked)", () => {
    setCommunityAllowedSpecies([1, 4, 7]);
    expect(communitySpeciesAllowed(1)).toBe(true); // on-list -> catch is kept
    expect(communitySpeciesAllowed(4)).toBe(true);
    expect(communitySpeciesAllowed(25)).toBe(false); // off-list -> caught but not added
  });

  it("an empty whitelist is treated as no whitelist (not an all-blocking run)", () => {
    setCommunityAllowedSpecies([]);
    expect(getCommunityAllowedSpecies()).toBeNull();
    expect(communitySpeciesAllowed(25)).toBe(true);
  });

  it("the whitelist survives a session save/reload round-trip (gate keeps working)", () => {
    setCommunityAllowedSpecies([1, 4, 7]);

    // Mid-run save: the session save serializes getCommunityAllowedSpecies() to plain
    // JSON, a reload sets it back. Mirror that exact round-trip.
    const serialized = JSON.parse(JSON.stringify(getCommunityAllowedSpecies())) as number[];
    setCommunityAllowedSpecies(null);
    expect(communitySpeciesAllowed(25)).toBe(true); // cleared -> gate off
    setCommunityAllowedSpecies(serialized);

    expect(getCommunityAllowedSpecies()).toEqual([1, 4, 7]);
    expect(communitySpeciesAllowed(1)).toBe(true);
    expect(communitySpeciesAllowed(25)).toBe(false); // gate restored after reload
  });

  it("returning to the title clears the whitelist (a later normal run is unrestricted)", () => {
    setCommunityAllowedSpecies([1]);
    expect(communitySpeciesAllowed(2)).toBe(false);
    resetCommunityRunState();
    expect(getCommunityAllowedSpecies()).toBeNull();
    expect(communitySpeciesAllowed(2)).toBe(true);
  });
});
