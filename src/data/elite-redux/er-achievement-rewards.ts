/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - achievement reward grants.
//
// When an achievement unlocks for the FIRST time (via battle-scene.validateAchv,
// which dedupes against gameData.achvUnlocks), the matching reward below is
// granted to the player's SYSTEM save and announced in the inbox.
//
// Two properties fall out of hooking the FIRST-unlock path:
//  - One-time: the unlock is one-time, so the reward is too.
//  - Never retroactive: an already-unlocked achievement never re-fires, so
//    existing holders are NOT back-paid when this ships, and an IMPORTED save
//    (achievements already unlocked) earns nothing - importing forfeits rewards.
//  NOTE for any future STATE-based achievement (e.g. "own all 18 ribbons"): it
//  would auto-unlock + pay on first validate for players who already qualify.
//  Such achievements must gate the reward on a fresh event, not a load-time
//  state check. Every reward wired so far is event-based (a win / a one-time act).
//
// Reward PHILOSOPHY (maintainer rule - do not violate):
//  - The roster/collection layer ONLY: candy, eggs, specific Pokemon, and -
//    for very hard challenges only - shinies.
//  - NEVER money, NEVER charms / rate boosts, NEVER run-start power. Rewards must
//    not make a run easier or trivialize skill.
//  - The black shiny is granted ONLY by the apex-tier stacked challenges. Maintainer
//    house rule (extended #900 follow-up): the black shiny is earned by Inferno
//    (Hell + NU usage tier + Doubles-only + Ghost Trainers) AND the two deeper apex
//    rungs added in the follow-up - COCYTUS (Hell + NU + Triples-only + Ghost
//    Trainers) and GIUDECCA (Hell + PU + Doubles-only + Ghost Trainers). Nothing
//    outside these hell-tier apex stacks grants it.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { speciesStarterCosts } from "#balance/starters";
import { Egg } from "#data/egg";
import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { grantErShinyLabEffectAvailability } from "#data/elite-redux/er-shiny-lab-config";
import {
  ER_SHINY_LAB_EFFECT_INDEX,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  getErShinyLabEffectsForAchv,
} from "#data/elite-redux/er-shiny-lab-effects";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { type Achv, achvs, RewardAchv } from "#system/achv";
import { VoucherType } from "#system/voucher";

/** Per-difficulty multiplier applied to candy-to-team payouts (skill scaling). */
const REWARD_DIFFICULTY_CANDY_MULT: Record<string, number> = {
  youngster: 1,
  ace: 1.5,
  elite: 2,
  hell: 3,
};

/** Player-facing egg-tier label (no enum SHOUTING in the inbox). */
const EGG_TIER_LABEL = ["Common", "Rare", "Epic", "Legendary"] as const;

/** Player-facing voucher label per VoucherType (Regular/Plus/Premium/Golden). */
const VOUCHER_LABEL: Record<VoucherType, string> = {
  [VoucherType.REGULAR]: "Egg Voucher",
  [VoucherType.PLUS]: "Egg Voucher Plus",
  [VoucherType.PREMIUM]: "Egg Voucher Premium",
  [VoucherType.GOLDEN]: "Golden Egg Voucher",
};

/**
 * What a single achievement grants. A discriminated union so each kind carries
 * exactly its own fields. `species: "random"` rolls a random obtainable starter.
 */
export type RewardSpec =
  /** Fixed candy to one species (root-normalized). */
  | { kind: "candy"; species: SpeciesId; amount: number }
  /** Candy to EACH mon on the winning team, scaled by run difficulty. */
  | { kind: "candyTeam"; perMon: number }
  /**
   * `count` eggs of a fixed tier. `shiny` forces every hatch to be shiny; `species`
   * makes them a fixed-species egg (otherwise the tier's species pool rolls).
   */
  | { kind: "eggs"; tier: EggTier; count: number; shiny?: boolean; species?: SpeciesId }
  /** `count` egg-gacha vouchers of a type (Regular/Plus/Premium/Golden = 1/5/10/25 pulls). */
  | { kind: "voucher"; voucherType: VoucherType; count: number }
  /**
   * A guaranteed shiny (hard challenges only). `tier: "random"` rolls a variant tier 1-3
   * at grant time (never the black tier). `minCost` restricts a `"random"` species roll to
   * starters whose base cost is at least that value (skill/rarity scaling - reused by later
   * feats), and is ignored for a fixed species.
   */
  | { kind: "shiny"; tier: 1 | 2 | 3 | "random"; species: SpeciesId | "random"; minCost?: number }
  /** The apex-only black shiny (separate ER tier-4 path). */
  | { kind: "blackShiny"; species: SpeciesId | "random" }
  /** A specific Pokemon, caught (normal). */
  | { kind: "pokemon"; species: SpeciesId }
  /**
   * A trainer title, persisted to the system save (gameData.erTitles). Display UI is
   * intentionally deferred - the grant only records the earned title so nothing is lost.
   */
  | { kind: "title"; title: string }
  /** Global Shiny Lab availability gates. Species still buy or catch ownership. */
  | { kind: "shinyLabEffects"; effects: string[] }
  /**
   * Unlock availability of ONE randomly-chosen achievement-gated AROUND aura effect
   * that isn't available yet (the apex COCYTUS reward). Cosmetic-only, unseeded roll.
   */
  | { kind: "randomAroundEffect" };

/**
 * achv id (the key in `achvs`) -> reward(s). Only ids present here grant anything;
 * everything else stays cosmetic-score-only exactly as before.
 *
 * PHASE 1 wires CLASSIC_VICTORY as the proof. The rest (apex/Nuzlocke shinies,
 * catch-tier eggs, mono candy-to-team, etc.) are added in later phases.
 */
