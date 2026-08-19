/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { getErEndlessRaidBossPool, resetErEndlessRaidBossPoolForTests } from "#data/elite-redux/er-endless-bosses";
import { ErSpeciesId } from "#enums/er-species-id";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => resetErEndlessRaidBossPoolForTests());

describe("Elite Redux Endless raid boss pool", () => {
  it("uses at most 20 strongest-form bosses from cost 10+ starter lines", () => {
    const pool = getErEndlessRaidBossPool();
    const starterCosts = speciesStarterCosts as Record<number, number | undefined>;
    expect(pool.length).toBeGreaterThan(1);
    expect(pool.length).toBeLessThanOrEqual(20);
    for (const candidate of pool) {
      if (Number(candidate.species.speciesId) !== ErSpeciesId.CASCOON_PRIMAL) {
        const root = candidate.species.getRootSpeciesId(true);
        expect(starterCosts[root]).toBeGreaterThanOrEqual(10);
        const strongestLineTotal = allSpecies
          .filter(species => species.getRootSpeciesId(true) === root)
          .reduce(
            (best, species) => Math.max(best, species.baseTotal, ...species.forms.map(form => form.baseTotal)),
            0,
          );
        expect(candidate.baseTotal).toBe(strongestLineTotal);
      }
      expect(candidate.species.forms[candidate.formIndex]?.baseTotal ?? candidate.species.baseTotal).toBe(
        candidate.baseTotal,
      );
    }
  });

  it("keeps Primal Cascoon and always uses Mega Moltres Ex", () => {
    const pool = getErEndlessRaidBossPool();
    expect(pool.some(candidate => Number(candidate.species.speciesId) === ErSpeciesId.CASCOON_PRIMAL)).toBe(true);
    const moltresEx = pool.find(candidate => Number(candidate.species.speciesId) === ErSpeciesId.MOLTRES_EX);
    expect(moltresEx).toBeDefined();
    expect(moltresEx?.species.forms[moltresEx.formIndex]?.formKey).toMatch(/mega/i);
  });
});
