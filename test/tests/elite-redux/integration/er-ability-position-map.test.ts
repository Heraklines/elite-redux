/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// er-species.ts ability/innate refs are dex array POSITIONS, but the ER ability
// engine + ER_ID_MAP are keyed by the dex id-FIELD (resync #609e0c2c0). For the
// 81 abilities whose position != id-field, feeding a species' position ref
// straight into ER_ID_MAP resolved to the WRONG ability - mega/primal forms
// showed garbage (Hydreigon Mega: Ice Picks instead of Wings of Pestilence;
// Excadrill Mega: Overcast instead of Mega Drill). mapAbilityId now translates
// position -> id-field via dexAbilityId. This pins:
//   (1) the 81-entry table stays in sync with the vendor dex (regen guard), and
//   (2) the reported mega abilities resolve to their dex-correct (position) names.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { dexAbilityId, ER_ABILITY_POSITION_TO_ID } from "#data/elite-redux/er-ability-position-map";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { describe, expect, it } from "vitest";
import dex from "../../../../vendor/elite-redux/v2.65beta.json";

/** Resolve a species' POSITION ability ref exactly as mapAbilityId does. */
const resolveName = (positionRef: number): string | undefined =>
  allAbilities[ER_ID_MAP.abilities[dexAbilityId(positionRef)]]?.name;

/** The dex ability name at an array POSITION (how the dex/game resolves abis/inns). */
const dexNameAtPosition = (position: number): string => dex.abilities[position].name;

describe("ER ability position->id-field translation (mega ability fix)", () => {
  it("the drift table matches the vendor dex (regen guard)", () => {
    const drift: Record<number, number> = {};
    dex.abilities.forEach((ability, position) => {
      if (ability.id !== position) {
        drift[position] = ability.id;
      }
    });
    expect(ER_ABILITY_POSITION_TO_ID).toEqual(drift);
    expect(Object.keys(ER_ABILITY_POSITION_TO_ID)).toHaveLength(81);
  });

  it("dexAbilityId is identity for non-drifted positions", () => {
    expect(dexAbilityId(1)).toBe(1);
    expect(dexAbilityId(266)).toBe(266); // As One Glastrier (below the drift range)
    expect(dexAbilityId(200)).toBe(200); // Steelworker (Excadrill Mega innate)
  });

  // The exact abilities the testers reported, resolved by POSITION (the dex truth).
  it.each([
    [930, "Wings of Pestilence"], // Hydreigon Mega ability
    [929, "Hydra"], // Hydreigon Mega innate 1
    [568, "Mind Crunch"], // Hydreigon Mega innate 2
    [196, "Merciless"], // Hydreigon Mega innate 3
    [983, "Mega Drill"], // Excadrill Mega innate 1 (was wrongly "Overcast")
    [200, "Steelworker"], // Excadrill Mega innate 2
    [104, "Mold Breaker"], // Excadrill Mega ability 1
  ])("species ability position %i resolves to %s", (positionRef, expected) => {
    expect(dexNameAtPosition(positionRef)).toBe(expected); // sanity: dex truth
    expect(resolveName(positionRef)).toBe(expected); // the runtime resolution after the fix
  });

  it("every drifted position resolves to its dex position name", () => {
    for (const position of Object.keys(ER_ABILITY_POSITION_TO_ID).map(Number)) {
      expect(resolveName(position)).toBe(dexNameAtPosition(position));
    }
  });
});
