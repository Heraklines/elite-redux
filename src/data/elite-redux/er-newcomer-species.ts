/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — HAND-AUTHORABLE new-SPECIES seam (fakemon newcomer patch).
//
// The mega/primal newcomers live as FORMS on an existing species
// (`er-newcomer-forms.ts`). This sibling seam registers brand-new SPECIES that
// are NOT in the ER 2.65 dump. Three obtainability shapes are supported, each
// with its own leak profile:
//
//   1. EVOLUTION-ONLY new species (Tentalect / Astoot / Discupid): reachable ONLY
//      by evolving an existing mon. They get a species record (stats, N-typing,
//      active/innate triple, learnset, #287 sprite redirect via the ErCustomSpecies
//      slug pipeline) and a level-50 evolution EDGE onto `pokemonEvolutions` — but
//      NO starter cost and NO egg tier, so they never surface in the starter grid,
//      the egg pool, or wild spawns (#133/#232/#352). Because they carry a
//      prevolution, the ER egg/starter passes (which only look at the dump anyway)
//      also skip them. Dex registration on evolve is automatic: `initDexData`
//      seeds a `dexData` entry for every `allSpecies` member, so the standard
//      caught/seen path handles them exactly like the dump's evolved customs.
//
//   2. STARTER new species (partner Eevee): its OWN dex slot + starter cost (the
//      maintainer-confirmed obtainability — a separate starter mon, NOT a form on
//      vanilla Eevee, so vanilla Eevee stays byte-identical). No egg tier.
//
//   3. EGG-POOL new species (Regitube): the editor custom-mons registration shape
//      (starter cost + egg tier), because it is a base-of-line, egg-obtainable
//      standalone. No line, so the base-form-only egg rules are trivially met.
//
// The partner-Eevee FAMILY (partner Eevee + 8 partner eeveelutions) is registered
// here too: each is an EXACT clone of its base eeveelution's LIVE (ER-patched) kit
// — read from the base species at init time so the clone can never drift — with
// its FIRST innate replaced by a [innate + Omniform] composite (see
// `composite-newcomers.ts`). The 8 partner eeveelutions carry NO cost/egg tier;
// they are reachable only as Omniform transform targets. The production Omniform
// mappings that chain the whole family (Water->Vaporeon, Electric->Jolteon, ...)
// are registered here.
//
// Split across two init passes (see init.ts):
//   - `injectErNewcomerSpecies()`  — after the base-kit + custom-species init
//     (species records, evolution edges, egg/starter tables, Omniform mappings).
//   - `applyErNewcomerSpeciesLearnsets()` — after `initEliteReduxMovesets` rebuilds
//     `pokemonSpeciesLevelMoves` from the dump (learnset clone + additions).
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { pokemonEvolutions, SpeciesEvolution } from "#balance/pokemon-evolutions";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import {
  ER_PARTNER_EEVEE_ABILITY_ID,
  ER_PARTNER_ESPEON_ABILITY_ID,
  ER_PARTNER_FLAREON_ABILITY_ID,
  ER_PARTNER_GLACEON_ABILITY_ID,
  ER_PARTNER_JOLTEON_ABILITY_ID,
  ER_PARTNER_LEAFEON_ABILITY_ID,
  ER_PARTNER_SYLVEON_ABILITY_ID,
  ER_PARTNER_UMBREON_ABILITY_ID,
  ER_PARTNER_VAPOREON_ABILITY_ID,
} from "#data/elite-redux/abilities/composite-newcomers";
import { registerOmniformMapping } from "#data/elite-redux/abilities/omniform";
import { registerErEditorMon } from "#data/elite-redux/init-elite-redux-custom-species";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { getPokemonSpecies } from "#utils/pokemon-utils";

