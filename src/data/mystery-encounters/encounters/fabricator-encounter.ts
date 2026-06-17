/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #525 - The Fabricator. A FACTORY crafting event, the rework of the old
// Salvage Yard (transcript line 124214). The reclamation works can turn your
// spare gear into something better - two machines:
//
//   THE SMELTER: pour a held item (its WHOLE stack) into the crucible. The more
//     you pour and the finer it is, the higher the rarity of the bar you get out
//     - the maintainer's "pull a bunch of items together for a higher-rarity
//     item, weighted by value." Always succeeds (no crack); the value just sets
//     the output tier.
//   THE FABRICATOR: feed one held item into the assembler to stamp out a
//     production RELIC (a Scrap Magnet / Quartermaster / Collector's Album - gear
//     that keeps paying out over the run).
//   WALK AWAY: salvage nothing.
//
// New mechanic: value-weighted item smelting (output tier scales with the fed
// item's rarity AND stack size). Built on the Delibirdy held-item picker; no
// engine changes.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { getEncounterText, queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/fabricator";

/** Production relics the Fabricator can stamp out (gear that keeps paying out). */
const FABRICATOR_RELICS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_SCRAP_MAGNET,
  modifierTypes.ER_RELIC_QUARTERMASTER,
  modifierTypes.ER_RELIC_COLLECTORS_ALBUM,
];

interface FabMisc {
  chosenModifier?: PokemonHeldItemModifier;
}

function getMisc(): FabMisc {
  return globalScene.currentBattle.mysteryEncounter!.misc as FabMisc;
}

/** The held-item picker (preOptionPhase): choose the item to feed a machine. */
function feedPicker(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    const validItems = pokemon.getHeldItems().filter(it => it.isTransferable);
    return validItems.map((modifier: PokemonHeldItemModifier): OptionSelectItem => {
      return {
        label: modifier.type.name,
        handler: () => {
          encounter.setDialogueToken("chosenItem", modifier.type.name);
          getMisc().chosenModifier = modifier;
          return true;
        },
      };
    });
  };
  const selectableFilter = (pokemon: Pokemon) => {
    return pokemon.getHeldItems().some(it => it.isTransferable)
      ? null
      : (getEncounterText(`${namespace}:invalidSelection`) ?? null);
  };
  return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
}

/** Smelt: pour the WHOLE fed stack; output tier scales with rarity + quantity. */
async function smelt(): Promise<void> {
  const modifier = getMisc().chosenModifier;
  if (!modifier) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const fedTier = modifier.type.tier ?? ModifierTier.COMMON;
  const stack = modifier.stackCount;
  // The more you pour (and the finer it is), the higher the rarity of the bar.
  const quantityBonus = Math.min(2, Math.floor(stack / 2));
  const out = Math.max(ModifierTier.GREAT, Math.min(fedTier + 1 + quantityBonus, ModifierTier.ROGUE)) as ModifierTier;
  // Pour the entire stack into the crucible.
  globalScene.removeModifier(modifier);
  await globalScene.updateModifiers(true);
  await transitionMysteryEncounterIntroVisuals(true, false);
  queueEncounterMessage(`${namespace}:smelted`);
  setEncounterRewards({ guaranteedModifierTiers: [out], fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

/** Fabricate: consume one fed item, stamp out a random production relic. */
async function fabricate(): Promise<void> {
  const modifier = getMisc().chosenModifier;
  if (!modifier) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  if (modifier.stackCount > 1) {
    modifier.stackCount--;
  } else {
    globalScene.removeModifier(modifier);
  }
  await globalScene.updateModifiers(true);
  await transitionMysteryEncounterIntroVisuals(true, false);
  queueEncounterMessage(`${namespace}:fabricated`);
  setEncounterRewards({ guaranteedModifierTypeFuncs: [randSeedItem(FABRICATOR_RELICS)], fillRemaining: false });
  leaveEncounterWithoutBattle(false);
}

export const FabricatorEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FABRICATOR,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The works' tireless machine (Klinklang), gears spinning.
    { species: SpeciesId.KLINKLANG, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
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
      .withPreOptionPhase(feedPicker)
      .withOptionPhase(async () => {
        await smelt();
        return true;
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        secondOptionPrompt: `${namespace}:option.2.selectPrompt`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withPreOptionPhase(feedPicker)
      .withOptionPhase(async () => {
        await fabricate();
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Walk away - salvage nothing, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
