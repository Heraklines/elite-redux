/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - achievement CATEGORISATION + aggregate progress.
//
// Vanilla `Achv` has no category field and the registry is a flat ~112-entry
// object, so the achievement screen could only ever show one undifferentiated
// grid. This module adds a category to every achievement WITHOUT touching the
// ~112 constructors: a small explicit side-map (mirroring the ER pattern used by
// ER_ACHIEVEMENT_REWARDS / ER_SHINY_LAB_EFFECT_ACHV) keyed by achv id, with a
// subclass-based fallback for the ladder/ribbon/challenge families. It also
// computes the aggregate progress + achievement-point totals the overhauled UI
// surfaces (per-category counts, overall completion %, earned points).
//
// Achievements here are BINARY (condition-based one-shots; no partial-progress
// tracking), so "progress" means unlocked / total counts, never a fractional bar.
// =============================================================================

import type { PlayerGender } from "#enums/player-gender";
import {
  type Achv,
  AchvTier,
  achvs,
  ChallengeAchv,
  DamageAchv,
  HealAchv,
  LevelAchv,
  ModifierAchv,
  MoneyAchv,
  RibbonAchv,
} from "#system/achv";

/** The bucket an achievement is grouped + ordered under in the achievement screen. */
export enum AchvCategory {
  /** Run completions + ribbon milestones (classic / daily / unevolved victory, ribbons). */
  VICTORY,
  /** In-battle feats + mechanics (damage, mega/tera/giga/splice, the ER combat feats). */
  BATTLE,
  /** Grind + progression ladders (money, heal, level, friendship, hidden ability, IVs). */
  TRAINING,
  /** Catch / hatch / shiny / dex completion. */
  COLLECTION,
  /** Challenge-run clears (mono-gen, mono-type, nuzlocke, inverse, the ER apex stacks). */
  CHALLENGE,
  /** ER event + boss feats (Giratina's bargain, ghost exorcism, the Cascoon boss, relics). */
  EVENTS,
  /** Showdown 1v1 PvP feats (first blood, win streaks, staked duels, the wager spoils). */
  VERSUS,
  /** Co-op run feats (shared wave milestones, the final-boss duo clear, partner acts of kindness). */
  COOP,
}

/** Category nav order (the synthetic "All" filter is handled by the UI, not listed here). */
export const ACHV_CATEGORY_ORDER: readonly AchvCategory[] = [
  AchvCategory.VICTORY,
  AchvCategory.BATTLE,
  AchvCategory.VERSUS,
  AchvCategory.COOP,
  AchvCategory.TRAINING,
  AchvCategory.COLLECTION,
  AchvCategory.CHALLENGE,
  AchvCategory.EVENTS,
];

/** Localization sub-key per category: i18next `achv:category.<key>`. */
export const ACHV_CATEGORY_KEY: Record<AchvCategory, string> = {
  [AchvCategory.VICTORY]: "victory",
  [AchvCategory.BATTLE]: "battle",
  [AchvCategory.VERSUS]: "versus",
  [AchvCategory.COOP]: "coop",
  [AchvCategory.TRAINING]: "training",
  [AchvCategory.COLLECTION]: "collection",
  [AchvCategory.CHALLENGE]: "challenge",
  [AchvCategory.EVENTS]: "events",
};

/**
 * Explicit category for the plain-`Achv` (and any other) entries that the subclass
 * fallback cannot infer. Keyed by achv id (the UPPER_SNAKE registry key, assigned in
 * `initAchievements`). The ladder/ribbon/challenge subclasses fall through to
 * {@linkcode getAchvCategory}'s instanceof rules and are intentionally NOT listed here.
 */
