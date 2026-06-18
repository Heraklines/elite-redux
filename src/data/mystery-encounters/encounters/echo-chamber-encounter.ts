/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - Echo Chamber. A CAVE-biome SCOUT map event (Phase D). Call into the
// dark and listen: the returning echoes map the tunnels ahead. This is a SOUND-
// MOVE skill check - a Pokemon that knows a sound move (Hyper Voice, Boomburst,
// Echoed Voice, Snarl, ...) echoes LOUDER and maps the WHOLE area (every onward
// route revealed). Without a sound move the echo dies in the dark and you make
// out only a single faint passage. Or move on quietly (reveal nothing).
//
// This is what makes it distinct from the Observatory (which charts everything
// unconditionally): here the reveal SCALES with bringing the right move.
//
// [Recovered design - er-events-design-recovered.md "Echo Chamber": sound-move-
// gated SCOUT, "a mon with a sound move echoes louder and reveals more."]
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { revealAllErPendingNodes, revealNextHiddenErPendingNode } from "#data/elite-redux/er-biome-routing";
import { MoveFlags } from "#enums/move-flags";
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

const namespace = "mysteryEncounters/echoChamber";

/** True if any party member knows a SOUND-based move (the louder-echo skill check). */
function partyHasSoundMove(): boolean {
  return globalScene.getPlayerParty().some(p => p.moveset.some(m => m?.getMove().hasFlag(MoveFlags.SOUND_BASED)));
}

export const EchoChamberEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_ECHO_CHAMBER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // An echolocating cave dweller (Noibat).
    { species: SpeciesId.NOIBAT, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Hint whether the party can make the cavern ring (a sound move) before choosing.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken(
      "echoTell",
      partyHasSoundMove()
        ? "A sound-move partner could make the whole cavern ring, mapping every tunnel."
        : "No sound move in your party - the echo will carry only so far.",
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
      // Sound move -> the cavern rings: every onward route is mapped. Otherwise the
      // faint echo makes out only one more passage.
      if (partyHasSoundMove()) {
        revealAllErPendingNodes();
      } else {
        revealNextHiddenErPendingNode();
      }
      queueEncounterMessage(`${namespace}:charted`);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
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
