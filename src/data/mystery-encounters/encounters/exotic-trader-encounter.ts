/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Exotic Trader. A SEA-biome premium MARKET event (design PART XIII
// s45.3): a floating merchant ship whose every good is top-shelf. Pay the steep
// boarding fee to browse a guaranteed HIGH-TIER selection (one Rogue + two Ultra
// picks); the prices are high, but "if you can afford it, it's worth it." Sail on
// for free to keep your coin.
//
// Premium = the selection itself is the reward (a guaranteed high-tier shop),
// gated behind a wave-scaled fee via the existing MoneyRequirement + reward-shop
// plumbing.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";

const namespace = "mysteryEncounters/exoticTrader";

/** Wave-scaled boarding fee multiplier (steep - this is premium stock). */
const BOARDING_FEE_MULTIPLIER = 2.5;

/** The wave-scaled boarding fee. */
function boardingFee(): number {
  return Math.floor(globalScene.getWaveMoneyAmount(BOARDING_FEE_MULTIPLIER));
}

export const ExoticTraderEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_EXOTIC_TRADER,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Placeholder art (reuses an already-served key). Swap to a dedicated trader
    // ship sprite once one is uploaded to er-assets.
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Board and browse - gated on affording the fee; greys out if too poor.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      .withSceneRequirement(new MoneyRequirement(0, BOARDING_FEE_MULTIPLIER))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Pay the boarding fee, then open the real premium SHOP screen
        // (ExoticShopPhase: every good Ultra->Master tier, steep prices, no heals).
        // Launched via the doEncounterRewards hook so it runs as a real phase
        // BEFORE the post-encounter continuation - a full browse-and-buy market,
        // not a reward screen.
        updatePlayerMoney(-boardingFee(), true, false);
        globalScene.currentBattle.mysteryEncounter!.doEncounterRewards = () => {
          globalScene.phaseManager.unshiftNew("ExoticShopPhase");
          return true;
        };
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
      // Sail on without boarding - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
