/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Biome battle identity (#439 §3) - the data spine.
//
// Every biome gets a signature battle rule so biomes feel distinct to fight in,
// not just different spawn tables. This file is the SINGLE editable table; thin
// hook sites across the battle phases read from it via getErBiomeRule().
//
// LOCKED (#439 §6.2): biome battle rules apply on ALL difficulties (incl.
// Ace/Youngster). "Pure vanilla" still governs SPAWNS and item pools there, but
// the world flavor (weather, terrain, hazards, field rules) is universal.
//
// Hook sites by group:
//   A weather/terrain   -> EncounterPhase.trySetWeather/TerrainIfNewBiome
//   B type-dmg          -> Arena.getAttackTypeMultiplier
//   B accuracy          -> Move.calculateBattleAccuracy
//   C switch-in Spd     -> PostSummonPhase
//   D entry status      -> PostSummonPhase
//   E turn-end chip     -> TurnEndPhase
//   F run-never-fails   -> AttemptRunPhase.calculateEscapeChance
//   F dark crit         -> Pokemon.getCritStage
//   F fairy blessing    -> InfatuatedTag.canAdd + Pokemon.doSetStatus (sleep)
//   F berry save        -> BerryModifier.apply
//   (Encounter-shape rules - ambush, double-battle odds, all-trainer waves,
//    +levels, totems, regionals - touch encounter generation, not the field,
//    and are a separate later batch.)
// =============================================================================

import { TerrainType } from "#data/terrain";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";

/** "burn" (Volcano) or "frostbite" (Ice Cave) - the entry-status flavor. */
export type ErBiomeEntryStatusKind = "burn" | "frostbite";

/** One biome's battle-identity config. Each field is consumed by its group's hook. */
export interface ErBiomeRule {
  // --- GROUP A: ambient weather/terrain forced on biome entry ---
  /** Weather forced on entry (baseline/always), overriding the random pool. */
  weather?: WeatherType;
  /** Terrain forced on entry (vanilla pools are all empty). */
  terrain?: TerrainType;

  // --- GROUP B: field damage / accuracy modifiers ---
  /** Field-wide damage boost (both sides) for moves of this type. */
  typeBoost?: { type: PokemonType; mult: number };
  /** Field-wide accuracy multiplier on ALL attackers (e.g. Mountain wind 0.95). */
  accuracyMult?: number;
  /** Darkness: 0.9 accuracy for ALL unless a Flash/Illuminate ability is on field (Cave). */
  darkness?: boolean;
  /** Zero-g: 0.9 accuracy for GROUNDED attackers only (Space). */
  groundedAccuracyMult?: number;

  // --- GROUP C: switch-in stat drops ---
  /** -1 Spd on entry to non-swimmers (no Water/Flying type, no Levitate) - Sea. */
  swimmerSpdDrop?: boolean;
  /** -1 Spd on entry to grounded mons - Space. */
  groundedSpdDrop?: boolean;

  // --- GROUP D: entry status risk ---
  /** On entry: a chance to inflict a status on grounded, non-immune, warm-item-less
   *  mons (Volcano burn for non-Fire, Ice Cave frostbite for non-Ice). */
  entryStatus?: { kind: ErBiomeEntryStatusKind; chance: number };

  // --- GROUP E: turn-end chip ---
  /** 1/16 max-HP turn-end damage on grounded non-Poison/Steel mons - Swamp bog. */
  bogChip?: boolean;

  // --- GROUP F: misc flags ---
  /** Escape/flee always succeeds - Plains open fields. */
  runNeverFails?: boolean;
  /** Dark-type attackers get +1 crit stage - Abyss. */
  darkCritBoost?: boolean;
  /** Fairy Cave blessing: fielded mons can't be infatuated + sleep wears off a turn faster. */
  fairyBlessing?: boolean;
  /** % chance a consumed berry is preserved instead (Beach Harvest-like, 0-100). */
  berrySaveChance?: number;

  // --- GROUP G: ER biome field/economy effects (#439 §3 second batch) ---
  /** Temple: stat stages are FROZEN - neither side can raise OR lower a stat stage
   *  (StatStageChangePhase no-ops every change while in this biome). */
  statStageFreeze?: boolean;
  /** Dojo: moves of this type are NEVER resisted - the type-effectiveness floor is
   *  clamped up to 1x for this attacking type (immunities/resistances become >=1x). */
  unresistedType?: PokemonType;
  /** Lake: fraction of max HP every party mon recovers at each turn end (e.g. 1/16). */
  perTurnHealFraction?: number;
  /** Slum: % of the player's money lost per ALLY faint in a TRAINER battle (0-100). */
  moneyLossPctPerFaint?: number;
  /** Wasteland: the every-wave shop sells NO healing items here. */
  shopNoHeal?: boolean;
  /** Wasteland: every WILD mon drops this many held items on defeat (post-battle loot). */
  wildItemDropCount?: number;
  /** Construction Site: extra reward-screen item slots offered after each battle. */
  extraRewardSlots?: number;
  /** Ruins: the ambush is AVOIDED when your lead's Def >= the foe's Atk (instead of
   *  the Forest/Snowy Forest speed gate). Pairs with an `ambushChance`. */
  ambushDefenseGate?: boolean;

  // --- Wild-generation shape (#439 §3 second batch) ---
  /** Laboratory: % chance a WILD encounter is a FUSION (biases the wild fusion roll). */
  wildFusionChancePct?: number;
  /** Factory: every WILD mon holds >=1 item, with stacking chances for a 2nd/3rd. */
  wildItemCount?: { guaranteed: number; secondPct: number; thirdPct: number };

  // --- Encounter shape (generation-layer, not the in-battle field) ---
  /** Multiplier on the WILD double-battle probability (Grass/Tall Grass = 2x). */
  doubleBattleMult?: number;
  /** Flat level bonus for WILD spawns (Jungle overgrowth = +2). */
  wildLevelBonus?: number;
  /** % chance a WILD foe gets a free turn-1 action unless your lead outspeeds it
   *  (Forest/Snowy Forest ambush, 0-100). */
  ambushChance?: number;
  /** Island "exotic imports": sharply boost the wild Redux-form spawn rate
   *  (Elite/Hell only - never breaks Ace/Youngster pure-vanilla). */
  reduxFormBoost?: boolean;
  /** Island: bias the wild species roll toward REGIONAL variants in the pool
   *  (Alolan/Galarian/Hisuian/Paldean). */
  regionalBoost?: boolean;
}

/**
 * The biome battle-identity table. Only biomes with a rule appear; everything
 * else keeps vanilla behavior. Several biomes already BIAS toward their
 * signature weather via vanilla weatherPools (Sea rain, etc.) - those are left
 * to the pool; the `weather` entries here are the doc's "baseline"/"always" ones.
 */
const ER_BIOME_RULES: Partial<Record<BiomeId, ErBiomeRule>> = {
  // GROUP A - forced ambient weather
  [BiomeId.BADLANDS]: { weather: WeatherType.SANDSTORM },
  [BiomeId.DESERT]: { weather: WeatherType.SANDSTORM },
  // Snowy Forest: snow ambient + Forest's ambush.
  [BiomeId.SNOWY_FOREST]: { weather: WeatherType.SNOW, ambushChance: 20 },
  [BiomeId.GRAVEYARD]: { weather: WeatherType.FOG },

  // GROUP A - forced ambient terrain (vanilla never sets terrain)
  // Grass fields: grassy terrain + doubled WILD double-battle odds.
  [BiomeId.GRASS]: { terrain: TerrainType.GRASSY, doubleBattleMult: 2 },
  [BiomeId.TALL_GRASS]: { terrain: TerrainType.GRASSY, doubleBattleMult: 2 },
  // Jungle overgrowth: grassy terrain + wild mons spawn +2 levels.
  [BiomeId.JUNGLE]: { terrain: TerrainType.GRASSY, wildLevelBonus: 2 },
  [BiomeId.POWER_PLANT]: { terrain: TerrainType.ELECTRIC },

  // Composite biomes (multiple groups) ----------------------------------------
  // Ice Cave: snow ambient + entry frostbite risk for non-Ice grounded mons.
  [BiomeId.ICE_CAVE]: { weather: WeatherType.SNOW, entryStatus: { kind: "frostbite", chance: 10 } },
  // Beach: sun ambient + Harvest-like berry preservation.
  [BiomeId.BEACH]: { weather: WeatherType.SUNNY, berrySaveChance: 25 },
  // Space: psychic terrain + zero-g (grounded mons -1 Spd on entry, -10% accuracy).
  [BiomeId.SPACE]: { terrain: TerrainType.PSYCHIC, groundedSpdDrop: true, groundedAccuracyMult: 0.9 },
  // Mountain: wind - Flying moves +20%, all accuracy -5%.
  [BiomeId.MOUNTAIN]: { typeBoost: { type: PokemonType.FLYING, mult: 1.2 }, accuracyMult: 0.95 },
  // Volcano: Fire moves +20% + entry burn risk for non-Fire grounded mons.
  [BiomeId.VOLCANO]: { typeBoost: { type: PokemonType.FIRE, mult: 1.2 }, entryStatus: { kind: "burn", chance: 10 } },
  // Cave: darkness - all accuracy -10% unless a Flash/Illuminate ability is on field.
  [BiomeId.CAVE]: { darkness: true },
  // Forest: ambush - a wild foe may snatch a free turn-1 move unless you outspeed.
  [BiomeId.FOREST]: { ambushChance: 20 },
  // Sea: non-swimmers lose 1 Spd on entry (rain frequency stays the vanilla pool).
  [BiomeId.SEA]: { swimmerSpdDrop: true },
  // Swamp: attrition - grounded non-Poison/Steel mons take 1/16 bog chip each turn.
  [BiomeId.SWAMP]: { bogChip: true },
  // Plains: open fields - running/switching never fails.
  [BiomeId.PLAINS]: { runNeverFails: true },
  // Abyss: dread - Dark-type attackers get +1 crit stage (darkness shop rules elsewhere).
  [BiomeId.ABYSS]: { darkCritBoost: true },
  // Fairy Cave: blessed - infatuation immunity + faster status recovery + Misty terrain.
  [BiomeId.FAIRY_CAVE]: { fairyBlessing: true, terrain: TerrainType.MISTY },
  // Island: exotic imports - boosts regional variants + Redux forms in the wild.
  [BiomeId.ISLAND]: { regionalBoost: true, reduxFormBoost: true },

  // GROUP G - ER biome field/economy identities (#439 §3 second batch) ----------
  // Laboratory: experiments - ~50% of wild encounters are FUSIONS.
  [BiomeId.LABORATORY]: { wildFusionChancePct: 50 },
  // Temple: hallowed stillness - Misty terrain + stat stages FROZEN for both sides.
  [BiomeId.TEMPLE]: { terrain: TerrainType.MISTY, statStageFreeze: true },
  // Metropolis: the crowd - nearly every battle is a double.
  [BiomeId.METROPOLIS]: { doubleBattleMult: 8 },
  // Dojo: martial mastery - Fighting +20% AND Fighting moves are never resisted.
  [BiomeId.DOJO]: { typeBoost: { type: PokemonType.FIGHTING, mult: 1.2 }, unresistedType: PokemonType.FIGHTING },
  // Factory: production line - every wild mon holds >=1 item (50% a 2nd, 30% a 3rd).
  [BiomeId.FACTORY]: { wildItemCount: { guaranteed: 1, secondPct: 50, thirdPct: 30 } },
  // Ruins: darkness + a Def-gated ambush (your lead's Def vs the foe's Atk).
  [BiomeId.RUINS]: { darkness: true, ambushChance: 15, ambushDefenseGate: true },
  // Wasteland: scarcity - the shop sells no healing + every wild mon drops 2 items.
  [BiomeId.WASTELAND]: { shopNoHeal: true, wildItemDropCount: 2 },
  // Construction Site: a busy site - one extra reward slot (50% cheaper shop via economy).
  [BiomeId.CONSTRUCTION_SITE]: { extraRewardSlots: 1 },
  // Slum: the den - lose 2% of your money per ally faint in a TRAINER battle.
  [BiomeId.SLUM]: { moneyLossPctPerFaint: 2 },
  // Lake: calm waters - keep an eaten berry (25%) + the party heals a little each turn.
  [BiomeId.LAKE]: { berrySaveChance: 25, perTurnHealFraction: 1 / 16 },
};

/** The full battle-identity rule for a biome, or undefined (vanilla behavior). */
export function getErBiomeRule(biomeId: BiomeId): ErBiomeRule | undefined {
  return ER_BIOME_RULES[biomeId];
}

/** GROUP A: the forced ambient weather for a biome, or undefined. */
export function erBiomeForcedWeather(biomeId: BiomeId): WeatherType | undefined {
  return ER_BIOME_RULES[biomeId]?.weather;
}

/** GROUP A: the forced ambient terrain for a biome, or undefined. */
export function erBiomeForcedTerrain(biomeId: BiomeId): TerrainType | undefined {
  return ER_BIOME_RULES[biomeId]?.terrain;
}