export const ER_ACHIEVEMENT_REWARDS: Record<string, RewardSpec | RewardSpec[]> = {
  CLASSIC_VICTORY: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "eggs", tier: EggTier.RARE, count: 2 },
  ],
  // Nuzlocke: a guaranteed random shiny, scaled by the difficulty cleared. The base
  // NUZLOCKE fires on any difficulty (T1); the Elite/Hell tiers are their own achvs.
  NUZLOCKE: { kind: "shiny", tier: 1, species: "random" },
  LAST_STAND: { kind: "shiny", tier: 2, species: "random" },
  PERMADEATH: { kind: "shiny", tier: 3, species: "random" },
  // Apex stack (NU + Doubles + Ghost Trainers): a difficulty-scaled shiny. Inferno
  // (Hell) is the ONLY source of a black shiny anywhere in the game.
  LIMBO: { kind: "shiny", tier: 1, species: "random" },
  PURGATORY: { kind: "shiny", tier: 2, species: "random" },
  INFERNO: { kind: "blackShiny", species: "random" },

  // === Catch rares (eggs scaled to rarity caught) ===========================
  CATCH_SUB_LEGENDARY: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  CATCH_MYTHICAL: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  CATCH_LEGENDARY: { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },

  // === Hatch rares ==========================================================
  HATCH_SUB_LEGENDARY: { kind: "eggs", tier: EggTier.RARE, count: 1 },
  HATCH_MYTHICAL: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  HATCH_LEGENDARY: { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
  HATCH_SHINY: { kind: "eggs", tier: EggTier.EPIC, count: 1, shiny: true },

  // === Mono-TYPE wins: team candy + one iconic on-type, non-legendary mon ====
  MONO_NORMAL: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.SNORLAX }],
  MONO_FIGHTING: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.MACHAMP }],
  MONO_FLYING: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.CORVIKNIGHT }],
  MONO_POISON: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "pokemon", species: SpeciesId.NIDOKING },
    { kind: "shinyLabEffects", effects: ["toxic", "poison"] },
  ],
  MONO_GROUND: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.EXCADRILL }],
  MONO_ROCK: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.GIGALITH }],
  MONO_BUG: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.SCIZOR }],
  MONO_GHOST: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.GENGAR }],
  MONO_STEEL: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.AEGISLASH }],
  MONO_FIRE: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.ARCANINE }],
  MONO_WATER: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.GYARADOS }],
  MONO_GRASS: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.VENUSAUR }],
  MONO_ELECTRIC: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.JOLTEON }],
  MONO_PSYCHIC: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.ALAKAZAM }],
  MONO_ICE: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "pokemon", species: SpeciesId.GLACEON },
    { kind: "shinyLabEffects", effects: ["frostbite", "frost"] },
  ],
  MONO_DRAGON: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.HAXORUS }],
  MONO_DARK: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.WEAVILE }],
  MONO_FAIRY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.SYLVEON }],

  // === Mono-GEN wins: team candy + one iconic non-legendary mon of that gen ==
  MONO_GEN_ONE_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.CHARIZARD }],
  MONO_GEN_TWO_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.TYPHLOSION }],
  MONO_GEN_THREE_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.BLAZIKEN }],
  MONO_GEN_FOUR_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.INFERNAPE }],
  MONO_GEN_FIVE_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.SERPERIOR }],
  MONO_GEN_SIX_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.GRENINJA }],
  MONO_GEN_SEVEN_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.INCINEROAR }],
  MONO_GEN_EIGHT_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.CINDERACE }],
  MONO_GEN_NINE_VICTORY: [{ kind: "candyTeam", perMon: 20 }, { kind: "pokemon", species: SpeciesId.MEOWSCARADA }],

  // === One-time mechanics (flat team candy) =================================
  MEGA_EVOLVE: { kind: "candyTeam", perMon: 10 },
  GIGANTAMAX: { kind: "candyTeam", perMon: 10 },
  TERASTALLIZE: { kind: "candyTeam", perMon: 10 },
  STELLAR_TERASTALLIZE: { kind: "candyTeam", perMon: 10 },
  SPLICE: { kind: "candyTeam", perMon: 10 },
  MINI_BLACK_HOLE: { kind: "candyTeam", perMon: 10 },
  TRANSFER_MAX_STAT_STAGE: { kind: "candyTeam", perMon: 10 },
  MAX_FRIENDSHIP: { kind: "candyTeam", perMon: 10 },
  HIDDEN_ABILITY: { kind: "candyTeam", perMon: 10 },
  PERFECT_IVS: { kind: "candyTeam", perMon: 10 },

  // === Ribbon milestones (escalating egg tiers) =============================
  _10_RIBBONS: { kind: "eggs", tier: EggTier.RARE, count: 1 },
  _25_RIBBONS: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  _50_RIBBONS: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  _75_RIBBONS: [
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  // 100 challenge ribbons is an extreme grind - cap the ladder with a guaranteed shiny.
  _100_RIBBONS: [
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
    { kind: "shiny", tier: 2, species: "random" },
  ],

  // === Grind ladders (team candy, escalating within each ladder) ============
  _10K_MONEY: { kind: "candyTeam", perMon: 10 },
  _100K_MONEY: { kind: "candyTeam", perMon: 15 },
  _1M_MONEY: { kind: "candyTeam", perMon: 20 },
  _10M_MONEY: { kind: "candyTeam", perMon: 30 },
  _250_DMG: { kind: "candyTeam", perMon: 10 },
  _1000_DMG: { kind: "candyTeam", perMon: 15 },
  _2500_DMG: { kind: "candyTeam", perMon: 20 },
  _10000_DMG: { kind: "candyTeam", perMon: 30 },
  _250_HEAL: { kind: "candyTeam", perMon: 10 },
  _1000_HEAL: { kind: "candyTeam", perMon: 15 },
  _2500_HEAL: { kind: "candyTeam", perMon: 20 },
  _10000_HEAL: { kind: "candyTeam", perMon: 30 },
  LV_100: { kind: "candyTeam", perMon: 10 },
  LV_250: { kind: "candyTeam", perMon: 20 },
  LV_1000: { kind: "candyTeam", perMon: 30 },

  // === Shiny ================================================================
  SEE_SHINY: { kind: "candyTeam", perMon: 10 },
  SHINY_PARTY: { kind: "eggs", tier: EggTier.EPIC, count: 5, shiny: true },

  // === Challenge wins =======================================================
  FRESH_START: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "eggs", tier: EggTier.RARE, count: 2 },
    { kind: "shinyLabEffects", effects: ["aurum", "flame", "goldenglow"] },
  ],
  INVERSE_BATTLE: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  FLIP_STATS: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  FLIP_INVERSE: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  UNEVOLVED_CLASSIC_VICTORY: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  DAILY_VICTORY: [{ kind: "candyTeam", perMon: 15 }, { kind: "eggs", tier: EggTier.RARE, count: 1 }],

  // === ER Pokemon grant =====================================================
  // Solrock System (ER-custom id 10770). The species field is typed SpeciesId
  // (the vanilla enum); ER ids live in ErSpeciesId, so bridge with the same
  // narrowing the rest of the ER layer uses (er-monocolor/scenarios/overgrown).
  BREEDERS_IN_SPACE: { kind: "pokemon", species: ErSpeciesId.SOLROCK_SYSTEM as unknown as SpeciesId },

  // === ER milestone achievements (event-gated grants) =======================
  // Accepting one of Giratina's Bargain deals.
  DEVILS_BARGAIN: { kind: "eggs", tier: EggTier.EPIC, count: 2 },
  // Defeating a ghost-team trainer (cross-player ghost or Colosseum ghost round).
  EXORCIST: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "pokemon", species: SpeciesId.CHANDELURE },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
    { kind: "shinyLabEffects", effects: ["cosmos", "shadowaura"] },
  ],
  // Defeating the Primal Cascoon final-boss second stage (endgame - guaranteed shiny).
  PRIMAL_CASCOON: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  ],
  // Holding five relics at once in a single run.
  RELIC_HUNTER: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  // Owning a shiny Pokemon of all three variant tiers.
  ALL_SHINY_TIERS: [
    { kind: "eggs", tier: EggTier.EPIC, count: 1, shiny: true },
    { kind: "shinyLabEffects", effects: ["rainbowoutline"] },
  ],
  // Earning all eighteen mono-type ribbons (= 18 hard run clears; the meta-capstone).
  MASTER_OF_ALL: [
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 3 },
    { kind: "shinyLabEffects", effects: ["spectrumsplit"] },
  ],

  // === New feat batch (#747) + Squatter ====================================
  // Low: a single egg + a little themed candy. Medium: egg-gacha vouchers.
  // High: a guaranteed shiny (per the difficulty->reward rule). Run-completion
  // achievements ALSO get +2 Premium vouchers folded in by RUN_COMPLETION_ACHV_IDS.
  POKE_HIM_ON: [{ kind: "eggs", tier: EggTier.RARE, count: 1 }, { kind: "candy", species: SpeciesId.PIKACHU, amount: 50 }],
  REALISTIC_FLASH_IS_BORING: [{ kind: "eggs", tier: EggTier.RARE, count: 1 }, { kind: "candyTeam", perMon: 10 }],
  PK_STARSTORM: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  INCOMPATIBLE_HARDWARE: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  SUPER_ARMOR: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  END_THE_LEGEND: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  // Compleat Nightmare needs a Darkrai; reward its lunar counterpart, Cresselia.
  COMPLEAT_NIGHTMARE: [
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
    { kind: "pokemon", species: SpeciesId.CRESSELIA },
  ],
  EVERYONE_GET_OUT: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  // Dreamcatcher catches Cresselia; reward its counterpart, Darkrai (feeds Compleat Nightmare).
  DREAMCATCHER: [
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
    { kind: "pokemon", species: SpeciesId.DARKRAI },
  ],
  MUTUALLY_ASSURED_DESTRUCTION: { kind: "shiny", tier: 1, species: "random" },
  FULL_ON_MEGA_POWER: { kind: "shiny", tier: 2, species: "random" },
  // Original Dragon Spirit: Reshiram + Zekrom -> the original dragon, a shiny Kyurem.
  ORIGINAL_DRAGON_SPIRIT: { kind: "shiny", tier: 2, species: SpeciesId.KYUREM },
  // Squatter: survive a fully-notorious 20-wave biome overstay -> a random shiny.
  SQUATTER: { kind: "shiny", tier: 1, species: "random" },

  // === ER combat feats (previously material-rewardless) =====================
  // Most are score-50 mid feats -> a voucher or egg; the boss/score-75 ones get more.
  // Several keep a thematic species candy/egg/shiny inspired by the feat itself.
  BEAM_SPAM: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  GOOD_CHIP: { kind: "candy", species: ErSpeciesId.DARMANITAN_REDUX as unknown as SpeciesId, amount: 75 },
  BACK_IN_BLOOD: { kind: "candyTeam", perMon: 20 },
  SHIELD_BREAK: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  CCC_COMBO: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  // Mega-evolve the Redux Infernape line -> shiny Redux Chimchar (the pre-evo).
  GEAR_5: { kind: "shiny", tier: 1, species: ErSpeciesId.CHIMCHAR_REDUX as unknown as SpeciesId },
  METAL_SLIME: { kind: "candy", species: ErSpeciesId.MUNCHLAX_REDUX as unknown as SpeciesId, amount: 50 },
  JURASSIC_END: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  // Heeding the Warning: act on Absol's omen -> a shiny Absol.
  HEEDING_THE_WARNING: { kind: "shiny", tier: 1, species: SpeciesId.ABSOL },
  MEGAFLARE: { kind: "candy", species: SpeciesId.PALKIA, amount: 50 },
  YO: { kind: "eggs", tier: EggTier.RARE, count: 1 },
  WEAVE_NATION_CERTIFIED: { kind: "candyTeam", perMon: 25 },
  CRIT_MATTERED: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  AUTO_COUNTER: { kind: "candyTeam", perMon: 15 },
  SNAKES_ON_A_PLANE: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  // Believe It: a Kanto Ninetales beats a Poison-master -> a shiny Kanto Ninetales.
  BELIEVE_IT: { kind: "shiny", tier: 1, species: SpeciesId.NINETALES },
  HOLD_IT: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  CHAIN_REACTION: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  I_JUST_GOT_HERE: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  SORRY_FOR_THE_WAIT: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  HOLLOW_WICKER_BASKET: [{ kind: "pokemon", species: SpeciesId.QUAGSIRE }, { kind: "eggs", tier: EggTier.RARE, count: 1 }],

  // === Elemental Apex (Elite/Hell mono-type apex; were cosmetic-only) =======
  // High difficulty -> guaranteed shiny. The +2 Premium run-completion bonus applies.
  SCORCHED_EARTH: { kind: "shiny", tier: 2, species: "random" },
  ABSOLUTE_ZERO: { kind: "shiny", tier: 2, species: "random" },
  ENDLESS_NIGHT: { kind: "shiny", tier: 2, species: "random" },
  TEMPEST: { kind: "shiny", tier: 2, species: "random" },

  // === Achievement expansion wave (#900) ===================================
  // House rules hold: collection layer only (candy / eggs / vouchers / specific mon /
  // tier 1-3 shiny), never money / charms / run-power, and no black shiny outside
  // Inferno. First-win one-offs pay a little team candy; mid feats an egg-gacha
  // voucher or an egg; hard / difficulty-gated feats a guaranteed shiny. Each achv's
  // Shiny Lab effect gate (er-shiny-lab-effects) is folded in automatically on unlock.

  // --- Versus: Showdown 1v1 PvP -------------------------------------------
  FIRST_BLOOD: { kind: "candyTeam", perMon: 10 },
  DUELIST: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  VETERAN_DUELIST: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  LEGENDARY_DUELIST: { kind: "shiny", tier: 2, species: "random" },
  // Difficulty rebalance: a staked PvP win is a real risk -> Premium voucher (keep rosegold gate).
  HIGH_ROLLER: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  // Bumped to tier-2 shiny per maintainer feedback (a shiny-staked win is a real risk).
  ALL_IN: { kind: "shiny", tier: 2, species: "random" },
  // Consolation for LOSING a shiny you staked in a wager (settlement takes your shiny mon).
  // A random shiny of a random variant tier 1-3 (never the apex black tier).
  THE_HOUSE_REMEMBERS: { kind: "shiny", tier: "random", species: "random" },
  FLAWLESS_DUEL: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  DAVID_AND_GOLIATH: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  GOOD_SPORT: { kind: "candyTeam", perMon: 10 },
  // #900 follow-up skill/restriction feats (escalating, sibling to David and Goliath).
  // Showdown is mega-heavy, so a mega-less win is genuinely hard: a tier-1 shiny of a
  // COST-5+ species (the min-cost roll), not the blanket "single-battle = low" scale.
  RAW_TALENT: { kind: "shiny", tier: 1, species: "random", minCost: 5 },
  BUDGET_CHAMPION: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  // Keeps the tier-1 shiny; the patina-bronze palette gate is folded in via ER_SHINY_LAB_EFFECT_ACHV.
  RAGS_TO_RICHES: { kind: "shiny", tier: 1, species: "random" },
  APEX_PREDATOR: { kind: "shiny", tier: 2, species: "random" },

  // --- Co-op: shared-run feats --------------------------------------------
  CO_OP_INITIATE: { kind: "candyTeam", perMon: 10 },
  BETTER_TOGETHER: { kind: "candyTeam", perMon: 10 },
  PARTNERS_IN_CRIME: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  LONG_HAUL_DUO: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  THE_LONG_ROAD: { kind: "shiny", tier: 2, species: "random" },
  // Beat the final boss in co-op: a run-completion feat (the +2 Premium bonus applies
  // via RUN_COMPLETION_ACHV_IDS) plus a guaranteed shiny.
  DYNAMIC_DUO: { kind: "shiny", tier: 2, species: "random" },
  GENEROUS_SOUL: { kind: "candyTeam", perMon: 10 },
  GUARDIAN_ANGEL: { kind: "candyTeam", perMon: 15 },
  SHARED_TRIUMPH: { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
  // Reach wave 100 in co-op on Hell (renamed from the old wave-25 DOUBLE_TROUBLE_HELL, which
  // was not reward-worthy). A single-battle-class feat, not a full run: tier-1 shiny + 1
  // Premium voucher (keeps the heatshimmer gate via ER_SHINY_LAB_EFFECT_ACHV).
  CENTURY_OF_TROUBLE: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],

  // --- Battle: Triple Battle feats ----------------------------------------
  THREES_COMPANY: { kind: "candyTeam", perMon: 10 },
  // Ten triple wins is a 5%-frequency grind (triples rarely roll): Premium voucher, not Plus.
  TRIPLE_THREAT: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  TRIPLE_DOWN: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  CENTER_STAGE: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  HOLD_THE_LINE: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  GHOST_TRIAD: { kind: "candyTeam", perMon: 15 },
  ONE_TURN_CLEAR: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  // A single-battle Hell feat, NOT a full run: it must not outrank a full-run clear, so
  // 1 Premium voucher + 1 Rare egg instead of a guaranteed shiny (keeps the lavacracks gate).
  TRIAD_OF_HELL: [
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
    { kind: "eggs", tier: EggTier.RARE, count: 1 },
  ],

  // --- Collection: Shiny Lab feats ----------------------------------------
  FASHIONISTA: { kind: "candyTeam", perMon: 10 },
  LOOK_COLLECTOR_10: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  LOOK_COLLECTOR_25: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  LOOK_COLLECTOR_50: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  LOOK_COLLECTOR_100: { kind: "shiny", tier: 1, species: "random" },
  PRESET_CURATOR: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  SIGNATURE_STYLE: { kind: "shiny", tier: 1, species: "random" },

  // --- #900 follow-up: challenge-stack apex + combo clears ----------------
  // Apex rungs (hell): the black shiny, house-rule-extended to the two new apex tiers.
  // COCYTUS also unlocks a random achievement-gated aura; GIUDECCA adds a Premium
  // voucher to differentiate its reward from Inferno's.
  COCYTUS: [{ kind: "blackShiny", species: "random" }, { kind: "randomAroundEffect" }],
  GIUDECCA: [{ kind: "blackShiny", species: "random" }, { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 }],
  // Mid-tier challenge combos (guaranteed shiny for the two hard permadeath combos;
  // an egg + voucher for the mono-type triples run). Each also folds in the +2 Premium
  // run-completion bonus via RUN_COMPLETION_ACHV_IDS.
  THE_UPSIDE_DOWN: { kind: "shiny", tier: 2, species: "random" },
  MONOCHROME_REQUIEM: { kind: "shiny", tier: 2, species: "random" },
  TYPECAST_TRIO: [{ kind: "eggs", tier: EggTier.EPIC, count: 1 }, { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 }],
  // Complete a run with Triples Only + Ghost Trainers active (any difficulty). A full-run
  // clear: 1 Epic egg here + the +2 Premium run-completion bonus via RUN_COMPLETION_ACHV_IDS,
  // plus the Double Team ("echoes") aura gate folded in via ER_SHINY_LAB_EFFECT_ACHV.
  PHANTOM_FORMATION: { kind: "eggs", tier: EggTier.EPIC, count: 1 },

  // === Definitive achievement expansion (70 new) ===========================
  // House rules hold: collection layer only (candy / eggs / vouchers / specific mon /
  // tier 1-3 shiny + the CHAMPION_MATERIAL title), never money / charms / run-power, and
  // no black shiny outside the apex stacks. Each achv's Shiny Lab effect gate
  // (er-shiny-lab-effects) is folded in automatically on unlock. The §1.5 full-run IDs
  // are in RUN_COMPLETION_ACHV_IDS (they get +2 Premium there), so their inline rows
  // below have the 2-Premium floor SUBTRACTED to avoid double-counting.

  // --- §2.1 Versus and ranked ---------------------------------------------
  RANKED_AND_FILED: { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  GREAT_EXPECTATIONS: [
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
    { kind: "eggs", tier: EggTier.RARE, count: 1 },
  ],
  ULTRA_INSTINCT: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "eggs", tier: EggTier.EPIC, count: 1 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  MASTER_PLAN: [
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 3 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  CHAMPION_MATERIAL: [
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 5 },
    { kind: "title", title: "Champion Material" },
  ],
  FIVE_ALARM_STREAK: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  META_BREAKER: [
    { kind: "shiny", tier: 2, species: "random", minCost: 5 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  CAP_SPACE: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  HOUSE_MONEY: [
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 20 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 5 },
  ],
  DOUBLE_OR_NOTHING: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  PRODIGAL_MON: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  DAVID_WAS_RANKED: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  ZERO_SUM_HERO: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 3 },
  ],

  // --- §2.2 Co-op ---------------------------------------------------------
  SIX_PACK: { kind: "candyTeam", perMon: 15 },
  LIFELINE_SUBSCRIPTION: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  NO_I_IN_TEAM: [
    { kind: "eggs", tier: EggTier.RARE, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  PARALLEL_PLAY: { kind: "shiny", tier: 1, species: "random" },
  // §1.5 full-run floor: the 2 Premium vouchers come from RUN_COMPLETION_ACHV_IDS.
  HELL_IS_OTHER_PEOPLE: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 15 },
  ],
  // §1.5 floor via RUN_COMPLETION_ACHV_IDS. Uniform random tier 1-3 (never black).
  WE_BOTH_LIVED: [
    { kind: "shiny", tier: "random", species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 10 },
  ],

  // --- §2.3 Battle, triples, ghost combat ---------------------------------
  NATURAL_SELECTION_BIAS: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  FORMATION_BREAKER: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  LEFT_RIGHT_GOODNIGHT: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  LAST_MON_STANDING: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  THREE_PIECE_COMBO: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  ONE_HP_AND_A_DREAM: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  NO_SELL: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "eggs", tier: EggTier.EPIC, count: 20 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  SETUP_PAYOFF: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  ZERO_TO_HERO: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
  ],
  CHECKMATE_IN_ONE: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 3 },
  ],
  FORM_VOLTRON: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
  ],
  PURE_VANILLA: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  CHARGE_IT_TO_THE_GAME: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  THE_LONGEST_TURN: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
  ],
  STATUS_QUO: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  IMMORTAL_OBJECT: [
    { kind: "candyTeam", perMon: 15 },
    { kind: "eggs", tier: EggTier.RARE, count: 10 },
  ],

  // --- §2.4 Training ------------------------------------------------------
  TECHNICAL_DIFFICULTIES: [
    { kind: "candyTeam", perMon: 10 },
    { kind: "voucher", voucherType: VoucherType.PLUS, count: 1 },
  ],

  // --- §2.5 Mystery encounters and events ---------------------------------
  EVICTION_NOTICE: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  IDENTITY_THEFT: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
  ],
  DEAD_RINGER: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  HELL_HOUSE: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  TRIPLE_EXORCISM: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 10 },
  ],
  FINAL_ANSWER: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ARE_YOU_NOT_ENTERTAINED: [
    { kind: "candyTeam", perMon: 30 },
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 5 },
  ],
  SEVEN_DEADLY_CHECKBOXES: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  // §1.5 floor via RUN_COMPLETION_ACHV_IDS (2 Premium subtracted from the inline row).
  READ_THE_FINE_PRINT: { kind: "eggs", tier: EggTier.EPIC, count: 10 },
  JUST_SAY_NO: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  DELVE_TOO_DEEP: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 10 },
  ],
  STRANGER_THAN_FICTION: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],

  // --- §2.6 Collection, economy, fusion, Shiny Lab ------------------------
  MUSEUM_QUALITY: [
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  BLACK_FRIDAY: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  BIOME_TOURIST: [
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 5 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],
  FOUR_MACHINES_ONE_DREAM: { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  GOLDEN_TICKET: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  FUSION_DANCE: [
    { kind: "eggs", tier: EggTier.RARE, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  TWO_LEGENDS_ONE_SLOT: [
    { kind: "shiny", tier: 1, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 5 },
  ],
  CROSS_VERSION_COMPATIBILITY: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  LAB_RAT: { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  PRESET_JET_SET: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  NAME_RECOGNITION: [
    { kind: "eggs", tier: EggTier.EPIC, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],
  NUMBER_GO_UP: [
    { kind: "eggs", tier: EggTier.RARE, count: 10 },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 1 },
  ],

  // --- §2.7 Victory meta-achievements -------------------------------------
  // GROUNDHOG_WEEK is NOT in RUN_COMPLETION_ACHV_IDS: it lists its 2 Premium inline.
  GROUNDHOG_WEEK: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 },
  ],

  // --- §2.8 Full-run challenges (§1.5: 2 Premium floor via RUN_COMPLETION) -
  HELL_AND_BACK: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
  ],
  GLASS_CANNON: { kind: "shiny", tier: 2, species: "random" },
  GENERATION_GAP: { kind: "shiny", tier: 2, species: "random" },
  HOUSE_OF_MIRRORS: { kind: "shiny", tier: 2, species: "random" },
  DEAD_CHANNEL: { kind: "shiny", tier: 3, species: "random" },
  WAR_OF_ATTRITION: [
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },
  ],
  TRINITY_TEST: [
    { kind: "shiny", tier: 3, species: "random" },
    { kind: "shiny", tier: 3, species: "random" },
  ],
  OPPOSITION_RESEARCH: [
    { kind: "shiny", tier: 2, species: "random" },
    { kind: "eggs", tier: EggTier.EPIC, count: 1 },
  ],
  // Darmanitan-Redux via the ER species bridge (same idiom as GOOD_CHIP / BREEDERS_IN_SPACE).
  MONO_GEN_REDUX_VICTORY: [
    { kind: "candyTeam", perMon: 20 },
    { kind: "pokemon", species: ErSpeciesId.DARMANITAN_REDUX as unknown as SpeciesId },
  ],
};

