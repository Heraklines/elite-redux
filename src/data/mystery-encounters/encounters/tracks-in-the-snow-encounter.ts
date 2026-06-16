/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #498 - Tracks in the Snow. A SNOWY_FOREST footprint hunt (design PART XII
// s43.1). Fresh tracks cut across the snow; reading spoor is the gameplay. The
// player is shown a single FOOTPRINT sprite and names who made it from three
// choices (the footprint quiz on the shared ErQuiz engine, "footprint" kind).
//
//   READ THE TRACKS (SCOUT): name the maker.
//     Right  -> you corner it: a RICHER cache (3 Ultra-tier picks).
//     Wrong  -> you still chase it down, but it had less stashed (2 Great picks).
//     No hard fail - skill scales the reward, never zero (per the design).
//   WALK ON: leave the trail, no cost.
//
// The footprint art is per-species (er-assets); species with no shipped
// footprint fall back to a silhouette in the quiz UI, so the hunt always renders.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
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
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ErQuizResult } from "#phases/er-quiz-phase";

const namespace = "mysteryEncounters/tracksInTheSnow";

/** One footprint to read, three choices to pick from. */
const TRACK_OPTIONS = 3;
/** Reward picks the player chooses from on each outcome. */
const REWARD_CHOICES_RIGHT = 3;
const REWARD_CHOICES_WRONG = 2;

/** Pay out the find: a richer cache if the tracks were read right, a lesser
 * one if they were misread (you still chased it down). Never empty-handed. */
function payTrail(correct: number): void {
  if (correct > 0) {
    setEncounterRewards({
      guaranteedModifierTiers: new Array(REWARD_CHOICES_RIGHT).fill(ModifierTier.ULTRA),
      fillRemaining: false,
    });
  } else {
    setEncounterRewards({
      guaranteedModifierTiers: new Array(REWARD_CHOICES_WRONG).fill(ModifierTier.GREAT),
      fillRemaining: false,
    });
  }
  leaveEncounterWithoutBattle(false);
}

export const TracksInTheSnowEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_TRACKS_IN_THE_SNOW,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A snow-country tracker/hunter at the trailhead (Sneasel).
    { species: SpeciesId.SNEASEL, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        await transitionMysteryEncounterIntroVisuals(true, false);
        // A single footprint to read, three choices. stopOnWrong is irrelevant
        // for one question; payTrail scales the find off whether it was right.
        const questions = buildErQuizRound("footprint", 1, TRACK_OPTIONS);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => payTrail(result.correct),
        });
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
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
