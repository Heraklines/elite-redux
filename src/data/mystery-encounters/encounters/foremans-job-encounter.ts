/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Foreman's Job. A CONSTRUCTION_SITE-biome guardian-boss trial
// (design PART XVI s112). A heavy-machine construction golem has gone haywire on
// the site; the foreman offers good pay to anyone who can shut it down. Best it in
// a real boss fight (a multi-bar threat, several levels above your strongest mon)
// for a guaranteed high-tier reward plus a Relic. Or clock out and leave.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { applyErGuardianTokens } from "#data/elite-redux/er-fight-tokens";
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

const namespace = "mysteryEncounters/foremansJob";

/** The guardian is at least this many levels above the player's strongest mon. */
const BOSS_LEVELS_ABOVE = 5;

/** Thematic heavy-machine / construction guardians (Steel / Rock / Fighting). */
const GUARDIAN_SPECIES: SpeciesId[] = [SpeciesId.CONKELDURR, SpeciesId.BRONZONG, SpeciesId.COALOSSAL];

/**
 * The Relic awarded on top of the high-tier picks for winning. Resolved at CALL
 * time, not module load: `modifierTypes` is populated lazily at game init, after
 * this encounter module is imported, so a module-level capture froze in `undefined`
 * relic funcs that were silently dropped from the reward (#616).
 */
function trialRelicFuncs(): ModifierTypeFunc[] {
  return [
    modifierTypes.ER_RELIC_ANCHOR,
    modifierTypes.ER_RELIC_MORALE_BANNER,
    modifierTypes.ER_RELIC_SECOND_WIND,
    modifierTypes.ER_RELIC_MERCHANTS_SEAL,
  ];
}

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

/** Build the multi-bar construction guardian boss. */
function buildGuardianBattle(): EnemyPartyConfig {
  const species = getPokemonSpecies(randSeedItem(GUARDIAN_SPECIES));
  return {
    pokemonConfigs: [{ species, isBoss: true, bossSegments: 2 + randSeedInt(2), level: guardianLevel() }],
  };
}

export const ForemansJobEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FOREMANS_JOB,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The construction guardian itself, looming over the site (Conkeldurr).
    { species: SpeciesId.CONKELDURR, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
          guaranteedModifierTypeFuncs: [randSeedItem(trialRelicFuncs())],
          guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
          fillRemaining: false,
        });
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildGuardianBattle());
        // Boss-tier challenge tokens; cleared after the battle by doPostBattleCleanup.
        applyErGuardianTokens(3);
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
