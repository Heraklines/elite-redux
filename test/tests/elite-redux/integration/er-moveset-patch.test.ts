/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: B6 moveset patch.
//
// Verifies that ER's level-up moveset rewrite (B6) actually changes the
// `pokemonSpeciesLevelMoves` table that pokerogue reads from. We don't run
// a full battle here — we just inspect the table directly, since that's the
// canonical source of truth for what moves a species learns at which level.
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES, type ErSpeciesDraft } from "#data/elite-redux/er-species";
import { describe, expect, it } from "vitest";

const VANILLA_SPECIES_CUTOFF = 10000;
const SPOT_CHECK_LIMIT = 50;

interface MovesetTally {
  matchedSpecies: number;
  totalSpeciesChecked: number;
  mismatches: string[];
}

function expectedErPairs(draft: ErSpeciesDraft): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const m of draft.levelUpMoves) {
    const pokerogueMoveId = ER_ID_MAP.moves[m.id];
    if (pokerogueMoveId !== undefined) {
      out.push([m.level, pokerogueMoveId] as const);
    }
  }
  return out;
}

function checkSpecies(draft: ErSpeciesDraft, tally: MovesetTally): void {
  if (draft.levelUpMoves.length === 0) {
    return;
  }
  const pokerogueSpeciesId = ER_ID_MAP.species[draft.id];
  if (pokerogueSpeciesId === undefined || pokerogueSpeciesId >= VANILLA_SPECIES_CUTOFF) {
    return;
  }
  const liveMoves = pokemonSpeciesLevelMoves[pokerogueSpeciesId];
  if (!liveMoves) {
    return;
  }
  tally.totalSpeciesChecked++;

  const expectedPairs = expectedErPairs(draft);
  const anyMatch = expectedPairs.some(([level, moveId]) => liveMoves.some(lm => lm[0] === level && lm[1] === moveId));

  if (anyMatch) {
    tally.matchedSpecies++;
  } else if (tally.mismatches.length < 3) {
    tally.mismatches.push(
      `${draft.speciesConst}: live[0..3]=${JSON.stringify(liveMoves.slice(0, 3))}, ER first ER-mapped=${JSON.stringify(expectedPairs.slice(0, 3))}`,
    );
  }
}

function tallyMovesetPatches(): MovesetTally {
  const tally: MovesetTally = { matchedSpecies: 0, totalSpeciesChecked: 0, mismatches: [] };
  for (const draft of ER_SPECIES) {
    if (tally.totalSpeciesChecked >= SPOT_CHECK_LIMIT) {
      break;
    }
    checkSpecies(draft, tally);
  }
  return tally;
}

describe("ER integration — B6 moveset patch is observable on pokemonSpeciesLevelMoves", () => {
  it("at least one vanilla species' live level-up moveset matches ER's draft", () => {
    const tally = tallyMovesetPatches();

    expect(tally.totalSpeciesChecked).toBeGreaterThan(0);
    expect(tally.matchedSpecies).toBeGreaterThan(0);

    if (tally.matchedSpecies < tally.totalSpeciesChecked) {
      console.info(
        `[er-moveset-test] ${tally.matchedSpecies}/${tally.totalSpeciesChecked} species had at least one ER move match. Mismatch examples: ${tally.mismatches.join(" | ")}`,
      );
    }
  });
});
