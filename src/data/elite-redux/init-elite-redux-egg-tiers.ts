/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — register ER-custom species in the egg-hatch + starter-cost
// tables so they're hatchable from gacha eggs.
//
// Pokerogue gates which species can hatch from eggs by membership in
// `speciesEggTiers`. ER customs (id >= 10000) are NOT in that table by
// default — meaning a player who hatches a bunch of eggs would never see
// any of the ER customs (Phantowl, Anubisn't, the regional-variant slot
// and so on).
//
// This init pass adds every ER-custom base/root species to
// `speciesEggTiers` with a sensible default tier, and to
// `speciesStarterCosts` with a default cost so the egg-weight calculation
// has a value to read. Both are runtime extensions of upstream tables.
//
// Tier picking heuristic:
//   - BST >= 600 → EPIC tier
//   - BST >= 540 → RARE tier
//   - Otherwise → COMMON tier
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { findErFormChangeByTarget } from "#data/elite-redux/er-form-change-overlay";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { EggTier } from "#enums/egg-type";
import type { SpeciesId } from "#enums/species-id";

const VANILLA_ID_CUTOFF = 10000;

export interface InitEliteReduxEggTiersResult {
  /** Number of ER-custom species added to speciesEggTiers. */
  eggTiersAdded: number;
  /** Number of ER-custom species added to speciesStarterCosts. */
  starterCostsAdded: number;
  /** Number of ER customs already in the table (idempotent skip). */
  alreadyPresent: number;
  /** Number of ER customs skipped because they have a prevolution (only base forms hatch). */
  skippedPrevolutions: number;
  /** Number of ER custom form-change targets skipped (megas, primals, move-megas). */
  skippedFormChanges: number;
}

function pickTier(draft: (typeof ER_SPECIES)[number]): EggTier {
  // BST-based tiering. The field is `baseStats: readonly [hp,atk,def,spatk,spdef,spd]`.
  const stats = draft.baseStats;
  if (Array.isArray(stats) && stats.length === 6) {
    const bst = stats.reduce((s, v) => s + v, 0);
    if (bst >= 600) {
      return EggTier.EPIC;
    }
    if (bst >= 540) {
      return EggTier.RARE;
    }
    if (bst >= 470) {
      // Mid-BST → uncommon. Without an UNCOMMON tier in pokerogue, this
      // bucket also lands in RARE eggs (less likely than EPIC, more likely
      // than COMMON spam).
      return EggTier.RARE;
    }
  }
  return EggTier.COMMON;
}

/**
 * Hand-tuned egg-tier overrides for ER customs by exact species name, taking
 * precedence over the BST banding in {@linkcode pickTier}. The Lake Trio Redux
 * (BST 580 → would band as RARE) are bumped to EPIC as requested.
 */
const EGG_TIER_OVERRIDES: Readonly<Record<string, EggTier>> = {
  "Azelf Redux": EggTier.EPIC,
  "Mesprit Redux": EggTier.EPIC,
  "Uxie Redux": EggTier.EPIC,
};

/**
 * Name-PREFIX egg-tier overrides, taking precedence over the BST banding in
 * {@linkcode pickTier} (and applied like {@linkcode EGG_TIER_OVERRIDES}). Used
 * for families where ER ships several custom mask/form entries that should all
 * share a tier. The Ogerpon masks (Wellspring / Hearthflame / Cornerstone) are
 * separate ER custom species at BST 550 — they'd band as RARE, but the vanilla
 * base Ogerpon is EPIC, so the whole family is pinned to EPIC. (The mega forms
 * are form-change targets and are removed from the egg pool earlier, so this
 * never promotes a mega.)
 */
const EGG_TIER_PREFIX_OVERRIDES: ReadonlyArray<readonly [string, EggTier]> = [
  // Ogerpon masks (Wellspring/Hearthflame/Cornerstone) — see above.
  ["Ogerpon", EggTier.EPIC],
  // Legendary/quasi-legendary families ER ships as separate custom forms
  // (Thundurus Therian, the Silvally type forms, …) at BST 570-580 → they band
  // as RARE. Pin the whole family to EPIC, matching their vanilla base tier
  // (THUNDURUS / TYPE_NULL are EPIC; a Therian/typed form shouldn't hatch lower).
  ["Thundurus", EggTier.EPIC],
  ["Silvally", EggTier.EPIC],
];

