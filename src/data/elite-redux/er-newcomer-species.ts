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
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
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
import {
  registerOmniformMapping,
  registerOmniformUnlockOwner,
} from "#data/elite-redux/abilities/omniform-registry";
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

// NOTE: there is intentionally NO ER_PARTNER_EEVEE_SPECIES_ID. Partner Eevee is
// NOT a new species — it is the VANILLA Eevee "partner" FORM (formKey "partner",
// `pokemon-species.ts` EEVEE.forms[1], isStarterSelectable). The Omniform kit is
// grafted onto THAT form (its innate[0] -> composite 5946); the 8 partner
// eeveelutions below stay as transform-target species (maintainer 2026-07-16).
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
  /** Optional explicit cry-audio key hook (the key `cry()` plays). */
  readonly cryKey?: string;
  /** Optional cry-audio FILE path on er-assets (loaded under `cryKey`). */
  readonly cryFile?: string;
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
  // stays Lv 30 (untouched). Cry LIVE on er-assets: key `cry/er_tentalect` loads the
  // published `audio/cry/tentalect.wav` (WAV: no AAC encoder was available at bake time;
  // .wav decodes natively through the Web-Audio loader, so no transcode is needed).
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
    cryFile: "audio/cry/tentalect.wav",
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
 * Per-slug icon-atlas slugs for the slug-based newcomer species (the three
 * evolutions above + Regitube). The loading scene preloads each
 * `er_icon__<slug>` atlas at boot so TITLE-screen surfaces that render a party
 * mini icon WITHOUT a battle having run first (the save-slot preview, the party
 * screen reached from the menu, etc.) resolve the texture instead of showing an
 * error box: these species live in the hand-authored 70000+ band and are NOT in
 * the auto-generated `ER_SPRITE_MANIFEST` the preloader otherwise iterates, and
 * `ErCustomSpecies.loadAssets` only lazily loads the atlas during a battle.
 *
 * Partner eeveelutions are intentionally omitted: they alias a vanilla base
 * eeveelution's bundled icon (no per-slug atlas), so the bundled
 * `pokemon_icons_N` sheet already covers them.
 */
export const ER_NEWCOMER_ICON_SLUGS: readonly string[] = [
  ...ER_NEWCOMER_EVO_SPECIES.map(def => def.slug),
  // Regitube is registered below with slug "regitube" (kept in sync with its
  // registerErEditorMon call).
  "regitube",
];

/**
 * Slugs whose menu icon is preloaded from the FRONT sprite atlas instead of the
 * bespoke `icon` atlas (front-only art; see `ErCustomSpecies.registerIconFromFront`).
 * STATIC because `loadEliteReduxCustomIcons` runs before ER init, when the runtime
 * registry is still empty. Keep in sync with the `registerIconFromFront` calls.
 *
 * Currently empty: Regitube (the sole former member) now ships a valid bespoke
 * `icon.png` atlas and loads its mini icon from that like every other newcomer,
 * so nothing derives its icon from the front sprite anymore.
 */
export const ER_NEWCOMER_FRONT_ICON_SLUGS: ReadonlySet<string> = new Set<string>();

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

/** Base eeveelution -> partner transform-target (new species id, grafted composite id, move type). */
interface PartnerFamilyDef {
  readonly base: SpeciesId;
  readonly partnerId: number;
  readonly name: string;
  /** The [baseInnate + Omniform] composite id that replaces the base kit's innate[0]. */
  readonly compositeId: number;
  /** The move type that chains INTO this partner in the family Omniform registry. */
  readonly mapType: PokemonType;
}

/**
 * The 8 partner EEVEELUTIONS — Omniform transform targets ONLY (no starter cost,
 * no egg tier, no wild spawn). The family HEAD (Partner Eevee) is NOT here: it is
 * the vanilla Eevee "partner" form, grafted separately below. Each entry's sprite
 * aliases its BASE eeveelution's existing vanilla art (no new er-assets needed);
 * `mapType` is the move type that adapts/chains INTO it.
 */
