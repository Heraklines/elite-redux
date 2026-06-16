/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Hot Spring. A MOUNTAIN-biome REST event (design PART XVIII s64):
// a natural spring on the slope, watched over by Pokemon that have made it their
// home. They will not take coin - they accept only BERRIES as tribute. Pay the
// berry toll to soak and FULLY restore the whole party (HP, status, PP, revive).
// Or move on for free and keep your berries.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { BerryModifier } from "#modifiers/modifier";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PersistentModifierRequirement } from "#mystery-encounters/mystery-encounter-requirements";

const namespace = "mysteryEncounters/hotSpring";

/**
 * Berry toll the guardians demand to let the party soak. Keep this in sync with
 * the "{{berryCost}}" count baked into the option label in the locale file.
 */
const BERRY_COST = 3;

/** Spend BERRY_COST berries from across the party, removing depleted stacks. */
function payBerryToll(): void {
  let remaining = BERRY_COST;
  const berries = globalScene.findModifiers(m => m instanceof BerryModifier) as BerryModifier[];
  for (const berry of berries) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, berry.getStackCount());
    berry.stackCount -= take;
    remaining -= take;
    if (berry.getStackCount() <= 0) {
      globalScene.removeModifier(berry);
    }
  }
  globalScene.updateModifiers(true);
}

export const HotSpringEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_HOT_SPRING,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A guardian Pokemon watching over the spring (Slowking - the wise onsen keeper).
    {
      species: SpeciesId.SLOWKING,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Soak - gated on holding the berry toll; greys out if the party has too few.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new PersistentModifierRequirement("BerryModifier", BERRY_COST))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Hand over the berry tribute, then fully restore the party.
        payBerryToll();
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
