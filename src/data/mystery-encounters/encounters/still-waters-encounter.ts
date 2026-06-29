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
// globalScene.getPlayerParty() at the moment you accept, INCLUDING your held items
// (cloned onto the reflection per the design - so a smart player can exploit the
// mirror). Mystery-encounter battles are exempt from the #419 BST cap, so the
// clone keeps your real (possibly over-cap) team.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
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
import type { HeldModifierConfig } from "#types/held-modifier-config";
import i18next from "i18next";

const namespace = "mysteryEncounters/stillWaters";

/** Build a mirror of the player's current party as the enemy party config. */
function buildMirrorBattle(): EnemyPartyConfig {
  const configs: EnemyPokemonConfig[] = globalScene.getPlayerParty().map(mon => {
    const moveSet = mon.moveset.filter(m => m != null).map(m => m.moveId);
    // The reflection fights with YOUR OWN held items (design intent). CLONE each
    // held item - generateEnemyModifiers re-points the modifier's pokemonId to the
    // clone, so passing the live instance would strip it off the player's mon.
    // Non-transferable so the player can't Thief their own mirrored gear back.
    const modifierConfigs: HeldModifierConfig[] = mon.getHeldItems().map(item => ({
      modifier: item.clone() as PokemonHeldItemModifier,
      stackCount: item.getStackCount(),
      isTransferable: false,
    }));
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
      modifierConfigs,
    };
  });
  // Run as a TRAINER battle, not WILD. A WILD multi-mon config only fields enemy[0]
  // and the wild victory check ends the encounter the moment that one clone faints -
  // so only the FIRST party member was ever fought. A trainer config sends the WHOLE
  // mirrored team out one-by-one (the reflection of your full squad). The name reads
  // as the encounter's "Mirror" title; the team is the explicit pokemonConfigs.
  const trainerConfig = trainerConfigs[TrainerType.ACE_TRAINER].clone();
  trainerConfig.setName(i18next.t(`${namespace}:title`));
  return { trainerConfig, pokemonConfigs: configs, disableSwitch: false };
}

export const StillWatersEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_STILL_WATERS,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A serpentine beauty mirrored on the still surface (Milotic).
    { species: SpeciesId.MILOTIC, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
