/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #515 - The Cleansing Font. A TEMPLE-biome shrine event (design recon line
// 124193). A font of clean water at a forgotten temple: drink to be cleansed.
//   - If the party carries a CURSE, the font lifts one curse.
//   - Otherwise the clean water simply restores the whole party (HP + status).
//
// ER curses are stored per-Pokemon as customPokemonData.erCursedStat (the Bog
// Witch's "anti-vitamin" hex, #508). If the party carries one, the font lifts a
// single curse; otherwise the clean water just restores the whole party.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
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

const namespace = "mysteryEncounters/cleansingFont";

/** A party Pokemon carrying the Bog Witch's anti-vitamin curse, or undefined. */
function findCursedPartyMember() {
  return globalScene.getPlayerParty().find(p => p.customPokemonData.erCursedStat >= 0);
}

export const CleansingFontEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_CLEANSING_FONT,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A temple water-guardian watching over the font (Lumineon, serene and clean).
    { species: SpeciesId.LUMINEON, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
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
      // Cursed party -> lift one curse; otherwise the clean water restores everyone.
      const cursed = findCursedPartyMember();
      if (cursed) {
        cursed.customPokemonData.erCursedStat = -1;
        cursed.calculateStats();
        cursed.updateInfo();
        queueEncounterMessage(`${namespace}:cleansed`);
      } else {
        queueEncounterMessage(`${namespace}:restored`);
      }
      globalScene.phaseManager.unshiftNew("PartyHealPhase", true);
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
