/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 / #506 - The Sealed Door (the Unown Cipher). A RUINS-biome decoding
// puzzle (reconciliation Ruins, transcript line 124175). The vault door is carved
// with words spelled out in UNOWN letters; decode each word (pick it from the
// choices, on the shared ErQuiz engine's "cipher" kind) to work the mechanism. The
// more words you read, the richer the vault: a perfect round cracks it for a
// guaranteed Rogue-tier haul, a partial read still opens it a crack.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { buildErQuizRound } from "#data/elite-redux/er-quiz";
import { ModifierTier } from "#enums/modifier-tier";
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
import type { ErQuizResult } from "#phases/er-quiz-phase";

const namespace = "mysteryEncounters/sealedDoor";

/** Number of Unown words carved on the door (the vault tier keys off how many
 * the player decodes). */
const GLYPH_COUNT = 3;
/** How many reward options to offer at the earned tier (player picks one). */
const REWARD_CHOICES = 3;

/**
 * Open the vault for `correct` glyphs read, then leave. The tier scales with the
 * tally: a perfect read = Rogue, partial = Ultra / Great, none leaves with a heal.
 */
function openVault(correct: number): void {
  const tier =
    correct >= GLYPH_COUNT
      ? ModifierTier.ROGUE
      : correct === 2
        ? ModifierTier.ULTRA
        : correct === 1
          ? ModifierTier.GREAT
          : null;
  if (tier === null) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  setEncounterRewards({ guaranteedModifierTiers: new Array(REWARD_CHOICES).fill(tier), fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

export const SealedDoorEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SEALED_DOOR,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Placeholder art (reuses an already-served key). Swap to a dedicated vault
    // door sprite once one is uploaded to er-assets.
    // An ancient automaton standing guard over the vault door (Golett).
    { species: SpeciesId.GOLETT, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
        // Decode ALL cipher words (no stop-on-wrong) - the vault tier keys off the
        // tally. Each word is spelled in Unown letters, picked from 4 choices.
        const questions = buildErQuizRound("cipher", GLYPH_COUNT, 4);
        globalScene.phaseManager.unshiftNew("ErQuizPhase", {
          questions,
          stopOnWrong: false,
          onComplete: (result: ErQuizResult) => openVault(result.correct),
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
      // Leave the door sealed - no reward, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