/**
 * Achievements earned by COMPLETING A WHOLE RUN (classic / daily / challenge / apex
 * / final-boss clears). Each grants +2 Premium egg vouchers ON TOP of its base
 * reward (maintainer rule: full-run feats were under-paying for the effort). Folded
 * in by the spec assembly so it applies whether or not the achv has a base entry.
 */
const RUN_COMPLETION_ACHV_IDS = new Set<string>([
  "CLASSIC_VICTORY",
  "UNEVOLVED_CLASSIC_VICTORY",
  "DAILY_VICTORY",
  "FRESH_START",
  "INVERSE_BATTLE",
  "FLIP_STATS",
  "FLIP_INVERSE",
  "NUZLOCKE",
  "LAST_STAND",
  "PERMADEATH",
  "LIMBO",
  "PURGATORY",
  "INFERNO",
  "SCORCHED_EARTH",
  "ABSOLUTE_ZERO",
  "ENDLESS_NIGHT",
  "TEMPEST",
  "PRIMAL_CASCOON",
  "MONO_GEN_ONE_VICTORY",
  "MONO_GEN_TWO_VICTORY",
  "MONO_GEN_THREE_VICTORY",
  "MONO_GEN_FOUR_VICTORY",
  "MONO_GEN_FIVE_VICTORY",
  "MONO_GEN_SIX_VICTORY",
  "MONO_GEN_SEVEN_VICTORY",
  "MONO_GEN_EIGHT_VICTORY",
  "MONO_GEN_NINE_VICTORY",
  "MONO_NORMAL",
  "MONO_FIGHTING",
  "MONO_FLYING",
  "MONO_POISON",
  "MONO_GROUND",
  "MONO_ROCK",
  "MONO_BUG",
  "MONO_GHOST",
  "MONO_STEEL",
  "MONO_FIRE",
  "MONO_WATER",
  "MONO_GRASS",
  "MONO_ELECTRIC",
  "MONO_PSYCHIC",
  "MONO_ICE",
  "MONO_DRAGON",
  "MONO_DARK",
  "MONO_FAIRY",
  // #900: beating the final boss in co-op is a full-run completion.
  "DYNAMIC_DUO",
  // #900 follow-up: the new apex + combo challenge clears are full-run completions.
  "COCYTUS",
  "GIUDECCA",
  "THE_UPSIDE_DOWN",
  "MONOCHROME_REQUIEM",
  "TYPECAST_TRIO",
  // #900 follow-up 2: Triples Only + Ghost Trainers full-run clear (any difficulty).
  "PHANTOM_FORMATION",
  // Definitive expansion §1.5: the new full-run achievements. Each gets +2 Premium here,
  // so their inline ER_ACHIEVEMENT_REWARDS rows have the 2-Premium floor subtracted.
  "HELL_IS_OTHER_PEOPLE",
  "WE_BOTH_LIVED",
  "READ_THE_FINE_PRINT",
  "HELL_AND_BACK",
  "GLASS_CANNON",
  "GENERATION_GAP",
  "HOUSE_OF_MIRRORS",
  "DEAD_CHANNEL",
  "WAR_OF_ATTRITION",
  "TRINITY_TEST",
  "OPPOSITION_RESEARCH",
  "MONO_GEN_REDUX_VICTORY",
]);