function resolveEggTierOverride(name: string): EggTier | undefined {
  if (name in EGG_TIER_OVERRIDES) {
    return EGG_TIER_OVERRIDES[name];
  }
  for (const [prefix, tier] of EGG_TIER_PREFIX_OVERRIDES) {
    if (name.startsWith(prefix)) {
      return tier;
    }
  }
  return;
}

function pickStarterCost(tier: EggTier): number {
  switch (tier) {
    case EggTier.LEGENDARY:
      return 8;
    case EggTier.EPIC:
      return 6;
    case EggTier.RARE:
      return 4;
    default:
      return 2;
  }
}

function isErFormChangeTarget(draft: (typeof ER_SPECIES)[number], speciesId: number): boolean {
  return (
    findErFormChangeByTarget(speciesId) !== undefined // HANGRY is Morpeko's in-battle alt-form (the Hunger Switch / Two-Faced // toggle target — SPECIES_MORPEKO_HANGRY / SPECIES_MORPEKYLL_HANGRY in the // ER dump). Like Mega/Primal it is a battle-only form, NOT a base/root mon,
    || // so it must never hatch from eggs or appear in starter selection. ER models
    // it as a separate custom species with no prevolution, so it would otherwise
    // leak past the prevolution gate below.
    /(?:^|_)MEGA(?:_|$)|(?:^|_)PRIMAL(?:_|$)|(?:^|_)HANGRY(?:_|$)/.test(draft.speciesConst)
    || /\b(Mega|Primal|Hangry)\b/i.test(draft.name ?? "")
  );
}

function removeRuntimeStarterRegistration(speciesId: number): void {
  const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
  const costs = speciesStarterCosts as Record<number, number | undefined>;
  delete tiers[speciesId];
  delete costs[speciesId];
}

/**
 * Add every ER-custom species to `speciesEggTiers` + `speciesStarterCosts`
 * so they become valid egg-hatch targets. Skips species that have a
 * prevolution and species that are form-change targets (only base/root mons
 * hatch from eggs or appear as starters).
 */
