/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Professor's Scrambled Pokedex. The Professor shows four jumbled
// Pokedex entries; name each from four choices (the dex-entry quiz on the shared
// ErQuiz engine). Match ALL FOUR -> unlock the Damage Calculator (a genuine,
// thematic tool, not a pool pull). A couple right -> a Rare Candy token.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
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

const namespace = "mysteryEncounters/scrambledPokedex";

/** Number of dex entries the Professor asks about (all must be right for the calc). */
const POKEDEX_QUESTION_COUNT = 4;

export const ScrambledPokedexEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // NOTE: "professor_oak" must match the uploaded er-assets mystery-encounters
    // sprite key; swap this one string if the asset is named differently.
    { spriteKey: "professor_oak", fileRoot: "mystery-encounters", hasShadow: true, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` }])
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
        // Answer ALL four (no stop-on-wrong) - the reward keys off the final tally.
        const questions = buildErQuizRound("dex", POKEDEX_QUESTION_COUNT);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => {
            if (result.correct >= POKEDEX_QUESTION_COUNT) {
              // Perfect - unlock the Damage Calculator tool.
              setEncounterRewards({
                guaranteedModifierTypeFuncs: [modifierTypes.DAMAGE_CALCULATOR],
                fillRemaining: false,
              });
              leaveEncounterWithoutBattle(false);
            } else if (result.correct >= 2) {
              // Partial - a small token of thanks.
              setEncounterRewards({ guaranteedModifierTypeFuncs: [modifierTypes.RARE_CANDY], fillRemaining: false });
              leaveEncounterWithoutBattle(false);
            } else {
              leaveEncounterWithoutBattle(true);
            }
          },
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
