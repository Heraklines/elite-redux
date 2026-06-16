/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 / #487 - The Picnic. A MEADOW-biome social REST event (design PART XII
// s42). You CHOOSE how big a spread to lay out - spending Berries as the food -
// and the whole party shares it: every member gains CANDY (for its species) and
// AFFECTION, scaled to the spread's size. The bigger the feast, the more you get.
//
// Three spread sizes (Light / Hearty / Feast) cost 1 / 3 / 5 Berries and are
// gated on holding that many (greyed out otherwise), spending them like the Hot
// Spring's berry toll. Or move on for free.
//
// NOTE: the design's "a generous feast tempts a rare/ultra biome-native Pokemon
// to wander up and JOIN you (dex-registered), chance scaling with the spread" is
// the planned next refinement - it needs the biome-native wander pool + the
// join/dex-register flow; this pass delivers the choose-your-spread + scaled
// Candy/affection core (the part that was missing).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { BerryModifier } from "#modifiers/modifier";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PersistentModifierRequirement } from "#mystery-encounters/mystery-encounter-requirements";

const namespace = "mysteryEncounters/picnic";

/** A spread tier: how many Berries it costs and what each party member gains. */
interface SpreadTier {
  /** 1-indexed option slot (matches the locale option key). */
  option: number;
  /** Berries spent to lay this spread out. */
  berries: number;
  /** Candy added to each party member's species. */
  candy: number;
  /** Affection (friendship) added to each party member. */
  affection: number;
}

const SPREAD_TIERS: SpreadTier[] = [
  { option: 1, berries: 1, candy: 4, affection: 20 },
  { option: 2, berries: 3, candy: 7, affection: 35 },
  { option: 3, berries: 5, candy: 10, affection: 50 },
];

/** Spend `count` Berries from across the party, removing depleted stacks. */
function spendBerries(count: number): void {
  let remaining = count;
  const berries = globalScene.findModifiers(m => m instanceof BerryModifier) as BerryModifier[];
  for (const berry of berries) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, berry.getStackCount());
    berry.stackCount -= take;
    remaining -= take;
    if (berry.getStackCount() <= 0) {
      globalScene.removeModifier(berry);
    }
  }
  globalScene.updateModifiers(true);
}

/** Lay out a spread of the given tier: spend its Berries, then feed the party. */
function shareSpread(tier: SpreadTier): void {
  spendBerries(tier.berries);
  for (const mon of globalScene.getPlayerParty()) {
    globalScene.gameData.addStarterCandy(mon.species.getRootSpeciesId(), tier.candy);
    mon.addFriendship(tier.affection);
  }
  globalScene.playSound("item_fanfare");
  queueEncounterMessage(`${namespace}:shared`);
}

/** Build a spread option: gated on holding enough Berries, greyed out otherwise. */
function spreadOption(tier: SpreadTier) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new PersistentModifierRequirement("BerryModifier", tier.berries))
    .withDialogue({
      buttonLabel: `${namespace}:option.${tier.option}.label`,
      buttonTooltip: `${namespace}:option.${tier.option}.tooltip`,
      selected: [{ text: `${namespace}:option.${tier.option}.selected` }],
    })
    .withOptionPhase(async () => {
      shareSpread(tier);
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    })
    .build();
}

export const PicnicEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_PICNIC,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // Reuses the already-served berry-bush key (reads as a meadow spread). Swap to
    // a dedicated picnic sprite once one is uploaded to er-assets.
    { spriteKey: "berries_abound_bush", fileRoot: "mystery-encounters", hasShadow: false, x: 0, y: 6, yShadow: 6 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(spreadOption(SPREAD_TIERS[0]))
  .withOption(spreadOption(SPREAD_TIERS[1]))
  .withOption(spreadOption(SPREAD_TIERS[2]))
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.4.label`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      selected: [{ text: `${namespace}:option.4.selected` }],
    },
    async () => {
      // Move on without a picnic - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