// ---------------------------------------------------------------------------
// New-species ids. Hand-authored newcomer species live in a dedicated 70000+
// band, above the ER dump customs (10000-10880) and editor mons (60000-69999),
// so nothing collides. Any id >= 10000 flows through the ErCustomSpecies slug
// pipeline (slug sprites/icons, crash-safe cry/name, sprite-only asset loading).
// ---------------------------------------------------------------------------
export const ER_TENTALECT_SPECIES_ID = 70001;
export const ER_ASTOOT_SPECIES_ID = 70002;
export const ER_DISCUPID_SPECIES_ID = 70003;
export const ER_REGITUBE_SPECIES_ID = 70004;

export const ER_PARTNER_EEVEE_SPECIES_ID = 70011;
export const ER_PARTNER_VAPOREON_SPECIES_ID = 70012;
export const ER_PARTNER_JOLTEON_SPECIES_ID = 70013;
export const ER_PARTNER_FLAREON_SPECIES_ID = 70014;
export const ER_PARTNER_ESPEON_SPECIES_ID = 70015;
export const ER_PARTNER_UMBREON_SPECIES_ID = 70016;
export const ER_PARTNER_LEAFEON_SPECIES_ID = 70017;
export const ER_PARTNER_GLACEON_SPECIES_ID = 70018;
export const ER_PARTNER_SYLVEON_SPECIES_ID = 70019;

// ER-custom / vanilla ability ids used below (verified live via ER_ID_MAP at
// authoring time; the seam test asserts each resolves to a real allAbilities entry).
const CORROSION = 212; // vanilla
const PREDATOR = 5101;
const TOXIC_CHAIN = 302; // vanilla
const PUPPET_STRINGS = 5901;
const MINION_CONTROL = 5299;
const CORRUPTED_MIND = 5475;
const MYSTIC_POWER = 5025;
const HEADSTRONG = 5504;
const AIR_BLOWER = 5058;
const LIBRARY = 5928;
const BRAINPOWER = 5940; // composite (Emanate + Insomnia)
const FAMILIAR = 5941; // composite (Majestic Bird + Archmage)
const POWER_SPOT = 249; // vanilla
const RAINBOW_FISH = 5943; // composite (Swift Swim + Marvel Scale)
const FRIEND_GUARD = 132; // vanilla
const SOULMATE = 5918;
const RENDEZVOUS = 5919;
const HEARTBREAK = 5920;
const SEA_GUARDIAN = 5094;
const DRIZZLE = 2; // vanilla
const AFTERMATH = 106; // vanilla
const PRESSURE_VESSEL = 5914;
const RAIN_PUMP = 5915;
const LIFE_PRESERVER = 5916;

/**
 * A hand-authored EVOLUTION-ONLY new species: reachable only by evolving
 * {@linkcode evolvesFrom} at {@linkcode evolveLevel}. Never in the starter grid,
 * egg pool, or wild spawns.
 */
interface NewcomerEvoSpeciesDef {
  readonly speciesId: number;
  readonly name: string;
  readonly slug: string;
  /** Full static typing (1..N). type1 = [0], type2 = [1] ?? null, extras = [2..]. */
  readonly types: readonly [PokemonType, ...PokemonType[]];
  readonly stats: readonly [number, number, number, number, number, number];
  readonly actives: readonly [number, number, number];
  readonly innates: readonly [number, number, number];
  readonly catchRate: number;
  /** Existing species this evolves FROM (the level-50 edge source). */
  readonly evolvesFrom: SpeciesId;
  /** Evolution level (50 for all three per the patch). */
  readonly evolveLevel: number;
  /** Optional explicit cry-audio key hook (asset lands in the assets phase). */
  readonly cryKey?: string;
  /**
   * Learnset additions appended to the CLONED pre-evo learnset — typing-appropriate
   * moves granted at the evolution level. Derivation documented per entry.
   */
  readonly learnsetAdditions: ReadonlyArray<readonly [number, MoveId]>;
}

/**
 * The three evolution-only newcomer species.
 *
 * Learnset derivation (per the patch): each takes its PRE-EVO's level-up learnset
 * verbatim and appends a small typing-appropriate set at the evolution level (50),
 * so the evolved form immediately gains coverage matching its new typing.
 */
