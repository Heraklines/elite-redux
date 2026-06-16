/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - The Storm. A SEA-biome map TRAVEL event (Phase D): a sudden squall
// rolls in. Brave it and the wind sweeps the party off-course - the next biome
// transition is forced to a random onward destination. If you carry a
// weather-setting Pokemon (Drizzle / Drought / Sand Stream / Snow Warning), it
// READS the storm's currents and a DISTANT land is glimpsed and marked on your
// map. Or turn back and ride it out where you are (no travel).
//
// NOTE: the design's "carry that weather into the next biome" is a later
// refinement (it touches arena weather persistence across the transition); this
// pass delivers the weather-reader -> reveal-a-distant-node beat.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { setRandomTravelTarget } from "#data/elite-redux/er-map-events";
import { revealMapNodes } from "#data/elite-redux/er-map-nodes";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { getBiomeName, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/theStorm";

/** Weather-setting abilities that let a party member "read" the storm. */
const WEATHER_ABILITIES: AbilityId[] = [
  AbilityId.DRIZZLE,
  AbilityId.DROUGHT,
  AbilityId.SAND_STREAM,
  AbilityId.SNOW_WARNING,
];

/** True if any party member has a weather-setting ability. */
function hasWeatherReader(): boolean {
  return globalScene.getPlayerParty().some(p => WEATHER_ABILITIES.some(a => p.hasAbility(a)));
}

/** Biomes that are never marked as a distant glimpse. */
const NON_TRAVEL_BIOMES: ReadonlySet<BiomeId> = new Set([BiomeId.TOWN, BiomeId.END]);

/** Reveal one random DISTANT biome onto the map. Returns true if one was marked. */
function revealDistantNode(): boolean {
  const current = globalScene.arena.biomeId;
  const candidates = [...allBiomes.keys()].filter(b => b !== current && !NON_TRAVEL_BIOMES.has(b));
  if (candidates.length === 0) {
    return false;
  }
  const biome = randSeedItem(candidates);
  revealMapNodes([{ biome, label: getBiomeName(biome), kind: "biome" }]);
  return true;
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
      // Swept off course - force the next biome transition to a random onward link.
      const target = setRandomTravelTarget();
      queueEncounterMessage(target == null ? `${namespace}:calm` : `${namespace}:swept`);
      // A weather-attuned mon reads the storm and glimpses a distant land (marked on the map).
      if (hasWeatherReader() && revealDistantNode()) {
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
      // Turn back - no travel.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
