/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #513 - The Great Forge. A VOLCANO crafting event (design PART XV s58 /
// transcript line 124181). Feed a held item into the lava forge and stoke the
// heat to temper it into something better - but the hotter you push, the more
// likely it cracks:
//
//   TEMPER GENTLY: a modest upgrade (+1 rarity tier), low crack risk.
//   STOKE WHITE-HOT: a big upgrade (+2 tiers), high crack risk.
// Either way the crack chance ALSO climbs with the fed item's rarity (the finer
// the metal, the touchier the temper - maintainer ruling 124181), and feeding a
// Master-tier item upgrades it to a RELIC. If it cracks you lose the item and
// keep only the slag (a little scrap money).
//   WALK AWAY: leave the forge cold.
//
// New mechanic: item-fed crafting (consume a held item -> a higher-tier output,
// with rarity-scaled failure). Built on the Delibirdy two-step held-item picker;
// no engine changes.
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
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { randSeedInt, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/greatForge";

/** Relics a Master-tier feed can be forged into (the "master -> relic" upgrade). */
const FORGE_RELICS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_MORALE_BANNER,
  modifierTypes.ER_RELIC_SECOND_WIND,
  modifierTypes.ER_RELIC_ANCHOR,
  modifierTypes.ER_RELIC_WEATHERVANE,
];

interface Heat {
  /** Rarity tiers added to the fed item's tier on a successful temper. */
  bump: number;
  /** Base crack chance before the fed-rarity scaling. */
  base: number;
  /** Crack chance added per tier of the fed item's rarity. */
  scale: number;
}

const GENTLE: Heat = { bump: 1, base: 0.1, scale: 0.06 };
const WHITE_HOT: Heat = { bump: 2, base: 0.3, scale: 0.08 };

interface ForgeMisc {
  chosenModifier?: PokemonHeldItemModifier;
}

function getMisc(): ForgeMisc {
  return globalScene.currentBattle.mysteryEncounter!.misc as ForgeMisc;
}

/** The held-item picker (preOptionPhase): choose the item to feed the forge. */
function feedPicker(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    const validItems = pokemon.getHeldItems().filter(it => it.isTransferable);
    return validItems.map((modifier: PokemonHeldItemModifier): OptionSelectItem => {
      return {
        label: modifier.type.name,
        handler: () => {
          encounter.setDialogueToken("chosenItem", modifier.type.name);
          // Assign a fresh misc object - encounter.misc resets to null, so
          // mutating getMisc() in place would throw and the click would no-op.
          encounter.misc = { chosenModifier: modifier };
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

/** Temper the fed item at the given heat: consume it, then upgrade-or-crack. */
async function temper(heat: Heat): Promise<void> {
  const modifier = getMisc().chosenModifier;
  if (!modifier) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const fedTier = modifier.type.tier ?? ModifierTier.COMMON;
  // Consume one of the fed item (the metal goes into the forge).
  if (modifier.stackCount > 1) {
    modifier.stackCount--;
  } else {
    globalScene.removeModifier(modifier);
  }
  await globalScene.updateModifiers(true);
  await transitionMysteryEncounterIntroVisuals(true, false);

  const crackChance = Math.min(0.7, heat.base + fedTier * heat.scale);
  if (randSeedInt(100) < Math.round(crackChance * 100)) {
    // Cracked: the item is lost; keep only the slag (a little scrap money).
    updatePlayerMoney(Math.max(1, Math.floor(globalScene.getWaveMoneyAmount(1))), true, false);
    globalScene.playSound("se/error");
    queueEncounterMessage(`${namespace}:cracked`);
    leaveEncounterWithoutBattle(true);
    return;
  }
  // Tempered: a Master-tier feed becomes a relic; otherwise upgrade the rarity.
  queueEncounterMessage(`${namespace}:tempered`);
  if (fedTier >= ModifierTier.MASTER) {
    setEncounterRewards({ guaranteedModifierTypeFuncs: [randSeedItem(FORGE_RELICS)], fillRemaining: false });
  } else {
    const out = Math.min(fedTier + heat.bump, ModifierTier.ROGUE) as ModifierTier;
    setEncounterRewards({ guaranteedModifierTiers: [out], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false);
}

function forgeOption(n: number, heat: Heat) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${n}.label`,
      buttonTooltip: `${namespace}:option.${n}.tooltip`,
      secondOptionPrompt: `${namespace}:option.${n}.selectPrompt`,
      selected: [{ text: `${namespace}:option.${n}.selected` }],
    })
    .withPreOptionPhase(feedPicker)
    .withOptionPhase(async () => {
      await temper(heat);
      return true;
    })
    .build();
}

export const GreatForgeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GREAT_FORGE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The forge's living bellows (Magmortar), tending the lava.
    { species: SpeciesId.MAGMORTAR, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(forgeOption(1, GENTLE))
  .withOption(forgeOption(2, WHITE_HOT))
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Leave the forge cold - no item fed, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