export const ER_NEWCOMER_EVO_SPECIES: readonly NewcomerEvoSpeciesDef[] = [
  // Tentalect — Tentacruel (Lv 50) branch. Water/Poison/Psychic. Tentacool->Tentacruel
  // stays Lv 30 (untouched). Cry hook wired (tentalect asset lands in the assets phase).
  {
    speciesId: ER_TENTALECT_SPECIES_ID,
    name: "Tentalect",
    slug: "tentalect",
    types: [PokemonType.WATER, PokemonType.POISON, PokemonType.PSYCHIC],
    stats: [110, 70, 75, 110, 130, 105],
    actives: [CORROSION, PREDATOR, TOXIC_CHAIN],
    innates: [PUPPET_STRINGS, MINION_CONTROL, CORRUPTED_MIND],
    catchRate: 60,
    evolvesFrom: SpeciesId.TENTACRUEL,
    evolveLevel: 50,
    cryKey: "cry/er_tentalect",
    // Psychic/Poison coverage on top of Tentacruel's Water/Poison kit.
    learnsetAdditions: [
      [50, MoveId.PSYCHIC],
      [50, MoveId.SLUDGE_WAVE],
      [50, MoveId.HYDRO_PUMP],
    ],
  },
  // Astoot — Noctowl (Lv 50) BRANCH (alongside Noctowl's existing L50 evo, so the
  // #240 branched-evo chooser offers both). Psychic/Flying. Hoothoot->Noctowl stays Lv 20.
  {
    speciesId: ER_ASTOOT_SPECIES_ID,
    name: "Astoot",
    slug: "astoot",
    types: [PokemonType.PSYCHIC, PokemonType.FLYING],
    stats: [105, 60, 52, 110, 140, 65],
    actives: [MYSTIC_POWER, HEADSTRONG, AIR_BLOWER],
    innates: [LIBRARY, BRAINPOWER, FAMILIAR],
    catchRate: 60,
    evolvesFrom: SpeciesId.NOCTOWL,
    evolveLevel: 50,
    // Psychic/Flying coverage on top of Noctowl's kit.
    learnsetAdditions: [
      [50, MoveId.PSYCHIC],
      [50, MoveId.AIR_SLASH],
      [50, MoveId.FUTURE_SIGHT],
    ],
  },
  // Discupid — Luvdisc (Lv 50) evolution (Luvdisc has no other evo, so this is a
  // plain single-target level evolution). Water/Fairy.
  {
    speciesId: ER_DISCUPID_SPECIES_ID,
    name: "Discupid",
    slug: "discupid",
    types: [PokemonType.WATER, PokemonType.FAIRY],
    stats: [90, 70, 80, 90, 75, 122],
    actives: [POWER_SPOT, RAINBOW_FISH, FRIEND_GUARD],
    innates: [SOULMATE, RENDEZVOUS, HEARTBREAK],
    catchRate: 60,
    evolvesFrom: SpeciesId.LUVDISC,
    evolveLevel: 50,
    // Fairy coverage on top of Luvdisc's Water kit.
    learnsetAdditions: [
      [50, MoveId.MOONBLAST],
      [50, MoveId.DRAINING_KISS],
      [50, MoveId.SURF],
    ],
  },
];

/**
 * Regitube — standalone Water "Inflatable Pokemon". Egg-obtainable base-of-line
 * (custom-mons registration shape: starter cost + egg tier). No evolution line.
 *
 * Obtainability (DOCUMENTED, maintainer veto): egg tier EPIC + BST-banded starter
 * cost 6 (BST 580 -> the 540+ band). A 580-BST standalone legendary-like; EPIC
 * (not LEGENDARY) because the legendary-egg floor is cost >= 8 and Regitube bands
 * to 6. It surfaces in the egg pool (and, like every custom-mons-path mon, the
 * starter grid); flag to the maintainer if grid presence is unwanted.
 */
