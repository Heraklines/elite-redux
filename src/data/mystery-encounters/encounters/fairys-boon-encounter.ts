/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Fairy's Boon. A FAIRY_CAVE-biome benevolent gift event (design
// PART XVII s62 / s76). A fairy presence offers a blessing with no catch: accept
// it to receive a random Formation / buff RELIC for the rest of the run. Decline
// and walk on with nothing lost.
//
// Reuses the ER Relic modifier funcs (er-relics.ts, registered in modifierTypes
// as ER_RELIC_*) handed to the reward shop via guaranteedModifierTypeFuncs - the
// same path Town Raffle uses to award its Formation Relic.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
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
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/fairysBoon";

/** The blessing pool - protective / fortune-flavored Relics fitting a fairy's gift. */
const BOON_RELIC_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_MORALE_BANNER,
  modifierTypes.ER_RELIC_SECOND_WIND,
  modifierTypes.ER_RELIC_MYSTERY_CHARM,
  modifierTypes.ER_RELIC_WEATHERVANE,
];

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
        const relic = randSeedItem(BOON_RELIC_FUNCS);
        setEncounterRewards({ guaranteedModifierTypeFuncs: [relic], fillRemaining: false });
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
      // Decline the boon - nothing lost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
