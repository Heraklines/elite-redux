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
import {
  EvoCondKey,
  type EvolutionConditionData,
  pokemonEvolutions,
  SpeciesEvolution,
} from "#balance/pokemon-evolutions";
import { Gender } from "#data/gender";
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
  ER_PARTNER_NIMBEON_ABILITY_ID,
  ER_PARTNER_RYUVEON_ABILITY_ID,
  ER_PARTNER_SYLVEON_ABILITY_ID,
  ER_PARTNER_TITANEON_ABILITY_ID,
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

// Partner ALIAS species for the three batch-2 eeveelutions (70030+). These are the
// Omniform transform targets for the Flying/Dragon/Steel move types — built exactly
// like the 8 partner eeveelutions above (sprite-aliased to the base eeveelution art,
// composite [innate + Omniform] as their innate, no cost/egg tier). The REAL
// Nimbeon/Ryuveon/Titaneon (70022-70024) carry a PLAIN innate and never transform, so
// a regular eeveelution (evolved from a regular Eevee) is inert.
export const ER_PARTNER_NIMBEON_SPECIES_ID = 70030;
export const ER_PARTNER_RYUVEON_SPECIES_ID = 70031;
export const ER_PARTNER_TITANEON_SPECIES_ID = 70032;

// ---------------------------------------------------------------------------
// Newcomer BATCH 2 species (70020+). Evolution-only convergents/eeveelutions +
// one standalone paradox (Webbed Bruiser). Drawclops is a NEW middle stage in
// the Duskull -> Drawclops -> Dustnoir line, so Dustnoir's evolution edge sources
// from a NEW numeric species id (handled by the widened evolvesFrom below).
// ---------------------------------------------------------------------------
export const ER_DRAWCLOPS_SPECIES_ID = 70020;
export const ER_DUSTNOIR_SPECIES_ID = 70021;
export const ER_NIMBEON_SPECIES_ID = 70022;
export const ER_RYUVEON_SPECIES_ID = 70023;
export const ER_TITANEON_SPECIES_ID = 70024;
export const ER_TWINKLETUFF_SPECIES_ID = 70025;
export const ER_EGOELK_SPECIES_ID = 70026;
export const ER_FORBIDDRON_SPECIES_ID = 70027;
export const ER_IDOLFIN_SPECIES_ID = 70028;
export const ER_WEBBED_BRUISER_SPECIES_ID = 70029;


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

