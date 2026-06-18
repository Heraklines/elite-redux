/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - The Storm. A SEA-biome map TRAVEL event (Phase D). A weather front is
// forming over the open water, its type HIDDEN - but you don't guess it blind.
// The SIGNAL is your own party: a Pokemon with a weather-reactive ability/innate
// (Drought/Chlorophyll -> sun, Drizzle/Swift Swim -> rain, Sand Stream/Sand Rush
// -> sand, Snow Warning/Slush Rush -> snow) STIRS, reading the storm cleanly.
// Teams with no weather mon get only a murky read.
//
// RIDE THE STORM -> a DISTANT land you could not otherwise reach is glimpsed and
// charted onto the World Map as a selectable (blue) onward route AND, if a mon
// read the front, you CARRY that favourable weather into the very next biome.
// Turn back -> ride it out where you are (nothing happens).
//
// [Recovered design - er-events-design-recovered.md "The Storm": the maintainer
// rejected the blind "guess the weather" and approved reading it via your own
// team's weather ability + carrying the weather + revealing a distant node. The
// earlier shipped version (random travel target) was BUILT-WRONG.]
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { addErEventRevealedNode, getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { setErCarriedWeather } from "#data/elite-redux/er-map-nodes";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/theStorm";

/**
 * Weather-reactive abilities/innates map to the weather their holder reads in the
 * storm (and would carry, in its favour). Covers the weather SETTERS and the
 * common weather-SYNERGY abilities so a synergy team reads the front cleanly.
 */
const ABILITY_WEATHER: Partial<Record<AbilityId, WeatherType>> = {
  [AbilityId.DROUGHT]: WeatherType.SUNNY,
  [AbilityId.CHLOROPHYLL]: WeatherType.SUNNY,
  [AbilityId.SOLAR_POWER]: WeatherType.SUNNY,
  [AbilityId.LEAF_GUARD]: WeatherType.SUNNY,
  [AbilityId.FLOWER_GIFT]: WeatherType.SUNNY,
  [AbilityId.ORICHALCUM_PULSE]: WeatherType.SUNNY,
  [AbilityId.DRIZZLE]: WeatherType.RAIN,
  [AbilityId.SWIFT_SWIM]: WeatherType.RAIN,
  [AbilityId.RAIN_DISH]: WeatherType.RAIN,
  [AbilityId.DRY_SKIN]: WeatherType.RAIN,
  [AbilityId.HYDRATION]: WeatherType.RAIN,
  [AbilityId.SAND_STREAM]: WeatherType.SANDSTORM,
  [AbilityId.SAND_RUSH]: WeatherType.SANDSTORM,
  [AbilityId.SAND_FORCE]: WeatherType.SANDSTORM,
  [AbilityId.SAND_VEIL]: WeatherType.SANDSTORM,
  [AbilityId.SNOW_WARNING]: WeatherType.SNOW,
  [AbilityId.SLUSH_RUSH]: WeatherType.SNOW,
  [AbilityId.ICE_BODY]: WeatherType.SNOW,
  [AbilityId.SNOW_CLOAK]: WeatherType.SNOW,
};

/** Read the storm via the party: the weather the first weather-attuned mon senses, or null. */
function readStormWeather(): WeatherType | null {
  for (const p of globalScene.getPlayerParty()) {
    for (const key of Object.keys(ABILITY_WEATHER)) {
      const ability = Number(key) as AbilityId;
      if (p.hasAbility(ability)) {
        return ABILITY_WEATHER[ability] as WeatherType;
      }
    }
  }
  return null;
}

/** Biomes that are never a valid distant glimpse. */
const NON_TRAVEL_BIOMES: ReadonlySet<BiomeId> = new Set([BiomeId.TOWN, BiomeId.END]);

/**
 * Pick a DISTANT biome you could not otherwise reach this hop: not the current
 * biome, not one of the already-rolled onward routes, not a non-travel biome.
 */
function pickDistantBiome(): BiomeId | null {
  const current = globalScene.arena.biomeId;
  const onward = new Set(getErPendingNodes().map(n => n.biome));
  const candidates = [...allBiomes.keys()].filter(b => b !== current && !onward.has(b) && !NON_TRAVEL_BIOMES.has(b));
  return candidates.length > 0 ? randSeedItem(candidates) : null;
}

export const TheStormEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_THE_STORM,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A storm-petrel of the open sea, wheeling in the squall (Pelipper).
    { species: SpeciesId.PELIPPER, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Read the front up front so the description can hint whether a mon senses it.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken(
      "stormTell",
      readStormWeather() == null
        ? "No weather-attuned partner stirs - you can only read the storm murkily."
        : "A weather-attuned partner stirs, reading the storm's currents clearly.",
    );
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [{ text: `${namespace}:option.1.selected` }],
    },
    async () => {
      // Ride it: chart a distant land as a selectable onward route, and - if a mon
      // read the front - carry that favourable weather into the next biome.
      const read = readStormWeather();
      const distant = pickDistantBiome();
      if (distant != null) {
        addErEventRevealedNode(distant);
      }
      if (read == null) {
        // Murky read: you brave the squall and still glimpse a distant land.
        queueEncounterMessage(distant == null ? `${namespace}:calm` : `${namespace}:swept`);
      } else {
        setErCarriedWeather(read);
        // A clean read: a distant land glimpsed AND the weather carried with you.
        queueEncounterMessage(`${namespace}:foresaw`);
      }
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Turn back - ride it out where you are. No travel, no carry.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