export const ER_PARTNER_FAMILY: readonly PartnerFamilyDef[] = [
  {
    base: SpeciesId.VAPOREON,
    partnerId: ER_PARTNER_VAPOREON_SPECIES_ID,
    name: "Partner Vaporeon",
    compositeId: ER_PARTNER_VAPOREON_ABILITY_ID,
    mapType: PokemonType.WATER,
  },
  {
    base: SpeciesId.JOLTEON,
    partnerId: ER_PARTNER_JOLTEON_SPECIES_ID,
    name: "Partner Jolteon",
    compositeId: ER_PARTNER_JOLTEON_ABILITY_ID,
    mapType: PokemonType.ELECTRIC,
  },
  {
    base: SpeciesId.FLAREON,
    partnerId: ER_PARTNER_FLAREON_SPECIES_ID,
    name: "Partner Flareon",
    compositeId: ER_PARTNER_FLAREON_ABILITY_ID,
    mapType: PokemonType.FIRE,
  },
  {
    base: SpeciesId.ESPEON,
    partnerId: ER_PARTNER_ESPEON_SPECIES_ID,
    name: "Partner Espeon",
    compositeId: ER_PARTNER_ESPEON_ABILITY_ID,
    mapType: PokemonType.PSYCHIC,
  },
  {
    base: SpeciesId.UMBREON,
    partnerId: ER_PARTNER_UMBREON_SPECIES_ID,
    name: "Partner Umbreon",
    compositeId: ER_PARTNER_UMBREON_ABILITY_ID,
    mapType: PokemonType.DARK,
  },
  {
    base: SpeciesId.LEAFEON,
    partnerId: ER_PARTNER_LEAFEON_SPECIES_ID,
    name: "Partner Leafeon",
    compositeId: ER_PARTNER_LEAFEON_ABILITY_ID,
    mapType: PokemonType.GRASS,
  },
  {
    base: SpeciesId.GLACEON,
    partnerId: ER_PARTNER_GLACEON_SPECIES_ID,
    name: "Partner Glaceon",
    compositeId: ER_PARTNER_GLACEON_ABILITY_ID,
    mapType: PokemonType.ICE,
  },
  {
    base: SpeciesId.SYLVEON,
    partnerId: ER_PARTNER_SYLVEON_SPECIES_ID,
    name: "Partner Sylveon",
    compositeId: ER_PARTNER_SYLVEON_ABILITY_ID,
    mapType: PokemonType.FAIRY,
  },
];

/** Family head: the vanilla Eevee "partner" FORM the Omniform composite is grafted onto. */
const PARTNER_HEAD_SPECIES = SpeciesId.EEVEE;
const PARTNER_HEAD_FORM_KEY = "partner";

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
 * Graft the [Fluffy + Omniform] composite ({@linkcode ER_PARTNER_EEVEE_ABILITY_ID})
 * onto the VANILLA Eevee "partner" form's innate[0], leaving innate[1]/[2] and every
 * OTHER Eevee form (Normal, G-Max) plus base-Eevee species state untouched. Partner
 * Eevee is NOT a new species — this attaches the Omniform kit to the already
 * starter-selectable vanilla form. Returns the partner form index (for the Omniform
 * head mapping), or -1 if the form is absent. Idempotent (re-writes the same triple).
 */
function graftPartnerEeveeComposite(result: InjectErNewcomerSpeciesResult): number {
  const eevee = getPokemonSpecies(PARTNER_HEAD_SPECIES);
  if (!eevee) {
    result.errors.push(`partner Eevee head: base species ${PARTNER_HEAD_SPECIES} not found`);
    return -1;
  }
  const idx = eevee.forms.findIndex(f => f.formKey === PARTNER_HEAD_FORM_KEY);
  if (idx < 0) {
    result.errors.push(`partner Eevee head: no "${PARTNER_HEAD_FORM_KEY}" form on Eevee`);
    return -1;
  }
  const form = eevee.forms[idx];
  const cur = [...form.getPassiveAbilities()];
  // Typed as plain numbers so each widens to AbilityId (same as registerErEditorMon's
  // innate passing); the composite id + the two preserved innates keep the form's
  // original innate[1]/[2] intact.
  const grafted: [number, number, number] = [ER_PARTNER_EEVEE_ABILITY_ID, cur[1] ?? 0, cur[2] ?? 0];
  form.setPassives(grafted);
  return idx;
}

