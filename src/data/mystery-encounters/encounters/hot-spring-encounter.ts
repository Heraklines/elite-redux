/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Hot Spring. A MOUNTAIN-biome REST event (design PART XVIII s64):
// a natural spring on the slope where a tired team can soak and recover. Pay the
// keeper's modest fee to soak and FULLY restore the whole party - HP, status, PP,
// and any fainted mon revived (the standard PartyHealPhase). Or move on for free
// and keep your money.
//
// NOTE: the design's "berry-tax" framing (pay in berries rather than coin) is the
// intended refinement; this first pass charges a small wave-scaled coin fee, which
// reuses the existing MoneyRequirement + updatePlayerMoney plumbing.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";

const namespace = "mysteryEncounters/hotSpring";

/** Wave-scaled fee multiplier for the soak (modest, scales with run progress). */
const SOAK_FEE_MULTIPLIER = 0.5;

/** The wave-scaled coin fee to soak. */
function soakFee(): number {
  return Math.floor(globalScene.getWaveMoneyAmount(SOAK_FEE_MULTIPLIER));
}

export const HotSpringEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_HOT_SPRING,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Placeholder art (reuses an already-served key). Swap to a dedicated hot-spring
    // sprite once one is uploaded to er-assets.
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Soak - gated on having the fee; greys out if the player can't afford it.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new MoneyRequirement(0, SOAK_FEE_MULTIPLIER))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Charge the fee, then fully restore the party (HP / status / PP / revive).
        updatePlayerMoney(-soakFee(), true, false);
        queueEncounterMessage(`${namespace}:soaked`);
        globalScene.phaseManager.unshiftNew("PartyHealPhase", true);
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(true);
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
      // Move on without soaking - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
