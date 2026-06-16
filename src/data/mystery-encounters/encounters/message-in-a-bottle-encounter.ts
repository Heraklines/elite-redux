/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - Message in a Bottle. A SEA-biome map event (Phase D): a sealed bottle
// bobs in on the tide holding a torn Treasure-Map fragment and a scrawled chart.
// Opening it grants ONE Treasure-Map fragment (collect 3 for the Beach "X Marks
// the Spot" payout) and reveals the run's onward locations onto the World Map
// (press M to view). Or leave the bottle and move on.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { addTreasureFragments, type ErMapNode, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import type { BiomeId } from "#enums/biome-id";
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
import { getBiomeName } from "#utils/common";

const namespace = "mysteryEncounters/messageInABottle";

/** Chart the current biome's onward links onto the map as Route nodes. */
function chartOnwardRoutes(): number {
  const links = allBiomes.get(globalScene.arena.biomeId)?.biomeLinks ?? [];
  const nodes: ErMapNode[] = links
    .map(link => (Array.isArray(link) ? link[0] : link) as BiomeId)
    .map(biome => ({ biome, label: getBiomeName(biome), kind: "biome" }) satisfies ErMapNode);
  return revealMapNodes(nodes);
}

export const MessageInABottleEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_MESSAGE_IN_A_BOTTLE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A seabird perched by the washed-up bottle (Wingull).
    { species: SpeciesId.WINGULL, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
      // One fragment toward the cache, and chart the onward routes onto the map.
      addTreasureFragments(1);
      chartOnwardRoutes();
      queueEncounterMessage(`${namespace}:opened`);
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
      // Leave the bottle on the tide.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
