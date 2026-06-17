/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #514 - The Innate Shrine. A TEMPLE trial event (design line 9412 / task
// #514: "unlock locked innate, trial boss"). A shrine guarded by an aura totem
// can awaken a Pokemon's dormant innate slots - but only for one who proves
// worthy:
//
//   TAKE THE TRIAL: choose a party mon to attune, then face the shrine's guardian
//     (a multi-bar, aura-boosted boss). Win, and ALL of that mon's ER innate slots
//     are unlocked for the rest of the run (no candy purchase needed) - the
//     maintainer's "extra innate slot" boon, pure ER innate system.
//   LEAVE: do not disturb the shrine, no fight.
//
// New mechanic: a run-scoped per-Pokemon innate unlock (CustomPokemonData
// .erInnateShrineUnlocked, read in Pokemon.canApplyAbility). The trial reuses the
// boss enemy config + omni-boost-on-entry + the doContinueEncounter post-win hook.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { getEncounterText, queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { isSlotUnlocked, unlockSlot } from "#utils/passive-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/innateShrine";

const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

interface ShrineMisc {
  /** Id of the party mon chosen to attune. */
  blessId: number;
}

/** True if the mon has at least one ER innate ability worth unlocking. */
function hasUnlockableInnate(p: Pokemon): boolean {
  return p.getPassiveAbilities().some(a => !!a && a.id !== AbilityId.NONE);
}

/** Enemy level the shrine guardian is pinned to: matched to the strongest party member / wave. */
function guardianLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  // No level bonus: you face the trial with ONE attuned mon, so a +5 boss was too
  // steep. Same level, two bars keeps it a real fight without being unwinnable.
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build the shrine guardian: an aura totem (two-bar, omni-boosts on entry). */
function buildGuardian(): EnemyPartyConfig {
  return {
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.BRONZONG),
        isBoss: true,
        bossSegments: 2,
        level: guardianLevel(),
        tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
        mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
          globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, ALL_STATS, 1);
        },
      },
    ],
  };
}

/**
 * Attune the chosen mon: unlock ALL its ER innate slots for the REST OF THE RUN,
 * and PERMANENTLY unlock ONE still-locked innate slot for its species (persists
 * across runs in starterData, exactly like a candy unlock). The permanent unlock
 * targets the lowest slot that holds a real innate but is not yet unlocked.
 */
function attune(pokemon: Pokemon): void {
  pokemon.customPokemonData.erInnateShrineUnlocked = true;

  const rootId = pokemon.species.getRootSpeciesId();
  const starterData = globalScene.gameData.starterData[rootId];
  if (starterData) {
    const passives = pokemon.getPassiveAbilities();
    for (const slot of [0, 1, 2] as const) {
      const ability = passives[slot];
      if (ability && ability.id !== AbilityId.NONE && !isSlotUnlocked(starterData.passiveAttr, slot)) {
        // unlockSlot sets the slot's UNLOCKED + ENABLED bits; saveSystem persists it.
        starterData.passiveAttr = unlockSlot(starterData.passiveAttr, slot);
        void globalScene.gameData.saveSystem();
        break;
      }
    }
  }

  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("blessedName", pokemon.getNameToRender());
  queueEncounterMessage(`${namespace}:attuned`);
  leaveEncounterWithoutBattle(true);
}

export const InnateShrineEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_INNATE_SHRINE,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The shrine's aura totem (Bronzong), humming with dormant power.
    { species: SpeciesId.BRONZONG, spriteKey: "", fileRoot: "", hasShadow: true, tint: 0.25, repeat: true, y: 5 },
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
        secondOptionPrompt: `${namespace}:option.1.selectPrompt`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          encounter.misc = { blessId: pokemon.id } satisfies ShrineMisc;
        };
        const selectableFilter = (pokemon: Pokemon) => {
          return hasUnlockableInnate(pokemon) ? null : (getEncounterText(`${namespace}:invalidSelection`) ?? null);
        };
        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        // Face the guardian; on a win the chosen mon's innates awaken.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.doContinueEncounter = async () => {
          encounter.doContinueEncounter = undefined;
          const id = (encounter.misc as ShrineMisc).blessId;
          const mon = globalScene.getPlayerParty().find(p => p.id === id);
          if (mon) {
            attune(mon);
          } else {
            leaveEncounterWithoutBattle(true);
          }
        };
        await transitionMysteryEncounterIntroVisuals(true, false);
        await initBattleWithEnemyConfig(buildGuardian());
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
      // Leave the shrine undisturbed - no trial, no boon.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
