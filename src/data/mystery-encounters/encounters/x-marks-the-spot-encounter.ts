/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - X Marks the Spot. A BEACH-biome map event (Phase D): a weathered X is
// scratched into the sand. With THREE Treasure-Map fragments in hand (collected
// from Message-in-a-Bottle and other map events), dig up the buried cache for a
// guaranteed haul. Short of three, you can still scratch around the spot for a
// chance at one more fragment. Or just walk the shoreline and leave.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { addTreasureFragments, consumeTreasureFragmentsForReward } from "#data/elite-redux/er-map-nodes";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";

const namespace = "mysteryEncounters/xMarksTheSpot";

export const XMarksTheSpotEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_X_MARKS_THE_SPOT,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A coin-hoarding treasure mon guarding the buried cache (Gimmighoul).
    { species: SpeciesId.GIMMIGHOUL, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Dig at the X. Pays out only with the full set of fragments; otherwise it
    // costs nothing and just tells you how many you still need.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        if (consumeTreasureFragmentsForReward()) {
          // Full set spent - a generous buried cache.
          setEncounterRewards({
            guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT],
            fillRemaining: false,
          });
          queueEncounterMessage(`${namespace}:dug`);
          await transitionMysteryEncounterIntroVisuals(true, true);
          leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
        } else {
          // Not enough fragments - no cost, just report the shortfall.
          queueEncounterMessage(`${namespace}:notEnough`);
          await transitionMysteryEncounterIntroVisuals(true, true);
          leaveEncounterWithoutBattle(true);
        }
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Scratch around the X - a chance to turn up one more fragment.
      addTreasureFragments(1);
      queueEncounterMessage(`${namespace}:scratched`);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
