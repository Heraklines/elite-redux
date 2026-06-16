/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Totem Trial. A TEMPLE-biome guardian-boss trial (design PART XVII
// s63 / s78). An aura-wreathed stone totem awakens to test you: best it in a real
// boss fight (a multi-bar guardian, several levels above your strongest mon) and
// claim a guaranteed high-tier reward plus a blessing Relic. Decline and leave the
// totem at rest, no cost.
//
// Combat-ending option (not press-your-luck): rewards are set before the fight, so
// the standard MysteryEncounterRewardsPhase pays out on victory; a party wipe ends
// the run as any battle would.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/totemTrial";

/** The totem boss is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;

/** Thematic guardian-totem species (Ground / Rock / Ghost golems fit a temple). */
const TOTEM_SPECIES: SpeciesId[] = [SpeciesId.GOLURK, SpeciesId.REGIROCK, SpeciesId.RUNERIGUS];

/** The blessing pool - a Relic awarded on top of the high-tier picks for winning. */
const TRIAL_RELIC_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_MORALE_BANNER,
  modifierTypes.ER_RELIC_ANCHOR,
  modifierTypes.ER_RELIC_SECOND_WIND,
];

/** Enemy level for the totem: the player's strongest mon plus a margin. */
function totemLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl)) + BOSS_LEVELS_ABOVE;
}

/** Build the multi-bar totem guardian boss. */
function buildTotemBattle(): EnemyPartyConfig {
  const species = getPokemonSpecies(randSeedItem(TOTEM_SPECIES));
  return {
    pokemonConfigs: [{ species, isBoss: true, bossSegments: 2 + randSeedInt(2), level: totemLevel() }],
  };
}

export const TotemTrialEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_TOTEM_TRIAL,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Placeholder art (reuses an already-served key). Swap to a dedicated totem
    // sprite once one is uploaded to er-assets.
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Face the totem - win the boss fight for a guaranteed high-tier reward + Relic.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        setEncounterRewards({
          guaranteedModifierTypeFuncs: [randSeedItem(TRIAL_RELIC_FUNCS)],
          guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
          fillRemaining: false,
        });
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildTotemBattle());
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
      // Leave the totem at rest - no fight, no reward, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
