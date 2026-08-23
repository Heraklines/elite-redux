/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — HAND-AUTHORABLE mega/primal FORM injection seam (newcomer patch).
//
// {@linkcode ER_MEGA_FORMS} + `injectAllErMegaForms()` are DATA-DRIVEN from the
// vendor dump: every mega/primal there is a real ER species record whose stats /
// types / abilities are looked up by id. The newcomer-patch fakemon megas/primals
// have NO vendor record — they are hand-authored. This seam is the hand-authored
// analogue: a small table of {@linkcode NewcomerFormDef}s, each of which
// `injectNewcomerForms()` turns into a real pokerogue `PokemonForm` on an existing
// species with:
//   - its own stats + N-type typing (types 3..N via the N-type static model's
//     `setExtraTypes`, so effectiveness/STAB/battle-info fold them in),
//   - its own ACTIVE ability triple + INNATE (passive) triple,
//   - a #287 sprite/icon redirect to `elite-redux/<slug>/…` (LIVE art on er-assets;
//     each `slug` matches its published dir, e.g. `xerneas_mega`, `mew_primal`),
//   - a registered form-change EDGE in `pokemonFormChanges` triggered by its
//     mega stone / primal orb, so the reward pool offers the stone (Mega-Bracelet
//     gated, #207/#318/#359) and holding it transforms the base mon.
//
// Runs AFTER `injectAllErMegaForms()` (so a species' base form is already seeded
// when possible) and is IDEMPOTENT (a formKey already present is skipped). Forms
// store numeric ability ids, so it does NOT require the referenced abilities to
// be constructed yet (they are resolved at battle time from `allAbilities`).
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  installErFormSpriteRedirect,
  installErSpeciesFormSpriteDispatch,
} from "#data/elite-redux/er-form-sprite-redirect";
import { ErCustomSpecies } from "#data/elite-redux/init-elite-redux-custom-species";
import { PokemonForm } from "#data/pokemon-species";
import { pokemonFormChanges, SpeciesFormChange, SpeciesFormChangeCondition } from "#data/pokemon-forms";
import {
  SpeciesFormChangeItemTrigger,
  SpeciesFormChangeManualTrigger,
} from "#data/pokemon-forms/form-change-triggers";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { ER_SPORE_BED_ABILITY_ID } from "#data/elite-redux/abilities/spore-bed";
import { ER_MYCELIAL_NETWORK_ABILITY_ID } from "#data/elite-redux/abilities/mycelial-network";
import { ER_LAST_HOST_ABILITY_ID } from "#data/elite-redux/abilities/last-host";
import { ER_CLEANSING_LIGHT_ABILITY_ID } from "#data/elite-redux/abilities/cleansing-light";
import { ER_QUICKENING_GRACE_ABILITY_ID } from "#data/elite-redux/abilities/quickening-grace";
import {
  ER_DECOMPOSER_ABILITY_ID,
  ER_FIRST_SERPENT_ABILITY_ID,
  ER_GALE_BLOOM_ABILITY_ID,
  ER_GLYCOLYSIS_ABILITY_ID,
  ER_PURE_GOOD_ABILITY_ID,
  ER_TITAN_ABILITY_ID,
  ER_BRAIN_FOOD_ABILITY_ID,
} from "#data/elite-redux/abilities/composite-newcomers";
import {
  ER_ASTRAL_PROJECT_ABILITY_ID,
  ER_CONTAMINATED_ABILITY_ID,
  ER_CRYOGENESIS_ABILITY_ID,
  ER_DAYDREAMER_ABILITY_ID,
  ER_DECAY_ABILITY_ID,
  ER_EULOGY_ABILITY_ID,
  ER_FLUTTERING_SPIRIT_ABILITY_ID,
  ER_FREE_SPIRIT_ABILITY_ID,
  ER_HEAD_FIRST_ABILITY_ID,
  ER_IRRADIATED_FIST_ABILITY_ID,
  ER_METALLOSIS_ABILITY_ID,
  ER_NUCLEUS_ABILITY_ID,
  ER_ORACLE_ABILITY_ID,
  ER_PENTA_PUNCH_ABILITY_ID,
  ER_PHOTOVOLTAIC_ABILITY_ID,
  ER_PROPHETIC_ABILITY_ID,
  ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID,
  ER_SPLIT_MIND_ABILITY_ID,
  ER_STARCROSSED_ABILITY_ID,
  ER_THIRD_EYE_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { ER_FORMLESS_FIST_ABILITY_ID } from "#data/elite-redux/abilities/type-nativization-abilities";
import {
  ER_LILLIGANT_VERDANT_SPECIES_ID,
  ER_POWER_PLANT_SPECIES_ID,
} from "#data/elite-redux/er-fakemon-pitch-species";

/** ER-custom / newcomer ability ids are real `allAbilities` keys; narrow the type. */
const ab = (id: number): AbilityId => id as AbilityId;

// ---------------------------------------------------------------------------
// ER-custom active/innate ability ids used below. The 5900-range are the manual
// newcomer/batch abilities; the others are ER draft abilities resolved to their
// pokerogue id via ER_ID_MAP at authoring time (verified live by the seam test,
// which asserts every id resolves to a real allAbilities entry).
// ---------------------------------------------------------------------------
const ON_THE_PROWL = 5352; // ER draft 648
const COWARD = 5165; // ER draft 429
const SELF_REPAIR = 5151; // ER draft 415
const SLIME_MOLD = 5734; // ER draft 1033
const RAGING_BOXER = 5057; // ER draft 319
const STYGIAN_RUSH = 5279; // ER draft 558
const PREDATOR = 5101; // ER draft 363
// 5900-range innates carried by the megas/primals below.
const BORROWED_TIME = 5910;
const RELATIVITY = 5911;
const TANGLED_SEED = 5903;
const COMMON_ROOT = 5904;
const DANDELION_BURST = 5907;
const SYNCHRONIZED_CURRENT = 5921;
const POSITIVE_FEEDBACK = 5922;
const NEGATIVE_FEEDBACK = 5923;
const CLOSED_CIRCUIT = 5924;
const CAPACITOR_BANK = 5925;
const FAULT_CURRENT = 5926;
const OVERLOADED = 5927;
const DRACONIC_VOODOO = 5930;
const HYDRAPEX = 5931;
const BAD_SPLICE = 5932;
const WORLD_IN_PIECES = 5917;
const GENESIS_SUPERNOVA = 5937;
const SHATTERED_PSYCHE = 5968;
// Mega Skarmory Z / Mega Dragonite Z (formKey-collision rows, cleared 2026-07-15).
const POWER_EDGE = 5362; // ER draft
const KEEN_EDGE = 5009; // ER custom
const CROSSCUT = 5908; // batch newcomer
const ELUDE = 5511; // ER draft
const PUNCTURE = 5942; // composite (Deep Cuts + Pinnacle Blade)
const CHIVALRY = 5909; // batch newcomer
const MEGA_DRILL = 5684; // ER draft
const WEIGHTED_SCALES = 5938; // composite (Steelworker + Multiscale)
const KNIGHTS_HONOR = 5939; // bespoke (Def/SpDef King's Wrath)
const POWER_CORE = 5105; // ER draft
// --- Newcomer BATCH 2 form ability ids (codex signatures 5971-5994 + composites
// 5995-5996 + residual placeholders 5997-5998; resolved via the batch-2 audit). ---
const SPIRIT_PUNCH = 5983; // codex signature (Iron Fist Mystic Blades)
const EARTH_EATER = 297; // vanilla
const LEAD_COAT = 5034; // ER
const CRUDE_STEEL = 5995; // composite (Solid Rock + Steelworker)
const METEOR_MASS = 5997; // PLACEHOLDER (no design)
const FAE_HUNTER = 5178; // ER
const ECLIPSE_WING = 5971; // codex signature
const REAPERS_EMBRACE = 5726; // dump draft "Reaper's Embarce" (spec: Reaper's Embrace)
const HYPER_AGGRESSIVE = 5096; // ER
const ELECTRO_SURGE = 5000; // ER
const MOSH_PIT = 5376; // ER
const FIGHTING_SPIRIT = 5038; // ER
const TWO_FACED_UNLEASHED = 5977; // codex signature
const BRUTE_FORCE = 5459; // ER

/**
 * A hand-authored newcomer mega/primal form. Injected onto {@linkcode baseSpecies}
 * as a real `PokemonForm` with the stats/typing/kit below.
 */
export interface NewcomerFormDef {
  /** Vanilla or append-only custom species id the form is attached to. */
  readonly baseSpecies: SpeciesId | number;
  /** pokerogue form key (`mega` / `mega-x` / `mega-y` / `primal`). Must be free on the base. */
  readonly formKey: string;
  /** Display name of the injected form. */
  readonly formName: string;
  /** ER art slug: the form redirects to `elite-redux/<slug>/{front,back,icon}`. */
  readonly slug: string;
  /** Full static typing (1..6 entries). type1 = [0], type2 = [1] ?? null, extras = [2..]. */
  readonly types: readonly [PokemonType, ...PokemonType[]];
  /** Base stats [hp, atk, def, spatk, spdef, spd]. */
  readonly stats: readonly [number, number, number, number, number, number];
  /** ACTIVE ability triple (ability1, ability2, abilityHidden). */
  readonly actives: readonly [AbilityId, AbilityId, AbilityId];
  /** INNATE (passive) triple. */
  readonly innates: readonly [AbilityId, AbilityId, AbilityId];
  /** Mega stone / primal orb that triggers the form (a FormChangeItem enum value). */
  readonly item?: FormChangeItem;
  /** Register a one-way manual battle-form edge instead of an item edge. */
  readonly manualTrigger?: boolean;
  readonly preFormKeys?: readonly string[];
  /** Whether this form may be selected as a starter; omitted forms stay excluded. */
  readonly isStarterSelectable?: boolean;
  /** Optional gender condition for mutually-exclusive item edges. */
  readonly gender?: Gender;
  readonly replaceExisting?: boolean;
  /**
   * Extra level-1 learnset moves to append to the BASE species (learnsets are
   * per-species, not per-form). Applied AFTER `initEliteReduxMovesets` (which
   * rebuilds the whole table from the ER dump and would otherwise clobber them).
   */
  readonly learnMoves?: readonly MoveId[];
}

/**
 * The newcomer form table. Kits/stats/typings are verbatim from
 * `docs/fakemon-newcomer-patch.md`.
 *
 * NOTE: the two formKey-collision rows are now wired with a DEDICATED `mega-z`
 * key (maintainer decision 2026-07-15), additive alongside the existing ER megas:
 *   - Mega Skarmory Z  (new `mega-z`; the existing ER Mega Skarmory Y is untouched),
 *   - Mega Dragonite Z (new `mega-z`; a third mega alongside Dragonite `mega` + `mega-y`).
 */
export const ER_NEWCOMER_FORMS: readonly NewcomerFormDef[] = [
  // #4 Mega Xerneas — Fairy. Active Limber; innates Quickening Grace (5913),
  // Cleansing Light (5912), Pure Good (5935). Stone Xerneasite.
  {
    baseSpecies: SpeciesId.XERNEAS,
    formKey: "mega",
    formName: "Mega",
    slug: "xerneas_mega",
    types: [PokemonType.FAIRY],
    stats: [126, 151, 125, 151, 128, 99],
    actives: [AbilityId.LIMBER, AbilityId.LIMBER, AbilityId.LIMBER],
    innates: [
      ab(ER_QUICKENING_GRACE_ABILITY_ID),
      ab(ER_CLEANSING_LIGHT_ABILITY_ID),
      ab(ER_PURE_GOOD_ABILITY_ID),
    ],
    item: FormChangeItem.XERNEASITE,
  },
  // #10 Mega Parasect — Bug/Grass/Ghost (N-type). Active Spore Bed (5902) /
  // Shadow Tag / On the Prowl (5352); innates Decomposer (5945),
  // Mycelial Network (5905), Last Host (5906). Stone Parasectite. Also gains
  // Leaf Blade (learnset addition in pokemon-level-moves.ts).
  {
    baseSpecies: SpeciesId.PARASECT,
    formKey: "mega",
    formName: "Mega",
    slug: "parasect_mega",
    types: [PokemonType.BUG, PokemonType.GRASS, PokemonType.GHOST],
    stats: [80, 120, 145, 80, 170, 20],
    actives: [ab(ER_SPORE_BED_ABILITY_ID), AbilityId.SHADOW_TAG, ab(ON_THE_PROWL)],
    innates: [ab(ER_DECOMPOSER_ABILITY_ID), ab(ER_MYCELIAL_NETWORK_ABILITY_ID), ab(ER_LAST_HOST_ABILITY_ID)],
    item: FormChangeItem.PARASECTITE,
    learnMoves: [MoveId.LEAF_BLADE],
  },
  // #1 Mega Hydreigon X — Dark/Dragon. Active Strong Jaw; innates Hydrapex
  // (5931), Draconic Voodoo (5930), First Serpent (5933). Stone Hydreigonite X.
  {
    baseSpecies: SpeciesId.HYDREIGON,
    formKey: "mega-x",
    formName: "Mega X",
    slug: "hydreigon_mega_x",
    types: [PokemonType.DARK, PokemonType.DRAGON],
    stats: [92, 165, 123, 115, 90, 115],
    actives: [AbilityId.STRONG_JAW, AbilityId.STRONG_JAW, AbilityId.STRONG_JAW],
    innates: [ab(HYDRAPEX), ab(DRACONIC_VOODOO), ab(ER_FIRST_SERPENT_ABILITY_ID)],
    item: FormChangeItem.HYDREIGONITE_X,
  },
  // #5 Mega Shuckle Y — Bug/Psychic. Active Battle Armor / Coward / Self Repair;
  // innates Borrowed Time (5910), Relativity (5911), Slime Mold. Stone Shucklite Y.
  {
    baseSpecies: SpeciesId.SHUCKLE,
    formKey: "mega-y",
    formName: "Mega Y",
    slug: "shuckle_mega_y",
    types: [PokemonType.BUG, PokemonType.PSYCHIC],
    stats: [50, 50, 200, 130, 200, 20],
    actives: [AbilityId.BATTLE_ARMOR, ab(COWARD), ab(SELF_REPAIR)],
    innates: [ab(BORROWED_TIME), ab(RELATIVITY), ab(SLIME_MOLD)],
    item: FormChangeItem.SHUCKLITE_Y,
  },
  // #11 Mega Electivire X — Electric/Dark/Ground (N-type). Active Gorilla Tactics
  // / Raging Boxer / Stygian Rush; innates Overloaded (5927), Capacitor Bank
  // (5925), Fault Current (5926). Stone Electivirite X.
  {
    baseSpecies: SpeciesId.ELECTIVIRE,
    formKey: "mega-x",
    formName: "Mega X",
    slug: "electivire_mega_x",
    types: [PokemonType.ELECTRIC, PokemonType.DARK, PokemonType.GROUND],
    stats: [95, 163, 107, 85, 130, 60],
    actives: [AbilityId.GORILLA_TACTICS, ab(RAGING_BOXER), ab(STYGIAN_RUSH)],
    innates: [ab(OVERLOADED), ab(CAPACITOR_BANK), ab(FAULT_CURRENT)],
    item: FormChangeItem.ELECTIVIRITE_X,
  },
  // #15 Mega Jumpluff — Grass/Flying/Fairy (N-type). Active Gale Bloom (5944);
  // innates Tangled Seed (5903), Common Root (5904), Dandelion Burst (5907).
  // Stone Jumpluffite.
  {
    baseSpecies: SpeciesId.JUMPLUFF,
    formKey: "mega",
    formName: "Mega",
    slug: "jumpluff_mega",
    types: [PokemonType.GRASS, PokemonType.FLYING, PokemonType.FAIRY],
    stats: [75, 115, 90, 100, 105, 150],
    actives: [ab(ER_GALE_BLOOM_ABILITY_ID), ab(ER_GALE_BLOOM_ABILITY_ID), ab(ER_GALE_BLOOM_ABILITY_ID)],
    innates: [ab(TANGLED_SEED), ab(COMMON_ROOT), ab(DANDELION_BURST)],
    item: FormChangeItem.JUMPLUFFITE,
  },
  // #13 Mega Minun — Electric/Fairy (physical). Active Transistor / Closed Circuit
  // (5924) / Lightning Rod; innates Minus, Synchronized Current (5921), Negative
  // Feedback (5923). Stone Minunite.
  {
    baseSpecies: SpeciesId.MINUN,
    formKey: "mega",
    formName: "Mega",
    slug: "minun_mega",
    types: [PokemonType.ELECTRIC, PokemonType.FAIRY],
    stats: [60, 125, 95, 55, 85, 125],
    actives: [AbilityId.TRANSISTOR, ab(CLOSED_CIRCUIT), AbilityId.LIGHTNING_ROD],
    innates: [AbilityId.MINUS, ab(SYNCHRONIZED_CURRENT), ab(NEGATIVE_FEEDBACK)],
    item: FormChangeItem.MINUNITE,
  },
  // #14 Mega Plusle — Electric/Fairy (special). Active Pretty Privilege / Closed
  // Circuit (5924) / Friend Guard; innates Plus, Synchronized Current (5921),
  // Positive Feedback (5922). Stone Plusleite. (Pretty Privilege = ER draft 628.)
  {
    baseSpecies: SpeciesId.PLUSLE,
    formKey: "mega",
    formName: "Mega",
    slug: "plusle_mega",
    types: [PokemonType.ELECTRIC, PokemonType.FAIRY],
    stats: [60, 55, 95, 115, 105, 115],
    actives: [ab(5332), ab(CLOSED_CIRCUIT), AbilityId.FRIEND_GUARD],
    innates: [AbilityId.PLUS, ab(SYNCHRONIZED_CURRENT), ab(POSITIVE_FEEDBACK)],
    item: FormChangeItem.PLUSLEITE,
  },
  // #3 Primal Regigigas — Normal/Rock/Ice/Steel/Electric/Dragon (SIX types).
  // (Water was removed per maintainer directive 2026-07-22 — no longer native.) This
  // is the 6-type stress case for the N-type UI (Pass B); every non-Normal type is
  // removable, so World in Pieces has FIVE removable types in its pool here.
  // Active Predator / Stall / Raging Boxer; innates Titan (5934), World in Pieces
  // (5917), Self Repair. Orb Planetary Orb. Reversion form (like other primals):
  // holding the orb triggers the "primal" form, Mega-Bracelet gated in the pool.
  {
    baseSpecies: SpeciesId.REGIGIGAS,
    formKey: "primal",
    formName: "Primal",
    slug: "regigigas_primal",
    types: [
      PokemonType.NORMAL,
      PokemonType.ROCK,
      PokemonType.ICE,
      PokemonType.STEEL,
      PokemonType.ELECTRIC,
      PokemonType.DRAGON,
    ],
    stats: [140, 170, 145, 70, 145, 100],
    actives: [ab(PREDATOR), AbilityId.STALL, ab(RAGING_BOXER)],
    innates: [ab(ER_TITAN_ABILITY_ID), ab(WORLD_IN_PIECES), ab(SELF_REPAIR)],
    item: FormChangeItem.PLANETARY_ORB,
  },
  // #6 Primal Mew — Psychic. Active Bad Splice (5932); innates Brain Food (5936),
  // Genesis Supernova (5937), and Shattered Psyche (5968). Orb Embryonic Orb.
  {
    baseSpecies: SpeciesId.MEW,
    formKey: "primal",
    formName: "Primal",
    slug: "mew_primal",
    types: [PokemonType.PSYCHIC],
    stats: [100, 110, 130, 110, 130, 120],
    actives: [ab(BAD_SPLICE), ab(BAD_SPLICE), ab(BAD_SPLICE)],
    innates: [ab(ER_BRAIN_FOOD_ABILITY_ID), ab(GENESIS_SUPERNOVA), ab(SHATTERED_PSYCHE)],
    item: FormChangeItem.EMBRYONIC_ORB,
  },
  // #9 Mega Skarmory Z — Steel/Flying/Dragon (N-type). Additive `mega-z` key
  // alongside the EXISTING ER Mega Skarmory Y (formKey collision resolved by the
  // maintainer 2026-07-15: new key, Y untouched). Active Light Metal / Power Edge
  // / Keen Edge; innates Crosscut (5908), Elude (5511), Puncture (5942). Stone
  // Skarmorite Z. Sprite slug skarmory_mega_z (published er-assets dir; the ER
  // disk bake was mega_scam_y_*, republished under the game-side slug).
  {
    baseSpecies: SpeciesId.SKARMORY,
    formKey: "mega-z",
    formName: "Mega Z",
    slug: "skarmory_mega_z",
    types: [PokemonType.STEEL, PokemonType.FLYING, PokemonType.DRAGON],
    stats: [75, 135, 70, 135, 70, 110],
    actives: [AbilityId.LIGHT_METAL, ab(POWER_EDGE), ab(KEEN_EDGE)],
    innates: [ab(CROSSCUT), ab(ELUDE), ab(PUNCTURE)],
    item: FormChangeItem.SKARMORITE_Z,
  },
  // #7 Mega Dragonite Z — Dragon/Flying/Steel (N-type). Additive THIRD mega key
  // (`mega-z`) alongside Dragonite's existing mega + mega-y. Active Chivalry
  // (5909) / Mega Drill / Stamina; innates Weighted Scales (5938), Knight's Honor
  // (5939), Power Core. Stone Dragoninite Z. Slug dragonite_mega_z (published er-assets dir).
  {
    baseSpecies: SpeciesId.DRAGONITE,
    formKey: "mega-z",
    formName: "Mega Z",
    slug: "dragonite_mega_z",
    types: [PokemonType.DRAGON, PokemonType.FLYING, PokemonType.STEEL],
    stats: [91, 144, 144, 110, 110, 101],
    actives: [ab(CHIVALRY), ab(MEGA_DRILL), AbilityId.STAMINA],
    innates: [ab(WEIGHTED_SCALES), ab(KNIGHTS_HONOR), ab(POWER_CORE)],
    item: FormChangeItem.DRAGONINITE_Z,
  },
  // Alpha-dex additions. Lucario's newer Mega Y is published as Mega Z and
  // replaces the older imported `mega` record in place.
  {
    baseSpecies: SpeciesId.LUCARIO,
    formKey: "mega",
    formName: "Mega Z",
    slug: "lucario_mega_z",
    types: [PokemonType.FIGHTING, PokemonType.ELECTRIC],
    stats: [70, 142, 65, 142, 86, 120],
    actives: [ab(5064), AbilityId.ANTICIPATION, ab(5160)],
    innates: [ab(5364), ab(5365), ab(5363)],
    item: FormChangeItem.LUCARIONITE_Z,
    preFormKeys: [""],
    replaceExisting: true,
  },
  {
    baseSpecies: SpeciesId.KINGDRA,
    formKey: "mega-y",
    formName: "Mega Y",
    slug: "mega_kingdra_y",
    types: [PokemonType.WATER, PokemonType.DRAGON],
    stats: [75, 105, 95, 125, 95, 145],
    actives: [AbilityId.SURGE_SURFER, ab(5275), ab(5288)],
    innates: [AbilityId.TRANSISTOR, ab(5478), AbilityId.MULTISCALE],
    item: FormChangeItem.KINGDRANITE_Y,
    preFormKeys: [""],
  },
  {
    baseSpecies: SpeciesId.DURALUDON,
    formKey: "mega",
    formName: "Mega",
    slug: "duraludon_partner_mega",
    types: [PokemonType.STEEL, PokemonType.DRAGON],
    stats: [70, 155, 135, 110, 75, 90],
    actives: [AbilityId.MIRROR_ARMOR, AbilityId.LIGHT_METAL, ab(5374)],
    innates: [AbilityId.STEELWORKER, AbilityId.MEGA_LAUNCHER, AbilityId.LONG_REACH],
    item: FormChangeItem.DURALUDONITE,
    preFormKeys: [""],
  },
  {
    baseSpecies: SpeciesId.FIDOUGH,
    formKey: "partner",
    formName: "Partner",
    slug: "fidough_partner",
    types: [PokemonType.FAIRY],
    stats: [80, 75, 70, 50, 85, 75],
    actives: [ab(5290), ab(5215), ab(5332)],
    innates: [AbilityId.WELL_BAKED_BODY, AbilityId.REGENERATOR, AbilityId.PICKUP],
    isStarterSelectable: true,
  },
  {
    baseSpecies: SpeciesId.ROWLET,
    formKey: "partner",
    formName: "Partner",
    slug: "rowlet_partner",
    types: [PokemonType.GRASS, PokemonType.FLYING, PokemonType.FIRE],
    stats: [68, 40, 100, 138, 67, 122],
    actives: [ab(5984), ab(6105), AbilityId.SUPER_LUCK],
    innates: [ab(5292), ab(6108), ab(6109)],
    isStarterSelectable: true,
  },
  {
    baseSpecies: SpeciesId.ONIX,
    formKey: "partner",
    formName: "Partner",
    slug: "onix_partner",
    types: [PokemonType.STELLAR, PokemonType.ICE],
    stats: [65, 90, 170, 30, 160, 20],
    actives: [ab(5025), ab(5267), ab(6110)],
    innates: [ab(6111), ab(6112), ab(5064)],
    isStarterSelectable: true,
  },
  {
    baseSpecies: SpeciesId.GIMMIGHOUL,
    formKey: "partner",
    formName: "Partner",
    slug: "gimmighoul_partner",
    types: [PokemonType.GHOST, PokemonType.STEEL],
    stats: [75, 40, 129, 133, 80, 78],
    actives: [ab(5421), ab(5165), ab(6113)],
    innates: [ab(6114), AbilityId.GOOD_AS_GOLD, ab(6115)],
    isStarterSelectable: true,
  },
  {
    baseSpecies: SpeciesId.FIDOUGH,
    formKey: "mega",
    formName: "Mega",
    slug: "fidough_partner_mega",
    types: [PokemonType.FAIRY],
    stats: [80, 110, 110, 55, 110, 70],
    actives: [AbilityId.MISTY_SURGE, ab(5453), ab(5332)],
    innates: [ab(ER_GLYCOLYSIS_ABILITY_ID), ab(5356), ab(5969)],
    item: FormChangeItem.FIDOUGHITE,
    preFormKeys: ["partner"],
  },
  // ===================== NEWCOMER BATCH 2 =====================
  // Metagross Battle Bond — Steel/Psychic/Rock (N-type). FLAG (mechanism): a true
  // Battle Bond form should transform on a KO via a Greninja-style
  // SpeciesFormChangeAbilityTrigger; wired here with an item trigger
  // (Metagrossite Bond) for obtainability until that trigger is added.
  {
    baseSpecies: SpeciesId.METAGROSS,
    formKey: "battle-bond",
    formName: "Battle Bond",
    slug: "metagross_battle_bond",
    types: [PokemonType.STEEL, PokemonType.PSYCHIC, PokemonType.ROCK],
    stats: [80, 150, 150, 155, 135, 30],
    actives: [ab(SPIRIT_PUNCH), ab(EARTH_EATER), ab(LEAD_COAT)],
    innates: [ab(CRUDE_STEEL), ab(METEOR_MASS), AbilityId.BATTLE_BOND],
    item: FormChangeItem.METAGROSSITE_BOND,
  },
  // Yveltal Mega Z — Dark/Flying. Active Fae Hunter; innates Dark Aura, Eclipse
  // Wing (5971), Reaper's Embrace (5726). Stone Yveltalite Z.
  {
    baseSpecies: SpeciesId.YVELTAL,
    formKey: "mega-z",
    formName: "Mega Z",
    slug: "yveltal_mega_z",
    types: [PokemonType.DARK, PokemonType.FLYING],
    stats: [126, 179, 95, 131, 98, 151],
    actives: [ab(FAE_HUNTER), ab(FAE_HUNTER), ab(FAE_HUNTER)],
    innates: [AbilityId.DARK_AURA, ab(ECLIPSE_WING), ab(REAPERS_EMBRACE)],
    item: FormChangeItem.YVELTALITE_Z,
  },
  // Mega Luxray Y — Electric. Active Hyper Aggressive / Electro Surge / Mosh Pit;
  // innates Fighting Spirit, Two-Faced Unleashed (5977), Brute Force. Stone Luxrayite Y.
  {
    baseSpecies: SpeciesId.LUXRAY,
    formKey: "mega-y",
    formName: "Mega Y",
    slug: "luxray_mega_y",
    types: [PokemonType.ELECTRIC],
    stats: [90, 150, 100, 110, 100, 110],
    actives: [ab(HYPER_AGGRESSIVE), ab(ELECTRO_SURGE), ab(MOSH_PIT)],
    innates: [ab(FIGHTING_SPIRIT), ab(TWO_FACED_UNLEASHED), ab(BRUTE_FORCE)],
    item: FormChangeItem.LUXRAYITE_Y,
  },
  // ===================== DISCORD FAKEMON PITCH ROSTER (2026-08) =====================
  {
    baseSpecies: SpeciesId.CRYOGONAL,
    formKey: "mega",
    formName: "Mega",
    slug: "cryogonal_mega",
    types: [PokemonType.ICE],
    stats: [80, 50, 90, 115, 175, 105],
    actives: [ab(5100), ab(5187), ab(5007)],
    innates: [ab(5086), ab(5680), ab(ER_CRYOGENESIS_ABILITY_ID)],
    item: FormChangeItem.CRYOGONALITE,
  },
  {
    baseSpecies: SpeciesId.JIRACHI,
    formKey: "mega",
    formName: "Mega",
    slug: "jirachi_mega",
    types: [PokemonType.STEEL, PokemonType.PSYCHIC],
    stats: [100, 125, 125, 125, 125, 100],
    actives: [ab(ER_PROPHETIC_ABILITY_ID), AbilityId.REGENERATOR, ab(5025)],
    innates: [ab(5560), ab(ER_DAYDREAMER_ABILITY_ID), ab(ER_FREE_SPIRIT_ABILITY_ID)],
    item: FormChangeItem.JIRACHITE,
  },
  {
    baseSpecies: SpeciesId.LEDIAN,
    formKey: "mega",
    formName: "Mega",
    slug: "ledian_mega",
    types: [PokemonType.BUG, PokemonType.FIGHTING],
    stats: [55, 135, 80, 65, 130, 125],
    actives: [AbilityId.MOXIE, ab(ER_PENTA_PUNCH_ABILITY_ID), ab(ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID)],
    innates: [ab(ER_STARCROSSED_ABILITY_ID), ab(ER_ASTRAL_PROJECT_ABILITY_ID), ab(ER_FLUTTERING_SPIRIT_ABILITY_ID)],
    item: FormChangeItem.LEDIANITE,
  },
  {
    baseSpecies: SpeciesId.RAMPARDOS,
    formKey: "mega",
    formName: "Mega",
    slug: "rampardos_mega",
    types: [PokemonType.ROCK, PokemonType.DARK],
    stats: [97, 185, 105, 65, 80, 83],
    actives: [ab(5101), AbilityId.ANGER_POINT, ab(ER_HEAD_FIRST_ABILITY_ID)],
    innates: [AbilityId.NEUROFORCE, ab(5459), AbilityId.MOLD_BREAKER],
    item: FormChangeItem.RAMPARDOSITE,
  },
  {
    baseSpecies: SpeciesId.REUNICLUS,
    formKey: "mega-x",
    formName: "Mega X",
    slug: "reuniclus_mega_x",
    types: [PokemonType.PSYCHIC],
    stats: [110, 125, 92, 60, 110, 143],
    actives: [ab(ER_IRRADIATED_FIST_ABILITY_ID), ab(ER_IRRADIATED_FIST_ABILITY_ID), ab(ER_IRRADIATED_FIST_ABILITY_ID)],
    innates: [ab(5724), ab(ER_NUCLEUS_ABILITY_ID), ab(ER_FORMLESS_FIST_ABILITY_ID)],
    item: FormChangeItem.REUNICLUSITE_X,
  },
  {
    baseSpecies: SpeciesId.XATU,
    formKey: "mega",
    formName: "Mega",
    slug: "xatu_mega",
    types: [PokemonType.PSYCHIC, PokemonType.FLYING],
    stats: [82, 100, 110, 130, 110, 111],
    actives: [ab(ER_SPLIT_MIND_ABILITY_ID), ab(5043), ab(ER_EULOGY_ABILITY_ID)],
    innates: [ab(ER_ORACLE_ABILITY_ID), ab(ER_THIRD_EYE_ABILITY_ID), AbilityId.KEEN_EYE],
    item: FormChangeItem.XATUNITE,
  },
  {
    baseSpecies: SpeciesId.ZANGOOSE,
    formKey: "mega",
    formName: "Mega",
    slug: "zangoose_mega",
    types: [PokemonType.NORMAL, PokemonType.STEEL, PokemonType.POISON],
    stats: [73, 115, 115, 60, 115, 115],
    actives: [AbilityId.TOXIC_BOOST, AbilityId.TOXIC_BOOST, AbilityId.TOXIC_BOOST],
    innates: [ab(ER_METALLOSIS_ABILITY_ID), ab(ER_CONTAMINATED_ABILITY_ID), ab(ER_DECAY_ABILITY_ID)],
    item: FormChangeItem.ZANGOOSEITE,
  },
  // Power Plant's Live Current is a battle form, not a separate obtainable species.
  {
    baseSpecies: ER_POWER_PLANT_SPECIES_ID as SpeciesId,
    formKey: "live-current",
    formName: "Live Current",
    slug: "power_plant_live_current",
    types: [PokemonType.GRASS, PokemonType.FIRE, PokemonType.ELECTRIC],
    stats: [120, 40, 80, 130, 80, 120],
    actives: [AbilityId.FLASH_FIRE, ab(5350), ab(5197)],
    innates: [AbilityId.QUARK_DRIVE, ab(ER_PHOTOVOLTAIC_ABILITY_ID), ab(5363)],
    manualTrigger: true,
  },
  // Discord fakemon-pitch source-backed forms (2026-08).
  {
    baseSpecies: SpeciesId.CALYREX,
    formKey: "mega",
    formName: "Mega",
    slug: "calyrex_chariot_mega",
    types: [PokemonType.GRASS, PokemonType.PSYCHIC, PokemonType.ICE, PokemonType.GHOST],
    stats: [100, 155, 135, 155, 135, 100],
    actives: [ab(5158), ab(231), AbilityId.STAMINA],
    innates: [ab(6054), ab(6055), ab(5259)],
    item: FormChangeItem.CALYRITE,
    preFormKeys: ["ice", "shadow"],
  },
  {
    baseSpecies: SpeciesId.HYPNO,
    formKey: "mega",
    formName: "Mega",
    slug: "hypno_mega",
    types: [PokemonType.PSYCHIC],
    stats: [95, 73, 124, 120, 150, 73],
    actives: [ab(6056), AbilityId.BAD_DREAMS, AbilityId.PSYCHIC_SURGE],
    innates: [ab(6057), ab(5043), ab(6058)],
    item: FormChangeItem.HYPNITE,
  },
  {
    baseSpecies: SpeciesId.ALOLA_RAICHU,
    formKey: "mega-male",
    formName: "Mega Male",
    slug: "raichu_alolan_mega_male",
    types: [PokemonType.ELECTRIC, PokemonType.PSYCHIC],
    stats: [60, 125, 80, 105, 95, 125],
    actives: [ab(6059), ab(6059), ab(6059)],
    innates: [ab(6061), ab(6062), ab(6063)],
    item: FormChangeItem.ALORAICHUNITE,
    gender: Gender.MALE,
  },
  {
    baseSpecies: SpeciesId.ALOLA_RAICHU,
    formKey: "mega-female",
    formName: "Mega Female",
    slug: "raichu_alolan_mega_female",
    types: [PokemonType.ELECTRIC, PokemonType.PSYCHIC],
    stats: [60, 105, 70, 115, 95, 145],
    actives: [ab(6060), ab(6060), ab(6060)],
    innates: [ab(6061), ab(6062), ab(6063)],
    item: FormChangeItem.ALORAICHUNITE,
    gender: Gender.FEMALE,
  },
  {
    baseSpecies: SpeciesId.BARBARACLE,
    formKey: "mega-y",
    formName: "Mega Y",
    slug: "barbaracle_mega_y",
    types: [PokemonType.ROCK, PokemonType.PSYCHIC],
    stats: [72, 88, 130, 140, 106, 64],
    actives: [ab(6075), AbilityId.LIMBER, AbilityId.PSYCHIC_SURGE],
    innates: [ab(6076), ab(6077), AbilityId.SOLID_ROCK],
    item: FormChangeItem.BARBARACITE_Y,
    learnMoves: [MoveId.SWIRLY_ROOM],
  },
  {
    baseSpecies: ER_LILLIGANT_VERDANT_SPECIES_ID,
    formKey: "mega",
    formName: "Mega",
    slug: "lilligant_verdant_mega",
    types: [PokemonType.WATER, PokemonType.FAIRY, PokemonType.GHOST],
    stats: [90, 50, 101, 129, 120, 110],
    actives: [ab(6071), ab(6078), ab(6072)],
    innates: [ab(5596), ab(6073), ab(6074)],
    item: FormChangeItem.LILLIGANITE_VERDANT,
  },
  {
    baseSpecies: SpeciesId.UXIE,
    formKey: "primal",
    formName: "Corrupted",
    slug: "uxie_corrupted",
    types: [PokemonType.PSYCHIC, PokemonType.DARK],
    stats: [75, 125, 130, 125, 130, 95],
    actives: [ab(5224), AbilityId.MOODY, ab(5158)],
    innates: [ab(5464), ab(5314), ab(5475)],
    item: FormChangeItem.DISTORTED_CHAIN,
  },
  {
    baseSpecies: SpeciesId.GOLURK,
    formKey: "mega-y",
    formName: "Mega Y",
    slug: "golurk_mega_y",
    types: [PokemonType.GROUND, PokemonType.GHOST, PokemonType.FIGHTING],
    stats: [89, 159, 110, 105, 110, 40],
    actives: [ab(6081), AbilityId.SHEER_FORCE, AbilityId.SHADOW_SHIELD],
    innates: [ab(6116), ab(6082), ab(6083)],
    item: FormChangeItem.GOLURKITE_Y,
    preFormKeys: [""],
  },
  {
    baseSpecies: SpeciesId.SKUNTANK,
    formKey: "mega",
    formName: "Mega",
    slug: "skuntank_mega",
    types: [PokemonType.DARK, PokemonType.POISON, PokemonType.FIRE],
    stats: [103, 61, 97, 143, 91, 104],
    actives: [ab(5509), AbilityId.CORROSION, ab(5535)],
    innates: [ab(6084), ab(6085), ab(6086)],
    item: FormChangeItem.SKUNTANKITE,
  },
  {
    baseSpecies: SpeciesId.DODRIO,
    formKey: "mega",
    formName: "Mega",
    slug: "dodrio_mega",
    types: [PokemonType.NORMAL, PokemonType.FLYING, PokemonType.GROUND, PokemonType.FIGHTING],
    stats: [90, 130, 100, 70, 80, 140],
    actives: [AbilityId.VITAL_SPIRIT, AbilityId.LIMBER, AbilityId.BIG_PECKS],
    innates: [ab(6087), ab(6088), ab(6089)],
    item: FormChangeItem.DODRIONITE,
  },
  {
    baseSpecies: SpeciesId.PYUKUMUKU,
    formKey: "mega",
    formName: "Mega",
    slug: "pyukumuku_mega",
    types: [PokemonType.WATER],
    stats: [105, 60, 250, 30, 250, 5],
    actives: [AbilityId.CORROSION, AbilityId.PERISH_BODY, ab(5064)],
    innates: [ab(6104), AbilityId.UNAWARE, ab(5085)],
    item: FormChangeItem.PYUKUMUKUNITE,
  },
];

/**
 * Append every wired form's `learnMoves` to its base species' level-up moveset
 * (as level-1 entries, deduped). Called from init AFTER `initEliteReduxMovesets`,
 * which rebuilds the level-move table from the ER dump and would clobber a
 * pre-applied addition. Idempotent.
 */
export function applyNewcomerLearnsetAdditions(): number {
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;
  let added = 0;
  for (const def of ER_NEWCOMER_FORMS) {
    if (!def.learnMoves || def.learnMoves.length === 0) {
      continue;
    }
    const moves = (table[def.baseSpecies] ??= []);
    for (const moveId of def.learnMoves) {
      if (!moves.some(([, m]) => m === moveId)) {
        moves.push([1, moveId]);
        added++;
      }
    }
  }
  return added;
}

/** Outcome summary of a single {@linkcode injectNewcomerForms} run. */
export interface InjectNewcomerFormsResult {
  /** Forms newly injected this run. */
  injected: number;
  /** Forms skipped because their formKey already existed on the base (idempotent re-run). */
  skippedExisting: number;
  /** Form-change edges registered in pokemonFormChanges. */
  edgesRegistered: number;
  /** Non-fatal issues (unknown base species, etc.). */
  errors: string[];
}

/** Seed a "Normal" base form (formKey "") at index 0 so the mega lands at index >= 1. */
function seedBaseForm(species: ReturnType<typeof getPokemonSpecies>): void {
  const baseForm = new PokemonForm(
    "Normal",
    "",
    species.type1,
    species.type2,
    species.height,
    species.weight,
    species.ability1,
    species.ability2,
    species.abilityHidden,
    species.baseTotal,
    species.baseStats[0],
    species.baseStats[1],
    species.baseStats[2],
    species.baseStats[3],
    species.baseStats[4],
    species.baseStats[5],
    species.catchRate,
    species.baseFriendship,
    species.baseExp,
    false,
    null,
    true,
    false,
  );
  baseForm.setPassives(species.getPassiveAbilities());
  baseForm.setExtraTypes(species.getExtraTypes());
  const baseMut = baseForm as unknown as { speciesId: number; formIndex: number; generation: number };
  baseMut.speciesId = species.speciesId;
  baseMut.formIndex = 0;
  baseMut.generation = species.generation;
  (species.forms as unknown as PokemonForm[]).push(baseForm);
  const spriteSlug = ErCustomSpecies.getSpriteSlug(species.speciesId);
  if (spriteSlug !== undefined) {
    installErFormSpriteRedirect(baseForm, spriteSlug);
  }
}

/**
 * Register the mega stone / primal orb form-change edge so the reward pool offers
 * it AND the Pokedex lists the form.
 *
 * The `preFormKey` MUST equal the base species' live default form key, because
 * both the reward generator (`fc.preFormKey === p.getFormKey()`) and the Pokedex
 * form list (`f.preFormKey === currentFormKey`) match on it exactly. The old
 * hardcoded `""` was correct only for FORMLESS bases (their seeded base form key
 * is ""), but broke any base with NAMED default forms — e.g. Xerneas, whose forms
 * are "neutral"/"active" and never "", so Xerneasite never spawned and Mega
 * Xerneas was unreachable in the dex. Register an edge from EACH non-mega base
 * form key so the mega is offered whatever form the base is currently in.
 */
function registerFormChangeEdge(def: NewcomerFormDef, result: InjectNewcomerFormsResult): void {
  if (def.item === undefined && !def.manualTrigger) {
    return;
  }
  if (!pokemonFormChanges[def.baseSpecies]) {
    pokemonFormChanges[def.baseSpecies] = [];
  }
  const list = pokemonFormChanges[def.baseSpecies] as SpeciesFormChange[];
  const species = getPokemonSpecies(def.baseSpecies as SpeciesId);
  const baseKeys = (species?.forms ?? [])
    .map(f => f.formKey ?? "")
    .filter(k => k !== def.formKey && !/mega|primal/.test(k));
  const preKeys = def.preFormKeys ?? (baseKeys.length > 0 ? [...new Set(baseKeys)] : [""]);
  for (const preKey of preKeys) {
    const hasForwardEdge = list.some(fc => fc.preFormKey === preKey && fc.formKey === def.formKey);
    if (!hasForwardEdge) {
      const trigger = def.manualTrigger
        ? new SpeciesFormChangeManualTrigger()
        : new SpeciesFormChangeItemTrigger(def.item!);
      const conditions = def.gender === undefined
        ? []
        : [new SpeciesFormChangeCondition(pokemon => pokemon.gender === def.gender)];
      list.push(new SpeciesFormChange(def.baseSpecies as SpeciesId, preKey, def.formKey, trigger, false, ...conditions));
      result.edgesRegistered++;
    }

    // Calyrex keeps the rider's Reins modifier active while CALYRITE is
    // active. Explicit, rider-conditioned inactive edges prevent
    // initPokemonForms from creating two indistinguishable generic reverses.
    if (
      def.baseSpecies === SpeciesId.CALYREX
      && def.formKey === "mega"
      && def.item === FormChangeItem.CALYRITE
      && (preKey === "ice" || preKey === "shadow")
    ) {
      const riderItem = preKey === "ice"
        ? FormChangeItem.ICY_REINS_OF_UNITY
        : FormChangeItem.SHADOW_REINS_OF_UNITY;
      const hasReverseEdge = list.some(fc => fc.preFormKey === def.formKey && fc.formKey === preKey);
      if (!hasReverseEdge) {
        const riderCondition = new SpeciesFormChangeCondition(pokemon =>
          !!globalScene.findModifier(
            modifier =>
              modifier instanceof PokemonFormChangeItemModifier
              && modifier.pokemonId === pokemon.id
              && modifier.formChangeItem === riderItem
              && modifier.active,
            pokemon.isPlayer(),
          ),
        );
        list.push(
          new SpeciesFormChange(
            def.baseSpecies as SpeciesId,
            def.formKey,
            preKey,
            new SpeciesFormChangeItemTrigger(FormChangeItem.CALYRITE, false),
            false,
            riderCondition,
          ),
        );
        result.edgesRegistered++;
      }
    }
  }
}

/**
 * Inject every {@linkcode ER_NEWCOMER_FORMS} entry as a real form on its base
 * species, with N-type typing, active + innate kits, sprite redirect, and a
 * stone/orb-triggered form-change edge. Idempotent.
 */
export function injectNewcomerForms(): InjectNewcomerFormsResult {
  const result: InjectNewcomerFormsResult = { injected: 0, skippedExisting: 0, edgesRegistered: 0, errors: [] };
  for (const def of ER_NEWCOMER_FORMS) {
    const species = getPokemonSpecies(def.baseSpecies as SpeciesId);
    if (!species) {
      result.errors.push(`newcomer form ${def.formName}: base species ${def.baseSpecies} not found`);
      continue;
    }
    // Always register the stone edge (reachability/dex), even if the form was
    // already injected on a prior run.
    registerFormChangeEdge(def, result);
    const existingForm = species.forms.find(f => f.formKey === def.formKey);
    if (existingForm && !def.replaceExisting) {
      result.skippedExisting++;
      continue;
    }
    if (species.forms.length === 0) {
      seedBaseForm(species);
    }
    const type1 = def.types[0];
    const type2 = def.types.length > 1 ? def.types[1] : null;
    const [hp, atk, def_, spatk, spdef, spd] = def.stats;
    const form = new PokemonForm(
      def.formName,
      def.formKey,
      type1,
      type2,
      species.height,
      species.weight,
      def.actives[0],
      def.actives[1],
      def.actives[2],
      hp + atk + def_ + spatk + spdef + spd,
      hp,
      atk,
      def_,
      spatk,
      spdef,
      spd,
      species.catchRate,
      species.baseFriendship,
      species.baseExp,
      false, // genderDiffs
      null, // formSpriteKey — redirected to the ER slug below
      def.isStarterSelectable ?? false,
      false, // isUnobtainable
    );
    form.setPassives([def.innates[0], def.innates[1], def.innates[2]]);
    // N-type static model: fold types 3..N in (no-op for 1/2-type forms).
    if (def.types.length > 2) {
      form.setExtraTypes(def.types.slice(2));
    }
    const formMut = form as unknown as { speciesId: number; formIndex: number; generation: number };
    formMut.speciesId = species.speciesId;
    formMut.formIndex = existingForm?.formIndex ?? species.forms.length;
    formMut.generation = species.generation;
    if (existingForm) {
      (species.forms as unknown as PokemonForm[])[existingForm.formIndex] = form;
    } else {
      (species.forms as unknown as PokemonForm[]).push(form);
    }

    // #287 sprite/icon redirect to the ER slug (placeholder until art lands).
    installErFormSpriteRedirect(form, def.slug);
    // #287: also bridge the SPECIES-level sprite path to the redirected form.
    // The battle path uses `getSpeciesForm(formIndex).getSpriteAtlasPath()` (the
    // form object, patched above), but the DEX page and other UI surfaces call
    // the SPECIES-level `species.getSpriteKey(female, formIndex, …)`, which builds
    // the vanilla `{speciesId}-{formKey}` key and never touches the patched form.
    // Bases that also carry a vendor mega / redux form get this dispatch installed
    // by a later init sweep, but bases in NEITHER sweep (e.g. Minun, Plusle) were
    // left spriteless on the dex — install it here for every newcomer form so all
    // 12 render regardless of coincidental sweep membership. Idempotent per species.
    installErSpeciesFormSpriteDispatch(species);

    result.injected++;
  }
  return result;
}
