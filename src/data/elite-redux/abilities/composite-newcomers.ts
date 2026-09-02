/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Newcomer-patch composite abilities (fakemon forms phase).
//
// These are hand-authored composite abilities carried by the newcomer-patch
// megas/primals/evolutions. They use the manual ER-custom id range (5933+),
// which — like the Batch 1-4 abilities (5900-5932) — bypasses the auto-generated
// ER_ABILITIES / ER_ID_MAP / ER_COMPOSITE_PARTS tables (those are keyed by ER
// source draft id, and these abilities have no ER source draft).
//
// "Invoke ALL constituent parts via the established composite infra": each
// composite is the union of its constituents' AbAttrs, exactly the model
// documented in `archetypes/composite.ts` and executed by `dispatchComposite`
// (`resolveCompositePartAttrs`) for the draft-id composites. We replicate that
// resolution here for the manual-id range:
//   - resolve every constituent to its LIVE pokerogue ability (`allAbilities[id]`),
//   - copy its AbAttrs onto the composite (shallow-cloned so the two abilities
//     never share a mutable AbAttr instance),
//   - carry the constituent ability's own gate (`.conditions`, e.g. Swift Swim's
//     rain condition) onto each copied attr as an `extraCondition` so a gated
//     part cannot apply unconditionally inside the composite.
//
// Wiring happens in a post-init pass (`wireEliteReduxManualComposites`) called
// right after `refreshEliteReduxComposites()` so every constituent — ER-custom
// (>=5000, built in the main pass) AND vanilla (rebalance-/C-source-patched
// LATER) — is in its final state before we snapshot its attrs.
//
// "Show constituent detailed descriptions" (#201): `MANUAL_COMPOSITE_PARTS` is
// also consulted by `getErCompositeDetailedDescription` so the summary/ability
// detail view concatenates each constituent's detailed description, just like
// the draft-id composites.
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { DOCUMENTED_COMPOSITES } from "#data/elite-redux/abilities/documented-ability-definitions";
import {
  ER_BEJEWELED_ABILITY_ID,
  ER_BLAZE_RELEASE_ABILITY_ID,
  ER_BODHISATTVA_ABILITY_ID,
  ER_CRANISPHERE_ABILITY_ID,
  ER_CRUSHING_ANTLERS_ABILITY_ID,
  ER_CRYOGENESIS_ABILITY_ID,
  ER_CURSED_SPIRIT_ABILITY_ID,
  ER_DAYDREAMER_ABILITY_ID,
  ER_DIRTY_SNOWBALL_ABILITY_ID,
  ER_EBB_AND_FLOW_ABILITY_ID,
  ER_EXOSUIT_ABILITY_ID,
  ER_FLUTTERING_SPIRIT_ABILITY_ID,
  ER_FOURTH_DEGREE_ABILITY_ID,
  ER_FREE_SPIRIT_ABILITY_ID,
  ER_IN_THE_CLOUDS_ABILITY_ID,
  ER_IN_THE_ROUGH_ABILITY_ID,
  ER_KAGUTSUCHI_ABILITY_ID,
  ER_KYOKUSHIN_ABILITY_ID,
  ER_LINGERING_MUSK_ABILITY_ID,
  ER_MAGISTRATE_ABILITY_ID,
  ER_MONK_ABILITY_ID,
  ER_MOONARCH_ABILITY_ID,
  ER_NUCLEUS_ABILITY_ID,
  ER_PAPER_TALISMAN_ABILITY_ID,
  ER_PHOTOVOLTAIC_ABILITY_ID,
  ER_PUNGENCY_ABILITY_ID,
  ER_SOLAR_PANEL_ABILITY_ID,
  ER_SPIRITUAL_SABER_ABILITY_ID,
  ER_SPLASH_DAMAGE_ABILITY_ID,
  ER_STRONG_HEADED_ABILITY_ID,
  ER_SWORDS_NATURE_ABILITY_ID,
  ER_THICK_SKULLED_ABILITY_ID,
  ER_TWO_CHAMBERED_ABILITY_ID,
  ER_VORACITY_ABILITY_ID,
  ER_WORLD_EATER_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import {
  ER_DRAGONFRUIT_ABILITY_ID,
  ER_FREE_CLIMB_ABILITY_ID,
  ER_GRIEVOUS_SPEAR_ABILITY_ID,
  ER_GRIM_JAB_ABILITY_ID,
  ER_KOMODO_NATIVIZE_ABILITY_ID,
  ER_OMINOUS_SHROUD_ABILITY_ID,
  ER_SAVAGE_SPEAR_ABILITY_ID,
  ER_SPECTACLE_ABILITY_ID,
  ER_VOLTRON_ABILITY_ID,
  ER_WATERBORNE_ABILITY_ID,
} from "#data/elite-redux/abilities/type-nativization-abilities";
import { AbilityId } from "#enums/ability-id";

// ---------------------------------------------------------------------------
// Manual composite ability ids (continue the 5900-range Batch 1-4 numbering).
// ---------------------------------------------------------------------------
export const ER_FIRST_SERPENT_ABILITY_ID = 5933;
export const ER_TITAN_ABILITY_ID = 5934;
export const ER_PURE_GOOD_ABILITY_ID = 5935;
export const ER_BRAIN_FOOD_ABILITY_ID = 5936;
// 5937 Genesis Supernova — bespoke (see genesis-supernova.ts).
export const ER_WEIGHTED_SCALES_ABILITY_ID = 5938;
// 5939 Knight's Honor — bespoke variant (see knights-honor.ts).
export const ER_BRAINPOWER_ABILITY_ID = 5940;
export const ER_FAMILIAR_ABILITY_ID = 5941;
export const ER_PUNCTURE_ABILITY_ID = 5942;
export const ER_RAINBOW_FISH_ABILITY_ID = 5943;
export const ER_GALE_BLOOM_ABILITY_ID = 5944;
export const ER_DECOMPOSER_ABILITY_ID = 5945;
// Partner-Eevee family (fakemon newcomer patch). Each partner species grafts
// Omniform (5929) onto its base kit's FIRST innate as a composite [innate +
// Omniform], so the original innate stays fully live while the family can
// adapt/chain across forms. 9 entries: partner Eevee + 8 partner eeveelutions.
export const ER_PARTNER_EEVEE_ABILITY_ID = 5946;
export const ER_PARTNER_VAPOREON_ABILITY_ID = 5947;
export const ER_PARTNER_JOLTEON_ABILITY_ID = 5948;
export const ER_PARTNER_FLAREON_ABILITY_ID = 5949;
export const ER_PARTNER_ESPEON_ABILITY_ID = 5950;
export const ER_PARTNER_UMBREON_ABILITY_ID = 5951;
export const ER_PARTNER_LEAFEON_ABILITY_ID = 5952;
export const ER_PARTNER_GLACEON_ABILITY_ID = 5953;
export const ER_PARTNER_SYLVEON_ABILITY_ID = 5954;
// 5955-5969 are allocated by type-nativization and other newcomer abilities.
export const ER_GLYCOLYSIS_ABILITY_ID = 5970;
// --- Newcomer BATCH 2 composites (fakemon newcomer patch, batch 2). ---
// Each is the union of its two constituents' attrs, resolved by the same wire
// pass; both constituents stay fully active with their own gates. Ids 5971-5994
// are owned by the codex signature batch (newcomer-signature-abilities.ts), so
// these two designer-spec'd composites live at 5995+ (Porous + Gillie Suit are
// NOT composites in the codex batch — they are bespoke signature abilities there).
export const ER_CRUDE_STEEL_ABILITY_ID = 5995; // Solid Rock + Steelworker
export const ER_MINIGUN_ABILITY_ID = 5996; // Quick Draw + Dual Wield
// 5997 Meteor Mass + 5998 Inverse Room are signature abilities (newcomer-batch2.ts).
// Batch-2 Omniform EXTENSION (maintainer verdict 2026-07-22, CORRECTED after the live
// "regular Titaneon transformed" report): the three NEW eeveelutions Nimbeon / Ryuveon /
// Titaneon get PARTNER ALIAS species (like the 8 partner eeveelutions 70012-70019). The
// composite [innate + Omniform] is carried by the ALIAS, NOT the real species — so the
// REGULAR eeveelution (evolved from a regular Eevee) has a PLAIN innate and never
// transforms, while the Partner Eevee family chains THROUGH the alias. Each composite is
// [that eeveelution's own innate[0] + Omniform], grafted onto the alias's innate[0].
export const ER_PARTNER_NIMBEON_ABILITY_ID = 6001; // Fluffy + Omniform
export const ER_PARTNER_RYUVEON_ABILITY_ID = 6002; // Stamina + Omniform
export const ER_PARTNER_TITANEON_ABILITY_ID = 6003; // Stainless Steel + Omniform

/**
 * A single manual-composite definition: the display name, the verbatim short
 * description, and the resolved pokerogue ability ids of its constituents.
 *
 * Constituent ids are the LIVE pokerogue ids (vanilla `AbilityId.*` for vanilla
 * parts, or the ER-custom id >=5000 that `ER_ID_MAP.abilities[draftId]`
 * produced — verified present at authoring time). The wire pass resolves each
 * against `allAbilities` at runtime.
 */
export interface ManualCompositeDef {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly constituents: readonly number[];
}

// Resolved ER-custom constituent ids (draft id -> pokerogue id, verified via
// ER_ID_MAP at authoring time). Named here for legibility of the table below.
const SIDEWINDER = 5380;
const WORLD_SERPENT = 5550;
const IMPENETRABLE = 5064;
const RELIC_STONE = 5567;
const ARCANE_FORCE = 5224;
const SOUL_EATER = 5069;
const EMANATE = 5190;
const MAJESTIC_BIRD = 5061;
const ARCHMAGE = 5186;
const DEEP_CUTS = 5438;
const PINNACLE_BLADE = 5401;
const AIR_BLOWER = 5058;
const HARUKAZE = 5534;
const PARASITIC_SPORES = 5314;
const ITCHY_DEFENSE = 5207;
// Batch-2 composite constituents (ER-custom live pokerogue ids, verified via the
// ability audit against ER_ID_MAP; the seam test asserts each resolves).
const DUAL_WIELD = 5169; // Minigun constituent (ER custom)
// Omniform (5929) — the graft constituent for the partner-Eevee family. Resolved
// live via `allAbilities[5929]`; its `OmniformAbAttr` is copied into every partner
// composite so the composite drives the adaptive transform AND keeps the base
// innate's own effect. The remaining constituents are each base eeveelution's
// FIRST innate (verified live from the ER-patched kit at authoring time).
/** Lightweight Omniform id for composite metadata consumers. */
export const ER_OMNIFORM_COMPOSITE_PART_ID = 5929;
const OMNIFORM = ER_OMNIFORM_COMPOSITE_PART_ID;
const FLUFFY = 218; // base Eevee innate[0] (also Nimbeon innate[0])
const STAMINA = 192; // Ryuveon innate[0] (vanilla)
const STAINLESS_STEEL = 5530; // Titaneon innate[0] (ER custom)
const WATER_VEIL = 41; // base Vaporeon innate[0]
const SHORT_CIRCUIT = 5060; // base Jolteon innate[0] (ER custom)
const FLASH_FIRE = 18; // base Flareon innate[0]
const MAGIC_BOUNCE = 156; // base Espeon innate[0]
const SELF_SUFFICIENT = 5045; // base Umbreon innate[0] (ER custom)
const KEEN_EDGE = 5009; // base Leafeon innate[0] (ER custom)
const ICE_BODY = 115; // base Glaceon innate[0]
const PIXILATE = 182; // base Sylveon innate[0]

// Type-nativization (Pass A) composite constituents. ER-custom constituent ids
// are the LIVE pokerogue ids (ErAbilityId), verified present at authoring time.
const HYDRATE = 5053; // ER custom (Normal moves become Water, Water empowered)
const DRACONIZE = 5149; // ER custom (Normal moves become Dragon, Dragon empowered)
const ENVENOM = 5553; // ER custom (poison-on-attack)
const FOGGY_EYE = 5666; // ER custom
const MOUNTAINEER = 5052; // ER custom (immune to Rock moves + Stealth Rock)
const PERMAFROST = 5055;
const FREEZING_POINT = 5222;
const EQUINOX = 5160;
const OVERRULE = 5516;
const DREAM_WHIMSY = 5413;
const WISHMAKER = 5226;
const AERODYNAMICS = 5020;
const SWORD_OF_RUIN = AbilityId.SWORD_OF_RUIN;
const HUNTERS_HORN = 5195;
const ROCKY_PAYLOAD = 276;
const LETS_ROLL = 5031;
const LIQUIFIED = 5049;
const EMANATE_FAKEMON = 5190;
const SOLAR_POWER = AbilityId.SOLAR_POWER;
const BLADES_ESSENCE = 5242;
const AEGIS_WARD = 5697;
const HAND_BARNACLES = 5668;
const BRAIN_OVER_BRAWN = 6080;

/**
 * The manual-composite registry, keyed by pokerogue ability id. This is the
 * single source of truth consumed by both {@linkcode wireEliteReduxManualComposites}
 * (attrs) and `getErCompositeDetailedDescription` (constituent detail text).
 */
export const MANUAL_COMPOSITE_PARTS: Readonly<Record<number, ManualCompositeDef>> = {
  ...Object.fromEntries(DOCUMENTED_COMPOSITES.map(def => [def.id, def])),
  [ER_CRYOGENESIS_ABILITY_ID]: {
    id: ER_CRYOGENESIS_ABILITY_ID,
    name: "Cryogenesis",
    description: "Permafrost + Freezing Point.",
    constituents: [PERMAFROST, FREEZING_POINT],
  },
  [ER_MAGISTRATE_ABILITY_ID]: {
    id: ER_MAGISTRATE_ABILITY_ID,
    name: "Magistrate",
    description: "Equinox + Overrule.",
    constituents: [EQUINOX, OVERRULE],
  },
  [ER_DAYDREAMER_ABILITY_ID]: {
    id: ER_DAYDREAMER_ABILITY_ID,
    name: "Daydreamer",
    description: "Dream Whimsy + Wishmaker.",
    constituents: [DREAM_WHIMSY, WISHMAKER],
  },
  [ER_FREE_SPIRIT_ABILITY_ID]: {
    id: ER_FREE_SPIRIT_ABILITY_ID,
    name: "Free Spirit",
    description: "Serene Grace + Levitate.",
    constituents: [AbilityId.SERENE_GRACE, AbilityId.LEVITATE],
  },
  [ER_FLUTTERING_SPIRIT_ABILITY_ID]: {
    id: ER_FLUTTERING_SPIRIT_ABILITY_ID,
    name: "Fluttering Spirit",
    description: "Aerilate + Aerodynamics.",
    constituents: [AbilityId.AERILATE, AERODYNAMICS],
  },
  [ER_IN_THE_CLOUDS_ABILITY_ID]: {
    id: ER_IN_THE_CLOUDS_ABILITY_ID,
    name: "In the Clouds",
    description: "Unaware + Cloud Nine.",
    constituents: [AbilityId.UNAWARE, AbilityId.CLOUD_NINE],
  },
  [ER_THICK_SKULLED_ABILITY_ID]: {
    id: ER_THICK_SKULLED_ABILITY_ID,
    name: "Thick Skulled",
    description: "Rock Head + Thick Fat.",
    constituents: [AbilityId.ROCK_HEAD, AbilityId.THICK_FAT],
  },
  [ER_SWORDS_NATURE_ABILITY_ID]: {
    id: ER_SWORDS_NATURE_ABILITY_ID,
    name: "Sword's Nature",
    description: "Sword of Ruin + Keen Edge.",
    constituents: [SWORD_OF_RUIN, KEEN_EDGE],
  },
  [ER_CRUSHING_ANTLERS_ABILITY_ID]: {
    id: ER_CRUSHING_ANTLERS_ABILITY_ID,
    name: "Crushing Antlers",
    description: "Hunter's Horn + Rapier: horn and Keen Edge moves receive both abilities' effects.",
    constituents: [HUNTERS_HORN, KEEN_EDGE],
  },
  [ER_DIRTY_SNOWBALL_ABILITY_ID]: {
    id: ER_DIRTY_SNOWBALL_ABILITY_ID,
    name: "Dirty Snowball",
    description: "Rocky Payload + Let's Roll.",
    constituents: [ROCKY_PAYLOAD, LETS_ROLL],
  },
  [ER_SOLAR_PANEL_ABILITY_ID]: {
    id: ER_SOLAR_PANEL_ABILITY_ID,
    name: "Solar Panel",
    description: "Drought + Steelworker.",
    constituents: [AbilityId.DROUGHT, AbilityId.STEELWORKER],
  },
  [ER_PHOTOVOLTAIC_ABILITY_ID]: {
    id: ER_PHOTOVOLTAIC_ABILITY_ID,
    name: "Photovoltaic",
    description: "Solar Power + Electric type graft.",
    constituents: [SOLAR_POWER],
  },
  [ER_NUCLEUS_ABILITY_ID]: {
    id: ER_NUCLEUS_ABILITY_ID,
    name: "Nucleus",
    description: "Liquified + Emanate.",
    constituents: [LIQUIFIED, EMANATE_FAKEMON],
  },
  [ER_GLYCOLYSIS_ABILITY_ID]: {
    id: ER_GLYCOLYSIS_ABILITY_ID,
    name: "Glycolysis",
    description: "Harvest + Well-Baked Body.",
    constituents: [AbilityId.HARVEST, AbilityId.WELL_BAKED_BODY],
  },
  // --- Newcomer BATCH 2 composites (spec'd inline by the designer). ---
  // Crude Steel (Metagross Battle Bond innate) = Solid Rock + Steelworker.
  [ER_CRUDE_STEEL_ABILITY_ID]: {
    id: ER_CRUDE_STEEL_ABILITY_ID,
    name: "Crude Steel",
    description: "Solid Rock + Steelworker.",
    constituents: [AbilityId.SOLID_ROCK, AbilityId.STEELWORKER],
  },
  // Minigun (Dustnoir/Drawclops innate) = Quick Draw + Dual Wield.
  [ER_MINIGUN_ABILITY_ID]: {
    id: ER_MINIGUN_ABILITY_ID,
    name: "Minigun",
    description: "Quick Draw + Dual Wield.",
    constituents: [AbilityId.QUICK_DRAW, DUAL_WIELD],
  },
  [ER_FIRST_SERPENT_ABILITY_ID]: {
    id: ER_FIRST_SERPENT_ABILITY_ID,
    name: "First Serpent",
    description: "Sidewinder + World Serpent.",
    constituents: [SIDEWINDER, WORLD_SERPENT],
  },
  [ER_TITAN_ABILITY_ID]: {
    id: ER_TITAN_ABILITY_ID,
    name: "Titan",
    description: "Impenetrable + Relic Stone.",
    constituents: [IMPENETRABLE, RELIC_STONE],
  },
  [ER_PURE_GOOD_ABILITY_ID]: {
    id: ER_PURE_GOOD_ABILITY_ID,
    name: "Pure Good",
    description: "Fairy Aura + Soul-Heart.",
    constituents: [AbilityId.FAIRY_AURA, AbilityId.SOUL_HEART],
  },
  [ER_BRAIN_FOOD_ABILITY_ID]: {
    id: ER_BRAIN_FOOD_ABILITY_ID,
    name: "Brain Food",
    description: "Arcane Force + Soul Eater.",
    constituents: [ARCANE_FORCE, SOUL_EATER],
  },
  [ER_WEIGHTED_SCALES_ABILITY_ID]: {
    id: ER_WEIGHTED_SCALES_ABILITY_ID,
    name: "Weighted Scales",
    description: "Steelworker + Multiscale.",
    constituents: [AbilityId.STEELWORKER, AbilityId.MULTISCALE],
  },
  [ER_BRAINPOWER_ABILITY_ID]: {
    id: ER_BRAINPOWER_ABILITY_ID,
    name: "Brainpower",
    description: "Emanate + Insomnia.",
    constituents: [EMANATE, AbilityId.INSOMNIA],
  },
  [ER_FAMILIAR_ABILITY_ID]: {
    id: ER_FAMILIAR_ABILITY_ID,
    name: "Familiar",
    description: "Majestic Bird + Archmage.",
    constituents: [MAJESTIC_BIRD, ARCHMAGE],
  },
  [ER_PUNCTURE_ABILITY_ID]: {
    id: ER_PUNCTURE_ABILITY_ID,
    name: "Puncture",
    description: "Deep Cuts + Pinnacle Blade.",
    constituents: [DEEP_CUTS, PINNACLE_BLADE],
  },
  [ER_RAINBOW_FISH_ABILITY_ID]: {
    id: ER_RAINBOW_FISH_ABILITY_ID,
    name: "Rainbow Fish",
    description: "Swift Swim + Marvel Scale.",
    constituents: [AbilityId.SWIFT_SWIM, AbilityId.MARVEL_SCALE],
  },
  [ER_GALE_BLOOM_ABILITY_ID]: {
    id: ER_GALE_BLOOM_ABILITY_ID,
    name: "Gale Bloom",
    description: "Air Blower + Harukaze.",
    constituents: [AIR_BLOWER, HARUKAZE],
  },
  // Decomposer (maintainer 2026-07-15): the newcomer-patch innate that had no
  // definition is a composite of two existing ER abilities. Both constituents
  // stay fully active with their own gates; their detailed descriptions surface
  // via the #201 constituent-detail pattern.
  [ER_DECOMPOSER_ABILITY_ID]: {
    id: ER_DECOMPOSER_ABILITY_ID,
    name: "Decomposer",
    description: "Parasitic Spores + Itchy Defense.",
    constituents: [PARASITIC_SPORES, ITCHY_DEFENSE],
  },
  // Partner-Eevee family (fakemon newcomer patch). Each entry grafts Omniform
  // onto the base eeveelution's FIRST innate: the original innate stays fully
  // active (its detailed description surfaces via #201) AND the composite carries
  // Omniform's adaptive-transform attr so the partner form can chain across the
  // family. The eeveelutions keep the base innate's name; the Partner Eevee HEAD
  // is renamed to "Adaptive Fur" (maintainer directive 2026-07-22) — display name
  // only, mechanics + constituents (Fluffy + Omniform) unchanged, and the
  // constituent parts stay visible via the description + the card chips.
  [ER_PARTNER_EEVEE_ABILITY_ID]: {
    id: ER_PARTNER_EEVEE_ABILITY_ID,
    name: "Adaptive Fur",
    description: "Fluffy + Omniform.",
    constituents: [FLUFFY, OMNIFORM],
  },
  [ER_PARTNER_VAPOREON_ABILITY_ID]: {
    id: ER_PARTNER_VAPOREON_ABILITY_ID,
    name: "Water Veil",
    description: "Water Veil + Omniform.",
    constituents: [WATER_VEIL, OMNIFORM],
  },
  [ER_PARTNER_JOLTEON_ABILITY_ID]: {
    id: ER_PARTNER_JOLTEON_ABILITY_ID,
    name: "Short Circuit",
    description: "Short Circuit + Omniform.",
    constituents: [SHORT_CIRCUIT, OMNIFORM],
  },
  [ER_PARTNER_FLAREON_ABILITY_ID]: {
    id: ER_PARTNER_FLAREON_ABILITY_ID,
    name: "Flash Fire",
    description: "Flash Fire + Omniform.",
    constituents: [FLASH_FIRE, OMNIFORM],
  },
  [ER_PARTNER_ESPEON_ABILITY_ID]: {
    id: ER_PARTNER_ESPEON_ABILITY_ID,
    name: "Magic Bounce",
    description: "Magic Bounce + Omniform.",
    constituents: [MAGIC_BOUNCE, OMNIFORM],
  },
  [ER_PARTNER_UMBREON_ABILITY_ID]: {
    id: ER_PARTNER_UMBREON_ABILITY_ID,
    name: "Self Sufficient",
    description: "Self Sufficient + Omniform.",
    constituents: [SELF_SUFFICIENT, OMNIFORM],
  },
  [ER_PARTNER_LEAFEON_ABILITY_ID]: {
    id: ER_PARTNER_LEAFEON_ABILITY_ID,
    name: "Keen Edge",
    description: "Keen Edge + Omniform.",
    constituents: [KEEN_EDGE, OMNIFORM],
  },
  [ER_PARTNER_GLACEON_ABILITY_ID]: {
    id: ER_PARTNER_GLACEON_ABILITY_ID,
    name: "Ice Body",
    description: "Ice Body + Omniform.",
    constituents: [ICE_BODY, OMNIFORM],
  },
  [ER_PARTNER_SYLVEON_ABILITY_ID]: {
    id: ER_PARTNER_SYLVEON_ABILITY_ID,
    name: "Pixilate",
    description: "Pixilate + Omniform.",
    constituents: [PIXILATE, OMNIFORM],
  },
  // Batch-2 Omniform EXTENSION: the three NEW eeveelutions get PARTNER ALIAS species that
  // carry Omniform (the real species do NOT — regular eeveelutions never transform). Each
  // alias keeps its base eeveelution's own innate[0] name; Omniform is grafted on.
  [ER_PARTNER_NIMBEON_ABILITY_ID]: {
    id: ER_PARTNER_NIMBEON_ABILITY_ID,
    name: "Fluffy",
    description: "Fluffy + Omniform.",
    constituents: [FLUFFY, OMNIFORM],
  },
  [ER_PARTNER_RYUVEON_ABILITY_ID]: {
    id: ER_PARTNER_RYUVEON_ABILITY_ID,
    name: "Stamina",
    description: "Stamina + Omniform.",
    constituents: [STAMINA, OMNIFORM],
  },
  [ER_PARTNER_TITANEON_ABILITY_ID]: {
    id: ER_PARTNER_TITANEON_ABILITY_ID,
    name: "Stainless Steel",
    description: "Stainless Steel + Omniform.",
    constituents: [STAINLESS_STEEL, OMNIFORM],
  },
  [ER_SPIRITUAL_SABER_ABILITY_ID]: {
    id: ER_SPIRITUAL_SABER_ABILITY_ID,
    name: "Spiritual Saber",
    description: "Blade's Essence + Keen Edge moves make no contact.",
    constituents: [BLADES_ESSENCE],
  },
  [ER_PAPER_TALISMAN_ABILITY_ID]: {
    id: ER_PAPER_TALISMAN_ABILITY_ID,
    name: "Paper Talisman",
    description: "Fluffy + Aegis Ward.",
    constituents: [FLUFFY, AEGIS_WARD],
  },
  [ER_EBB_AND_FLOW_ABILITY_ID]: {
    id: ER_EBB_AND_FLOW_ABILITY_ID,
    name: "Ebb and Flow",
    description: "Tidal Rush + High Tide.",
    constituents: [5281, 5233],
  },
  [ER_MOONARCH_ABILITY_ID]: {
    id: ER_MOONARCH_ABILITY_ID,
    name: "Moonarch",
    description: "Queenly Majesty + Moon Spirit.",
    constituents: [AbilityId.QUEENLY_MAJESTY, 5209],
  },
  // -----------------------------------------------------------------------
  // Type-nativization (Pass A) composite replacements (5955-5962). Each is the
  // union of its two constituents' attrs, resolved by the same wire pass.
  // -----------------------------------------------------------------------
  [ER_WATERBORNE_ABILITY_ID]: {
    id: ER_WATERBORNE_ABILITY_ID,
    name: "Waterborne",
    description: "Hydrate + Adaptability.",
    constituents: [HYDRATE, AbilityId.ADAPTABILITY],
  },
  [ER_DRAGONFRUIT_ABILITY_ID]: {
    id: ER_DRAGONFRUIT_ABILITY_ID,
    name: "Dragonfruit",
    description: "Draconize + Rough Skin.",
    constituents: [DRACONIZE, AbilityId.ROUGH_SKIN],
  },
  [ER_KOMODO_NATIVIZE_ABILITY_ID]: {
    id: ER_KOMODO_NATIVIZE_ABILITY_ID,
    name: "Komodo",
    description: "Draconize + Envenom.",
    constituents: [DRACONIZE, ENVENOM],
  },
  [ER_VOLTRON_ABILITY_ID]: {
    id: ER_VOLTRON_ABILITY_ID,
    name: "Voltron",
    description: "Steely Spirit + Battle Armor.",
    constituents: [AbilityId.STEELY_SPIRIT, AbilityId.BATTLE_ARMOR],
  },
  [ER_GRIEVOUS_SPEAR_ABILITY_ID]: {
    id: ER_GRIEVOUS_SPEAR_ABILITY_ID,
    name: "Grievous Spear",
    description: "Grim Jab + Savage Spear.",
    constituents: [ER_GRIM_JAB_ABILITY_ID, ER_SAVAGE_SPEAR_ABILITY_ID],
  },
  [ER_SPECTACLE_ABILITY_ID]: {
    id: ER_SPECTACLE_ABILITY_ID,
    name: "Spectacle",
    description: "Levitate + Illuminate.",
    constituents: [AbilityId.LEVITATE, AbilityId.ILLUMINATE],
  },
  [ER_OMINOUS_SHROUD_ABILITY_ID]: {
    id: ER_OMINOUS_SHROUD_ABILITY_ID,
    name: "Ominous Shroud",
    description: "Shadow Shield + Foggy Eye.",
    constituents: [AbilityId.SHADOW_SHIELD, FOGGY_EYE],
  },
  [ER_FREE_CLIMB_ABILITY_ID]: {
    id: ER_FREE_CLIMB_ABILITY_ID,
    name: "Free Climb",
    description: "Unburden + Mountaineer.",
    constituents: [AbilityId.UNBURDEN, MOUNTAINEER],
  },
  [ER_BODHISATTVA_ABILITY_ID]: {
    id: ER_BODHISATTVA_ABILITY_ID,
    name: "Bodhisattva",
    description: "Hand Barnacles + Brain Over Brawn.",
    constituents: [HAND_BARNACLES, BRAIN_OVER_BRAWN],
  },
  [ER_MONK_ABILITY_ID]: {
    id: ER_MONK_ABILITY_ID,
    name: "Monk",
    description: "Inner Focus + an empowered, disruption-proof Focus Punch.",
    constituents: [AbilityId.INNER_FOCUS],
  },
  [ER_LINGERING_MUSK_ABILITY_ID]: {
    id: ER_LINGERING_MUSK_ABILITY_ID,
    name: "Lingering Musk",
    description: "Lingering Aroma + delayed end-of-turn fainting.",
    constituents: [AbilityId.LINGERING_AROMA],
  },
  [ER_PUNGENCY_ABILITY_ID]: {
    id: ER_PUNGENCY_ABILITY_ID,
    name: "Pungency",
    description: "Stench + Aftermath.",
    constituents: [AbilityId.STENCH, AbilityId.AFTERMATH],
  },
  [ER_TWO_CHAMBERED_ABILITY_ID]: {
    id: ER_TWO_CHAMBERED_ABILITY_ID,
    name: "Two-Chambered",
    description: "Dual Wield + Splash Damage.",
    constituents: [5169, ER_SPLASH_DAMAGE_ABILITY_ID],
  },
  [ER_STRONG_HEADED_ABILITY_ID]: {
    id: ER_STRONG_HEADED_ABILITY_ID,
    name: "Strong-Headed",
    description: "Multi-Headed + Moxie.",
    constituents: [5085, AbilityId.MOXIE],
  },
  [ER_KYOKUSHIN_ABILITY_ID]: {
    id: ER_KYOKUSHIN_ABILITY_ID,
    name: "Kyokushin",
    description: "Roundhouse + Mixed Martial Arts.",
    constituents: [5139, 5514],
  },
  [ER_CURSED_SPIRIT_ABILITY_ID]: {
    id: ER_CURSED_SPIRIT_ABILITY_ID,
    name: "Cursed Spirit",
    description: "Ill Will + Avenger.",
    constituents: [5285, 5030],
  },
  [ER_CRANISPHERE_ABILITY_ID]: {
    id: ER_CRANISPHERE_ABILITY_ID,
    name: "Cranisphere",
    description: "Bone Zone + a one-turn first Skull Bash.",
    constituents: [5091],
  },
  [ER_EXOSUIT_ABILITY_ID]: {
    id: ER_EXOSUIT_ABILITY_ID,
    name: "Exosuit",
    description: "Battle Armor + Unburden.",
    constituents: [AbilityId.BATTLE_ARMOR, AbilityId.UNBURDEN],
  },
  [ER_VORACITY_ABILITY_ID]: {
    id: ER_VORACITY_ABILITY_ID,
    name: "Voracity",
    description: "Unnerve + Gluttony.",
    constituents: [AbilityId.UNNERVE, AbilityId.GLUTTONY],
  },
  [ER_WORLD_EATER_ABILITY_ID]: {
    id: ER_WORLD_EATER_ABILITY_ID,
    name: "World-Eater",
    description: "Devourer + Jaws of Carnage.",
    constituents: [5249, 5174],
  },
  [ER_BLAZE_RELEASE_ABILITY_ID]: {
    id: ER_BLAZE_RELEASE_ABILITY_ID,
    name: "Blaze Release",
    description: "Immolate + Amaterasu.",
    constituents: [5017, 6106],
  },
  [ER_KAGUTSUCHI_ABILITY_ID]: {
    id: ER_KAGUTSUCHI_ABILITY_ID,
    name: "Kagutsuchi",
    description: "Mythical Arrows + Fourth Degree.",
    constituents: [5308, 6107],
  },
  [ER_FOURTH_DEGREE_ABILITY_ID]: {
    id: ER_FOURTH_DEGREE_ABILITY_ID,
    name: "Fourth Degree",
    description: "Sniper + critical hits burn.",
    constituents: [AbilityId.SNIPER],
  },
  [ER_BEJEWELED_ABILITY_ID]: {
    id: ER_BEJEWELED_ABILITY_ID,
    name: "Bejeweled",
    description: "Crystallize + Stellarize.",
    constituents: [5018, 6053],
  },
  [ER_IN_THE_ROUGH_ABILITY_ID]: {
    id: ER_IN_THE_ROUGH_ABILITY_ID,
    name: "In the Rough",
    description: "Crystalline Armor + Rough Skin.",
    constituents: [5588, AbilityId.ROUGH_SKIN],
  },
};

/**
 * Resolve one constituent ability's AbAttrs for embedding in a composite.
 *
 * Mirrors `resolveCompositePartAttrs` in the archetype dispatcher: shallow-clones
 * each source attr (so the composite and the standalone ability never share a
 * mutable AbAttr instance) and, when the source ability carries ability-level
 * gate conditions (e.g. Swift Swim's rain condition), folds those onto each
 * clone as an `extraCondition` so the part cannot apply unconditionally.
 *
 * @param constituentId - live pokerogue ability id of the constituent
 * @returns the cloned, gate-preserving attr list; empty when the constituent
 *   is absent or has no attrs (logged by the caller for triage).
 */
function resolveConstituentAttrs(constituentId: number): readonly AbAttr[] {
  const ability = allAbilities[constituentId];
  if (!ability || ability.attrs.length === 0) {
    return [];
  }
  const sourceConditions = ability.conditions;
  return ability.attrs.map(attr => {
    const clone = Object.assign(Object.create(Object.getPrototypeOf(attr)), attr) as AbAttr;
    if (sourceConditions.length > 0) {
      const existing = clone.getCondition();
      clone.addCondition(
        pokemon => sourceConditions.every(c => c(pokemon)) && (existing === null || existing(pokemon)),
      );
    }
    return clone;
  });
}

/** Aggregated result of a single {@linkcode wireEliteReduxManualComposites} run. */
export interface WireManualCompositesResult {
  /** Number of composites that received at least one constituent attr this run. */
  wired: number;
  /** Constituent ids that resolved to zero attrs (a pre-existing port gap, logged). */
  emptyConstituents: { compositeId: number; constituentId: number }[];
}

/**
 * Post-init pass: populate every manual-composite ability's attrs from its
 * constituents. Idempotent — clears and rebuilds the attr list each call
 * (matches `refreshEliteReduxComposites`). Must run AFTER the vanilla rebalance
 * + C-source corrections + `refreshEliteReduxComposites`, so vanilla and
 * draft-id-composite constituents are in their final patched state.
 */
export function wireEliteReduxManualComposites(): WireManualCompositesResult {
  const result: WireManualCompositesResult = { wired: 0, emptyConstituents: [] };
  for (const def of Object.values(MANUAL_COMPOSITE_PARTS)) {
    const ability = allAbilities[def.id];
    if (!ability) {
      continue;
    }
    const collected: AbAttr[] = [];
    for (const constituentId of def.constituents) {
      const attrs = resolveConstituentAttrs(constituentId);
      if (attrs.length === 0) {
        result.emptyConstituents.push({ compositeId: def.id, constituentId });
        continue;
      }
      for (const attr of attrs) {
        collected.push(attr);
      }
    }
    // Keep bespoke riders wired directly onto a composite (e.g. Photovoltaic's
    // type graft, Spiritual Saber's contact override, and the BerNerd compound
    // abilities). Constituent-derived attrs are rebuilt below, so only ctor
    // shapes absent from the resolved parts are preserved.
    const constituentCtorNames = new Set(collected.map(attr => attr.constructor.name));
    const preservedBespokeAttrs = ability.attrs.filter(attr => !constituentCtorNames.has(attr.constructor.name));
    if (collected.length === 0) {
      continue;
    }
    const attrs = (ability as unknown as { attrs: AbAttr[] }).attrs;
    attrs.length = 0;
    for (const attr of collected) {
      attrs.push(attr);
    }
    for (const attr of preservedBespokeAttrs) {
      attrs.push(attr);
    }
    if (def.constituents.some(id => allAbilities[id]?.bypassFaint)) {
      ability.makeBypassFaint();
    }
    result.wired++;
  }
  return result;
}

/**
 * Whether `pokerogueAbilityId` is a manual-composite (newcomer-patch) ability.
 * Used by the ability-detail description path to route to the constituent-detail
 * builder.
 */
export function isManualComposite(pokerogueAbilityId: number): boolean {
  return pokerogueAbilityId in MANUAL_COMPOSITE_PARTS;
}

/** The constituent pokerogue ability ids for a manual-composite, or null. */
export function manualCompositeConstituents(pokerogueAbilityId: number): readonly number[] | null {
  return MANUAL_COMPOSITE_PARTS[pokerogueAbilityId]?.constituents ?? null;
}

/** Assert that a live ability instance is one of ours (test/diagnostic helper). */
export function manualCompositeName(ability: Ability | undefined): string | undefined {
  if (!ability) {
    return;
  }
  return MANUAL_COMPOSITE_PARTS[ability.id]?.name;
}
