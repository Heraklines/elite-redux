/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared free-text ability search used by the starter-select and Pokédex
// filters. Matches a query (case-insensitive regex, substring fallback) against
// the FULL detailed ROM ability descriptions (#120) of a species' main ability
// + all innates — so e.g. "sun" surfaces every mon whose ability text mentions
// the sun (Chlorophyll, Drought, Solar Power, …), not just ability names.

import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import type { PokemonSpecies } from "#data/pokemon-species";

export function matchesAbilityText(species: PokemonSpecies, query: string): boolean {
  const q = query.trim();
  if (q === "") {
    return true;
  }
  let re: RegExp | null = null;
  try {
    re = new RegExp(q, "i");
  } catch {
    re = null; // invalid regex → substring fallback
  }
  const ql = q.toLowerCase();
  const ids = new Set<number>([
    species.ability1,
    species.ability2,
    species.abilityHidden,
    ...species.getPassiveAbilities(0),
  ]);
  for (const id of ids) {
    if (!id) {
      continue;
    }
    const ability = allAbilities[id];
    if (!ability) {
      continue;
    }
    // Resolve the detailed text by ID — the same authoritative description shown
    // on the in-battle ability "Detail" screen. This is locale-independent
    // (looking up by the ER-localized display name silently fails outside
    // English and falls back to the short text) and consistent with what the
    // player reads about the ability. Fall back to the short text only for
    // abilities with no ROM detail entry.
    const detailed = getErAbilityDescription(id) ?? ability.description ?? "";
    const haystack = `${ability.name}\n${detailed}`;
    if (re ? re.test(haystack) : haystack.toLowerCase().includes(ql)) {
      return true;
    }
  }
  return false;
}
