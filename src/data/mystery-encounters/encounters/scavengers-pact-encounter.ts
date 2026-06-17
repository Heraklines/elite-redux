/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #523 - The Scavenger's Pact. A WASTELAND character-test event (design PART
// XVII / transcript line 124214, maintainer-approved "good character test"). You
// and another scavenger have eyed the same big find at the same moment:
//
//   SPLIT IT (righteous): shake on a fair share. No fight, a moderate cut of the
//     find. Safe and smaller.
//   TAKE IT ALL (greedy): betray the pact and fight them for the lot. Win -> the
//     whole hoard (a bigger, Rogue-tier haul). The character-test fork the
//     maintainer flagged for the future Notoriety / Team Echo arc.
//   WALK AWAY: leave the find to the other scavenger, no cost.
//
// NOTE: the design's "split = team up in an ALLY battle" needs a partner-trainer
// engine that isn't built yet (the same one Lost Wanderer v1 is waiting on), so
// SPLIT ships here as a peaceful share - faithful to the safe-but-smaller half of
// the character test. The ally-battle flavour can be layered on once that engine
// lands. The Notoriety flag on betrayal is likewise parked as future scope.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/scavengersPact";

/** The rival scavenger's wasteland pack - drifter scavengers of the wastes. */
const RIVAL_SPECIES: SpeciesId[] = [SpeciesId.KROOKODILE, SpeciesId.MIGHTYENA, SpeciesId.FLYGON];

/** Level the rival is pinned to: the player's strongest party member / wave. */
function rivalLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build the betrayal fight: the rival scavenger as a ROUGHNECK trainer + their pack. */
function buildRivalBattle(): EnemyPartyConfig {
  const level = rivalLevel();
  const pokemonConfigs = RIVAL_SPECIES.map(s => ({ species: getPokemonSpecies(s), isBoss: false, level }));
  const trainerConfig = trainerConfigs[TrainerType.ROUGHNECK]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(pokemonConfigs.length, PartyMemberStrength.STRONGER));
  return { trainerConfig, pokemonConfigs };
}

export const ScavengersPactEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_SCAVENGERS_PACT,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The rival's wasteland pack lead, eyeing the same find (Krookodile).
    { species: SpeciesId.KROOKODILE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
      // Split it: a fair share, no fight, a moderate cut.
      setEncounterRewards({
        guaranteedModifierTiers: [ModifierTier.ULTRA, ModifierTier.GREAT],
        fillRemaining: false,
      });
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
      // Take it all: betray the pact and fight them for the whole hoard.
      setEncounterRewards({
        guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ULTRA],
        fillRemaining: false,
      });
      await transitionMysteryEncounterIntroVisuals(true, false);
      await initBattleWithEnemyConfig(buildRivalBattle());
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Walk away: leave the find to the other scavenger, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
