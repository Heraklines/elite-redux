/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared free-text ability search used by the starter-select and Pokédex
// filters. Matches a query (case-insensitive regex, substring fallback) against
// the FULL detailed ROM ability descriptions (#120) of a species' main ability
// + all innates — so e.g. "sun" surfaces every mon whose ability text mentions
// the sun (Chlorophyll, Drought, Solar Power, …), not just ability names.
//
// The match also walks the species' whole EVOLUTION LINE (descendants via
// `pokemonEvolutions`, which includes ER-injected evos) AND its MEGA / PRIMAL
// forms (the ER form-change registry). Starter-select only shows base forms, so
// without this a search for "hail" would miss a base mon whose *evolution* or
// *mega* is the one that actually has the ability — exactly the info you need
// when team-building.

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { allAbilities } from "#data/data-lists";
import { getErAbilityDescription } from "#data/elite-redux/er-ability-descriptions";
import { ER_FORM_CHANGE_KIND, ER_FORM_CHANGES_BY_SOURCE } from "#data/elite-redux/init-elite-redux-form-changes";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** True if any of `species`' own (main + innate) abilities' text matches. */
function speciesAbilityTextMatches(species: PokemonSpecies, re: RegExp | null, ql: string): boolean {
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

/**
 * Collect the species id of `start` plus every evolution descendant and every
 * MEGA / PRIMAL / MOVE_MEGA form reachable from any member of that line. Guards
 * against cycles and bounds the walk.
 */
function collectFamilySpeciesIds(start: number): number[] {
  const seen = new Set<number>();
  const queue: number[] = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    // Forward evolutions (ER evos are patched onto this same table).
    for (const evo of pokemonEvolutions[id as SpeciesId] ?? []) {
      if (evo?.speciesId != null && !seen.has(evo.speciesId)) {
        queue.push(evo.speciesId);
      }
    }
    // Mega / primal / move-mega forms (ER models these as separate species).
    for (const fc of ER_FORM_CHANGES_BY_SOURCE.get(id) ?? []) {
      const isFormChange =
        fc.kind === ER_FORM_CHANGE_KIND.MEGA
        || fc.kind === ER_FORM_CHANGE_KIND.PRIMAL
        || fc.kind === ER_FORM_CHANGE_KIND.MOVE_MEGA;
      if (isFormChange && fc.targetSpeciesId != null && !seen.has(fc.targetSpeciesId)) {
        queue.push(fc.targetSpeciesId);
      }
    }
  }
  return [...seen];
}

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

  // Check the base species first (the common case), then walk its evolution +
  // mega family so a search surfaces base mons whose evolved/mega forms carry
  // the ability.
  if (speciesAbilityTextMatches(species, re, ql)) {
    return true;
  }
  for (const id of collectFamilySpeciesIds(species.speciesId)) {
    if (id === species.speciesId) {
      continue; // already checked
    }
    let related: PokemonSpecies | undefined;
    try {
      related = getPokemonSpecies(id as SpeciesId);
    } catch {
      related = undefined;
    }
    if (related && speciesAbilityTextMatches(related, re, ql)) {
      return true;
    }
  }
  return false;
}