const ACHV_CATEGORY_OVERRIDES: Record<string, AchvCategory> = {
  // --- Victory: run completions ---
  CLASSIC_VICTORY: AchvCategory.VICTORY,
  UNEVOLVED_CLASSIC_VICTORY: AchvCategory.VICTORY,
  DAILY_VICTORY: AchvCategory.VICTORY,

  // --- Battle: mechanics one-offs ---
  MEGA_EVOLVE: AchvCategory.BATTLE,
  GIGANTAMAX: AchvCategory.BATTLE,
  TERASTALLIZE: AchvCategory.BATTLE,
  STELLAR_TERASTALLIZE: AchvCategory.BATTLE,
  SPLICE: AchvCategory.BATTLE,
  TRANSFER_MAX_STAT_STAGE: AchvCategory.BATTLE,
  // --- Battle: the ER combat feats ---
  BEAM_SPAM: AchvCategory.BATTLE,
  GOOD_CHIP: AchvCategory.BATTLE,
  BACK_IN_BLOOD: AchvCategory.BATTLE,
  SHIELD_BREAK: AchvCategory.BATTLE,
  CCC_COMBO: AchvCategory.BATTLE,
  GEAR_5: AchvCategory.BATTLE,
  METAL_SLIME: AchvCategory.BATTLE,
  JURASSIC_END: AchvCategory.BATTLE,
  HEEDING_THE_WARNING: AchvCategory.BATTLE,
  MEGAFLARE: AchvCategory.BATTLE,
  YO: AchvCategory.BATTLE,
  WEAVE_NATION_CERTIFIED: AchvCategory.BATTLE,
  CRIT_MATTERED: AchvCategory.BATTLE,
  AUTO_COUNTER: AchvCategory.BATTLE,
  SNAKES_ON_A_PLANE: AchvCategory.BATTLE,
  BELIEVE_IT: AchvCategory.BATTLE,
  HOLD_IT: AchvCategory.BATTLE,
  CHAIN_REACTION: AchvCategory.BATTLE,
  I_JUST_GOT_HERE: AchvCategory.BATTLE,
  SORRY_FOR_THE_WAIT: AchvCategory.BATTLE,
  HOLLOW_WICKER_BASKET: AchvCategory.BATTLE,

  // --- Training: progression ---
  MAX_FRIENDSHIP: AchvCategory.TRAINING,
  HIDDEN_ABILITY: AchvCategory.TRAINING,
  PERFECT_IVS: AchvCategory.TRAINING,

  // --- Battle: the new feat batch (#747) ---
  EVERYONE_GET_OUT: AchvCategory.BATTLE,
  MUTUALLY_ASSURED_DESTRUCTION: AchvCategory.BATTLE,
  FULL_ON_MEGA_POWER: AchvCategory.BATTLE,
  ORIGINAL_DRAGON_SPIRIT: AchvCategory.BATTLE,
  COMPLEAT_NIGHTMARE: AchvCategory.BATTLE,
  SUPER_ARMOR: AchvCategory.BATTLE,
  PK_STARSTORM: AchvCategory.BATTLE,
  REALISTIC_FLASH_IS_BORING: AchvCategory.BATTLE,
  END_THE_LEGEND: AchvCategory.BATTLE,

  // --- Collection: catch / hatch / shiny ---
  SEE_SHINY: AchvCategory.COLLECTION,
  // The new obtain/catch/release feats (#747).
  INCOMPATIBLE_HARDWARE: AchvCategory.COLLECTION,
  DREAMCATCHER: AchvCategory.COLLECTION,
  POKE_HIM_ON: AchvCategory.COLLECTION,
  SHINY_PARTY: AchvCategory.COLLECTION,
  ALL_SHINY_TIERS: AchvCategory.COLLECTION,
  CATCH_SUB_LEGENDARY: AchvCategory.COLLECTION,
  CATCH_MYTHICAL: AchvCategory.COLLECTION,
  CATCH_LEGENDARY: AchvCategory.COLLECTION,
  HATCH_SUB_LEGENDARY: AchvCategory.COLLECTION,
  HATCH_MYTHICAL: AchvCategory.COLLECTION,
  HATCH_LEGENDARY: AchvCategory.COLLECTION,
  HATCH_SHINY: AchvCategory.COLLECTION,
  MASTER_OF_ALL: AchvCategory.COLLECTION,

  // --- Events: ER event + boss feats ---
  SQUATTER: AchvCategory.EVENTS,
  BREEDERS_IN_SPACE: AchvCategory.EVENTS,
  DEVILS_BARGAIN: AchvCategory.EVENTS,
  EXORCIST: AchvCategory.EVENTS,
  PRIMAL_CASCOON: AchvCategory.EVENTS,
  RELIC_HUNTER: AchvCategory.EVENTS,

  // --- Versus: the Showdown 1v1 PvP feats (#900 + follow-up) ---
  FIRST_BLOOD: AchvCategory.VERSUS,
  DUELIST: AchvCategory.VERSUS,
  VETERAN_DUELIST: AchvCategory.VERSUS,
  LEGENDARY_DUELIST: AchvCategory.VERSUS,
  HIGH_ROLLER: AchvCategory.VERSUS,
  ALL_IN: AchvCategory.VERSUS,
  FLAWLESS_DUEL: AchvCategory.VERSUS,
  DAVID_AND_GOLIATH: AchvCategory.VERSUS,
  GOOD_SPORT: AchvCategory.VERSUS,
  RAW_TALENT: AchvCategory.VERSUS,
  BUDGET_CHAMPION: AchvCategory.VERSUS,
  RAGS_TO_RICHES: AchvCategory.VERSUS,
  APEX_PREDATOR: AchvCategory.VERSUS,
  THE_HOUSE_REMEMBERS: AchvCategory.VERSUS,

  // --- Co-op: the shared-run feats (#900) ---
  BETTER_TOGETHER: AchvCategory.COOP,
  PARTNERS_IN_CRIME: AchvCategory.COOP,
  DYNAMIC_DUO: AchvCategory.COOP,
  LONG_HAUL_DUO: AchvCategory.COOP,
  THE_LONG_ROAD: AchvCategory.COOP,
  CO_OP_INITIATE: AchvCategory.COOP,
  GENEROUS_SOUL: AchvCategory.COOP,
  GUARDIAN_ANGEL: AchvCategory.COOP,
  SHARED_TRIUMPH: AchvCategory.COOP,
  CENTURY_OF_TROUBLE: AchvCategory.COOP,

  // --- Battle: the Triple Battle feats (#900) ---
  THREES_COMPANY: AchvCategory.BATTLE,
  TRIPLE_THREAT: AchvCategory.BATTLE,
  TRIPLE_DOWN: AchvCategory.BATTLE,
  CENTER_STAGE: AchvCategory.BATTLE,
  HOLD_THE_LINE: AchvCategory.BATTLE,
  GHOST_TRIAD: AchvCategory.BATTLE,
  ONE_TURN_CLEAR: AchvCategory.BATTLE,
  TRIAD_OF_HELL: AchvCategory.BATTLE,

  // --- Collection: the Shiny Lab feats (#900) ---
  FASHIONISTA: AchvCategory.COLLECTION,
  LOOK_COLLECTOR_10: AchvCategory.COLLECTION,
  LOOK_COLLECTOR_25: AchvCategory.COLLECTION,
  LOOK_COLLECTOR_50: AchvCategory.COLLECTION,
  LOOK_COLLECTOR_100: AchvCategory.COLLECTION,
  PRESET_CURATOR: AchvCategory.COLLECTION,
  SIGNATURE_STYLE: AchvCategory.COLLECTION,

  // === Definitive achievement expansion (70 new) ===========================
  // --- §2.1 Versus and ranked -> VERSUS ---
  RANKED_AND_FILED: AchvCategory.VERSUS,
  GREAT_EXPECTATIONS: AchvCategory.VERSUS,
  ULTRA_INSTINCT: AchvCategory.VERSUS,
  MASTER_PLAN: AchvCategory.VERSUS,
  CHAMPION_MATERIAL: AchvCategory.VERSUS,
  FIVE_ALARM_STREAK: AchvCategory.VERSUS,
  META_BREAKER: AchvCategory.VERSUS,
  CAP_SPACE: AchvCategory.VERSUS,
  HOUSE_MONEY: AchvCategory.VERSUS,
  DOUBLE_OR_NOTHING: AchvCategory.VERSUS,
  PRODIGAL_MON: AchvCategory.VERSUS,
  DAVID_WAS_RANKED: AchvCategory.VERSUS,
  ZERO_SUM_HERO: AchvCategory.VERSUS,
  // --- §2.2 Co-op -> COOP ---
  SIX_PACK: AchvCategory.COOP,
  LIFELINE_SUBSCRIPTION: AchvCategory.COOP,
  NO_I_IN_TEAM: AchvCategory.COOP,
  PARALLEL_PLAY: AchvCategory.COOP,
  HELL_IS_OTHER_PEOPLE: AchvCategory.COOP,
  WE_BOTH_LIVED: AchvCategory.COOP,
  // --- §2.3 Battle, triples, ghost combat -> BATTLE ---
  NATURAL_SELECTION_BIAS: AchvCategory.BATTLE,
  FORMATION_BREAKER: AchvCategory.BATTLE,
  LEFT_RIGHT_GOODNIGHT: AchvCategory.BATTLE,
  LAST_MON_STANDING: AchvCategory.BATTLE,
  THREE_PIECE_COMBO: AchvCategory.BATTLE,
  ONE_HP_AND_A_DREAM: AchvCategory.BATTLE,
  NO_SELL: AchvCategory.BATTLE,
  SETUP_PAYOFF: AchvCategory.BATTLE,
  ZERO_TO_HERO: AchvCategory.BATTLE,
  CHECKMATE_IN_ONE: AchvCategory.BATTLE,
  FORM_VOLTRON: AchvCategory.BATTLE,
  PURE_VANILLA: AchvCategory.BATTLE,
  CHARGE_IT_TO_THE_GAME: AchvCategory.BATTLE,
  THE_LONGEST_TURN: AchvCategory.BATTLE,
  STATUS_QUO: AchvCategory.BATTLE,
  IMMORTAL_OBJECT: AchvCategory.BATTLE,
  // --- §2.4 Training -> TRAINING ---
  TECHNICAL_DIFFICULTIES: AchvCategory.TRAINING,
  // --- §2.5 Mystery encounters and events -> EVENTS ---
  EVICTION_NOTICE: AchvCategory.EVENTS,
  IDENTITY_THEFT: AchvCategory.EVENTS,
  DEAD_RINGER: AchvCategory.EVENTS,
  HELL_HOUSE: AchvCategory.EVENTS,
  TRIPLE_EXORCISM: AchvCategory.EVENTS,
  FINAL_ANSWER: AchvCategory.EVENTS,
  ARE_YOU_NOT_ENTERTAINED: AchvCategory.EVENTS,
  SEVEN_DEADLY_CHECKBOXES: AchvCategory.EVENTS,
  READ_THE_FINE_PRINT: AchvCategory.EVENTS,
  JUST_SAY_NO: AchvCategory.EVENTS,
  DELVE_TOO_DEEP: AchvCategory.EVENTS,
  STRANGER_THAN_FICTION: AchvCategory.EVENTS,
  // --- §2.6 Collection, economy, fusion, Shiny Lab -> COLLECTION ---
  MUSEUM_QUALITY: AchvCategory.COLLECTION,
  BLACK_FRIDAY: AchvCategory.COLLECTION,
  BIOME_TOURIST: AchvCategory.COLLECTION,
  FOUR_MACHINES_ONE_DREAM: AchvCategory.COLLECTION,
  GOLDEN_TICKET: AchvCategory.COLLECTION,
  FUSION_DANCE: AchvCategory.COLLECTION,
  TWO_LEGENDS_ONE_SLOT: AchvCategory.COLLECTION,
  CROSS_VERSION_COMPATIBILITY: AchvCategory.COLLECTION,
  LAB_RAT: AchvCategory.COLLECTION,
  PRESET_JET_SET: AchvCategory.COLLECTION,
  NAME_RECOGNITION: AchvCategory.COLLECTION,
  NUMBER_GO_UP: AchvCategory.COLLECTION,
  // --- §2.7 Victory meta-achievements -> VICTORY ---
  GROUNDHOG_WEEK: AchvCategory.VICTORY,
  // --- §2.8 Full-run challenges -> CHALLENGE (also inferred from ChallengeAchv) ---
  HELL_AND_BACK: AchvCategory.CHALLENGE,
  GLASS_CANNON: AchvCategory.CHALLENGE,
  GENERATION_GAP: AchvCategory.CHALLENGE,
  HOUSE_OF_MIRRORS: AchvCategory.CHALLENGE,
  DEAD_CHANNEL: AchvCategory.CHALLENGE,
  WAR_OF_ATTRITION: AchvCategory.CHALLENGE,
  TRINITY_TEST: AchvCategory.CHALLENGE,
  OPPOSITION_RESEARCH: AchvCategory.CHALLENGE,
  MONO_GEN_REDUX_VICTORY: AchvCategory.CHALLENGE,
};