/** The +2 Premium-voucher bonus a full-run-completion achievement gets, else nothing. */
function runCompletionBonus(achvId: string): RewardSpec[] {
  return RUN_COMPLETION_ACHV_IDS.has(achvId)
    ? [{ kind: "voucher", voucherType: VoucherType.PREMIUM, count: 2 }]
    : [];
}

/** A short, player-facing summary of one granted reward (+ optional icon mon). */
interface GrantedReward {
  text: string;
  iconSpecies?: SpeciesId;
  shiny?: boolean;
  variant?: number;
}

/**
 * Grant the reward(s) for a freshly-unlocked achievement and announce them.
 * FAIL-OPEN: any error is swallowed so a reward bug can NEVER break the
 * achievement unlock, the voucher cascade, or the run. Call only from the
 * first-unlock path (see battle-scene.validateAchv).
 */
export function grantErAchievementReward(achvId: string): void {
  try {
    const entry = ER_ACHIEVEMENT_REWARDS[achvId];
    const specs: RewardSpec[] = entry ? (Array.isArray(entry) ? [...entry] : [entry]) : [];
    // Fold the effect->achv gate map (er-shiny-lab-effects) in as the single source
    // of cosmetic unlocks. Skip any effect an inline shinyLabEffects spec already
    // lists, so the original reward grants stay intact and nothing double-grants or
    // double-announces. This is what lets map-only achievements (combat feats, the
    // new apex combos) grant + announce their effect on first unlock.
    const alreadyListed = new Set(specs.flatMap(s => (s.kind === "shinyLabEffects" ? s.effects : [])));
    const mappedEffects = getErShinyLabEffectsForAchv(achvId).filter(e => !alreadyListed.has(e));
    if (mappedEffects.length) {
      specs.push({ kind: "shinyLabEffects", effects: mappedEffects });
    }
    specs.push(...runCompletionBonus(achvId));
    if (specs.length === 0) {
      return;
    }
    const granted: GrantedReward[] = [];
    for (const spec of specs) {
      const g = applyRewardSpec(spec);
      if (g) {
        granted.push(g);
      }
    }
    if (granted.length === 0) {
      return;
    }
    showRewardToast(achvId, granted);
    // No explicit save: like the voucher / achvUnlocks grants, the mutated gameData
    // rides the game's normal save cycle (game-over for CLASSIC_VICTORY, the next
    // checkpoint otherwise), keeping the unlock and its reward persisted together.
    // (Calling saveSystem() here also wrongly re-triggered egg generation.)
  } catch (e) {
    console.warn(`[er-achv-reward] grant failed for ${achvId}:`, e);
  }
}

