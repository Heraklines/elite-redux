/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Integrity + wiring test for the hand-audited ER egg moves.

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { allMoves } from "#data/data-lists";
import { ER_EGG_MOVES } from "#data/elite-redux/er-egg-moves";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("ER egg moves", () => {
  const draftIdByConst = new Map<string, number>();
  for (const d of ER_SPECIES) {
    draftIdByConst.set(d.speciesConst, d.id);
  }
  const speciesIdByName = SpeciesId as unknown as Record<string, number | undefined>;

  // Resolve a speciesConst the same way init-elite-redux-egg-moves.ts does:
  // ER customs via the id-map, vanilla via the SpeciesId enum.
  const resolve = (speciesConst: string): number | undefined => {
    const draftId = draftIdByConst.get(speciesConst);
    if (draftId !== undefined) {
      return ER_ID_MAP.species[draftId];
    }
    return speciesIdByName[speciesConst.replace(/^SPECIES_/, "")];
  };

  it("every entry has 1-4 distinct, real moves", () => {
    for (const [speciesConst, moves] of Object.entries(ER_EGG_MOVES)) {
      expect(moves.length, speciesConst).toBeGreaterThanOrEqual(1);
      expect(moves.length, speciesConst).toBeLessThanOrEqual(4);
      expect(new Set(moves).size, `${speciesConst} has duplicate egg moves`).toBe(moves.length);
      for (const m of moves) {
        expect(m, `${speciesConst} -> ${MoveId[m]}`).not.toBe(MoveId.NONE);
        expect(allMoves[m], `${speciesConst} -> move ${m} not in allMoves`).toBeDefined();
      }
    }
  });

  it("every entry's speciesConst resolves to a pokerogue species id (vanilla or ER)", () => {
    for (const speciesConst of Object.keys(ER_EGG_MOVES)) {
      expect(resolve(speciesConst), `${speciesConst} has no pokerogue id`).toBeDefined();
    }
  });

  it("egg moves are applied to speciesEggMoves at init", () => {
    // ER custom: Corm wired through the id-map.
    const cormPkrgId = resolve("SPECIES_CORM")!;
    expect(speciesEggMoves[cormPkrgId]).toEqual(ER_EGG_MOVES.SPECIES_CORM);
    // Vanilla: Bulbasaur present + overridden in place from the table.
    expect(speciesEggMoves[SpeciesId.BULBASAUR]).toEqual(ER_EGG_MOVES.SPECIES_BULBASAUR);
  });
});
