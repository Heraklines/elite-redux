/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Professor's Scrambled Pokedex. The Professor shows four jumbled
// Pokedex entries; name each from four choices (the dex-entry quiz on the shared
// ErQuiz engine). The reward scales with the tally: all four right -> a CHOICE of
// Rogue-tier items PLUS research candy for the whole team; otherwise pick one
// reward from a tier that scales (Ultra / Great / Common).
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

const namespace = "mysteryEncounters/scrambledPokedex";

/** Number of dex entries the Professor asks about. */
const POKEDEX_QUESTION_COUNT = 4;
/** How many reward options to offer at the earned tier (player picks one). */
const REWARD_CHOICES = 3;
/** Research candy granted to EACH team member's species on a perfect round. */
const PERFECT_CANDY_PER_MON = 5;

/**
 * Hand out the Professor's reward for `correct` dex entries, then leave. A
 * perfect round grants the whole team research candy and a Rogue-tier pick;
 * otherwise the player chooses one reward from a tier that scales with the
 * tally. Naming none leaves with a heal.
 */
function grantPokedexReward(correct: number): void {
  if (correct >= POKEDEX_QUESTION_COUNT) {
    for (const mon of globalScene.getPlayerParty()) {
      globalScene.gameData.addStarterCandy(mon.species.getRootSpeciesId(), PERFECT_CANDY_PER_MON);
    }
    globalScene.phaseManager.queueMessage(
      `The Professor shares ${PERFECT_CANDY_PER_MON} research Candy for each of your Pokémon!`,
      null,
      true,
    );
    setEncounterRewards({
      guaranteedModifierTiers: new Array(REWARD_CHOICES).fill(ModifierTier.ROGUE),
      fillRemaining: false,
    });
    leaveEncounterWithoutBattle(false);
    return;
  }
  const tier =
    correct === 3
      ? ModifierTier.ULTRA
      : correct === 2
        ? ModifierTier.GREAT
        : correct === 1
          ? ModifierTier.COMMON
          : null;
  if (tier === null) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  setEncounterRewards({ guaranteedModifierTiers: new Array(REWARD_CHOICES).fill(tier), fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

export const ScrambledPokedexEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Lab-coat researcher already served from the CDN (reads as the Professor).
    // Swap to a dedicated Oak/Juniper sprite once one is uploaded to er-assets
    // (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "dark_deal_scientist", fileRoot: "mystery-encounters", hasShadow: true, x: 0, y: 6, yShadow: 6 },
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
          onComplete: (result: ErQuizResult) => grantPokedexReward(result.correct),
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