/** Optional grant-time context that makes a description concrete (party size, rolled species). */
interface RewardDescribeContext {
  /** Actual party size at grant time (candyTeam -> "...each of your N team members"). */
  teamSize?: number;
  /** Difficulty candy multiplier at grant time (candyTeam -> the real per-mon amount). */
  candyMult?: number;
  /** The concrete species a `"random"` roll resolved to (shiny/blackShiny -> name it). */
  species?: SpeciesId;
}

/**
 * A pure, player-facing one-line description of a single reward spec - the single source
 * of truth for BOTH the grant toast and the achievement-screen reward list. With `ctx`
 * (the grant path) it reads concretely ("90 candy for each of your 6 team members",
 * "a shiny Pikachu"); without it (the UI, no active run) it stays generic ("30 candy per
 * team member", "a random shiny"). No side effects, no global reads.
 */
export function describeRewardSpec(spec: RewardSpec, ctx?: RewardDescribeContext): string | null {
  switch (spec.kind) {
    case "candy":
      return `${spec.amount} candy for ${speciesName(spec.species)}`;
    case "candyTeam": {
      if (ctx?.teamSize != null && ctx?.candyMult != null) {
        const amount = Math.round(spec.perMon * ctx.candyMult);
        return `${amount} candy for each of your ${ctx.teamSize} team members`;
      }
      return `${spec.perMon} candy per team member`;
    }
    case "eggs": {
      const label = EGG_TIER_LABEL[spec.tier] ?? "";
      const shinyPrefix = spec.shiny === true ? "shiny " : "";
      const plural = spec.count === 1 ? "" : "s";
      if (spec.species != null) {
        return `${spec.count} ${shinyPrefix}${speciesName(spec.species)} Egg${plural}`;
      }
      return `${spec.count} ${shinyPrefix}${label} Egg${plural}`;
    }
    case "voucher": {
      const label = VOUCHER_LABEL[spec.voucherType];
      return `${spec.count} ${label}${spec.count === 1 ? "" : "s"}`;
    }
    case "shiny": {
      if (ctx?.species != null) {
        return `a shiny ${speciesName(ctx.species)}`;
      }
      return spec.species === "random" ? "a random shiny" : `a shiny ${speciesName(spec.species)}`;
    }
    case "blackShiny": {
      if (ctx?.species != null) {
        return `a BLACK shiny ${speciesName(ctx.species)}`;
      }
      return spec.species === "random" ? "a random BLACK shiny" : `a BLACK shiny ${speciesName(spec.species)}`;
    }
    case "pokemon":
      return speciesName(spec.species);
    case "title":
      return `the title "${spec.title}"`;
    case "shinyLabEffects":
      return spec.effects.length ? `Shiny Lab effects: ${spec.effects.map(effectLabel).join(", ")}` : null;
    case "randomAroundEffect":
      return "a random Shiny Lab aura";
  }
}