const REGITUBE_EGG_TIER = EggTier.EPIC;
const REGITUBE_STARTER_COST = 6;

/** Base eeveelution -> partner (new species id, grafted composite id, move type). */
interface PartnerFamilyDef {
  readonly base: SpeciesId;
  readonly partnerId: number;
  readonly name: string;
  readonly slug: string;
  /** The [baseInnate + Omniform] composite id that replaces the base kit's innate[0]. */
  readonly compositeId: number;
  /** The move type that maps TO this partner in the family Omniform registry (eeveelutions only). */
  readonly mapType: PokemonType | null;
}

/**
 * The partner-Eevee family. Partner Eevee is the starter head; the 8 partner
 * eeveelutions are Omniform transform targets. `mapType` is the move type that
 * chains INTO each partner (null for Eevee, which is never a target).
 */
export const ER_PARTNER_FAMILY: readonly PartnerFamilyDef[] = [
  {
    base: SpeciesId.EEVEE,
    partnerId: ER_PARTNER_EEVEE_SPECIES_ID,
    name: "Partner Eevee",
    slug: "partner_eevee",
    compositeId: ER_PARTNER_EEVEE_ABILITY_ID,
    mapType: null,
  },
  {
    base: SpeciesId.VAPOREON,
    partnerId: ER_PARTNER_VAPOREON_SPECIES_ID,
    name: "Partner Vaporeon",
    slug: "partner_vaporeon",
    compositeId: ER_PARTNER_VAPOREON_ABILITY_ID,
    mapType: PokemonType.WATER,
  },
  {
    base: SpeciesId.JOLTEON,
    partnerId: ER_PARTNER_JOLTEON_SPECIES_ID,
    name: "Partner Jolteon",
    slug: "partner_jolteon",
    compositeId: ER_PARTNER_JOLTEON_ABILITY_ID,
    mapType: PokemonType.ELECTRIC,
  },
  {
    base: SpeciesId.FLAREON,
    partnerId: ER_PARTNER_FLAREON_SPECIES_ID,
    name: "Partner Flareon",
    slug: "partner_flareon",
    compositeId: ER_PARTNER_FLAREON_ABILITY_ID,
    mapType: PokemonType.FIRE,
  },
  {
    base: SpeciesId.ESPEON,
    partnerId: ER_PARTNER_ESPEON_SPECIES_ID,
    name: "Partner Espeon",
    slug: "partner_espeon",
    compositeId: ER_PARTNER_ESPEON_ABILITY_ID,
    mapType: PokemonType.PSYCHIC,
  },
  {
    base: SpeciesId.UMBREON,
    partnerId: ER_PARTNER_UMBREON_SPECIES_ID,
    name: "Partner Umbreon",
    slug: "partner_umbreon",
    compositeId: ER_PARTNER_UMBREON_ABILITY_ID,
    mapType: PokemonType.DARK,
  },
  {
    base: SpeciesId.LEAFEON,
    partnerId: ER_PARTNER_LEAFEON_SPECIES_ID,
    name: "Partner Leafeon",
    slug: "partner_leafeon",
    compositeId: ER_PARTNER_LEAFEON_ABILITY_ID,
    mapType: PokemonType.GRASS,
  },
  {
    base: SpeciesId.GLACEON,
    partnerId: ER_PARTNER_GLACEON_SPECIES_ID,
    name: "Partner Glaceon",
    slug: "partner_glaceon",
    compositeId: ER_PARTNER_GLACEON_ABILITY_ID,
    mapType: PokemonType.ICE,
  },
  {
    base: SpeciesId.SYLVEON,
    partnerId: ER_PARTNER_SYLVEON_SPECIES_ID,
    name: "Partner Sylveon",
    slug: "partner_sylveon",
    compositeId: ER_PARTNER_SYLVEON_ABILITY_ID,
    mapType: PokemonType.FAIRY,
  },
];

