/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - The Storm. A SEA-biome map TRAVEL event (Phase D). A weather front
// rolls in - its type is rolled fresh each time (sun / rain / sand / snow / fog),
// so the storm is VARIED. You don't guess it blind: the SIGNAL is your own party.
// If a Pokemon has an ability that activates in that weather (Chlorophyll, Swift
// Swim, Sand Rush, Slush Rush, ... - the full weather-ability set), it STIRS and
// reads the storm clear. The tell is the ABILITY NAME, not the weather - you infer
// it (a Chlorophyll mon stirring means sun is coming). No matching ability = a
// murky read. Fog is the one nothing reads (it stays murky by nature).
//
// RIDE THE STORM -> a DISTANT land you could not otherwise reach is charted onto
// the World Map as a selectable (blue) onward route AND, on a clear read, you
// CARRY that weather into the very next biome (in your favour). Turn back -> nothing.
//
// [Recovered design - er-events-design-recovered.md "The Storm": read via your own
// team's weather ability + carry the weather + reveal a distant node.]
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { setAnyBiomeTravelTarget } from "#data/elite-redux/er-map-events";
import { setErCarriedWeather } from "#data/elite-redux/er-map-nodes";
import { AbilityId } from "#enums/ability-id";
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
 * Every weather the storm can roll, mapped to the abilities/innates that "read"
 * it (activate in / benefit from that weather). Fog is intentionally unreadable -
 * no standard ability keys off it, so a fog front always reads murky.
 */
const WEATHER_ABILITIES: Record<number, AbilityId[]> = {
  [WeatherType.SUNNY]: [
    AbilityId.DROUGHT,
    AbilityId.CHLOROPHYLL,
    AbilityId.SOLAR_POWER,
    AbilityId.LEAF_GUARD,
    AbilityId.FLOWER_GIFT,
    AbilityId.HARVEST,
    AbilityId.PROTOSYNTHESIS,
    AbilityId.ORICHALCUM_PULSE,
  ],
  [WeatherType.RAIN]: [
    AbilityId.DRIZZLE,
    AbilityId.SWIFT_SWIM,
    AbilityId.RAIN_DISH,
    AbilityId.DRY_SKIN,
    AbilityId.HYDRATION,
  ],
  [WeatherType.SANDSTORM]: [
    AbilityId.SAND_STREAM,
    AbilityId.SAND_RUSH,
    AbilityId.SAND_FORCE,
    AbilityId.SAND_VEIL,
    AbilityId.OVERCOAT,
  ],
  [WeatherType.SNOW]: [
    AbilityId.SNOW_WARNING,
    AbilityId.SLUSH_RUSH,
    AbilityId.ICE_BODY,
    AbilityId.SNOW_CLOAK,
    AbilityId.OVERCOAT,
  ],
  [WeatherType.FOG]: [],
};

/** The weathers the storm rolls from (varied each encounter). */
const WEATHER_POOL: WeatherType[] = [
  WeatherType.SUNNY,
  WeatherType.RAIN,
  WeatherType.SANDSTORM,
  WeatherType.SNOW,
  WeatherType.FOG,
];

interface StormState {
  /** The rolled weather front (carried on a clear read). */
  weather: WeatherType;
  /** Display name of the party ability that read it, or null (murky read). */
  abilityName: string | null;
}

/** The display name of the first party ability that reads `weather`, or null. */
function readerAbilityName(weather: WeatherType): string | null {
  const candidates = WEATHER_ABILITIES[weather] ?? [];
  for (const p of globalScene.getPlayerParty()) {
    for (const ability of candidates) {
      if (p.hasAbility(ability)) {
        return allAbilities[ability]?.name ?? null;
      }
    }
  }
  return null;
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
    // Roll the (varied) weather front now and see if a party ability reads it, so
    // the description can name the stirring ability and the option can carry it.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const weather = randSeedItem(WEATHER_POOL);
    const abilityName = readerAbilityName(weather);
    encounter.misc = { weather, abilityName } satisfies StormState;
    encounter.setDialogueToken(
      "stormTell",
      abilityName == null
        ? "Nothing in your party stirs - you can only read the storm murkily."
        : `Your ${abilityName} stirs, reading the storm's currents clearly.`,
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
      // Ride it: the squall SWEEPS you to a random biome anywhere on the graph
      // (forced next-transition travel), and - on a clear read - you carry the
      // rolled weather into that biome.
      const { weather, abilityName } = globalScene.currentBattle.mysteryEncounter!.misc as StormState;
      const target = setAnyBiomeTravelTarget();
      if (abilityName == null) {
        queueEncounterMessage(target == null ? `${namespace}:calm` : `${namespace}:swept`);
      } else {
        setErCarriedWeather(weather);
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