function applyRewardSpec(spec: RewardSpec): GrantedReward | null {
  switch (spec.kind) {
    case "candy":
      grantCandy(spec.species, spec.amount);
      return { text: describeRewardSpec(spec) ?? "" };
    case "candyTeam": {
      const mult = REWARD_DIFFICULTY_CANDY_MULT[getErDifficulty()] ?? 1;
      const amount = Math.round(spec.perMon * mult);
      const party = globalScene.getPlayerParty();
      for (const mon of party) {
        grantCandy(mon.species.speciesId, amount);
      }
      return { text: describeRewardSpec(spec, { teamSize: party.length, candyMult: mult }) ?? "" };
    }
    case "eggs": {
      const isShiny = spec.shiny === true;
      // This is the same local, one-time account grant as candy/vouchers/dex unlocks above. The
      // default-deny co-op gate must not silently discard only the egg member of that reward set.
      coopAllowAccountWrite("achievement-egg-reward", () => {
        for (let i = 0; i < spec.count; i++) {
          new Egg({
            tier: spec.tier,
            sourceType: EggSourceType.EVENT,
            isShiny,
            ...(spec.species != null ? { species: spec.species } : {}),
          }).addEggToGameData();
        }
      });
      return { text: describeRewardSpec(spec) ?? "" };
    }
    case "voucher": {
      grantVouchers(spec.voucherType, spec.count);
      return { text: describeRewardSpec(spec) ?? "" };
    }
    case "shiny": {
      const tier = resolveShinyTier(spec.tier);
      const species = resolveSpecies(spec.species, spec.minCost);
      grantShiny(species, tier);
      return { text: describeRewardSpec(spec, { species }) ?? "", iconSpecies: species, shiny: true, variant: tier - 1 };
    }
    case "blackShiny": {
      const species = resolveSpecies(spec.species);
      grantBlackShiny(species);
      // variant 2 = the epic/black sprite frame (off-by-one vs the VARIANT_3 bit).
      return { text: describeRewardSpec(spec, { species }) ?? "", iconSpecies: species, shiny: true, variant: 2 };
    }
    case "pokemon":
      grantPokemon(spec.species);
      return { text: describeRewardSpec(spec) ?? "", iconSpecies: spec.species };
    case "title":
      grantTitle(spec.title);
      return { text: describeRewardSpec(spec) ?? "" };
    case "shinyLabEffects": {
      // Grant + announce only the effects NEWLY unlocked here (skip ones already owned).
      const granted = spec.effects.filter(effectId => grantErShinyLabEffectAvailability(effectId, false));
      const text = describeRewardSpec({ kind: "shinyLabEffects", effects: granted });
      return text ? { text } : null;
    }
    case "randomAroundEffect": {
      const granted = grantRandomAroundEffect();
      return granted ? { text: `Shiny Lab aura: ${effectLabel(granted)}` } : null;
    }
  }
}

