/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #516 - High Noon. A BADLANDS single-strike duel (design PART XIV s49.2 /
// transcript line 124137). A gunslinger calls you out: no battle, just one draw.
// Both ante money, you pick a Pokemon, and whoever's faster strikes first and
// wins. Pick your FASTEST mon to beat the outlaw's draw. It is a pure test of
// speed knowledge - win the pot, or lose your ante.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import { isPokemonValidForEncounterOptionSelection } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/highNoon";

/**
 * The gunslinger's speed-duel prize: one speed-flavored tactical item. These are
 * the reactive Speed items that were pulled OUT of the post-battle reward pool
 * (er-item-tuning), so the duel is a thematic home for them. Lazy (resolved at
 * option time) - modifierTypes is populated at game init, not module load.
 */
function highNoonPrizeFuncs(): ModifierTypeFunc[] {
  return [modifierTypes.ER_ADRENALINE_ORB, modifierTypes.ER_BLUNDER_POLICY, modifierTypes.ER_FLOAT_STONE];
}

/** The outlaw draws as fast as a roughly base-85-Speed Pokemon at this wave's level. */
const OUTLAW_BASE_SPD = 85;

interface DuelState {
  /** The outlaw's draw speed: the bar your chosen mon must match or beat. */
  outlawSpeed: number;
  /** The money each side antes. */
  ante: number;
}

function getDuel(): DuelState {
  return globalScene.currentBattle.mysteryEncounter!.misc as DuelState;
}

export const HighNoonEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_HIGH_NOON,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A badlands outlaw squaring off (Krookodile).
    { species: SpeciesId.KROOKODILE, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([
    { text: `${namespace}:intro` },
    { speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` },
  ])
  .withOnInit(() => {
    // The outlaw's draw is a standalone, wave-scaled speed (the Speed a roughly
    // base-85 mon would have at this wave's level). It does NOT depend on your team
    // - only the single mon you pick is compared against it. Ante tracks the wave.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const level = Math.max(1, Math.round(globalScene.currentBattle?.getLevelForWave?.() ?? 1));
    const outlawSpeed = Math.floor(((2 * OUTLAW_BASE_SPD + 20) * level) / 100) + 5;
    // High stakes: you ante HALF your money (so winning ~1.5x's it, losing halves
    // it). The outlaw's draw speed is hidden - the player has to KNOW their fastest.
    const ante = Math.max(10, Math.floor(globalScene.money * 0.5));
    encounter.misc = { outlawSpeed, ante } satisfies DuelState;
    encounter.setDialogueToken("ante", String(ante));
    return true;
  })
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
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          encounter.misc = { ...getDuel(), duelist: pokemon };
        };
        const selectableFilter = (pokemon: Pokemon) =>
          isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const { outlawSpeed, ante, duelist } = encounter.misc as DuelState & { duelist: PlayerPokemon };
        await transitionMysteryEncounterIntroVisuals(true, true);
        // Both ante; the faster mon strikes first. You stake half your money; win
        // and you take the outlaw's matching stake too (net +ante -> ~1.5x money).
        updatePlayerMoney(-ante, true, false);
        if (duelist.getStat(Stat.SPD) >= outlawSpeed) {
          updatePlayerMoney(ante * 2, true, false); // net +ante (your stake back + the pot)
          // The fastest draw also claims a speed-flavored tactical prize.
          setEncounterRewards({
            guaranteedModifierTypeFuncs: [randSeedItem(highNoonPrizeFuncs())],
            fillRemaining: false,
          });
          queueEncounterMessage(`${namespace}:win`);
        } else {
          queueEncounterMessage(`${namespace}:lose`);
        }
        leaveEncounterWithoutBattle(true);
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
