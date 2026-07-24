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
import { enSpeciesName } from "#data/elite-redux/er-canonical-names";
import { applyErEggPoolBans } from "#data/elite-redux/er-egg-pool-bans";
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
  /** Number of drafts skipped because their pkrg id is not a registered species (degenerate stub / id-map drift). */
  skippedUnregistered: number;
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
  // Wooly Worm (BST 570 → bands as RARE) is a high-value custom; pin to EPIC.
  "Wooly Worm": EggTier.EPIC,
  // ER-custom Typhlosion regional form (pokedex No 0439): "Lumbering Sloth
  // Engulfed" (BST 570 → bands as RARE). A custom legendary-tier regional
  // variant; pin to EPIC to match its vanilla-base-tier expectation.
  "Lumbering Sloth Engulfed": EggTier.EPIC,
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
  // Tornadus Therian (pokedex No 0268 region; ER custom, BST 580 → bands as
  // RARE). Like Thundurus, the vanilla base (TORNADUS) is EPIC, so the Therian
  // form is pinned to EPIC for parity. Prefix covers any other Tornadus customs.
  ["Tornadus", EggTier.EPIC],
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
  const isBattleForm =
    findErFormChangeByTarget(speciesId) !== undefined // HANGRY is Morpeko's in-battle alt-form (the Hunger Switch / Two-Faced // toggle target — SPECIES_MORPEKO_HANGRY / SPECIES_MORPEKYLL_HANGRY in the // ER dump). Like Mega/Primal it is a battle-only form, NOT a base/root mon, // so it must never hatch from eggs or appear in starter selection. ER models // it as a separate custom species with no prevolution, so it would otherwise // leak past the prevolution gate below. BOND / BLUNDER are Darmanitan Redux's // special Battle-Bond forms (SPECIES_DARMANITAN_REDUX_BOND / _BLUNDER) — also // battle-only forms reached via the Bond chain off the base Darmanitan Redux, // never base/root mons, so they must be excluded the same way. AURA is // Darmanitan Redux's Zen-Mode-style alternate battle form // (SPECIES_DARMANITAN_REDUX_AURA, "Darmanitan Aura") — likewise a // battle-emergent form that must NOT hatch (it was leaking into RARE eggs).
    || /(?:^|_)MEGA(?:_|$)|(?:^|_)PRIMAL(?:_|$)|(?:^|_)HANGRY(?:_|$)|(?:^|_)BOND(?:_|$)|(?:^|_)BLUNDER(?:_|$)|(?:^|_)AURA(?:_|$)|(?:^|_)BLADE(?:_|$)|(?:^|_)SCHOOL(?:_|$)|(?:^|_)ZEN(?:_|$)|(?:^|_)NOICE(?:_|$)|(?:^|_)CROWNED(?:_|$)|(?:^|_)ORIGIN(?:_|$)|(?:^|_)GIGANTAMAX(?:_|$)|(?:^|_)GMAX(?:_|$)|(?:^|_)ETERNAMAX(?:_|$)/.test(
      draft.speciesConst,
    ) // Display-name battle-form tokens (#352: "Aegislash Blade Redux" hatched — // Blade is Stance Change's in-battle form, ability-driven, so it is neither // a form-change-registry target nor prevolution-gated). School/Zen/Noice/ // Crowned/Origin/Gigantamax are the same class of battle/at-will forms. // ... Busted (Mimikyu's broken Disguise), Gulping/Gorging (Cramorant's // Gulp Missile payloads) and Sunshine (Cherrim's Flower Gift form) are the // same battle-only class (#407) - verified unambiguous across ER_SPECIES.
    || /\b(Mega|Primal|Hangry|Bond|Blunder|Blade|School|Zen|Noice|Crowned|Origin|Gigantamax|Eternamax|Busted|Gulping|Gorging|Sunshine)\b/i.test(
      draft.name ?? "",
    )
    || /^Darmanitan Aura$/i.test(draft.name ?? "");

  // Vanilla alternate-form mechanics remain the only way to reach these
  // standalone dump entries. REDUX/APEX suffixed customs remain hatchable.
  const isStandaloneVanillaForm =
    /^SPECIES_(UNOWN|ARCEUS|CASTFORM|DEOXYS|BURMY|WORMADAM|SHELLOS|GASTRODON|ROTOM|SHAYMIN|GIRATINA|BASCULIN|DEERLING|SAWSBUCK|TORNADUS|THUNDURUS|LANDORUS|ENAMORUS|KELDEO|MELOETTA|GENESECT|VIVILLON|FLABEBE|FLOETTE|FLORGES|FURFROU|PUMPKABOO|GOURGEIST|ZYGARDE|HOOPA|ORICORIO|LYCANROC|MINIOR|NECROZMA|MAGEARNA|KYUREM|SILVALLY|TOXTRICITY|ALCREMIE|INDEEDEE|MEOWSTIC|BASCULEGION|OINKOLOGNE|URSHIFU|CALYREX|ZARUDE|SQUAWKABILLY|TATSUGIRI|DUDUNSPARCE|MAUSHOLD|PIKACHU|EEVEE|TERAPAGOS|MIMIKYU|CRAMORANT|EISCUE|MORPEKO|WISHIWASHI)_[A-Z0-9]/.test(
      draft.speciesConst,
    ) && !/_(REDUX|APEX)(?:_|$)/.test(draft.speciesConst);

  return isBattleForm || isStandaloneVanillaForm;
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
    skippedUnregistered: 0,
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
  // #633: build BOTH name maps from the locale-INVARIANT (forced-English) name so
  // co-op clients in any language resolve the same vanilla bases. `idToName`'s
  // values are later compared against `erCustomNames` (static English draft names),
  // and `vanillaByName` is queried with static-English `draft.name` - so both must
  // hold English keys/values to match cross-locale (sp is a live PokemonSpecies).
  const vanillaByName = new Map<string, number>();
  const idToName = new Map<number, string>();
  for (const sp of allSpecies) {
    const enName = enSpeciesName(sp);
    idToName.set(sp.speciesId, enName);
    if (sp.speciesId < VANILLA_ID_CUTOFF) {
      vanillaByName.set(enName.toLowerCase(), sp.speciesId);
    }
  }
  // Registered ER-custom species names (lowercased) — to detect whether a
  // LOWER-stage custom of the same form exists in a line. `d` iterates ER_SPECIES
  // drafts, whose `.name` is already static English (locale-invariant) - leave as is.
  const erCustomNames = new Set<string>();
  for (const d of ER_SPECIES) {
    const id = ER_ID_MAP.species[d.id];
    if (id !== undefined && id >= VANILLA_ID_CUTOFF && d.name) {
      erCustomNames.add(d.name.toLowerCase());
    }
  }
  const formQualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;
  /**
   * Resolve a custom's VANILLA base species id from its display name.
   * 1) Strip the trailing form qualifier and try an exact vanilla-name match
   *    ("Infernape Redux" → "infernape").
   * 2) Fallback (#352): the LONGEST LEADING word-prefix that is a vanilla name.
   *    Names with a MIDDLE form token used to slip the evolved-base guard
   *    entirely ("Aegislash Blade Redux" → "aegislash blade" matched nothing →
   *    hatched a fully-evolved battle form). "aegislash" now resolves.
   *    Genuinely new ER lines ("Wispywaspy", "Terrow") match no prefix → undefined.
   */
  const resolveVanillaBaseId = (draftName: string): number | undefined => {
    const stripped = draftName.replace(formQualifier, "").trim().toLowerCase();
    const exact = vanillaByName.get(stripped);
    if (exact !== undefined) {
      return exact;
    }
    const words = stripped.split(/\s+/);
    for (let n = words.length; n >= 1; n--) {
      const prefix = words.slice(0, n).join(" ");
      const id = vanillaByName.get(prefix);
      if (id !== undefined) {
        return id;
      }
    }
    return;
  };
  const vanillaBaseIsEvolved = (draftName: string): boolean => {
    const vanillaId = resolveVanillaBaseId(draftName);
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
    let cur = resolveVanillaBaseId(draftName);
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
    let cur = resolveVanillaBaseId(draftName);
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
    // A draft can map to a pkrg id that was NEVER registered into `allSpecies`
    // (e.g. a degenerate all-zero stub dropped during species init, or id-map
    // drift). Writing such an id into `speciesEggTiers` creates a dangling
    // egg-pool entry: when an egg rolls that tier, `getPokemonSpecies(id)` is
    // undefined and the variant filter (`getPokemonSpecies(s).hasVariants()`)
    // hard-crashes the hatch. `idToName` is built from `allSpecies`, so a miss
    // means the species isn't registered — skip it. (Fixes the EggLapsePhase
    // freeze after a battle when auto-restock rolls a variant egg.)
    if (!idToName.has(pkrgId)) {
      result.skippedUnregistered++;
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

  // Declutter ban list (#407): drop the imported alternate-form duplicates
  // (Unown letters, Arceus plates, Pikachu caps, ...) and battle-only forms
  // from BOTH the egg pool and starter select. See er-egg-pool-bans.ts.
  applyErEggPoolBans();

  // Owner-approved standalone Alpha forms. They are intentionally obtainable
  // despite the broad BURMY_/CALYREX_ alternate-form safety filter above.
  const alphaEggOverrides: ReadonlyArray<readonly [string, EggTier, number]> = [
    ["SPECIES_BURMY_ETERNA", EggTier.LEGENDARY, 11],
    ["SPECIES_CALYREX_CLOUD_RIDER", EggTier.LEGENDARY, 9],
  ];
  for (const [speciesConst, tier, cost] of alphaEggOverrides) {
    const draft = ER_SPECIES.find(entry => entry.speciesConst === speciesConst);
    const id = draft ? ER_ID_MAP.species[draft.id] : undefined;
    if (id === undefined || !idToName.has(id)) {
      continue;
    }
    if (tiers[id] === undefined) {
      result.eggTiersAdded++;
    }
    if (costs[id] === undefined) {
      result.starterCostsAdded++;
    }
    tiers[id] = tier;
    costs[id] = cost;
  }

  return result;
}

// =============================================================================
// Multi-form family down-weighting.
//
// Many ER families ship as MANY separate egg-pool species (Arceus's type plates,
// Silvally's type forms, the Ogerpon masks, Therian forms, …). Each is its own
// egg entry, so collectively a family of N forms appears N× and dominates the
// pool. To keep the WHOLE family at roughly a single mon's appearance rate, each
// egg-pool form's weight is divided by the number of egg-eligible siblings in
// its family (see `getErEggWeightDivisor`, consumed by `Egg.rollSpecies`).
//
// Family key: the longest leading word-prefix of the custom's name that matches
// a vanilla species name (so "Arceus Fire"/"Arceus Water"/… → "arceus",
// "Silvally Steel" → "silvally", "Tornadus Therian" → "tornadus"); a custom with
// no vanilla-name prefix is its own family (divisor 1). Built lazily from the
// LIVE `speciesEggTiers` so it reflects every add/removal done during init.
// =============================================================================

let erEggWeightDivisors: ReadonlyMap<number, number> | null = null;

function buildErEggWeightDivisors(): Map<number, number> {
  const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
  // #633: locale-INVARIANT (forced-English) names so the family grouping is the
  // same on every co-op client. `idToName`'s values feed `familyKey`, which is
  // compared against `vanillaNames` - so both must hold English (sp is live).
  const vanillaNames = new Set<string>();
  const idToName = new Map<number, string>();
  for (const sp of allSpecies) {
    const enName = enSpeciesName(sp);
    idToName.set(sp.speciesId, enName);
    if (sp.speciesId < VANILLA_ID_CUTOFF) {
      vanillaNames.add(enName.toLowerCase());
    }
  }
  // ER-custom multi-form families with NO vanilla name prefix (the vanilla
  // loop below can't group them). Grotom + its 5 appliance variants (#407)
  // would otherwise each roll at FULL weight - 6x one mon's appearance rate.
  const ER_FAMILY_PREFIXES = ["grotom"];
  const familyKey = (name: string): string => {
    const lower = name.toLowerCase();
    const erFam = ER_FAMILY_PREFIXES.find(p => lower === p || lower.startsWith(`${p} `));
    if (erFam) {
      return erFam;
    }
    const words = name.split(/\s+/);
    for (let n = words.length; n >= 1; n--) {
      const prefix = words.slice(0, n).join(" ").toLowerCase();
      if (vanillaNames.has(prefix)) {
        return prefix;
      }
    }
    return lower;
  };
  const idFamily = new Map<number, string>();
  const familyCount = new Map<string, number>();
  for (const key of Object.keys(tiers)) {
    const id = Number(key);
    if (id < VANILLA_ID_CUTOFF || tiers[id] === undefined) {
      continue;
    }
    const name = idToName.get(id);
    if (!name) {
      continue;
    }
    const fam = familyKey(name);
    idFamily.set(id, fam);
    familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
  }
  const divisors = new Map<number, number>();
  for (const [id, fam] of idFamily) {
    divisors.set(id, Math.max(1, familyCount.get(fam) ?? 1));
  }
  return divisors;
}

/**
 * Egg-weight divisor for an ER-custom species: the number of egg-eligible forms
 * in its family (so an N-form family totals ≈ 1× a single mon instead of N×).
 * Returns 1 for vanilla ids and any custom that isn't part of a multi-form
 * family. Lazily computed + cached on first call (after all init has run).
 */
export function getErEggWeightDivisor(speciesId: number): number {
  if (speciesId < VANILLA_ID_CUTOFF) {
    return 1;
  }
  if (erEggWeightDivisors === null) {
    erEggWeightDivisors = buildErEggWeightDivisors();
  }
  return erEggWeightDivisors.get(speciesId) ?? 1;
}
