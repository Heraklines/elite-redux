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
import { describe, expect, it } from "vitest";

describe("ER egg moves", () => {
  const draftIdByConst = new Map<string, number>();
  for (const d of ER_SPECIES) {
    draftIdByConst.set(d.speciesConst, d.id);
  }

  it("every entry has exactly 4 distinct, real moves", () => {
    for (const [speciesConst, moves] of Object.entries(ER_EGG_MOVES)) {
      expect(moves, speciesConst).toHaveLength(4);
      expect(new Set(moves).size, `${speciesConst} has duplicate egg moves`).toBe(4);
      for (const m of moves) {
        expect(m, `${speciesConst} -> ${MoveId[m]}`).not.toBe(MoveId.NONE);
        expect(allMoves[m], `${speciesConst} -> move ${m} not in allMoves`).toBeDefined();
      }
    }
  });

  it("every entry's speciesConst resolves to a registered ER species id", () => {
    for (const speciesConst of Object.keys(ER_EGG_MOVES)) {
      const draftId = draftIdByConst.get(speciesConst);
      expect(draftId, `${speciesConst} not found in ER_SPECIES`).toBeDefined();
      const pkrgId = ER_ID_MAP.species[draftId!];
      expect(pkrgId, `${speciesConst} has no pokerogue id`).toBeDefined();
    }
  });

  it("egg moves are injected into speciesEggMoves at init", () => {
    // Spot-check a known batch-1 species (Corm) is wired through.
    const cormDraftId = draftIdByConst.get("SPECIES_CORM")!;
    const cormPkrgId = ER_ID_MAP.species[cormDraftId];
    expect(speciesEggMoves[cormPkrgId]).toEqual(ER_EGG_MOVES.SPECIES_CORM);
  });
});
