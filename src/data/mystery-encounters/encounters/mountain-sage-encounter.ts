/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #522 - The Mountain Sage. A MOUNTAIN training event (design PART XVIII s67 /
// transcript line 124214). A disciplined recluse who trains those who climb to
// it. The reward is NOT always a relic - the Sage offers a CHOICE:
//   - Train the BODY: a training boon (vitamins to grow stats + a Rare Candy).
//   - Train the TECHNIQUE: a Learner's Shroom (the "moveset workshop" - it teaches
//     a Pokemon any move it can legally learn), letting you rebuild a moveset.
//   - Decline and move on.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

const namespace = "mysteryEncounters/mountainSage";

export const MountainSageEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_MOUNTAIN_SAGE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A disciplined mountain ascetic (Medicham, the meditation master).
    { species: SpeciesId.MEDICHAM, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([
    { text: `${namespace}:intro` },
    { speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` },
  ])
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
      // Train the body: vitamins (permanent stat growth) + a Rare Candy.
      setEncounterRewards({
        guaranteedModifierTypeFuncs: [
          modifierTypes.BASE_STAT_BOOSTER,
          modifierTypes.BASE_STAT_BOOSTER,
          modifierTypes.RARE_CANDY,
        ],
        fillRemaining: false,
      });
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false);
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
      // Train the technique: a Learner's Shroom (teaches any legal move).
      setEncounterRewards({ guaranteedModifierTypeFuncs: [modifierTypes.ER_LEARNERS_SHROOM], fillRemaining: false });
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false);
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