/**
 * Register every newcomer species record (evolution-only, partner eeveelutions,
 * Regitube), their evolution edges, egg/starter tables, the Partner-Eevee-form
 * composite graft, and the partner Omniform mappings. Idempotent. Must run AFTER
 * `initEliteReduxSpecies()` (base eeveelution kits final, so the partner clones are
 * exact) and AFTER `initEliteReduxCustomSpecies()` (ErCustomSpecies plumbing installed).
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
      cryFile: def.cryFile,
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
    // Regitube uses its bespoke `icon.png` atlas (a valid 2-frame 32x32 mini icon,
    // same shape as the other newcomers). It formerly derived its icon from the
    // downscaled front sprite because the published icon atlas was missing its
    // 0001.png frame; that atlas has since been regenerated with a valid frame, so
    // the front-icon workaround (which rendered oversized on egg-hatch/party/
    // summary) is no longer needed. See ER_NEWCOMER_FRONT_ICON_SLUGS.
  }

  // --- 3. Partner EEVEELUTIONS (8 transform-target species). Exact clone of the
  // base eeveelution kit with the composite grafted onto innate[0]; sprite aliased
  // to the base eeveelution's existing vanilla art (no new er-assets). NO starter
  // cost / egg tier, so they never leak into grid/egg/wild (transform targets only). ---
  for (const def of ER_PARTNER_FAMILY) {
    const base = getPokemonSpecies(def.base);
    if (!base) {
      result.errors.push(`partner ${def.name}: base species ${def.base} not found`);
      continue;
    }
    // Exact clone of the base kit; graft the composite onto innate[0].
    const actives: [number, number, number] = [base.ability1, base.ability2, base.abilityHidden];
    const baseInnates = [...base.getPassiveAbilities()];
    const innates: [number, number, number] = [def.compositeId, baseInnates[1] ?? 0, baseInnates[2] ?? 0];
    const extraTypes = base.getExtraTypes();
    const added = registerErEditorMon({
      speciesId: def.partnerId,
      name: def.name,
      // No slug: the sprite/icon aliases the base eeveelution's vanilla art.
      spriteAlias: def.base,
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

  // --- 3b. Partner Eevee HEAD: graft the composite onto the vanilla Eevee "partner"
  // FORM (starter-selectable already; no new species, no starter cost). Base Eevee +
  // the Normal/G-Max forms stay byte-identical. ---
  const partnerFormIndex = graftPartnerEeveeComposite(result);

  // --- 4. Production Omniform mappings. The HEAD (Eevee partner form, keyed by
  // (EEVEE, partnerFormIndex)) maps each element type to the matching partner
  // eeveelution; every partner eeveelution also chains among the whole set. ---
  if (partnerFormIndex >= 0) {
    for (const target of ER_PARTNER_FAMILY) {
      registerOmniformMapping(PARTNER_HEAD_SPECIES, partnerFormIndex, target.mapType, target.partnerId as SpeciesId, 0);
      result.omniformMappings++;
    }
  }
  for (const holder of ER_PARTNER_FAMILY) {
    for (const target of ER_PARTNER_FAMILY) {
      registerOmniformMapping(holder.partnerId as SpeciesId, 0, target.mapType, target.partnerId as SpeciesId, 0);
      result.omniformMappings++;
    }
  }

  // Partner Eevee is the permanent candy-unlock owner for the whole Omniform
  // family. The transient pre-transform snapshot covers ordinary mid-battle
  // adaptation; this registry also covers partner Eeveelutions loaded or spawned
  // directly, which otherwise consult their transform-only species' empty data.
  if (partnerFormIndex >= 0) {
    registerOmniformUnlockOwner(
      PARTNER_HEAD_SPECIES,
      partnerFormIndex,
      PARTNER_HEAD_SPECIES,
      partnerFormIndex,
    );
    for (const member of ER_PARTNER_FAMILY) {
      registerOmniformUnlockOwner(
        member.partnerId as SpeciesId,
        0,
        PARTNER_HEAD_SPECIES,
        partnerFormIndex,
      );
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

/**
 * Regitube's TM set. It has no pre-evo to inherit TM compatibility from, so it
 * gets a hand Water/utility set (mirrors its hand Water level-up learnset). Only
 * ids that are ACTUAL TM moves get wired (the adder self-filters against the live
 * TM table), so listing a generous set is safe against roster changes.
 */
