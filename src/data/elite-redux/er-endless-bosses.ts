/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { ErSpeciesId } from "#enums/er-species-id";
import type { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const ENDLESS_RAID_POOL_LIMIT = 20;
const ENDLESS_RAID_MIN_STARTER_COST = 10;

export interface ErEndlessRaidBossChoice {
  readonly species: PokemonSpecies;
  readonly formIndex: number;
  readonly baseTotal: number;
  readonly starterCost: number;
}

let cachedBossPool: readonly ErEndlessRaidBossChoice[] | null = null;

function strongestForm(species: PokemonSpecies): { formIndex: number; baseTotal: number } {
  if (species.forms.length === 0) {
    return { formIndex: 0, baseTotal: species.baseTotal };
  }
  let best = { formIndex: 0, baseTotal: species.forms[0]?.baseTotal ?? species.baseTotal };
  for (let formIndex = 1; formIndex < species.forms.length; formIndex++) {
    const baseTotal = species.forms[formIndex].baseTotal;
    if (baseTotal > best.baseTotal) {
      best = { formIndex, baseTotal };
    }
  }
  return best;
}

function strongestMemberOfStarterLine(rootSpeciesId: SpeciesId, starterCost: number): ErEndlessRaidBossChoice | null {
  let best: ErEndlessRaidBossChoice | null = null;
  for (const species of allSpecies) {
    if (species.getRootSpeciesId(true) !== rootSpeciesId) {
      continue;
    }
    const form = strongestForm(species);
    if (best == null || form.baseTotal > best.baseTotal) {
      best = { species, formIndex: form.formIndex, baseTotal: form.baseTotal, starterCost };
    }
  }
  return best;
}

/** Strongest available form from every 10+ cost starter line, plus Primal Cascoon. */
export function getErEndlessRaidBossPool(): readonly ErEndlessRaidBossChoice[] {
  if (cachedBossPool != null) {
    return cachedBossPool;
  }
  const candidates: ErEndlessRaidBossChoice[] = [];
  for (const [rawSpeciesId, rawCost] of Object.entries(speciesStarterCosts)) {
    const starterCost = Number(rawCost);
    if (starterCost < ENDLESS_RAID_MIN_STARTER_COST) {
      continue;
    }
    const rootSpeciesId = Number(rawSpeciesId) as SpeciesId;
    const strongest = strongestMemberOfStarterLine(rootSpeciesId, starterCost);
    if (strongest) {
      candidates.push(strongest);
    }
  }

  const primalCascoon = getPokemonSpecies(ErSpeciesId.CASCOON_PRIMAL as SpeciesId);
  if (primalCascoon) {
    const form = strongestForm(primalCascoon);
    candidates.push({
      species: primalCascoon,
      formIndex: form.formIndex,
      baseTotal: form.baseTotal,
      starterCost: 12,
    });
  }

  const seen = new Set<string>();
  const ranked = candidates
    .toSorted((left, right) => right.starterCost - left.starterCost || right.baseTotal - left.baseTotal)
    .filter(candidate => {
      const key = `${candidate.species.speciesId}:${candidate.formIndex}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  const forcedIds = new Set<number>([ErSpeciesId.CASCOON_PRIMAL, ErSpeciesId.MOLTRES_EX]);
  const forced = ranked.filter(candidate => forcedIds.has(candidate.species.speciesId));
  cachedBossPool = [
    ...forced,
    ...ranked.filter(candidate => !forcedIds.has(candidate.species.speciesId)),
  ].slice(0, ENDLESS_RAID_POOL_LIMIT);
  return cachedBossPool;
}

/** Cost 12 lines are nine times as likely as cost 10, while every pool member remains reachable. */
export function pickErEndlessRaidBoss(roll: number): ErEndlessRaidBossChoice {
  const pool = getErEndlessRaidBossPool();
  const fallback = pool[0] ?? {
    species: getPokemonSpecies(ErSpeciesId.CASCOON_PRIMAL as SpeciesId),
    formIndex: 0,
    baseTotal: 600,
    starterCost: 12,
  };
  const weights = pool.map(candidate => Math.max(1, (candidate.starterCost - 9) ** 2));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return fallback;
  }
  let target = Math.abs(Math.floor(roll)) % totalWeight;
  for (let index = 0; index < pool.length; index++) {
    target -= weights[index];
    if (target < 0) {
      return pool[index];
    }
  }
  return fallback;
}

/** Test hook for suites that reinitialize species data in one process. */
export function resetErEndlessRaidBossPoolForTests(): void {
  cachedBossPool = null;
}