/** Partner Eevee starter cost (documented default; maintainer veto). */
const PARTNER_EEVEE_STARTER_COST = 4;

/** Aggregated result of a single {@linkcode injectErNewcomerSpecies} run. */
export interface InjectErNewcomerSpeciesResult {
  /** New species records pushed onto allSpecies this run. */
  speciesRegistered: number;
  /** Species skipped because already present (idempotent re-run). */
  speciesAlreadyPresent: number;
  /** Evolution edges registered onto pokemonEvolutions. */
  evolutionEdges: number;
  /** Omniform (species, moveType) mappings registered for the partner family. */
  omniformMappings: number;
  /** Non-fatal issues (missing base species, etc.). */
  errors: string[];
}

/** Add a level evolution edge, branched-safe (a second null-condition edge at the same level => player-choice). */
function addEvolutionEdge(from: SpeciesId, targetId: number, level: number): boolean {
  const table = pokemonEvolutions as Record<number, SpeciesEvolution[]>;
  const list = (table[from] ??= []);
  if (list.some(e => (e.speciesId as number) === targetId)) {
    return false; // idempotent
  }
  list.push(new SpeciesEvolution(targetId as SpeciesId, level, null, null));
  return true;
}

/**
 * Register every newcomer species record (evolution-only, partner family,
 * Regitube), their evolution edges, egg/starter tables, and the partner-family
 * Omniform mappings. Idempotent. Must run AFTER `initEliteReduxSpecies()` (base
 * eeveelution kits final, so the partner clones are exact) and AFTER
 * `initEliteReduxCustomSpecies()` (ErCustomSpecies plumbing installed).
 */
