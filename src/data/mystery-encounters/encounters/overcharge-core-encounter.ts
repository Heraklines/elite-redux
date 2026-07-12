/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Overcharge the Core. A POWER_PLANT press-your-luck event (design
// PART XVI s59 / transcript line 124175). NOT a boss fight (that was the old
// built-wrong version). The overloaded reactor lets you channel its surplus into
// ONE of your Pokemon for a PERMANENT stat surge:
//
//   Choose a Pokemon, then SURGE it again and again. Each surge permanently
//   raises one of its stats (Sp. Atk OR Speed, fixed for the session) - the boost
//   is applied immediately as a permanent vitamin. But every surge raises the
//   chance the core SHORT-CIRCUITS: if it does, the whole session's surge is lost
//   and the Pokemon takes chip damage. STABILIZE (bank) at any point to keep what
//   you have channelled. (The natural ceiling is the vitamin stat cap, ~the
//   spec's "max ~20%".)
//
// Reuses the shared press-your-luck substrate (er-press-your-luck.ts). The "also
// recharge Power Herb / Ward Stones" half of the spec is a later extension.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { type PressYourLuckConfig, startPressYourLuck } from "#data/elite-redux/er-press-your-luck";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { BaseStatBoosterModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { isPokemonValidForEncounterOptionSelection } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/overchargeCore";

/** The stat a surge can permanently raise (one is rolled per session). */
const SURGE_STATS = [Stat.SPATK, Stat.SPD] as const;
const STAT_LABEL: Record<number, string> = {
  [Stat.SPATK]: "Special Attack",
  [Stat.SPD]: "Speed",
};

// Short-circuit chance climbs FAST: ~25% on the first surge, ~45% on the second,
// ~65% on the third, capping at 85% - so each surge is a real gamble (success
// ~75% / 55% / 35% / ...). Tuned per the maintainer's "decreases quickly" call.
/** Base short-circuit chance for the very first surge, in [0, 1]. */
const SHORT_CIRCUIT_BASE = 0.25;
/** Added to the short-circuit chance per surge already held. */
const SHORT_CIRCUIT_PER_LEVEL = 0.2;
/** The short-circuit chance never exceeds this (risky, but never hopeless). */
const SHORT_CIRCUIT_MAX = 0.85;

/** Per-session surge state stashed on encounter.misc. */
interface SurgeState {
  pokemon: PlayerPokemon;
  /** The stat each surge raises this session. */
  stat: number;
  /** The permanent vitamins granted this session (removed on a short-circuit). */
  granted: ReturnType<BaseStatBoosterModifierType["newModifier"]>[];
}

function getSurge(): SurgeState {
  return globalScene.currentBattle.mysteryEncounter!.misc as SurgeState;
}

/** The press-your-luck config the core hands to the shared substrate. */
function surgeConfig(): PressYourLuckConfig {
  return {
    promptKey: `${namespace}:surgePrompt`,
    pushLabelKey: `${namespace}:surge.push.label`,
    pushTooltipKey: `${namespace}:surge.push.tooltip`,
    bankLabelKey: `${namespace}:surge.bank.label`,
    bankTooltipKey: `${namespace}:surge.bank.tooltip`,
    bustChance: level => Math.min(SHORT_CIRCUIT_BASE + level * SHORT_CIRCUIT_PER_LEVEL, SHORT_CIRCUIT_MAX),
    onPush: async () => {
      const surge = getSurge();
      // Grant one permanent vitamin of the session's stat to the channelled mon.
      // The vitamin's own stat cap naturally enforces the spec's "~20% max".
      const vitaminType = new BaseStatBoosterModifierType(surge.stat);
      vitaminType.id = "BASE_STAT_BOOSTER";
      const mod = vitaminType.newModifier(surge.pokemon);
      if (mod) {
        globalScene.addModifier(mod);
        surge.granted.push(mod);
      }
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      encounter.setDialogueToken("surges", String(surge.granted.length));
      queueEncounterMessage(`${namespace}:surged`);
    },
    onBank: async levelsCompleted => {
      await transitionMysteryEncounterIntroVisuals(true, true);
      if (levelsCompleted > 0) {
        queueEncounterMessage(`${namespace}:stabilized`);
      }
      leaveEncounterWithoutBattle(true);
    },
    onBust: async () => {
      const surge = getSurge();
      // Short-circuit: the whole session's surge is lost. The backlash SCALES with
      // how many surges were riding on it - the more you greedily stacked, the
      // worse the jolt. 0 held -> 20%, 1 -> 40%, 2 -> 80%, 3+ -> the mon FAINTS.
      const held = surge.granted.length;
      for (const mod of surge.granted) {
        if (mod) {
          globalScene.removeModifier(mod);
        }
      }
      surge.granted = [];
      const mon = surge.pokemon;
      globalScene.playSound("se/error");
      if (held >= 3) {
        mon.hp = 0;
        mon.doSetStatus(StatusEffect.FAINT);
      } else {
        const fraction = held >= 2 ? 0.8 : held >= 1 ? 0.4 : 0.2;
        mon.hp = Math.max(1, mon.hp - Math.floor(mon.getMaxHp() * fraction));
      }
      mon.updateInfo();
      queueEncounterMessage(held >= 3 ? `${namespace}:shortCircuitFaint` : `${namespace}:shortCircuit`);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
    },
  };
}

export const OverchargeCoreEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_OVERCHARGE_CORE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The reactor's surplus energy made manifest (Rotom, the spirit in the machine).
    { species: SpeciesId.ROTOM, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
      .withPreOptionPhase(async () => {
        // Choose which Pokemon will channel the core's surplus.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          const stat = randSeedItem([...SURGE_STATS]);
          encounter.misc = { pokemon, stat, granted: [] } satisfies SurgeState;
          encounter.setDialogueToken("statName", STAT_LABEL[stat]);
          // Seed the surge counter so the FIRST prompt reads "0 surge(s) held"
          // instead of the literal {{surges}} token (it is otherwise only set
          // after a surge lands).
          encounter.setDialogueToken("surges", "0");
        };
        const selectableFilter = (pokemon: Pokemon) =>
          isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        // Channel: run the press-your-luck surge loop on the chosen Pokemon.
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        encounter.continuousEncounter = true;
        await transitionMysteryEncounterIntroVisuals(true, false);
        await startPressYourLuck(surgeConfig());
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