/**
 * The category an achievement belongs to. An explicit override wins; otherwise the
 * achievement's subclass family decides (ribbons -> victory, money/heal/level ->
 * training, damage/modifier -> battle, challenge -> challenge). Falls back to BATTLE
 * for any unmapped plain achievement so the UI never drops one.
 */
export function getAchvCategory(achv: Achv): AchvCategory {
  const override = ACHV_CATEGORY_OVERRIDES[achv.id];
  if (override !== undefined) {
    return override;
  }
  if (achv instanceof RibbonAchv) {
    return AchvCategory.VICTORY;
  }
  if (achv instanceof MoneyAchv || achv instanceof HealAchv || achv instanceof LevelAchv) {
    return AchvCategory.TRAINING;
  }
  if (achv instanceof DamageAchv || achv instanceof ModifierAchv) {
    return AchvCategory.BATTLE;
  }
  if (achv instanceof ChallengeAchv) {
    return AchvCategory.CHALLENGE;
  }
  return AchvCategory.BATTLE;
}

/**
 * English-name fallback for the ladder achievements whose localization key starts with a
 * digit (money / damage / heal / ribbon). i18next DROPS resource keys whose first character
 * is a digit at load time (a store quirk: "1000Dmg" is absent from the loaded `achv` bundle
 * while "lv100" / "classicVictory" survive), so `getName()` for these resolves to the raw
 * "<key>.name" miss and the achievement screen would show e.g. "1000Dmg.name". The proper
 * fix is to rename these keys letter-leading across every locale; until then this keeps the
 * names readable. Copied verbatim from locales/en/achv.json.
 */
