/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Picnic. A MEADOW-biome social REST event (design PART XII s42).
// Lay out a spread in the meadow: the whole party shares a meal, gaining CANDY
// (for each mon's species) and AFFECTION. A cozy, no-risk payoff that leans into
// the Meadow's friendship/candy identity.
//
// NOTE: the design's "a rare biome Pokemon wanders up for an easy catch, scaled
// to how generous the spread was" is a planned refinement (needs a curated
// per-biome wander pool + the catch flow); this first pass delivers the
// guaranteed Candy + affection core.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

const namespace = "mysteryEncounters/picnic";

/** Candy granted to each party member's species when the spread is laid out. */
const PICNIC_CANDY_PER_MON = 5;
/** Affection (friendship) added to each party member. */
const PICNIC_AFFECTION_PER_MON = 20;

export const PicnicEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_PICNIC,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served berry-bush key (reads as a meadow spread). Swap to
    // a dedicated picnic sprite once one is uploaded to er-assets.
    { spriteKey: "berries_abound_bush", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
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
      // Share the spread: Candy for each species + affection across the party.
      for (const mon of globalScene.getPlayerParty()) {
        globalScene.gameData.addStarterCandy(mon.species.getRootSpeciesId(), PICNIC_CANDY_PER_MON);
        mon.addFriendship(PICNIC_AFFECTION_PER_MON);
      }
      globalScene.playSound("item_fanfare");
      queueEncounterMessage(`${namespace}:shared`);
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
      // Move on without a picnic - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