export function initEliteReduxEggTiers(): InitEliteReduxEggTiersResult {
  const result: InitEliteReduxEggTiersResult = {
    eggTiersAdded: 0,
    starterCostsAdded: 0,
    alreadyPresent: 0,
    skippedPrevolutions: 0,
    skippedFormChanges: 0,
  };

  const tiers = speciesEggTiers as Record<number, EggTier>;
  const costs = speciesStarterCosts as Record<number, number>;

  // Robust evolved-form guard. #104's species renumbering left some ER
  // evolution `into` ids stale, so a few evolved customs (e.g. the Redux
  // Chimchar line → Infernape Redux) never get a prevolution registered and
  // wrongly leak into eggs. As a name-based safety net: an ER custom whose name
  // (minus its form qualifier) matches a vanilla species that itself has a
  // prevolution is an evolved stage and must not hatch. (Chimchar Redux →
  // "chimchar" has no prevo → still hatches; Infernape Redux → "infernape" has
  // a prevo → skipped.)
  const vanillaByName = new Map<string, number>();
  const idToName = new Map<number, string>();
  for (const sp of allSpecies) {
    idToName.set(sp.speciesId, sp.name);
    if (sp.speciesId < VANILLA_ID_CUTOFF) {
      vanillaByName.set(sp.name.toLowerCase(), sp.speciesId);
    }
  }
  // Registered ER-custom species names (lowercased) — to detect whether a
  // LOWER-stage custom of the same form exists in a line.
  const erCustomNames = new Set<string>();
  for (const d of ER_SPECIES) {
    const id = ER_ID_MAP.species[d.id];
    if (id !== undefined && id >= VANILLA_ID_CUTOFF && d.name) {
      erCustomNames.add(d.name.toLowerCase());
    }
  }
  const formQualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;
  const vanillaBaseIsEvolved = (draftName: string): boolean => {
    const base = draftName.replace(formQualifier, "").trim().toLowerCase();
    const vanillaId = vanillaByName.get(base);
    return vanillaId !== undefined && Object.hasOwn(pokemonPrevolutions, vanillaId as SpeciesId);
  };
  // For an orphaned evolved custom (no prevolution edge points to it), is there
  // a LOWER-stage custom of the SAME form suffix to hatch instead? Walk the
  // vanilla base's prevolution chain and check for "<lowerVanilla> <suffix>".
  // (e.g. "Chandelure Redux" → is "Lampent Redux" or "Litwick Redux" a custom?)
  const hasLowerSuffixCustom = (draftName: string): boolean => {
    const suffix = draftName.match(formQualifier)?.[1];
    if (!suffix) {
      return false;
    }
    const base = draftName.replace(formQualifier, "").trim().toLowerCase();
    let cur = vanillaByName.get(base);
    let guard = 0;
    while (cur !== undefined && Object.hasOwn(pokemonPrevolutions, cur as SpeciesId) && guard++ < 10) {
      cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
      const lowerName = idToName.get(cur);
      if (lowerName && erCustomNames.has(`${lowerName} ${suffix}`.toLowerCase())) {
        return true;
      }
    }
    return false;
  };
  // Vanilla evolution-stage depth (0 = base, 1 = 2nd stage, 2 = 3rd) of a custom
  // from its base name — used to bump the cost when a non-base form hatches
  // directly because its line has no lower custom.
  const stageDepthOf = (draftName: string): number => {
    const base = draftName.replace(formQualifier, "").trim().toLowerCase();
    let cur = vanillaByName.get(base);
    let depth = 0;
    while (cur !== undefined && Object.hasOwn(pokemonPrevolutions, cur as SpeciesId) && depth < 5) {
      cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
      depth++;
    }
    return depth;
  };

  for (const draft of ER_SPECIES) {
    const pkrgId = ER_ID_MAP.species[draft.id];
    if (pkrgId === undefined || pkrgId < VANILLA_ID_CUTOFF) {
      continue;
    }
    if (isErFormChangeTarget(draft, pkrgId)) {
      removeRuntimeStarterRegistration(pkrgId);
      result.skippedFormChanges++;
      continue;
    }
    // Skip if already prevolution-gated (non-base forms can't hatch).
    if (Object.hasOwn(pokemonPrevolutions, pkrgId as SpeciesId)) {
      removeRuntimeStarterRegistration(pkrgId);
      result.skippedPrevolutions++;
      continue;
    }
    // Orphaned evolved custom: no prevolution edge points to it, but its vanilla
    // base IS evolved (e.g. Weavile Redux, Flygon Redux B — ER ships only the
    // evolved Redux, with no Sneasel/Vibrava/Trapinch Redux base). It can't be
    // reached by evolving, so to keep EVERY line reachable it must hatch the
    // lowest existing custom of its form directly — UNLESS a lower same-suffix
    // custom exists (then hatch that one instead). Direct-hatched non-base forms
    // pay a stage-bumped cost.
    let orphanStageBump = 0;
    if (vanillaBaseIsEvolved(draft.name)) {
      if (hasLowerSuffixCustom(draft.name)) {
        removeRuntimeStarterRegistration(pkrgId);
        result.skippedPrevolutions++;
        continue;
      }
      orphanStageBump = stageDepthOf(draft.name) * 2;
    }
    if (tiers[pkrgId] !== undefined) {
      result.alreadyPresent++;
      continue;
    }
    const tier = resolveEggTierOverride(draft.name ?? "") ?? pickTier(draft);
    tiers[pkrgId] = tier;
    result.eggTiersAdded++;
    if (costs[pkrgId] === undefined) {
      costs[pkrgId] = pickStarterCost(tier) + orphanStageBump;
      result.starterCostsAdded++;
    }
  }

  return result;
}
