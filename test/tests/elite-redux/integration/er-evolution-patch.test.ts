/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: B6 evolution patch.
//
// Verifies that ER's level-evolution rewrite (`initEliteReduxEvolutions()`)
// actually mutates the `pokemonEvolutions` table that pokerogue reads from
// during evolution checks. We inspect the table directly — running a full
// level-up evolution in a real battle is overkill here; the table is the
// source of truth pokerogue's `tryEvolve()` reads from.
//
// ER ships level-evo edges of kind 0/3/4 (LEVEL, LEVEL_MALE, LEVEL_FEMALE)
// in `er-species.ts`. We translate them through the id-map and check that
// at least some are reflected in `pokemonEvolutions`.
// =============================================================================

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES, type ErEvolutionDraft, type ErSpeciesDraft } from "#data/elite-redux/er-species";
import { describe, expect, it } from "vitest";

const VANILLA_SPECIES_CUTOFF = 10000;
const LEVEL_EVO_KINDS = new Set([0, 3, 4]);
const MAX_EDGES_TO_CHECK = 30;

interface EvolutionTally {
  edgesChecked: number;
  edgesPresent: number;
  mismatches: string[];
}

interface ResolvedEdge {
  draftConst: string;
  targetId: number;
  level: number;
}

function resolveErEdge(draft: ErSpeciesDraft, evo: ErEvolutionDraft): ResolvedEdge | null {
  if (!LEVEL_EVO_KINDS.has(evo.kind)) {
    return null;
  }
  const pokerogueTargetId = ER_ID_MAP.species[evo.into];
  if (pokerogueTargetId === undefined) {
    return null;
  }
  const erLevel = Number.parseInt(evo.requirement, 10);
  if (!Number.isFinite(erLevel) || erLevel <= 0) {
    return null;
  }
  return { draftConst: draft.speciesConst, targetId: pokerogueTargetId, level: erLevel };
}

function checkEvoEdge(edge: ResolvedEdge, liveEvos: (typeof pokemonEvolutions)[number], tally: EvolutionTally): void {
  tally.edgesChecked++;
  const matched = liveEvos.some(e => e.speciesId === edge.targetId && e.level === edge.level);
  if (matched) {
    tally.edgesPresent++;
  } else if (tally.mismatches.length < 3) {
    const liveStr = liveEvos.map(e => `${e.speciesId}@L${e.level}`).join(", ");
    tally.mismatches.push(`${edge.draftConst} → species ${edge.targetId} @L${edge.level} not found in [${liveStr}]`);
  }
}

function tallyEvolutionEdges(): EvolutionTally {
  const tally: EvolutionTally = { edgesChecked: 0, edgesPresent: 0, mismatches: [] };

  for (const draft of ER_SPECIES) {
    if (tally.edgesChecked >= MAX_EDGES_TO_CHECK) {
      break;
    }
    if (draft.evolutions.length === 0) {
      continue;
    }
    const pokerogueSourceId = ER_ID_MAP.species[draft.id];
    if (pokerogueSourceId === undefined || pokerogueSourceId >= VANILLA_SPECIES_CUTOFF) {
      continue;
    }
    const liveEvos = pokemonEvolutions[pokerogueSourceId];
    if (!liveEvos) {
      continue;
    }

    for (const evo of draft.evolutions) {
      if (tally.edgesChecked >= MAX_EDGES_TO_CHECK) {
        break;
      }
      const edge = resolveErEdge(draft, evo);
      if (edge !== null) {
        checkEvoEdge(edge, liveEvos, tally);
      }
    }
  }

  return tally;
}

describe("ER integration — B6 evolution patch is observable on pokemonEvolutions", () => {
  it("at least one ER level-evolution edge is present in the live evolutions table", () => {
    const tally = tallyEvolutionEdges();

    expect(tally.edgesChecked).toBeGreaterThan(0);
    // B6 evolutions: at least one edge should match. If zero match, either
    // B6 didn't run, or every ER level requirement happens to equal pokerogue's
    // baseline (unlikely — ER tweaks evo levels routinely).
    expect(tally.edgesPresent).toBeGreaterThan(0);

    if (tally.edgesPresent < tally.edgesChecked) {
      console.info(
        `[er-evolution-test] ${tally.edgesPresent}/${tally.edgesChecked} ER level-evo edges present in live table. Examples of missing: ${tally.mismatches.join(" | ")}`,
      );
    }
  });
});