/**
 * Unlock availability of ONE randomly-chosen achievement-gated AROUND aura that isn't
 * available yet. Only gated (lockHint) effects carry an availability bit, so a non-gated
 * effect is skipped. Unseeded (cosmetic, needs no reproducibility). Returns the granted
 * effect id, or null when every gated aura is already available.
 */
function grantRandomAroundEffect(): string | null {
  const candidates = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.around.filter(def => def.lockHint);
  // Fisher-Yates shuffle (unseeded) so each grant rolls a genuinely random aura.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const def of candidates) {
    if (grantErShinyLabEffectAvailability(def.id, false)) {
      return def.id;
    }
  }
  return null;
}

/**
 * The player-facing reward lines an achievement grants, for the achievement screen.
 * Mirrors {@linkcode grantErAchievementReward}'s spec assembly (the inline
 * `ER_ACHIEVEMENT_REWARDS` entry folded with the effect->achv gate map) so the listed
 * rewards match what actually unlocks, but is PURE - it describes, never grants. Empty
 * for achievements with no reward (the great majority, which are points-only).
 */
export function getAchvRewardSummary(achvId: string): string[] {
  const entry = ER_ACHIEVEMENT_REWARDS[achvId];
  const specs: RewardSpec[] = entry ? (Array.isArray(entry) ? [...entry] : [entry]) : [];
  const alreadyListed = new Set(specs.flatMap(s => (s.kind === "shinyLabEffects" ? s.effects : [])));
  const mappedEffects = getErShinyLabEffectsForAchv(achvId).filter(e => !alreadyListed.has(e));
  if (mappedEffects.length) {
    specs.push({ kind: "shinyLabEffects", effects: mappedEffects });
  }
  specs.push(...runCompletionBonus(achvId));
  return specs.map(spec => describeRewardSpec(spec)).filter((text): text is string => text != null);
}

