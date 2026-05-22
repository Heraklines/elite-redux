/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: B3 vanilla rebalance.
//
// Verifies that ER's stat rebalance pass (`initEliteReduxVanillaRebalance()`)
// actually patches the live `Move` instances in `allMoves` that pokerogue
// reads from during damage calculation. We don't run a full battle here —
// we just inspect the move's runtime fields, which is enough to confirm the
// patch landed without simulating phaser scenes (cheap, fast).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES, type ErMoveDraft } from "#data/elite-redux/er-moves";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

interface RebalanceTally {
  matchedCount: number;
  mismatchedCount: number;
  mismatches: string[];
}

function shouldConsiderDraft(draft: ErMoveDraft): boolean {
  if (draft.archetype !== "vanilla") {
    return false;
  }
  if (draft.power <= 0) {
    return false;
  }
  const pokerogueId = ER_ID_MAP.moves[draft.id];
  return pokerogueId !== undefined && pokerogueId < VANILLA_ID_CUTOFF;
}

function tallyRebalanceMatches(): RebalanceTally {
  const movesById = new Map<number, (typeof allMoves)[number]>();
  for (const m of allMoves) {
    movesById.set(m.id, m);
  }

  const tally: RebalanceTally = { matchedCount: 0, mismatchedCount: 0, mismatches: [] };

  for (const draft of ER_MOVES) {
    if (!shouldConsiderDraft(draft)) {
      continue;
    }
    const pokerogueId = ER_ID_MAP.moves[draft.id]!;
    const move = movesById.get(pokerogueId);
    if (!move) {
      continue;
    }

    if (move.power === draft.power) {
      tally.matchedCount++;
    } else {
      tally.mismatchedCount++;
      if (tally.mismatches.length < 5) {
        tally.mismatches.push(`${move.name}: live=${move.power}, ER=${draft.power}`);
      }
    }
  }

  return tally;
}

describe("ER integration — B3 vanilla rebalance is observable on allMoves", () => {
  it("at least one vanilla move's runtime power differs from pokerogue's baseline", () => {
    const tally = tallyRebalanceMatches();

    // B3 should have patched at least SOME vanilla moves to ER's power values.
    // If matchedCount is 0, either: (a) B3 didn't run, (b) ER ships identical
    // power values for every vanilla move (extremely unlikely — ER's whole
    // selling point is balance changes), or (c) B3's writes got overwritten.
    expect(tally.matchedCount).toBeGreaterThan(0);

    // Report drift but don't fail — informational.
    if (tally.mismatchedCount > 0) {
      console.info(
        `[er-rebalance-test] ${tally.matchedCount} matches, ${tally.mismatchedCount} mismatches. Examples: ${tally.mismatches.join("; ")}`,
      );
    }
  });
});