const REGITUBE_TM_MOVES: readonly MoveId[] = [
  MoveId.SURF,
  MoveId.WATERFALL,
  MoveId.SCALD,
  MoveId.DIVE,
  MoveId.ICE_BEAM,
  MoveId.BLIZZARD,
  MoveId.RAIN_DANCE,
  MoveId.BODY_SLAM,
  MoveId.REST,
  MoveId.SLEEP_TALK,
  MoveId.PROTECT,
  MoveId.SUBSTITUTE,
  MoveId.FACADE,
  MoveId.ROUND,
  MoveId.HYPER_BEAM,
  MoveId.GIGA_IMPACT,
];

/**
 * Wire the newcomer species' TM compatibility. This is a SEPARATE data path from
 * the level-up learnsets above (`tmSpecies` / `speciesTmMoves`, NOT
 * `pokemonSpeciesLevelMoves`), and it was originally missed — the 70000+ band had
 * no TM entries at all, so Tentalect etc. showed an empty TM list and could learn
 * no TMs (live tester report).
 *
 * Derivation (per the newcomer patch): each evolution species inherits its
 * PRE-EVO's full TM compatibility, plus the type-appropriate coverage moves from
 * its `learnsetAdditions` that are themselves TMs. Regitube (no pre-evo) gets the
 * hand set above. Partner eeveelutions inherit their base eeveelution's TM set.
 * Mega/primal FORMS need no wiring here: `Pokemon.generateCompatibleTms` matches
 * a plain `tmSpecies` entry against `this.species.speciesId` regardless of form,
 * so a form inherits its base species' TM compatibility automatically.
 *
 * Both live tables are kept in sync: `tmSpecies[move]` (read by the TM-item
 * compatibility check `generateCompatibleTms`) and `speciesTmMoves[speciesId]`
 * (read by the Pokedex TM list, AI moveset gen, and Showdown legality). Idempotent.
 *
 * Must run AFTER the species are registered (`injectErNewcomerSpecies`). Order
 * vs. the editor TM overrides (`applyErPokedexOverrides`) is irrelevant: those
 * only touch species listed in er-tm-learnsets.json, which the 70000+ band is not.
 */
export function applyErNewcomerSpeciesTmCompatibility(): number {
  const tmByMove = tmSpecies as Record<number, (SpeciesId | [SpeciesId | string, string])[]>;
  const movesBySpecies = speciesTmMoves as Record<number, (MoveId | [unknown, MoveId])[]>;
  let wired = 0;

  /** Plain (non-form-gated) TM move ids the species carries. */
  const plainTms = (speciesId: number): MoveId[] =>
    (movesBySpecies[speciesId] ?? []).map(e => (Array.isArray(e) ? e[1] : e));

  const addTm = (speciesId: number, moveId: number): void => {
    // Always record in the per-species table (drives Pokedex / AI / Showdown).
    const moves = (movesBySpecies[speciesId] ??= []);
    if (!moves.some(e => (Array.isArray(e) ? e[1] : e) === moveId)) {
      moves.push(moveId as MoveId);
    }
    // Mirror into the TM-item table only when this move is an actual TM (some
    // ER-added per-species entries aren't in the vanilla TM map; those stay
    // display-only, exactly as they are for the base species).
    const list = tmByMove[moveId];
    if (list && !list.some(p => (Array.isArray(p) ? p[0] === speciesId : p === speciesId))) {
      list.push(speciesId as SpeciesId);
    }
  };

  // Inherit the base/pre-evo's full TM set from the authoritative per-species
  // table (a superset of the TM-item map — includes ER-added display TMs).
  const inheritFrom = (speciesId: number, baseId: number): void => {
    for (const moveId of plainTms(baseId)) {
      addTm(speciesId, moveId);
    }
  };

  for (const def of ER_NEWCOMER_EVO_SPECIES) {
    inheritFrom(def.speciesId, def.evolvesFrom);
    for (const [, mv] of def.learnsetAdditions) {
      addTm(def.speciesId, mv);
    }
    wired++;
  }

  for (const mv of REGITUBE_TM_MOVES) {
    addTm(ER_REGITUBE_SPECIES_ID, mv);
  }
  wired++;

  for (const def of ER_PARTNER_FAMILY) {
    inheritFrom(def.partnerId, def.base);
    wired++;
  }

  return wired;
}
