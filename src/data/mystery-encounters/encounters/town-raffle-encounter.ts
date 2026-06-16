/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Town Raffle. A TOWN-biome RELIC gamble. Pay a small entry fee (scaled
// exactly like the Guessing Booth fee), then draw a single seeded ticket. The
// raffle ALWAYS pays out something, with a tiered outcome:
//
//   JACKPOT (small chance): a FORMATION RELIC - one of the existing ER relic
//     registry funcs (Quartermaster / Lookout / Anchor / Twin Link), offered as a
//     guaranteed shop pick. The design's "raffle -> rare Formation role" top prize.
//   MID: a Great/Ultra-tier item CHOICE (guaranteedModifierTiers).
//   CONSOLATION: a couple of Poke Balls (a common, always-useful payout).
//
// DECLINE: walk away, no fee. A single roll, never a loop, never a battle - so it
// can never softlock a forced encounter.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/townRaffle";

/** How many reward options to offer at the MID tier (player picks one). */
const MID_TIER_CHOICES = 3;

/** The Formation Relic registry funcs the jackpot draws from (one is rolled). */
const FORMATION_RELIC_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_QUARTERMASTER,
  modifierTypes.ER_RELIC_LOOKOUT,
  modifierTypes.ER_RELIC_ANCHOR,
  modifierTypes.ER_RELIC_TWIN_LINK,
];

/** Seeded ticket roll out of 100: 0-9 jackpot, 10-54 mid, 55-99 consolation. */
const JACKPOT_THRESHOLD = 10;
const MID_THRESHOLD = 55;

/**
 * Draw the ticket and set the matching reward, then show the outcome text and
 * leave. Always pays out something for the fee. The jackpot draws a random
 * Formation Relic; mid pays a Great/Ultra-tier choice; consolation pays a couple
 * of Poke Balls.
 */
async function drawTicket(): Promise<void> {
  const roll = randSeedInt(100);
  if (roll < JACKPOT_THRESHOLD) {
    const relic = randSeedItem(FORMATION_RELIC_FUNCS);
    setEncounterRewards({ guaranteedModifierTypeFuncs: [relic], fillRemaining: false });
    globalScene.playSound("item_fanfare");
    await showEncounterText(`${namespace}:jackpot`);
  } else if (roll < MID_THRESHOLD) {
    // Half the mid draws are Ultra, half Great - a small extra spread of luck.
    const tier = randSeedInt(2) === 0 ? ModifierTier.ULTRA : ModifierTier.GREAT;
    setEncounterRewards({ guaranteedModifierTiers: new Array(MID_TIER_CHOICES).fill(tier), fillRemaining: false });
    await showEncounterText(`${namespace}:midPrize`);
  } else {
    setEncounterRewards({
      guaranteedModifierTypeFuncs: [modifierTypes.POKEBALL, modifierTypes.POKEBALL],
      fillRemaining: false,
    });
    await showEncounterText(`${namespace}:consolation`);
  }
  leaveEncounterWithoutBattle(false);
}

export const TownRaffleEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_TOWN_RAFFLE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served festival booth key from Fun and Games (reads as the
    // raffle stand). Swap to a dedicated raffle-drum sprite once one is uploaded to
    // er-assets (images/mystery-encounters/<key>.png + .json).
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
        // Pay the entry fee (same scaling as the Guessing Booth fee), clear the
        // intro art, then draw the ticket.
        const fee = Math.floor((globalScene.getWaveMoneyAmount(1) * 0.45 * 0.7) / 10) * 10;
        updatePlayerMoney(-fee, true, false);
        await transitionMysteryEncounterIntroVisuals(true, false);
        await drawTicket();
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
      // Decline - no fee, no prize.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
