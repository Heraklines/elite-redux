/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Frozen Shapes. An ICE_CAVE-biome silhouette puzzle (design PART XV
// s116 "Under the Ice"). Pokemon shapes are frozen in the clear ice wall; name
// them (the silhouette quiz on the shared ErQuiz engine) to chip out the right
// cache. The more shapes you read, the richer the find.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ErQuizResult } from "#phases/er-quiz-phase";

const namespace = "mysteryEncounters/frozenShapes";

/** Number of shapes frozen in the ice. */
const SHAPE_COUNT = 3;
/** How many reward options to offer at the earned tier (player picks one). */
const REWARD_CHOICES = 3;

/** Chip out the cache for `correct` shapes read, then leave (tier scales with the tally). */
function chipCache(correct: number): void {
  const tier =
    correct >= SHAPE_COUNT
      ? ModifierTier.ROGUE
      : correct === 2
        ? ModifierTier.ULTRA
        : correct === 1
          ? ModifierTier.GREAT
          : null;
  if (tier === null) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  setEncounterRewards({ guaranteedModifierTiers: new Array(REWARD_CHOICES).fill(tier), fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

export const FrozenShapesEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FROZEN_SHAPES,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
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
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        await transitionMysteryEncounterIntroVisuals(true, false);
        const questions = buildErQuizRound("silhouette", SHAPE_COUNT);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => chipCache(result.correct),
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
