/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Mushroom Circle. A GRASS-biome one-shot GAMBLE (no substrate). A
// ring of glowing mushrooms grows in the meadow; tasting one is a single seeded
// coin-flip:
//
//   WINDFALL (~50%): a sweet candy boon for the whole team - each party member's
//     root species gains research candy (gameData.addStarterCandy), with a queued
//     notification, exactly like the Scrambled Pokedex perfect reward.
//   CURSE-LITE (~50%): a prankish spirit lifts a small, level-scaled bit of money
//     from the player's bag. The cleanest correct downside - it never touches
//     battle state, so it can never softlock a forced encounter.
//
// LEAVE: step around the ring, no cost. A single roll, not a loop.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt } from "#utils/common";

const namespace = "mysteryEncounters/mushroomCircle";

/** Research candy granted to EACH team member's root species on a windfall. */
const WINDFALL_CANDY_PER_MON = 3;

/**
 * Grant the windfall: research candy to every party member's root species, with a
 * queued notification (mirrors the Scrambled Pokedex perfect-reward candy grant).
 */
function grantWindfall(): void {
  for (const mon of globalScene.getPlayerParty()) {
    globalScene.gameData.addStarterCandy(mon.species.getRootSpeciesId(), WINDFALL_CANDY_PER_MON);
  }
}

/**
 * Curse-lite money loss: a small, level-scaled nip from the bag (about half a
 * wave's base money, floored to 10, never more than the player has). Returns the
 * amount lost so the dialogue token can report it.
 */
function curseMoneyLoss(): number {
  const base = Math.floor((globalScene.getWaveMoneyAmount(1) * 0.5) / 10) * 10;
  const lost = Math.max(10, Math.min(base, globalScene.money));
  updatePlayerMoney(-lost, true, false);
  return lost;
}

export const MushroomCircleEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_MUSHROOM_CIRCLE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served berry-bush key from Berries Abound (reads as the
    // glowing meadow foliage). Swap to a dedicated mushroom-ring sprite once one is
    // uploaded to er-assets (images/mystery-encounters/<key>.png + .json).
    { spriteKey: "berries_abound_bush", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
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
        // A single seeded coin-flip: windfall candy, or a curse-lite money nip.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        await transitionMysteryEncounterIntroVisuals(true, false);
        if (randSeedInt(2) === 0) {
          grantWindfall();
          encounter.setDialogueToken("candyAmount", String(WINDFALL_CANDY_PER_MON));
          globalScene.playSound("item_fanfare");
          await showEncounterText(`${namespace}:windfallCandy`);
        } else {
          const lost = curseMoneyLoss();
          encounter.setDialogueToken("moneyLost", String(lost));
          await showEncounterText(`${namespace}:curseMoney`);
        }
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
      // Step around the ring - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