export function injectErNewcomerSpecies(): InjectErNewcomerSpeciesResult {
  const result: InjectErNewcomerSpeciesResult = {
    speciesRegistered: 0,
    speciesAlreadyPresent: 0,
    evolutionEdges: 0,
    omniformMappings: 0,
    errors: [],
  };

  // --- 1. Evolution-only species (no starter cost / no egg tier). ---
  for (const def of ER_NEWCOMER_EVO_SPECIES) {
    const added = registerErEditorMon({
      speciesId: def.speciesId,
      name: def.name,
      slug: def.slug,
      type1: def.types[0],
      type2: def.types.length > 1 ? def.types[1] : null,
      baseStats: def.stats,
      abilities: def.actives,
      innates: def.innates,
      catchRate: def.catchRate,
      extraTypes: def.types.length > 2 ? def.types.slice(2) : undefined,
      cryKey: def.cryKey,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
    if (addEvolutionEdge(def.evolvesFrom, def.speciesId, def.evolveLevel)) {
      result.evolutionEdges++;
    }
  }

  // --- 2. Regitube — egg-obtainable standalone (custom-mons shape). ---
  {
    const added = registerErEditorMon({
      speciesId: ER_REGITUBE_SPECIES_ID,
      name: "Regitube",
      slug: "regitube",
      type1: PokemonType.WATER,
      type2: null,
      baseStats: [200, 50, 100, 80, 100, 50],
      abilities: [SEA_GUARDIAN, DRIZZLE, AFTERMATH],
      innates: [PRESSURE_VESSEL, RAIN_PUMP, LIFE_PRESERVER],
      catchRate: 45,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
    (speciesEggTiers as Record<number, EggTier>)[ER_REGITUBE_SPECIES_ID] = REGITUBE_EGG_TIER;
    (speciesStarterCosts as Record<number, number>)[ER_REGITUBE_SPECIES_ID] = REGITUBE_STARTER_COST;
  }

  // --- 3. Partner-Eevee family (exact live-kit clones + composite graft). ---
  for (const def of ER_PARTNER_FAMILY) {
    const base = getPokemonSpecies(def.base);
    if (!base) {
      result.errors.push(`partner ${def.name}: base species ${def.base} not found`);
      continue;
    }
    // Exact clone of the base kit; graft the composite onto innate[0].
    const actives: [number, number, number] = [base.ability1, base.ability2, base.abilityHidden];
    const baseInnates = [...base.getPassiveAbilities()];
    const innates: [number, number, number] = [
      def.compositeId,
      baseInnates[1] ?? 0,
      baseInnates[2] ?? 0,
    ];
    const extraTypes = base.getExtraTypes();
    const added = registerErEditorMon({
      speciesId: def.partnerId,
      name: def.name,
      slug: def.slug,
      type1: base.type1,
      type2: base.type2,
      baseStats: [...base.baseStats] as [number, number, number, number, number, number],
      abilities: actives,
      innates,
      catchRate: base.catchRate,
      extraTypes: extraTypes.length > 0 ? extraTypes : undefined,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
  }
  // Partner Eevee obtainability: a SEPARATE starter mon (own dex slot + starter
  // cost), NOT a form on vanilla Eevee — so vanilla Eevee stays byte-identical.
  // No egg tier (not egg-obtainable). The 8 partner eeveelutions get neither, so
  // they never leak into grid/egg/wild (Omniform transform targets only).
  (speciesStarterCosts as Record<number, number>)[ER_PARTNER_EEVEE_SPECIES_ID] = PARTNER_EEVEE_STARTER_COST;

  // --- 4. Production Omniform mappings: chain the whole partner family. Every
  // partner species (Eevee + all 8) maps each of the 8 element types to the
  // matching partner eeveelution, so a mapped-type move adapts/chains freely. ---
  const targets = ER_PARTNER_FAMILY.filter(d => d.mapType !== null);
  for (const holder of ER_PARTNER_FAMILY) {
    for (const target of targets) {
      registerOmniformMapping(
        holder.partnerId as SpeciesId,
        0,
        target.mapType as PokemonType,
        target.partnerId as SpeciesId,
        0,
      );
      result.omniformMappings++;
    }
  }

  return result;
}

/** Clone `[level, move]` pairs, appending `additions` (deduped by move id). */
function cloneLearnset(
  baseId: number,
  additions: ReadonlyArray<readonly [number, MoveId]> = [],
): [number, number][] {
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;
  const source = table[baseId] ?? [];
  const cloned: [number, number][] = source.map(([lvl, mv]) => [lvl, mv]);
  for (const [lvl, mv] of additions) {
    if (!cloned.some(([, m]) => m === mv)) {
      cloned.push([lvl, mv]);
    }
  }
  cloned.sort((a, b) => a[0] - b[0]);
  return cloned;
}

/**
 * Wire the newcomer species' level-up learnsets. Evolution species clone their
 * pre-evo learnset + typing additions; partner species clone their base
 * eeveelution's learnset verbatim (the Omniform default derives a level set from
 * these until the curation UI lands); Regitube gets a hand Water set.
 *
 * Must run AFTER `initEliteReduxMovesets()` rebuilds `pokemonSpeciesLevelMoves`
 * from the dump (so the CLONED source tables are final). Idempotent.
 */
export function applyErNewcomerSpeciesLearnsets(): number {
  const table = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
  let wired = 0;

  for (const def of ER_NEWCOMER_EVO_SPECIES) {
    table[def.speciesId] = cloneLearnset(def.evolvesFrom, def.learnsetAdditions);
    wired++;
  }

  // Regitube — hand Water learnset (no line to clone from).
  table[ER_REGITUBE_SPECIES_ID] = [
    [1, MoveId.WATER_GUN],
    [1, MoveId.HARDEN],
    [8, MoveId.BUBBLE_BEAM],
    [16, MoveId.AMNESIA],
    [24, MoveId.RAIN_DANCE],
    [32, MoveId.BODY_SLAM],
    [40, MoveId.RECOVER],
    [48, MoveId.SURF],
    [56, MoveId.HYDRO_PUMP],
  ];
  wired++;

  for (const def of ER_PARTNER_FAMILY) {
    table[def.partnerId] = cloneLearnset(def.base);
    wired++;
  }

  return wired;
}
