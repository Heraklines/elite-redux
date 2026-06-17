/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #525 - The Fabricator. A FACTORY crafting event, the rework of the old
// Salvage Yard (transcript line 124214). The reclamation works turn your spare
// gear into something better - feed it as many held items as you like and the
// machine values the haul (rarity x quantity), then pays out by total value:
//
//   THE SMELTER: melt the fed haul into ITEMS. The more (and finer) you pour, the
//     higher the rarity - and a big haul yields more than one. Always items, never
//     a relic.
//   THE FABRICATOR: forge the fed haul into a production RELIC (Scrap Magnet /
//     Quartermaster / Collector's Album) - BUT only if the haul is valuable enough.
//     A cheap haul just gets stamped into a normal item instead (no free relic).
//   WALK AWAY: salvage nothing.
//
// Feeding loops: pick an item, then pick another, until you choose "Done". Value
// is summed across everything fed (whole stacks), so it scales smoothly with how
// much and how rare your contribution is.
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

/** A fed item is worth this much "scrap value" per stack, weighted by rarity. */
function tierScrapValue(tier: ModifierTier): number {
  switch (tier) {
    case ModifierTier.MASTER:
      return 16;
    case ModifierTier.ROGUE:
      return 8;
    case ModifierTier.ULTRA:
      return 4;
    case ModifierTier.GREAT:
      return 2;
    default:
      return 1; // COMMON / unknown
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

/** The rarest tier among the fed items (GREAT floor - the works never spits out trash). */
function bestFedTier(fed: PokemonHeldItemModifier[]): ModifierTier {
  return fed.reduce<ModifierTier>((best, m) => Math.max(best, itemTier(m)) as ModifierTier, ModifierTier.GREAT);
}

/** Clamp a tier into the [GREAT, ROGUE] normal-item output band. */
function clampItemTier(tier: number): ModifierTier {
  return Math.max(ModifierTier.GREAT, Math.min(tier, ModifierTier.ROGUE)) as ModifierTier;
}

/** Haul value needed before the Fabricator will forge a RELIC (else a plain item). */
const RELIC_VALUE_THRESHOLD = 16;

/**
 * The held-item picker (preOptionPhase): feed AS MANY items as you like. Each round
 * you pick a mon then one of its (not-yet-fed) transferable items, or choose
 * "Done". Whole stacks are fed; chosen items accumulate in misc.fed.
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
      // A "stop feeding" entry so the player can finish with what they have.
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
    // Cancelled the party select, or chose "Done" -> stop looping.
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

/** Smelt: melt the haul into ITEMS - tier and count scale with total value. */
async function smelt(): Promise<void> {
  const fed = getFed();
  if (fed.length === 0) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const value = haulValue(fed);
  // Output starts at the rarest item fed, then a big haul bumps it up a tier or two.
  const bump = value >= 32 ? 2 : value >= 12 ? 1 : 0;
  const tier = clampItemTier(bestFedTier(fed) + bump);
  const count = Math.min(3, 1 + Math.floor(value / 16));
  await consumeFed(fed);
  queueEncounterMessage(`${namespace}:smelted`);
  setEncounterRewards({
    guaranteedModifierTiers: Array.from({ length: count }, () => tier),
    fillRemaining: false,
  });
  leaveEncounterWithoutBattle(false);
}

/** Fabricate: a valuable haul forges a RELIC; a cheap haul just gets a plain item. */
async function fabricate(): Promise<void> {
  const fed = getFed();
  if (fed.length === 0) {
    leaveEncounterWithoutBattle(true);
    return;
  }
  const value = haulValue(fed);
  await consumeFed(fed);
  if (value >= RELIC_VALUE_THRESHOLD) {
    queueEncounterMessage(`${namespace}:fabricated`);
    setEncounterRewards({ guaranteedModifierTypeFuncs: [randSeedItem(FABRICATOR_RELICS)], fillRemaining: false });
  } else {
    // Not enough scrap for a relic - the assembler stamps out a normal item that
    // reflects the rarest thing fed (so a Rogue item still yields a Rogue item).
    queueEncounterMessage(`${namespace}:smelted`);
    setEncounterRewards({ guaranteedModifierTiers: [clampItemTier(bestFedTier(fed))], fillRemaining: false });
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
