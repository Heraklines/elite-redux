/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Salvage Yard. A FACTORY-biome scrap-heap minigame (design PART
// XVI s63 "Scrap Heap", maintainer rework). The floor is piled with rusted,
// unidentifiable parts. The scrap dweller will let you dig - but only the parts
// you can correctly IDENTIFY from their worn silhouette are worth pulling out.
// Name a part right and you reclaim it; guess wrong and it is too rusted to use.
//
// Runs the shared ErQuiz engine's "item" kind (a held-item icon shown as a black
// silhouette, named from four choices). You keep one held item per part you
// correctly identify - so the haul scales with how many you actually know.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { applyModifierTypeToPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ErQuizResult } from "#phases/er-quiz-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";

const namespace = "mysteryEncounters/salvageYard";

/** How many scrap silhouettes the player must identify. */
const SCRAP_COUNT = 3;
/** Choices offered per silhouette (the answer + distractor part names). */
const SCRAP_CHOICES = 4;

/**
 * Reclaim every part the player correctly named: each correct silhouette hands
 * the player that exact held item DIRECTLY (no 1-of-N pick screen), spread across
 * the party so one mon is not buried under all of them. Identify nothing and you
 * leave empty-handed (the whole heap was too rusted to read).
 */
function reclaimParts(result: ErQuizResult): void {
  const party = globalScene.getPlayerParty();
  const types = result.correctItemIds
    .map(
      id =>
        generateModifierType(
          (modifierTypes as Record<string, ModifierTypeFunc>)[id],
        ) as PokemonHeldItemModifierType | null,
    )
    .filter((t): t is PokemonHeldItemModifierType => !!t);
  if (types.length === 0 || party.length === 0) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  types.forEach((type, i) => applyModifierTypeToPlayerPokemon(party[i % party.length], type));
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("count", String(types.length));
  encounter.setDialogueToken("parts", types.map(t => t.name).join(", "));
  queueEncounterMessage(`${namespace}:reclaimed`);
  leaveEncounterWithoutBattle(true);
}

export const SalvageYardEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SALVAGE_YARD,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A scrap-heap dweller picking through the salvage (Garbodor).
    { species: SpeciesId.GARBODOR, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
        await transitionMysteryEncounterIntroVisuals(true, false);
        // Sort the scrap: identify each worn part from its silhouette. No stop-on-
        // wrong; the haul keys off how many you correctly name (each = that item).
        const questions = buildErQuizRound("item", SCRAP_COUNT, SCRAP_CHOICES);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => reclaimParts(result),
        });
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
