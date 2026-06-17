/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #525 - The Fabricator. A FACTORY crafting event, the rework of the old
// Salvage Yard (transcript line 124214). Feed it as many held items as you like
// and the works value the haul (rarity x quantity), then pay out by total value.
//
// Scrap value per item (x its stack): COMMON 3 / GREAT 6 / ULTRA 12 / ROGUE 24 /
// MASTER 48. So ONE item of a tier is worth exactly that tier's output threshold:
//   value >= 48 -> MASTER item     value >= 24 -> ROGUE item
//   value >= 12 -> ULTRA item      else        -> GREAT item
//   value >= 100 -> a production RELIC (about two Master items' worth, plus a bit)
//
//   THE SMELTER: melts the haul into 1-3 ITEMS at that tier (more for bigger hauls),
//     or a RELIC once the haul is worth >= 100.
//   THE FABRICATOR: forges the haul into a RELIC at value >= 100; below that it
//     stamps out a single item at the value's tier (no free relics).
//   WALK AWAY: salvage nothing.
//
// Feeding loops: pick an item, then pick another, until you choose "Stop feeding"
// (up to 6). Whole stacks are fed; value sums across everything.
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

/** Most items a single visit can feed (keeps the picker loop bounded). */
const MAX_FEED = 6;

/** Haul value needed to forge a RELIC (about two Master-tier items' worth, plus a bit). */
const RELIC_VALUE_THRESHOLD = 100;

/** Scrap value of one item of a given tier (multiplied by its stack count). */
function tierScrapValue(tier: ModifierTier): number {
  switch (tier) {
    case ModifierTier.MASTER:
      return 48;
    case ModifierTier.ROGUE:
      return 24;
    case ModifierTier.ULTRA:
      return 12;
    case ModifierTier.GREAT:
      return 6;
    default:
      return 3; // COMMON / unknown
  }
}

interface FabMisc {
  fed: PokemonHeldItemModifier[];
}

function getFed(): PokemonHeldItemModifier[] {
  return (globalScene.currentBattle.mysteryEncounter!.misc as FabMisc | null)?.fed ?? [];
}

/**
 * A held item's rarity tier. Items already sitting on a mon usually have an UNSET
 * `.type.tier`, so we infer it from the modifier pool by id - otherwise a Soul Dew
 * or a Rogue-tier item would read as COMMON and the output would be junk.
 */
function itemTier(m: PokemonHeldItemModifier): ModifierTier {
  return m.type.getOrInferTier() ?? ModifierTier.COMMON;
}

/** Total scrap value of the fed haul = sum of rarity-weight x stack over each item. */
function haulValue(fed: PokemonHeldItemModifier[]): number {
  return fed.reduce((sum, m) => sum + tierScrapValue(itemTier(m)) * m.stackCount, 0);
}

/** Output ITEM tier for a given haul value (relic is handled separately at >= 100). */
function outputTier(value: number): ModifierTier {
  if (value >= 48) {
    return ModifierTier.MASTER;
  }
  if (value >= 24) {
    return ModifierTier.ROGUE;
  }
  if (value >= 12) {
    return ModifierTier.ULTRA;
  }
  return ModifierTier.GREAT; // floor: even a tiny haul never outputs trash
}

/** Grant one random production relic as the encounter reward. */
function rewardRelic(): void {
  queueEncounterMessage(`${namespace}:fabricated`);
  setEncounterRewards({ guaranteedModifierTypeFuncs: [randSeedItem(FABRICATOR_RELICS)], fillRemaining: false });
}

/**
 * The held-item picker (preOptionPhase): feed AS MANY items as you like. Each round
 * you pick a mon then one of its (not-yet-fed) transferable items, or choose
 * "Stop feeding". Whole stacks are fed; chosen items accumulate in misc.fed.
 */
async function feedPicker(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const fed: PokemonHeldItemModifier[] = [];
  encounter.misc = { fed } satisfies FabMisc;

  let feeding = true;
  while (feeding && fed.length < MAX_FEED) {
    let pickedThisRound = false;
    const onPokemonSelected = (pokemon: PlayerPokemon) => {
      const validItems = pokemon.getHeldItems().filter(it => it.isTransferable && !fed.includes(it));
      const opts: OptionSelectItem[] = validItems.map((modifier: PokemonHeldItemModifier) => ({
        label: modifier.type.name,
        handler: () => {
          fed.push(modifier);
          pickedThisRound = true;
          return true;
        },
      }));
      // A plain "stop feeding" entry so the player can finish with what they have.
      opts.push({
        label: "Stop feeding",
        handler: () => {
          feeding = false;
          return true;
        },
      });
      return opts;
    };
    const selectableFilter = (pokemon: Pokemon) =>
      pokemon.getHeldItems().some(it => it.isTransferable && !fed.includes(it))
        ? null
        : (getEncounterText(`${namespace}:invalidSelection`) ?? null);

    const proceeded = await selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
    // Cancelled the party select, or chose "Stop feeding" -> stop looping.
    if (!proceeded || !pickedThisRound) {
      feeding = false;
    }
  }

  encounter.setDialogueToken("fedCount", String(fed.length));
  // Only commit the option if at least one item was fed.
  return fed.length > 0;
}

/** Consume the whole fed haul (remove each fed item's full stack). */
async function consumeFed(fed: PokemonHeldItemModifier[]): Promise<void> {
  for (const modifier of fed) {
    globalScene.removeModifier(modifier);
  }
  await globalScene.updateModifiers(true);
}

/** Smelt: melt the haul into ITEMS (count + tier scale with value), or a RELIC at >= 100. */
async function smelt(): Promise<void> {
  const fed = getFed();
  if (fed.length === 0) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const value = haulValue(fed);
  await consumeFed(fed);
  if (value >= RELIC_VALUE_THRESHOLD) {
    rewardRelic();
  } else {
    const tier = outputTier(value);
    const count = Math.min(3, 1 + Math.floor(value / 48));
    queueEncounterMessage(`${namespace}:smelted`);
    setEncounterRewards({
      guaranteedModifierTiers: Array.from({ length: count }, () => tier),
      fillRemaining: false,
    });
  }
  leaveEncounterWithoutBattle(false);
}

/** Fabricate: forge a RELIC at value >= 100; below that, a single item at the value's tier. */
async function fabricate(): Promise<void> {
  const fed = getFed();
  if (fed.length === 0) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const value = haulValue(fed);
  await consumeFed(fed);
  if (value >= RELIC_VALUE_THRESHOLD) {
    rewardRelic();
  } else {
    // Not enough scrap for a relic - the assembler stamps out a normal item by value.
    queueEncounterMessage(`${namespace}:smelted`);
    setEncounterRewards({ guaranteedModifierTiers: [outputTier(value)], fillRemaining: false });
  }
  leaveEncounterWithoutBattle(false);
}

export const FabricatorEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FABRICATOR,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // Default auto-hide: the framework hides the intro sprite on option select, so
  // no manual transitionMysteryEncounterIntroVisuals is needed (a manual await
  // there could hang and skip the reward - see #518).
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
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
