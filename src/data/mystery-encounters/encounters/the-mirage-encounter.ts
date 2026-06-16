/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #511 - The Mirage. A DESERT-biome read-the-tell event (design recon line
// 124156). A shimmering "oasis" wavers in the heat - but "there's no water". A
// Pokemon with an ACUITY / illusion-piercing ability (Frisk, Compound Eyes, ...)
// can see through the haze to the real cache buried beneath; with that sight you
// dig up the good stuff (an Ultra + Great pick). Without it you still scratch
// something out of the sand (a single Great pick), or you can just move on.
//
// Pure read-the-tell: no fight. The "tell" is surfaced in the description so the
// player can see whether one of their mons pierces the mirage before choosing.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

const namespace = "mysteryEncounters/theMirage";

/** Acuity / illusion-piercing abilities that let a mon see through the heat-haze. */
const ACUITY_ABILITIES: AbilityId[] = [
  AbilityId.FRISK,
  AbilityId.COMPOUND_EYES,
  AbilityId.KEEN_EYE,
  AbilityId.ANTICIPATION,
  AbilityId.FOREWARN,
];

/** The first party mon that can see through the mirage, or null. */
function acuitySeer(): Pokemon | null {
  return globalScene.getPlayerParty().find(p => ACUITY_ABILITIES.some(a => p.hasAbility(a))) ?? null;
}

export const TheMirageEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_THE_MIRAGE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A desert wanderer that haunts the heat-haze (Sigilyph, the nomad guardian).
    { species: SpeciesId.SIGILYPH, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Resolve the "tell" now so the description can tell the player whether one of
    // their Pokemon pierces the mirage before they choose.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const seer = acuitySeer();
    encounter.misc = { canSee: seer != null };
    encounter.setDialogueToken(
      "tell",
      seer == null
        ? "The heat-haze hides whatever is real. Without a sharp-eyed Pokemon, you can only scratch at the sand and hope."
        : `Your ${seer.getNameToRender()}'s keen senses cut through the haze - there is a real cache hidden beneath it.`,
    );
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [{ text: `${namespace}:option.1.selected` }],
    },
    async () => {
      const canSee = (globalScene.currentBattle.mysteryEncounter!.misc as { canSee: boolean }).canSee;
      if (canSee) {
        // Sight pierces the haze: dig up the real cache (Ultra + Great pick).
        queueEncounterMessage(`${namespace}:resultSeer`);
        setEncounterRewards({
          guaranteedModifierTiers: [ModifierTier.ULTRA, ModifierTier.GREAT],
          fillRemaining: false,
        });
      } else {
        // No sight: the oasis was a mirage, but you scratch a single find from the sand.
        queueEncounterMessage(`${namespace}:resultBlind`);
        setEncounterRewards({ guaranteedModifierTiers: [ModifierTier.GREAT], fillRemaining: false });
      }
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false);
      return true;
    },
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
