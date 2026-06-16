/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - The Informant. A SLUM-biome map event (Phase D): a hooded figure in a
// back alley sells directions. Pay the fee for a tip-off - it charts the onward
// routes onto the World Map AND slips you a Treasure-Map Fragment. Or keep your
// coin and walk on.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { chartOnwardRoutes } from "#data/elite-redux/er-map-events";
import { addTreasureFragments } from "#data/elite-redux/er-map-nodes";
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

const namespace = "mysteryEncounters/informant";

/** Wave-scaled fee for the tip-off. */
const TIP_FEE_MULTIPLIER = 0.75;

function tipFee(): number {
  return Math.floor(globalScene.getWaveMoneyAmount(TIP_FEE_MULTIPLIER));
}

export const InformantEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_INFORMANT,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
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
    // Buy the tip - gated on the fee (greys out if the player can't afford it).
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new MoneyRequirement(0, TIP_FEE_MULTIPLIER))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        updatePlayerMoney(-tipFee(), true, false);
        chartOnwardRoutes([]);
        addTreasureFragments(1);
        queueEncounterMessage(`${namespace}:tipped`);
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
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
