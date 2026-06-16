/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Experiment. A LABORATORY-biome gamble (design PART IX s55 / s87).
// A researcher offers to run an experiment on the house: it usually pays out a
// high-tier reward, but there is a small chance it BACKFIRES - the apparatus
// shorts out, the reward is lost, and you eat the cleanup bill. Decline to walk
// away clean.
//
// First pass keeps the downside a contained money cost (no new infra); the
// design's ability-reroll flavor can replace the payout once that item exists.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt } from "#utils/common";

const namespace = "mysteryEncounters/experiment";

/** Percent chance the experiment backfires (no reward + cleanup cost). */
const BACKFIRE_CHANCE = 20;
/** Wave-scaled cleanup bill on a backfire. */
const CLEANUP_FEE_MULTIPLIER = 1;
/** The high-tier selection a successful experiment yields (player picks one). */
const SUCCESS_TIERS: ModifierTier[] = [ModifierTier.ULTRA, ModifierTier.ULTRA, ModifierTier.ULTRA];

export const ExperimentEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_EXPERIMENT,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Lab-coat researcher already served from the CDN (reads as the lab tech).
    { spriteKey: "dark_deal_scientist", fileRoot: "mystery-encounters", hasShadow: true, x: 0, y: 6, yShadow: 6 },
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
        if (randSeedInt(100) < BACKFIRE_CHANCE) {
          // Backfire: lost reward + a wave-scaled cleanup bill.
          updatePlayerMoney(-Math.floor(globalScene.getWaveMoneyAmount(CLEANUP_FEE_MULTIPLIER)), true, false);
          queueEncounterMessage(`${namespace}:backfire`);
          await transitionMysteryEncounterIntroVisuals(true, true);
          leaveEncounterWithoutBattle(true);
          return true;
        }
        queueEncounterMessage(`${namespace}:success`);
        setEncounterRewards({ guaranteedModifierTiers: SUCCESS_TIERS, fillRemaining: false });
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
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
