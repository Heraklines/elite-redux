/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Lake Spirit. A LAKE-biome knowledge trial (design PART XIII s47.2,
// flavor = Celebi). A guardian rises from the still water and tests you with a
// short Pokedex riddle (the dex-entry quiz on the shared ErQuiz engine). The
// blessing scales with how many you answer right: a perfect round grants the team
// Candy plus a blessing Relic and a high-tier pick; fewer correct still pays a
// scaled reward.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
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
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/lakeSpirit";

/** Number of riddles the spirit poses. */
const RIDDLE_COUNT = 3;
/** How many reward options to offer at the earned tier (player picks one). */
const REWARD_CHOICES = 3;
/** Candy granted to EACH team member's species on a perfect round. */
const PERFECT_CANDY_PER_MON = 5;

/**
 * The blessing pool - fortune-flavored Relics fitting a lake guardian's gift.
 * Resolved at CALL time, not module load: `modifierTypes` is populated lazily at game
 * init, after this encounter module is imported, so a module-level capture froze in
 * `undefined` relic funcs that were silently dropped from the reward (#616).
 */
function blessingRelicFuncs(): ModifierTypeFunc[] {
  return [modifierTypes.ER_RELIC_MYSTERY_CHARM, modifierTypes.ER_RELIC_MORALE_BANNER, modifierTypes.ER_RELIC_TWIN_LINK];
}

/**
 * Hand out the spirit's blessing for `correct` riddles, then leave. A perfect
 * round grants the team Candy, a blessing Relic, and high-tier picks; fewer
 * correct pays a scaled reward; zero leaves with a heal.
 */
function grantSpiritBlessing(correct: number): void {
  if (correct >= RIDDLE_COUNT) {
    for (const mon of globalScene.getPlayerParty()) {
      globalScene.gameData.addStarterCandy(mon.species.getRootSpeciesId(), PERFECT_CANDY_PER_MON);
    }
    globalScene.phaseManager.queueMessage(
      `The Lake Spirit blesses your team with ${PERFECT_CANDY_PER_MON} Candy each!`,
      null,
      true,
    );
    setEncounterRewards({
      guaranteedModifierTypeFuncs: [randSeedItem(blessingRelicFuncs())],
      guaranteedModifierTiers: [ModifierTier.ULTRA, ModifierTier.ULTRA],
      fillRemaining: false,
    });
    leaveEncounterWithoutBattle(false);
    return;
  }
  const tier = correct === 2 ? ModifierTier.ULTRA : correct === 1 ? ModifierTier.GREAT : null;
  if (tier === null) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  setEncounterRewards({ guaranteedModifierTiers: new Array(REWARD_CHOICES).fill(tier), fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

export const LakeSpiritEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_LAKE_SPIRIT,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Placeholder art (reuses an already-served key). Swap to a dedicated lake
    // spirit sprite once one is uploaded to er-assets.
    // The Being of Knowledge rising from the lake to test you (Uxie).
    { species: SpeciesId.UXIE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
        // Answer ALL riddles (no stop-on-wrong) - the blessing keys off the tally.
        const questions = buildErQuizRound("dex", RIDDLE_COUNT);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => grantSpiritBlessing(result.correct),
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