// --- grant primitives --------------------------------------------------------

/**
 * Add candy to a species (root-normalized + clamped by addStarterCandy).
 * `fromEgg=true` skips the run-scoped favour/difficulty scaling so OUR
 * difficulty multiplier (candyTeam) is the only difficulty term applied.
 */
function grantCandy(species: SpeciesId, amount: number): void {
  if (amount > 0) {
    globalScene.gameData.addStarterCandy(species, amount, true);
  }
}

/** Add egg-gacha vouchers (clamped to >= 0; rides the normal save cycle like candy). */
function grantVouchers(voucherType: VoucherType, count: number): void {
  if (count > 0) {
    globalScene.gameData.voucherCounts[voucherType] += count;
  }
}

function grantShiny(species: SpeciesId, tier: 1 | 2 | 3): void {
  const variantBit = tier === 3 ? DexAttr.VARIANT_3 : tier === 2 ? DexAttr.VARIANT_2 : DexAttr.DEFAULT_VARIANT;
  orCaughtAttr(species, DexAttr.SHINY | variantBit | DexAttr.MALE | DexAttr.DEFAULT_FORM);
}

/**
 * The ER tier-4 black shiny: the variant-3 shiny bits on the dex entry PLUS the
 * per-line `erBlackShiny` starter flag (what actually unlocks the black tier in
 * starter-select / the dex filter). NOT a DexAttr variant of its own.
 */
function grantBlackShiny(species: SpeciesId): void {
  orCaughtAttr(species, DexAttr.SHINY | DexAttr.VARIANT_3 | DexAttr.MALE | DexAttr.DEFAULT_FORM);
  const root = rootSpeciesId(species);
  const starter = globalScene.gameData.starterData[root];
  if (starter) {
    starter.erBlackShiny = true;
  }
}

function grantPokemon(species: SpeciesId): void {
  orCaughtAttr(species, DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM);
}

/**
 * Record an earned trainer title on the system save (dedup). Display UI is deferred;
 * this persists it so nothing is lost when the display eventually ships.
 */
function grantTitle(title: string): void {
  const titles = (globalScene.gameData.erTitles ??= []);
  if (!titles.includes(title)) {
    titles.push(title);
  }
}

function orCaughtAttr(species: SpeciesId, bits: bigint): void {
  const root = rootSpeciesId(species);
  const dex = globalScene.gameData.dexData[root];
  if (dex) {
    dex.caughtAttr |= bits;
  }
}

// --- helpers -----------------------------------------------------------------

function rootSpeciesId(species: SpeciesId): SpeciesId {
  return getPokemonSpecies(species).getRootSpeciesId();
}

function speciesName(species: SpeciesId): string {
  return getPokemonSpecies(species).name;
}

function effectLabel(effectId: string): string {
  return ER_SHINY_LAB_EFFECT_INDEX.get(effectId)?.label ?? effectId;
}

/** Resolve a random-shiny variant tier: a fixed tier passes through; "random" rolls 1-3 (never black). */
function resolveShinyTier(tier: 1 | 2 | 3 | "random"): 1 | 2 | 3 {
  // Unseeded like the species roll (cosmetic, needs no reproducibility across players).
  return tier === "random" ? ((Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3) : tier;
}

/**
 * Resolve a reward species: a fixed id passes through; "random" rolls a starter. When
 * `minCost` is given, a "random" roll is restricted to starters whose base cost is at
 * least that value (falls back to the full pool if the filter is somehow empty).
 */
function resolveSpecies(species: SpeciesId | "random", minCost?: number): SpeciesId {
  if (species !== "random") {
    return species;
  }
  let pool = Object.keys(speciesStarterCosts).map(Number) as SpeciesId[];
  if (minCost != null) {
    const filtered = pool.filter(id => (speciesStarterCosts[id] ?? 0) >= minCost);
    if (filtered.length > 0) {
      pool = filtered;
    }
  }
  // Use an UNSEEDED pick, NOT randSeedItem: an achievement unlocks with the battle RNG at a
  // fixed / reset state that is identical across players, so the seeded pick handed EVERY player
  // the same species (Scorbunny). A reward roll is cosmetic and needs no reproducibility, so
  // Math.random gives each unlock a genuinely random black shiny (same idiom as the random-starter
  // pick in starter-select).
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Announce the granted reward through the game's NATIVE achievement pop-up (the
 * little bar that already appears on an unlock). It queues as a second toast right
 * after the achievement's own, naming the achievement and listing what you earned,
 * and reuses the achievement's own icon so the two read as a pair.
 */
function showRewardToast(achvId: string, granted: GrantedReward[]): void {
  const achv = (achvs as Record<string, Achv>)[achvId];
  const name = achv?.getName(globalScene.gameData.gender) ?? "Reward";
  const icon = achv?.getIconImage() ?? "ribbon";
  const text = granted.map(g => g.text).join(", ");
  globalScene.ui.achvBar.showAchv(new RewardAchv(name, `You earned: ${text}`, icon));
}
