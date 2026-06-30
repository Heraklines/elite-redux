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
//  - The black shiny is granted ONLY by the apex stacked challenge (Inferno:
//    Hell + NU usage tier + Doubles-only + Ghost Trainers). Nothing else.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { speciesStarterCosts } from "#balance/starters";
import { Egg } from "#data/egg";
import { grantErShinyLabEffectAvailability } from "#data/elite-redux/er-shiny-lab-config";
import { ER_SHINY_LAB_EFFECT_INDEX, getErShinyLabEffectsForAchv } from "#data/elite-redux/er-shiny-lab-effects";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { type Achv, achvs, RewardAchv } from "#system/achv";
import { randSeedItem } from "#utils/common";

/** Per-difficulty multiplier applied to candy-to-team payouts (skill scaling). */
const REWARD_DIFFICULTY_CANDY_MULT: Record<string, number> = {
  youngster: 1,
  ace: 1.5,
  elite: 2,
  hell: 3,
};

/** Player-facing egg-tier label (no enum SHOUTING in the inbox). */
const EGG_TIER_LABEL = ["Common", "Rare", "Epic", "Legendary"] as const;

/**
 * What a single achievement grants. A discriminated union so each kind carries
 * exactly its own fields. `species: "random"` rolls a random obtainable starter.
 */
export type RewardSpec =
  /** Fixed candy to one species (root-normalized). */
  | { kind: "candy"; species: SpeciesId; amount: number }
  /** Candy to EACH mon on the winning team, scaled by run difficulty. */
  | { kind: "candyTeam"; perMon: number }
  /** `count` eggs of a fixed tier. `shiny` forces every hatch to be shiny. */
  | { kind: "eggs"; tier: EggTier; count: number; shiny?: boolean }
  /** A guaranteed shiny at tier 1/2/3 (hard challenges only). */
  | { kind: "shiny"; tier: 1 | 2 | 3; species: SpeciesId | "random" }
  /** The apex-only black shiny (separate ER tier-4 path). */
  | { kind: "blackShiny"; species: SpeciesId | "random" }
  /** A specific Pokemon, caught (normal). */
  | { kind: "pokemon"; species: SpeciesId }
  /** Global Shiny Lab availability gates. Species still buy or catch ownership. */
  | { kind: "shinyLabEffects"; effects: string[] };

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
  _75_RIBBONS: { kind: "eggs", tier: EggTier.EPIC, count: 2 },
  _100_RIBBONS: { kind: "eggs", tier: EggTier.LEGENDARY, count: 1 },

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
    { kind: "shinyLabEffects", effects: ["cosmos", "shadowaura"] },
  ],
  // Defeating the Primal Cascoon final-boss second stage.
  PRIMAL_CASCOON: { kind: "eggs", tier: EggTier.EPIC, count: 2 },
  // Holding five relics at once in a single run.
  RELIC_HUNTER: { kind: "eggs", tier: EggTier.RARE, count: 2 },
  // Owning a shiny Pokemon of all three variant tiers.
  ALL_SHINY_TIERS: [
    { kind: "eggs", tier: EggTier.EPIC, count: 1, shiny: true },
    { kind: "shinyLabEffects", effects: ["rainbowoutline"] },
  ],
  // Earning all eighteen mono-type ribbons.
  MASTER_OF_ALL: [{ kind: "shiny", tier: 2, species: "random" }, { kind: "shinyLabEffects", effects: ["spectrumsplit"] }],
};

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

function applyRewardSpec(spec: RewardSpec): GrantedReward | null {
  switch (spec.kind) {
    case "candy":
      grantCandy(spec.species, spec.amount);
      return { text: `${spec.amount} candy for ${speciesName(spec.species)}` };
    case "candyTeam": {
      const mult = REWARD_DIFFICULTY_CANDY_MULT[getErDifficulty()] ?? 1;
      const amount = Math.round(spec.perMon * mult);
      const party = globalScene.getPlayerParty();
      for (const mon of party) {
        grantCandy(mon.species.speciesId, amount);
      }
      return { text: `${amount} candy for each of your ${party.length} team members` };
    }
    case "eggs": {
      const isShiny = spec.shiny === true;
      for (let i = 0; i < spec.count; i++) {
        new Egg({ tier: spec.tier, sourceType: EggSourceType.EVENT, isShiny }).addEggToGameData();
      }
      const label = EGG_TIER_LABEL[spec.tier] ?? "";
      const shinyPrefix = isShiny ? "shiny " : "";
      return { text: `${spec.count} ${shinyPrefix}${label} Egg${spec.count === 1 ? "" : "s"}` };
    }
    case "shiny": {
      const species = resolveSpecies(spec.species);
      grantShiny(species, spec.tier);
      return { text: `a shiny ${speciesName(species)}`, iconSpecies: species, shiny: true, variant: spec.tier - 1 };
    }
    case "blackShiny": {
      const species = resolveSpecies(spec.species);
      grantBlackShiny(species);
      // variant 2 = the epic/black sprite frame (off-by-one vs the VARIANT_3 bit).
      return { text: `a BLACK shiny ${speciesName(species)}`, iconSpecies: species, shiny: true, variant: 2 };
    }
    case "pokemon":
      grantPokemon(spec.species);
      return { text: speciesName(spec.species), iconSpecies: spec.species };
    case "shinyLabEffects": {
      const labels = spec.effects.filter(effectId => grantErShinyLabEffectAvailability(effectId, false)).map(effectLabel);
      return labels.length ? { text: `Shiny Lab effects: ${labels.join(", ")}` } : null;
    }
  }
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

/** Resolve a reward species: a fixed id passes through; "random" rolls a starter. */
function resolveSpecies(species: SpeciesId | "random"): SpeciesId {
  if (species !== "random") {
    return species;
  }
  const pool = Object.keys(speciesStarterCosts).map(Number) as SpeciesId[];
  return randSeedItem(pool);
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
