/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - The Storm. A SEA-biome map TRAVEL event (Phase D): a sudden squall
// rolls in. Brave it and the wind sweeps the party off-course - the next biome
// transition is forced to a random onward destination (a map travel target). Or
// turn back and ride out the storm where you are (no travel).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { setRandomTravelTarget } from "#data/elite-redux/er-map-events";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

const namespace = "mysteryEncounters/theStorm";

export const TheStormEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_THE_STORM,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
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
