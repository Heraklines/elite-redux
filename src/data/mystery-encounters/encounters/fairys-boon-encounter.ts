/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 / #542 - The Fairy's Boon. A FAIRY_CAVE-biome benevolent gift event.
// REWORKED (#542): the old version handed out a permanent free relic, which was
// too basic and too generous for a no-catch event. Now accepting the blessing
// grants a TEMPORARY LUCK SURGE - the party's effective luck is boosted by
// FAIRY_LUCK_BONUS for the next FAIRY_LUCK_DURATION waves (sweetening shiny rolls
// and reward-tier upgrades while it lasts), then it fades. Decline and walk on.
//
// The temporary luck lives in er-fairy-luck.ts (folded into getPartyLuckValue),
// run-scoped and persisted across save/load.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { FAIRY_LUCK_BONUS, FAIRY_LUCK_DURATION, grantErFairyLuck } from "#data/elite-redux/er-fairy-luck";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";

const namespace = "mysteryEncounters/fairysBoon";

export const FairysBoonEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FAIRYS_BOON,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A fairy presence offering the blessing - Clefable as the benevolent guardian.
    { species: SpeciesId.CLEFABLE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Accept the boon - grant one random blessing Relic as a no-battle reward shop.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Grant the temporary luck surge for the next FAIRY_LUCK_DURATION waves.
        const wave = globalScene.currentBattle?.waveIndex ?? 0;
        grantErFairyLuck(FAIRY_LUCK_BONUS, FAIRY_LUCK_DURATION, wave);
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.setDialogueToken("luck", String(FAIRY_LUCK_BONUS));
        encounter.setDialogueToken("waves", String(FAIRY_LUCK_DURATION));
        queueEncounterMessage(`${namespace}:blessed`);
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
      // Decline the boon - nothing lost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