const ACHV_NAME_FALLBACK: Record<string, string> = {
  "10KMoney": "Money Haver",
  "100KMoney": "Rich",
  "1MMoney": "Millionaire",
  "10MMoney": "One Percenter",
  "250Dmg": "Hard Hitter",
  "1000Dmg": "Harder Hitter",
  "2500Dmg": "That’s a Lotta Damage!",
  "10000Dmg": "One Punch Man",
  "250Heal": "Novice Healer",
  "1000Heal": "Big Healer",
  "2500Heal": "Cleric",
  "10000Heal": "Recovery Master",
  "10Ribbons": "Pokémon League Champion",
  "25Ribbons": "Great League Champion",
  "50Ribbons": "Ultra League Champion",
  "75Ribbons": "Rogue League Champion",
  "100Ribbons": "Master League Champion",
};

/**
 * The achievement's localized display name, with a fallback for the digit-leading keys that
 * i18next cannot resolve (see {@linkcode ACHV_NAME_FALLBACK}). A name lookup miss returns the
 * raw "<key>.name", which is the signal to substitute the fallback.
 */
export function getAchvDisplayName(achv: Achv, playerGender: PlayerGender): string {
  const resolved = achv.getName(playerGender);
  if (resolved === `${achv.localizationKey}.name`) {
    return ACHV_NAME_FALLBACK[achv.localizationKey] ?? achv.localizationKey;
  }
  return resolved;
}

