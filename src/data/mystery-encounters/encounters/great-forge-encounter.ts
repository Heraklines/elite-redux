/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #513 - The Great Forge. A VOLCANO crafting event (design PART XV s58 /
// transcript line 124181). Feed ONE held item into the lava forge and stoke the
// heat to temper it into a higher tier - but the higher you aim, the likelier it
// cracks:
//
//   TEMPER GENTLY: +1 rarity tier.
//   STOKE WHITE-HOT: +2 rarity tiers (a touch riskier than reaching the same tier
//     gently).
// A successful temper to above MASTER forges the item into a production RELIC. If
// it cracks you lose the item and keep only the slag (a little scrap money).
//   WALK AWAY: leave the forge cold.
//
// Success chance is set by the TARGET tier you are reaching for (rarer = riskier):
//   -> GREAT 90% | -> ULTRA 75% | -> ROGUE 55% | -> MASTER 40% | -> RELIC 30%
//   (white-hot's +2 jump shaves 5% off, so e.g. ROGUE all the way to a RELIC = 25%).
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
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { randSeedInt, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/greatForge";

/** Relics a successful above-MASTER temper can be forged into. */
const FORGE_RELICS: ModifierTypeFunc[] = [
  modifierTypes.ER_RELIC_MORALE_BANNER,
  modifierTypes.ER_RELIC_SECOND_WIND,
  modifierTypes.ER_RELIC_ANCHOR,
  modifierTypes.ER_RELIC_WEATHERVANE,
  modifierTypes.ER_RELIC_MOMENTUM_ENGINE,
];

/** Tempering above MASTER yields a RELIC (this is the "tier" just past MASTER). */
const RELIC_TARGET = ModifierTier.MASTER + 1;

interface ForgeMisc {
  chosenModifier?: PokemonHeldItemModifier;
}

function getMisc(): ForgeMisc {
  return (globalScene.currentBattle.mysteryEncounter!.misc as ForgeMisc | null) ?? {};
}

/**
 * Success chance (percent) of reaching `target`. Rarer targets are riskier; the
 * white-hot +2 jump shaves a little extra off (so ROGUE -> RELIC is below
 * MASTER -> RELIC). Mirrors the maintainer's tuning.
 */
function successPct(target: number, bigJump: boolean): number {
  let base: number;
  if (target >= RELIC_TARGET) {
    base = 30; // -> RELIC
  } else if (target >= ModifierTier.MASTER) {
    base = 40; // -> MASTER
  } else if (target >= ModifierTier.ROGUE) {
    base = 55; // -> ROGUE
  } else if (target >= ModifierTier.ULTRA) {
    base = 75; // -> ULTRA
  } else {
    base = 90; // -> GREAT
  }
  return bigJump ? base - 5 : base;
}

/** The held-item picker (preOptionPhase): choose the ONE item to feed the forge. */
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

/** Temper the fed item by `bump` tiers: consume one, then upgrade-or-crack. */
async function temper(bump: number): Promise<void> {
  const modifier = getMisc().chosenModifier;
  if (!modifier) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  // Resolve the real rarity (items on a mon often have an unset .type.tier, which
  // would read as COMMON and wrongly downgrade the output).
  const fedTier = modifier.type.getOrInferTier() ?? ModifierTier.COMMON;
  const target = fedTier + bump;

  // Consume one of the fed item (the metal goes into the forge).
  if (modifier.stackCount > 1) {
    modifier.stackCount--;
  } else {
    globalScene.removeModifier(modifier);
  }
  await globalScene.updateModifiers(true);

  if (randSeedInt(100) >= successPct(target, bump >= 2)) {
    // Cracked: the item is lost; keep only the slag (a little scrap money).
    updatePlayerMoney(Math.max(1, Math.floor(globalScene.getWaveMoneyAmount(1))), true, false);
    globalScene.playSound("se/error");
    queueEncounterMessage(`${namespace}:cracked`);
    leaveEncounterWithoutBattle(true);
    return;
  }

  // Tempered: above MASTER forges a relic; otherwise the item climbs to `target`.
  queueEncounterMessage(`${namespace}:tempered`);
  if (target >= RELIC_TARGET) {
    setEncounterRewards({ guaranteedModifierTypeFuncs: [randSeedItem(FORGE_RELICS)], fillRemaining: false });
  } else {
    const out = Math.max(ModifierTier.GREAT, Math.min(target, ModifierTier.MASTER)) as ModifierTier;
    setEncounterRewards({ guaranteedModifierTiers: [out], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false);
}

function forgeOption(n: number, bump: number) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${n}.label`,
      buttonTooltip: `${namespace}:option.${n}.tooltip`,
      secondOptionPrompt: `${namespace}:option.${n}.selectPrompt`,
      selected: [{ text: `${namespace}:option.${n}.selected` }],
    })
    .withPreOptionPhase(feedPicker)
    .withOptionPhase(async () => {
      await temper(bump);
      return true;
    })
    .build();
}

export const GreatForgeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GREAT_FORGE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // Default auto-hide: the framework hides the intro sprite on option select, so
  // no manual transitionMysteryEncounterIntroVisuals is needed (a manual await
  // there could hang and skip the reward - see #518).
  .withIntroSpriteConfigs([
    // The forge's living bellows (Magmortar), tending the lava.
    { species: SpeciesId.MAGMORTAR, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(forgeOption(1, 1))
  .withOption(forgeOption(2, 2))
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Leave the forge cold - no item fed, no cost.
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
