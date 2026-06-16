/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Still Waters (the Mirror Pool's home). A LAKE-biome mirror-match
// (design PART XIII s47.1). A perfectly still lake reflects your team; the
// reflection steps out - a clone of your CURRENT squad (same species, level,
// ability, form, moves) - and you must beat yourself. Win for a Rogue-tier reward.
//
// Built on initBattleWithEnemyConfig: the enemy party is mirrored from
// globalScene.getPlayerParty() at the moment you accept. Held items are NOT copied
// (the reflection fights with the same builds, not your bag); a fuller "uses your
// own items" mirror is a later refinement.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";

const namespace = "mysteryEncounters/stillWaters";

/** Build a mirror of the player's current party as the enemy party config. */
function buildMirrorBattle(): EnemyPartyConfig {
  const configs: EnemyPokemonConfig[] = globalScene.getPlayerParty().map(mon => {
    const moveSet = mon.moveset.filter(m => m != null).map(m => m.moveId);
    return {
      species: mon.species,
      isBoss: false,
      level: mon.level,
      formIndex: mon.formIndex,
      abilityIndex: mon.abilityIndex,
      nature: mon.nature,
      gender: mon.gender,
      shiny: mon.shiny,
      variant: mon.variant,
      moveSet,
    };
  });
  return { pokemonConfigs: configs, disableSwitch: false };
}

export const StillWatersEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_STILL_WATERS,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
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
        // Mirror the current squad and fight it; win pays a Rogue-tier reward.
        setEncounterRewards({
          guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
          fillRemaining: false,
        });
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildMirrorBattle());
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
      // Step away from the water - no battle, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