/** The achievement-screen accent colour for a tier, matching the modifier-tier palette. */
export function getAchvTierTextTint(tier: AchvTier): number {
  switch (tier) {
    case AchvTier.COMMON:
      return 0xf8f8f8;
    case AchvTier.GREAT:
      return 0x4998f8;
    case AchvTier.ULTRA:
      return 0xf8d038;
    case AchvTier.ROGUE:
      return 0xdb4343;
    case AchvTier.MASTER:
      return 0xe331c5;
  }
}

/** i18next sub-key for a tier display name: `achv:tier.<key>`. */
export const ACHV_TIER_KEY: Record<AchvTier, string> = {
  [AchvTier.COMMON]: "common",
  [AchvTier.GREAT]: "great",
  [AchvTier.ULTRA]: "ultra",
  [AchvTier.ROGUE]: "rogue",
  [AchvTier.MASTER]: "master",
};

/** Unlocked / total counts + earned / total achievement points for one slice of the registry. */
export interface AchvProgress {
  unlocked: number;
  total: number;
  /** Achievement points earned (sum of `score` over unlocked achievements). */
  earnedScore: number;
  /** Achievement points available (sum of `score` over all achievements in the slice). */
  totalScore: number;
}

/** The aggregate progress the overhauled screen renders: overall + per-category. */
export interface AchvProgressSummary {
  overall: AchvProgress;
  byCategory: Record<AchvCategory, AchvProgress>;
}

const emptyProgress = (): AchvProgress => ({ unlocked: 0, total: 0, earnedScore: 0, totalScore: 0 });

/**
 * Tally unlocked/total counts + earned/total achievement points across the whole
 * registry and per category, from the player's `achvUnlocks` map (id -> unlock
 * timestamp). Pure: pass `gameData.achvUnlocks`; never reads global state itself.
 */
export function computeAchvProgress(unlocks: Record<string, number>): AchvProgressSummary {
  const byCategory = {} as Record<AchvCategory, AchvProgress>;
  for (const category of ACHV_CATEGORY_ORDER) {
    byCategory[category] = emptyProgress();
  }
  const overall = emptyProgress();
  for (const achv of Object.values(achvs)) {
    const bucket = byCategory[getAchvCategory(achv)];
    const unlocked = Object.hasOwn(unlocks, achv.id);
    bucket.total++;
    overall.total++;
    bucket.totalScore += achv.score;
    overall.totalScore += achv.score;
    if (unlocked) {
      bucket.unlocked++;
      overall.unlocked++;
      bucket.earnedScore += achv.score;
      overall.earnedScore += achv.score;
    }
  }
  return { overall, byCategory };
}
