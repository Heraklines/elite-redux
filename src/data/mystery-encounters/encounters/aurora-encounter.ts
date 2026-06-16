/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Aurora. A SNOWY_FOREST-biome blessing event (design PART XII s43).
// A rare aurora ripples overhead; standing beneath it bathes the team in a
// fleeting blessing - a guaranteed high-tier reward. Walk on and let the lights
// fade.
//
// NOTE: the design's full version is a press-your-luck tiered blessing that
// accrues FROSTBITE the longer you linger (more tiers vs more cost). That needs
// run-scoped buff tiers + a frostbite tick; this first pass delivers the core
// "stand under the lights for a high-tier reward" beat. The lingering buff/cost
// loop is the planned refinement.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { ModifierTier } from "#enums/modifier-tier";
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

const namespace = "mysteryEncounters/aurora";

/** The blessing selection the aurora bestows (player picks one). */
const BLESSING_TIERS: ModifierTier[] = [ModifierTier.ULTRA, ModifierTier.ULTRA, ModifierTier.ULTRA];

export const AuroraEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_AURORA,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A crystalline ice mon shimmering under the aurora (Cryogonal).
    { species: SpeciesId.CRYOGONAL, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
        setEncounterRewards({ guaranteedModifierTiers: BLESSING_TIERS, fillRemaining: false });
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
