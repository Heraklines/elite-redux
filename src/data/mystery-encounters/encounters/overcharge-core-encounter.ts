/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Overcharge the Core. A POWER_PLANT-biome guardian-boss trial (design
// PART XVI s59 / s119). The plant's core has overloaded and its Electric guardian
// surges to life. Best it in a real boss fight (a multi-bar threat, several levels
// above your strongest mon) to claim a high-tier reward plus a Relic. Or shut the
// breaker and walk away.
//
// Combat-ending option: rewards are set before the fight, so the standard
// MysteryEncounterRewardsPhase pays out on victory.
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

const namespace = "mysteryEncounters/overchargeCore";

/** The guardian is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;

/** Thematic overcharged Electric guardians. */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.ELECTRODE, SpeciesId.MAGNEZONE, SpeciesId.ROTOM];

/** The Relic awarded on top of the high-tier picks for winning. */
const TRIAL_RELIC_FUNCS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_TWIN_LINK,
  modifierTypes.ER_RELIC_SECOND_WIND,
  modifierTypes.ER_RELIC_MORALE_BANNER,
];

/** Enemy level for the guardian: the player's strongest mon plus a margin. */
function guardianLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl)) + BOSS_LEVELS_ABOVE;
}

/** Build the multi-bar overcharged guardian boss. */
function buildGuardianBattle(): EnemyPartyConfig {
  const species = getPokemonSpecies(randSeedItem(GUARDIAN_SPECIES));
  return {
    pokemonConfigs: [{ species, isBoss: true, bossSegments: 2 + randSeedInt(2), level: guardianLevel() }],
  };
}

export const OverchargeCoreEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_OVERCHARGE_CORE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    { spriteKey: "mysterious_chest_blue", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
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
        setEncounterRewards({
          guaranteedModifierTypeFuncs: [randSeedItem(TRIAL_RELIC_FUNCS)],
          guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
          fillRemaining: false,
        });
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildGuardianBattle());
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
