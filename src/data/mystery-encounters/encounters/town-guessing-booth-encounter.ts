/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Town Guessing Booth. A festival silhouette quiz (the "Who's that
// Pokemon?" booth). Pay a small fee, then a press-your-luck round of silhouette
// questions on the compact ErQuiz UI: every correct call raises the prize tier
// (capped at an Ultra Ball for early Town), one wrong answer ends it. Rides the
// shared Quiz/Minigame engine (ErQuizPhase).
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
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ErQuizResult } from "#phases/er-quiz-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";

const namespace = "mysteryEncounters/townGuessingBooth";

/** Prize for naming `correct` silhouettes (early-Town cap = Ultra Ball). */
function boothReward(correct: number): ModifierTypeFunc | undefined {
  if (correct >= 5) {
    return modifierTypes.ULTRA_BALL;
  }
  if (correct >= 3) {
    return modifierTypes.GREAT_BALL;
  }
  if (correct >= 1) {
    return modifierTypes.POKEBALL;
  }
  return;
}

export const TownGuessingBoothEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GUESSING_BOOTH,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    { spriteKey: "fun_and_games_game", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6 },
    { spriteKey: "fun_and_games_man", fileRoot: "mystery-encounters", hasShadow: true, x: 40, y: 6, yShadow: 6 },
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
        // Pay the entry fee, clear the intro art, then run the silhouette round.
        // The fee tracks a Super Potion's shop price at this wave: shop heal items
        // cost getWaveMoneyAmount(1) * factor * 0.7 (the ER heal discount), and a
        // Super Potion's factor is 0.45 (see getPlayerShopModifierTypeOptionsForWave).
        const fee = Math.floor((globalScene.getWaveMoneyAmount(1) * 0.45 * 0.7) / 10) * 10;
        updatePlayerMoney(-fee, true, false);
        await transitionMysteryEncounterIntroVisuals(true, false);

        const questions = buildErQuizRound("silhouette", 5);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: true,
          onComplete: (result: ErQuizResult) => {
            const reward = boothReward(result.correct);
            if (reward) {
              setEncounterRewards({ guaranteedModifierTypeFuncs: [reward], fillRemaining: false });
              leaveEncounterWithoutBattle(false);
            } else {
              // No prize - leave with a heal so a cold streak isn't a dead stop.
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
