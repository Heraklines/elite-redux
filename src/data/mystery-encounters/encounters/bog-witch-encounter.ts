/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #508 - The Bog Witch's Bargain. A SWAMP DEAL event (design PART XIV s? /
// transcript line 124137). The keeper of the mire offers to cleanse what the
// swamp does to you - but the bog's magic takes a price, and she is DEVIOUS: she
// tells you only to "leave an appropriate offering," never naming the rarity she
// expects. You have to READ how greedy she is and offer a held item AT OR ABOVE a
// HIDDEN rarity threshold:
//
//   LEAVE AN OFFERING: pick one of your held items. If its rarity meets her
//     hidden bar, she is pleased -> she purges your whole team's status and grants
//     a status-ward relic (Weathervane - your team ignores the biome's ambient
//     hazard, the swamp's bog-chip). If you lowball her, she curses you: the bog
//     rots your party's health (a curse-lite chip). Either way the offering is
//     gone - that is the gamble.
//   REFUSE: walk away from the mire, no offering, no boon, no curse.
//
// Built on the Delibirdy two-step held-item picker (selectPokemonForOption) - no
// new engine. (The fuller notoriety / Team Echo curse arc the maintainer sketched
// is parked as future scope; this ships the offering guessing-game core.)
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
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
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { randSeedInt } from "#utils/common";

const namespace = "mysteryEncounters/bogWitch";

/** Fraction of max HP the bog-rot curse chips from each party mon (never below 1). */
const BOG_CURSE_CHIP = 1 / 6;

interface BogMisc {
  /** The hidden minimum rarity the witch will accept (she never tells you). */
  requiredTier: ModifierTier;
  chosenModifier?: PokemonHeldItemModifier;
}

function getMisc(): BogMisc {
  return globalScene.currentBattle.mysteryEncounter!.misc as BogMisc;
}

export const BogWitchEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_BOG_WITCH,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The mire's keeper - reuses the witchy WEIRD_DREAM figure (no new asset).
    { spriteKey: "weird_dream_woman", fileRoot: "mystery-encounters", hasShadow: true, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([
    { text: `${namespace}:intro` },
    { speaker: `${namespace}:speaker`, text: `${namespace}:introDialogue` },
  ])
  .withOnInit(() => {
    // Roll the hidden rarity bar up front. She leans greedy: usually Great, often
    // Ultra, sometimes Rogue - and she never tells you which.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const roll = randSeedInt(100);
    const requiredTier = roll < 40 ? ModifierTier.GREAT : roll < 80 ? ModifierTier.ULTRA : ModifierTier.ROGUE;
    encounter.misc = { requiredTier } satisfies BogMisc;
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
        secondOptionPrompt: `${namespace}:option.1.selectPrompt`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          // Any transferable held item is a valid offering.
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
          const hasOffering = pokemon.getHeldItems().some(it => it.isTransferable);
          return hasOffering ? null : (getEncounterText(`${namespace}:invalidSelection`) ?? null);
        };
        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        const { requiredTier, chosenModifier } = getMisc();
        if (!chosenModifier) {
          // Shouldn't happen (selection is required), but never softlock.
          leaveEncounterWithoutBattle(true);
          return true;
        }
        const offeredTier = chosenModifier.type.tier ?? ModifierTier.COMMON;
        // Consume the offering (the price) - one stack of it.
        if (chosenModifier.stackCount > 1) {
          chosenModifier.stackCount--;
        } else {
          globalScene.removeModifier(chosenModifier);
        }
        await globalScene.updateModifiers(true);
        await transitionMysteryEncounterIntroVisuals(true, false);

        if (offeredTier >= requiredTier) {
          // Pleased: purge the whole team's status, and grant a status-ward relic.
          for (const p of globalScene.getPlayerParty()) {
            if (!p.isFainted()) {
              p.resetStatus(false);
              p.updateInfo();
            }
          }
          queueEncounterMessage(`${namespace}:blessed`);
          setEncounterRewards({
            guaranteedModifierTypeFuncs: [modifierTypes.ER_RELIC_WEATHERVANE],
            fillRemaining: false,
          });
          leaveEncounterWithoutBattle(false);
        } else {
          // Lowballed her: cursed. The bog rots your party's health.
          for (const p of globalScene.getPlayerParty()) {
            if (!p.isFainted()) {
              const chip = Math.max(1, Math.floor(p.getMaxHp() * BOG_CURSE_CHIP));
              p.hp = Math.max(1, p.hp - chip);
              p.updateInfo();
            }
          }
          globalScene.playSound("se/error");
          queueEncounterMessage(`${namespace}:cursed`);
          leaveEncounterWithoutBattle(true);
        }
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
      // Refuse the bargain - leave the mire, no offering, no boon, no curse.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