// --- Newcomer BATCH 2 ability ids (resolved via the audit + reconciled against
// the codex signature batch). Signature abilities (real mechanics) live at
// 5971-5994 (newcomer-signature-abilities.ts); the two designer-spec'd composites
// at 5995-5996 (composite-newcomers.ts); the two residual placeholders at
// 5997-5998 (newcomer-batch2.ts). PREDATOR, CORRUPTED_MIND, FRIEND_GUARD are
// reused from the batch-1 block above. ---
const SNIPER = 97; // vanilla
const BOOT_HILL = 5985; // codex signature
const SPECTRALIZE = 5123;
const DEADEYE = 5984; // codex "Deadeye Draw" (spec: Deadeye Draw)
const MINIGUN = 5996; // composite (Quick Draw + Dual Wield)
const TURBOBLAZE = 163; // vanilla
const FLARE_BOOST = 138; // vanilla
const BLUR = 5510;
const MOMENTUM = 5109;
// The REAL Nimbeon/Ryuveon/Titaneon carry their PLAIN innate[0] (no Omniform), so a
// regular eeveelution never transforms. The [innate + Omniform] composite lives ONLY on
// the partner ALIAS species (ER_NEWCOMER_PARTNER_FAMILY below). These three ids are the
// bare constituents (the same ones composite-newcomers.ts folds Omniform onto).
const FLUFFY = 218; // vanilla — Nimbeon innate[0]
const STAMINA = 192; // vanilla — Ryuveon innate[0]
const STAINLESS_STEEL = 5530; // ER custom — Titaneon innate[0]
const VAPOR_BODY = 5981; // codex signature
const AERIALIST = 5313;
const WHIPLASH = 5425;
const OVERRULE = 5516;
const UNRELENTING = 5695; // exists ("2-5 hits"); designer flagged "when fixed" — FLAG
const DRAGONFLY = 5050;
const SKYHOOK = 5978; // codex signature
const CHROME_COAT = 5267;
const ELUDE = 5511;
const IMPULSE = 5274;
const ANNEAL = 5979; // codex signature
const LIVING_CHROME = 5980; // codex signature
const WATER_COMPACTION = 195; // vanilla
const POROUS = 5974; // codex signature (bespoke, NOT the composite the spec suggested — FLAG)
const GLAM_ROCK = 5975; // codex signature
const FILTER = 111; // vanilla
const SEDIMENT_BLOOM = 5976; // codex signature
const POWER_CORE = 5105;
const INVERSE_ROOM = 5998; // Egoelk active — auto-sets the Inverse Room field effect on entry
const GLEAM_EYES = 5410;
const ENERGY_HORNS = 5452;
const EGOIST = 5276;
const SUPEREGO = 5994; // codex signature (Egoelk innate, designer kit update 2026-07-22)
const CENTER_OF_ATTENTION = 5993; // codex signature (Egoelk innate, designer kit update 2026-07-22)
const HEAVY_METAL = 134; // vanilla
const REDUCTION = 5991; // codex signature
const SOUL_TAP = 5521;
const CRACK_THE_VESSEL = 5992; // codex "Cracked Vessel" (spec: Crack the Vessel)
const ELEMENTAL_VORTEX = 5369;
const LIQUIFIED = 5049;
const PIXILATE = 182; // vanilla
const ZERO_TO_HERO = 278; // vanilla
const RADIANCE = 5173;
const SETLIST = 5989; // codex signature
const RAGING_BOXER = 5057;
const BLITZ_BOXER = 5015;
const MOXIE = 153; // vanilla
const RING_GENERAL = 5987; // codex signature
const PROTOSYNTHESIS = 281; // vanilla
const GILLIE_SUIT = 5986; // codex signature (bespoke "Predator + Protean")

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
  /**
   * Body weight in kg (canon-relative — reasoned from the pre-evo / nearest vanilla
   * relative and the species' size lore). Feeds Heavy Slam / Heat Crash / Grass Knot /
   * Low Kick / Sky Drop and weight-based abilities. FLAG: hand-authored, designer veto.
   */
  readonly weight: number;
  /**
   * Species this evolves FROM (the level-edge source). Usually a vanilla
   * `SpeciesId`, but MAY be a hand-authored newcomer species id (a bare number
   * in the 70000+ band) when the pre-evo is itself a newcomer middle stage
   * (Drawclops -> Dustnoir). `pokemonEvolutions` is keyed by number, so a numeric
   * source registers the edge exactly like a vanilla one.
   */
  readonly evolvesFrom: SpeciesId | number;
  /** Evolution level (per the patch; per-entry). */
  readonly evolveLevel: number;
  /**
   * Optional extra evolution condition(s) layered ON TOP of the level edge. Used by
   * Idolfin (female Palafin in "hero" form) to gate the edge on the Zero to Hero
   * switch-out transformation rather than an arbitrary level.
   */
  readonly evolutionCondition?: EvolutionConditionData | EvolutionConditionData[];
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
    // Tentacruel is 55kg; Tentalect is a larger evolved jellyfish (BST 600). ~78kg.
    weight: 78.0,
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
    // Noctowl is 40.8kg; Astoot is a same-sized Psychic/Flying owl. ~45kg.
    weight: 45.0,
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
    // Luvdisc is 8.7kg; Discupid is a slightly larger Water/Fairy fish. ~12kg.
    weight: 12.0,
    evolvesFrom: SpeciesId.LUVDISC,
    evolveLevel: 50,
    // Fairy coverage on top of Luvdisc's Water kit.
    learnsetAdditions: [
      [50, MoveId.MOONBLAST],
      [50, MoveId.DRAINING_KISS],
      [50, MoveId.SURF],
    ],
  },
  // ===================== NEWCOMER BATCH 2 =====================
  // Drawclops — NEW middle stage: Duskull (Lv 36) -> Drawclops. Ground/Ghost.
  // BRANCHES off Duskull alongside the vanilla Duskull->Dusclops line (#240
  // chooser). Same kit as Dustnoir ("same abilities for now"). FLAG: Duskull
  // gains a second level edge (36) beside vanilla Dusclops (37).
  {
    speciesId: ER_DRAWCLOPS_SPECIES_ID,
    name: "Drawclops",
    slug: "drawclops",
    types: [PokemonType.GROUND, PokemonType.GHOST],
    stats: [110, 40, 90, 110, 80, 40],
    actives: [SNIPER, BOOT_HILL, SPECTRALIZE],
    innates: [DEADEYE, MINIGUN, TURBOBLAZE],
    catchRate: 60,
    // Between Dusclops (30.6kg) and Dusknoir (106.6kg) as a new middle stage. ~40kg.
    weight: 40.0,
    evolvesFrom: SpeciesId.DUSKULL,
    evolveLevel: 36,
    learnsetAdditions: [
      [36, MoveId.SHADOW_SNEAK],
      [36, MoveId.MUD_SHOT],
      [36, MoveId.BONE_RUSH],
    ],
  },
  // Dustnoir — Convergent Dusknoir: Drawclops (Lv 45) -> Dustnoir. Ground/Ghost.
  // evolvesFrom the NEW Drawclops species id (numeric middle-stage source).
  {
    speciesId: ER_DUSTNOIR_SPECIES_ID,
    name: "Dustnoir",
    slug: "dustnoir",
    types: [PokemonType.GROUND, PokemonType.GHOST],
    stats: [120, 45, 105, 135, 90, 45],
    actives: [SNIPER, BOOT_HILL, SPECTRALIZE],
    innates: [DEADEYE, MINIGUN, TURBOBLAZE],
    catchRate: 45,
    // Dusknoir convergent (Ground/Ghost, BST 540). Dusknoir is 106.6kg. ~108kg.
    weight: 108.0,
    evolvesFrom: ER_DRAWCLOPS_SPECIES_ID,
    evolveLevel: 45,
    learnsetAdditions: [
      [45, MoveId.EARTHQUAKE],
      [45, MoveId.SHADOW_BALL],
      [45, MoveId.EARTH_POWER],
    ],
  },
  // Nimbeon — Cumulus eeveelution: Eevee (Lv 23) -> Nimbeon. Flying.
  {
    speciesId: ER_NIMBEON_SPECIES_ID,
    name: "Nimbeon",
    slug: "nimbeon",
    types: [PokemonType.FLYING],
    stats: [130, 65, 60, 95, 65, 110],
    actives: [FLARE_BOOST, BLUR, MOMENTUM],
    // Plain innate[0] (Fluffy). A regular Nimbeon carries NO Omniform and never
    // transforms; the transform kit lives on the partner alias (Partner Nimbeon).
    innates: [FLUFFY, VAPOR_BODY, AERIALIST],
    catchRate: 45,
    // Eeveelution-sized (bases ~24-29kg) but a light Flying cumulus form. ~22kg.
    weight: 22.0,
    evolvesFrom: SpeciesId.EEVEE,
    evolveLevel: 23,
    learnsetAdditions: [
      [23, MoveId.BRAVE_BIRD],
      [23, MoveId.HURRICANE],
      [23, MoveId.ROOST],
      [23, MoveId.AIR_SLASH],
    ],
  },
  // Ryuveon — Sky Dancer eeveelution: Eevee -> Ryuveon. Dragon. FLAG: no level
  // given by the designer — assumed Lv 23 to match the other new eeveelutions.
  // Active "Unrelenting" resolves live (5695, "moves hit 2-5 times"); designer
  // wrote "when its fixed" — wired inert-safe, FLAG.
  {
    speciesId: ER_RYUVEON_SPECIES_ID,
    name: "Ryuveon",
    slug: "ryuveon",
    types: [PokemonType.DRAGON],
    stats: [85, 95, 90, 45, 100, 110],
    actives: [WHIPLASH, OVERRULE, UNRELENTING],
    // Plain innate[0] (Stamina). A regular Ryuveon carries NO Omniform and never
    // transforms; the transform kit lives on the partner alias (Partner Ryuveon).
    innates: [STAMINA, DRAGONFLY, SKYHOOK],
    catchRate: 45,
    // Eeveelution-sized Dragon (a sinuous sky-dancer). ~30kg.
    weight: 30.0,
    evolvesFrom: SpeciesId.EEVEE,
    evolveLevel: 23,
    learnsetAdditions: [
      [23, MoveId.DRAGON_CLAW],
      [23, MoveId.DRAGON_DANCE],
      [23, MoveId.DRAGON_PULSE],
      [23, MoveId.OUTRAGE],
    ],
  },
  // Titaneon — Alloy eeveelution: Eevee (Lv 23) -> Titaneon. Steel.
  {
    speciesId: ER_TITANEON_SPECIES_ID,
    name: "Titaneon",
    slug: "titaneon",
    types: [PokemonType.STEEL],
    stats: [65, 110, 95, 60, 65, 130],
    actives: [CHROME_COAT, ELUDE, IMPULSE],
    // Plain innate[0] (Stainless Steel). A regular Titaneon carries NO Omniform and never
    // transforms; the transform kit lives on the partner alias (Partner Titaneon).
    innates: [STAINLESS_STEEL, ANNEAL, LIVING_CHROME],
    catchRate: 45,
    // Steel "Alloy" eeveelution — a dense metal-bodied form (cf. Steelix-class density
    // scaled to eeveelution size). ~95kg.
    weight: 95.0,
    evolvesFrom: SpeciesId.EEVEE,
    evolveLevel: 23,
    learnsetAdditions: [
      [23, MoveId.IRON_HEAD],
      [23, MoveId.FLASH_CANNON],
      [23, MoveId.IRON_DEFENSE],
      [23, MoveId.METEOR_MASH],
    ],
  },
  // Twinkletuff — Jigglypuff (Lv 20) -> Twinkletuff. Normal/Ground.
  {
    speciesId: ER_TWINKLETUFF_SPECIES_ID,
    name: "Twinkletuff",
    slug: "twinkletuff",
    types: [PokemonType.NORMAL, PokemonType.GROUND],
    stats: [140, 90, 100, 65, 90, 30],
    actives: [WATER_COMPACTION, POROUS, GLAM_ROCK],
    innates: [FILTER, SEDIMENT_BLOOM, POWER_CORE],
    catchRate: 60,
    // Wigglytuff is 12kg; Twinkletuff adds a Ground (earthen) body, heavier. ~28kg.
    weight: 28.0,
    evolvesFrom: SpeciesId.JIGGLYPUFF,
    evolveLevel: 20,
    learnsetAdditions: [
      [20, MoveId.EARTHQUAKE],
      [20, MoveId.BODY_SLAM],
      [20, MoveId.STEALTH_ROCK],
    ],
  },
  // Egoelk — Superego Pokemon: Stantler (Lv 31) -> Egoelk. Normal/Psychic.
  {
    speciesId: ER_EGOELK_SPECIES_ID,
    name: "Egoelk",
    slug: "egoelk",
    types: [PokemonType.NORMAL, PokemonType.PSYCHIC],
    stats: [77, 65, 65, 130, 65, 123],
    actives: [INVERSE_ROOM, GLEAM_EYES, ENERGY_HORNS],
    // Designer kit update 2026-07-22: innates Egoist + Superego + Center of Attention
    // (Mind's Eye and Corrupted Mind removed).
    innates: [EGOIST, SUPEREGO, CENTER_OF_ATTENTION],
    catchRate: 45,
    // Stantler is 71.2kg; Egoelk is a same-sized Normal/Psychic deer. ~75kg.
    weight: 75.0,
    evolvesFrom: SpeciesId.STANTLER,
    evolveLevel: 31,
    learnsetAdditions: [
      [31, MoveId.PSYCHIC],
      [31, MoveId.CALM_MIND],
      [31, MoveId.HYPER_VOICE],
    ],
  },
  // Forbiddron — Crawling Cauldron: Ghost/Poison/Steel (BST 550). FLAG (Sinistea
  // line reading): the spec text "Sinistea (Lv 36) -> Sinistea (Lv 55) ->
  // Forbiddron" is garbled; implemented as the most coherent reading against the
  // vanilla Sinistea -> Polteageist (Cracked Pot) line — Forbiddron evolves from
  // POLTEAGEIST at Lv 55, leaving the vanilla Cracked Pot evo intact.
  {
    speciesId: ER_FORBIDDRON_SPECIES_ID,
    name: "Forbiddron",
    slug: "forbiddron",
    types: [PokemonType.GHOST, PokemonType.POISON, PokemonType.STEEL],
    stats: [113, 75, 75, 134, 114, 39],
    actives: [HEAVY_METAL, REDUCTION, SOUL_TAP],
    innates: [CRACK_THE_VESSEL, ELEMENTAL_VORTEX, LIQUIFIED],
    catchRate: 45,
    // "Crawling Cauldron" — a heavy Ghost/Poison/Steel iron vessel (carries Heavy
    // Metal). Polteageist is a 0.4kg teapot; Forbiddron is a massive cauldron. ~95kg.
    weight: 95.0,
    evolvesFrom: SpeciesId.POLTEAGEIST,
    evolveLevel: 55,
    learnsetAdditions: [
      [55, MoveId.SHADOW_BALL],
      [55, MoveId.SLUDGE_BOMB],
      [55, MoveId.FLASH_CANNON],
      [55, MoveId.RECOVER],
    ],
  },
  // Idolfin — Palafin Idol (Superstar), Water. Idolfin is a "zero to hero" evolution
  // (maintainer verdict 2026-07-22): it comes from a FEMALE Palafin with Zero to Hero
  // that has undergone the HERO switch-out transformation. That transform is exactly the
  // vanilla ZtH form change (PreSwitchOutFormChangeAbAttr -> formIndex 1 "hero"; reverts
  // to "zero" only at the NEXT battle's PostBattleInit), so the evolution gate hangs off
  // it directly: the FORM_KEY==="hero" condition IS the record of the switch-out (and it
  // implies Zero to Hero, the only producer of the hero form). GENDER==FEMALE enforces the
  // female requirement. The Lv 45 floor is retained (a real Palafin is already >=38); the
  // CONDITION, not the level, is the gate. A male Palafin fails GENDER; a female that never
  // switched out is still "zero" and fails FORM_KEY.
  {
    speciesId: ER_IDOLFIN_SPECIES_ID,
    name: "Idolfin",
    slug: "idolfin",
    types: [PokemonType.WATER],
    stats: [100, 106, 87, 160, 97, 100],
    actives: [FRIEND_GUARD, PIXILATE, PREDATOR],
    innates: [ZERO_TO_HERO, RADIANCE, SETLIST],
    catchRate: 45,
    // Palafin Hero form is 60.2kg; Idolfin is a same-sized Water superstar dolphin. ~62kg.
    weight: 62.0,
    evolvesFrom: SpeciesId.PALAFIN,
    evolveLevel: 45,
    evolutionCondition: [
      { key: EvoCondKey.GENDER, gender: Gender.FEMALE },
      { key: EvoCondKey.FORM_KEY, formKey: "hero" },
    ],
    learnsetAdditions: [
      [45, MoveId.SURF],
      [45, MoveId.ICE_BEAM],
      [45, MoveId.CALM_MIND],
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
  // Regitube + Webbed Bruiser are registered below as standalones (kept in sync
  // with their registerErEditorMon calls).
  "regitube",
  "webbed_bruiser",
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

/**
 * Base CUSTOM eeveelution -> partner alias transform-target. Same shape as
 * {@linkcode PartnerFamilyDef} but the base is a CUSTOM species id (the real batch-2
 * eeveelution, 70022-70024) instead of a vanilla `SpeciesId` — its sprite/kit are read
 * from that custom species at init time.
 */
interface NewcomerPartnerFamilyDef {
  readonly baseSpeciesId: number;
  readonly partnerId: number;
  readonly name: string;
  readonly compositeId: number;
  readonly mapType: PokemonType;
}

/**
 * The three batch-2 partner ALIAS eeveelutions (Omniform transform targets ONLY — no
 * starter cost, no egg tier, no wild spawn). Each aliases its base custom eeveelution's
 * slug art and grafts the [base innate + Omniform] composite onto innate[0], EXACTLY as
 * the 8 vanilla-based partner eeveelutions do. The REAL Nimbeon/Ryuveon/Titaneon
 * (baseSpeciesId) stay inert (plain innate, no mapping), so a regular eeveelution never
 * transforms. `mapType` is the move type that adapts/chains INTO the alias.
 */
export const ER_NEWCOMER_PARTNER_FAMILY: readonly NewcomerPartnerFamilyDef[] = [
  {
    baseSpeciesId: ER_NIMBEON_SPECIES_ID,
    partnerId: ER_PARTNER_NIMBEON_SPECIES_ID,
    name: "Partner Nimbeon",
    compositeId: ER_PARTNER_NIMBEON_ABILITY_ID,
    mapType: PokemonType.FLYING,
  },
  {
    baseSpeciesId: ER_RYUVEON_SPECIES_ID,
    partnerId: ER_PARTNER_RYUVEON_SPECIES_ID,
    name: "Partner Ryuveon",
    compositeId: ER_PARTNER_RYUVEON_ABILITY_ID,
    mapType: PokemonType.DRAGON,
  },
  {
    baseSpeciesId: ER_TITANEON_SPECIES_ID,
    partnerId: ER_PARTNER_TITANEON_SPECIES_ID,
    name: "Partner Titaneon",
    compositeId: ER_PARTNER_TITANEON_ABILITY_ID,
    mapType: PokemonType.STEEL,
  },
];

/**
 * Every non-head Omniform family transform target as `[mapType, targetSpeciesId]`: the 8
 * partner eeveelutions + the 3 partner alias eeveelutions. The registry head (Partner
 * Eevee) maps each type to its target, and every target chains into every OTHER target,
 * so a transform can chain across the whole family (a self-type map is a same-form no-op).
 */
const OMNIFORM_FAMILY_TARGETS: readonly (readonly [PokemonType, number])[] = [
  ...ER_PARTNER_FAMILY.map(p => [p.mapType, p.partnerId] as const),
  ...ER_NEWCOMER_PARTNER_FAMILY.map(p => [p.mapType, p.partnerId] as const),
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
function addEvolutionEdge(
  from: SpeciesId | number,
  targetId: number,
  level: number,
  condition: EvolutionConditionData | EvolutionConditionData[] | null = null,
): boolean {
  const table = pokemonEvolutions as Record<number, SpeciesEvolution[]>;
  const list = (table[from] ??= []);
  if (list.some(e => (e.speciesId as number) === targetId)) {
    return false; // idempotent
  }
  list.push(new SpeciesEvolution(targetId as SpeciesId, level, null, condition));
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
      weight: def.weight,
      extraTypes: def.types.length > 2 ? def.types.slice(2) : undefined,
      cryKey: def.cryKey,
      cryFile: def.cryFile,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
    if (addEvolutionEdge(def.evolvesFrom, def.speciesId, def.evolveLevel, def.evolutionCondition ?? null)) {
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
      // Regi-class heavyweight (BST 580, Regirock 230 / Registeel 205). ~200kg.
      // FLAG: as an "Inflatable" Water mon an air-filled reading would argue MUCH
      // lighter; kept Regi-class-heavy per the maintainer's weight-audit example.
      weight: 200.0,
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

  // --- 2b. Webbed Bruiser — standalone Ariados PAST PARADOX (Boxing Spider),
  // Fighting/Bug, BST 570. FLAG (obtainability): no batch-1 paradox-specific seam
  // exists in this pipeline, so it uses the same egg-obtainable standalone shape
  // as Regitube (egg tier + BST-banded starter cost). If the maintainer wants a
  // paradox-only source (fixed encounter / no egg), swap this block. ---
  {
    const added = registerErEditorMon({
      speciesId: ER_WEBBED_BRUISER_SPECIES_ID,
      name: "Webbed Bruiser",
      slug: "webbed_bruiser",
      type1: PokemonType.FIGHTING,
      type2: PokemonType.BUG,
      baseStats: [95, 150, 105, 59, 130, 31],
      abilities: [RAGING_BOXER, BLITZ_BOXER, MOXIE],
      innates: [RING_GENERAL, PROTOSYNTHESIS, GILLIE_SUIT],
      catchRate: 45,
      // Ariados is 33.5kg; Webbed Bruiser is a heavyweight-boxer paradox (BST 570). ~90kg.
      weight: 90.0,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
    (speciesEggTiers as Record<number, EggTier>)[ER_WEBBED_BRUISER_SPECIES_ID] = EggTier.EPIC;
    (speciesStarterCosts as Record<number, number>)[ER_WEBBED_BRUISER_SPECIES_ID] = 6;
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
      // Transform-only clone: inherit the base eeveelution's real vanilla weight so
      // weight-based mechanics behave identically to the base form.
      weight: base.weight,
      extraTypes: extraTypes.length > 0 ? extraTypes : undefined,
    });
    if (added) {
      result.speciesRegistered++;
    } else {
      result.speciesAlreadyPresent++;
    }
  }

  // --- 3a. Partner ALIAS eeveelutions (Nimbeon/Ryuveon/Titaneon). Same shape as the 8
  // above, but the base is a CUSTOM eeveelution (70022-70024): the sprite/icon aliases
  // that custom species' slug art and the kit is cloned from it. The composite [base
  // innate + Omniform] goes on the ALIAS, so the REAL eeveelution stays inert. Must run
  // AFTER section 1 registered the base custom species (so getPokemonSpecies resolves and
  // its starterColors are seeded for the alias to inherit). ---
  for (const def of ER_NEWCOMER_PARTNER_FAMILY) {
    const base = getPokemonSpecies(def.baseSpeciesId as SpeciesId);
    if (!base) {
      result.errors.push(`partner alias ${def.name}: base species ${def.baseSpeciesId} not found`);
      continue;
    }
    const actives: [number, number, number] = [base.ability1, base.ability2, base.abilityHidden];
    const baseInnates = [...base.getPassiveAbilities()];
    const innates: [number, number, number] = [def.compositeId, baseInnates[1] ?? 0, baseInnates[2] ?? 0];
    const extraTypes = base.getExtraTypes();
    const added = registerErEditorMon({
      speciesId: def.partnerId,
      name: def.name,
      // No slug: the sprite/icon aliases the base custom eeveelution's slug art.
      spriteAlias: def.baseSpeciesId,
      type1: base.type1,
      type2: base.type2,
      baseStats: [...base.baseStats] as [number, number, number, number, number, number],
      abilities: actives,
      innates,
      catchRate: base.catchRate,
      weight: base.weight,
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
  // (EEVEE, partnerFormIndex)) maps each element type to its family target; every target
  // (8 partner eeveelutions + 3 partner aliases) chains among the whole set, so a
  // transform can chain freely (Partner Eevee -> Steel -> Partner Titaneon -> Water ->
  // Partner Vaporeon). The REAL Nimbeon/Ryuveon/Titaneon are NOT holders and have no
  // mapping — a regular eeveelution never transforms. A self-type map is a no-op. ---
  if (partnerFormIndex >= 0) {
    for (const [mapType, targetId] of OMNIFORM_FAMILY_TARGETS) {
      registerOmniformMapping(PARTNER_HEAD_SPECIES, partnerFormIndex, mapType, targetId as SpeciesId, 0);
      result.omniformMappings++;
    }
  }
  for (const [, holderId] of OMNIFORM_FAMILY_TARGETS) {
    for (const [mapType, targetId] of OMNIFORM_FAMILY_TARGETS) {
      registerOmniformMapping(holderId as SpeciesId, 0, mapType, targetId as SpeciesId, 0);
      result.omniformMappings++;
    }
  }

  // Partner Eevee is the permanent candy-unlock owner for the whole Omniform
  // family. The transient pre-transform snapshot covers ordinary mid-battle
  // adaptation; this registry also covers partner Eeveelutions (and aliases) loaded or
  // spawned directly, which otherwise consult their transform-only species' empty data.
  if (partnerFormIndex >= 0) {
    registerOmniformUnlockOwner(
      PARTNER_HEAD_SPECIES,
      partnerFormIndex,
      PARTNER_HEAD_SPECIES,
      partnerFormIndex,
    );
    for (const [, targetId] of OMNIFORM_FAMILY_TARGETS) {
      registerOmniformUnlockOwner(targetId as SpeciesId, 0, PARTNER_HEAD_SPECIES, partnerFormIndex);
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

  // Partner alias eeveelutions clone their base CUSTOM eeveelution's learnset verbatim.
  for (const def of ER_NEWCOMER_PARTNER_FAMILY) {
    table[def.partnerId] = cloneLearnset(def.baseSpeciesId);
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

  // Partner alias eeveelutions inherit their base CUSTOM eeveelution's TM set.
  for (const def of ER_NEWCOMER_PARTNER_FAMILY) {
    inheritFrom(def.partnerId, def.baseSpeciesId);
    wired++;
  }

  return wired;
}
