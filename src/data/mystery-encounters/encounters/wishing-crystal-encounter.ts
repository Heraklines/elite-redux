/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #521 - The Wishing Crystal. A FAIRY_CAVE blessing event (design PART XVII s62
// / transcript line 124193). A crystal hums with luck before you touch it: it
// ROLLS A TIER (the strength of the blessing), then you choose a CATEGORY -
// power, fortune, or protection. The magnitude scales with the rolled tier; a
// high roll throws in the matching fairy relic on top of the tiered gifts.
//
// (The maintainer's "high tier can make a mon permanently shiny" payoff is a
// later extension; this ships the tiered-gift + relic core.)
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import {
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";

const namespace = "mysteryEncounters/wishingCrystal";

type Blessing = "power" | "fortune" | "protection";

/** The fairy relic each blessing throws in on a high (Ultra+) roll. The "power"
 * blessing rolls one of a small pool (Morale Banner or the storm-summoning
 * Stormglass), the others a fixed relic. */
const POWER_RELICS: ModifierTypeFunc[] = [modifierTypes.ER_RELIC_MORALE_BANNER, modifierTypes.ER_RELIC_STORMGLASS];

/** Resolve the relic func a blessing grants (seeded for the power pool). */
function blessingRelicFunc(blessing: Blessing): ModifierTypeFunc {
  switch (blessing) {
    case "power":
      return randSeedItem(POWER_RELICS);
    case "fortune":
      return modifierTypes.ER_RELIC_COIN_PURSE;
    case "protection":
      return modifierTypes.ER_RELIC_FIELD_MEDIC;
  }
}

const TIER_NAME: Record<number, string> = {
  [ModifierTier.GREAT]: "Great",
  [ModifierTier.ULTRA]: "Ultra",
  [ModifierTier.ROGUE]: "Rogue",
};

interface CrystalState {
  /** The blessing tier this crystal rolled (drives magnitude). */
  tier: number;
}

/** Grant the chosen blessing at the rolled tier. */
async function grantBlessing(blessing: Blessing): Promise<void> {
  const { tier } = globalScene.currentBattle.mysteryEncounter!.misc as CrystalState;
  const picks = tier === ModifierTier.ROGUE ? 3 : tier === ModifierTier.ULTRA ? 2 : 1;
  const funcs: ModifierTypeFunc[] = tier >= ModifierTier.ULTRA ? [blessingRelicFunc(blessing)] : [];
  setEncounterRewards({
    ...(funcs.length > 0 ? { guaranteedModifierTypeFuncs: funcs } : {}),
    guaranteedModifierTiers: new Array(picks).fill(tier),
    fillRemaining: false,
  });
  await transitionMysteryEncounterIntroVisuals(true, true);
  leaveEncounterWithoutBattle(false);
}

function blessingOption(blessing: Blessing, n: number) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${n}.label`,
      buttonTooltip: `${namespace}:option.${n}.tooltip`,
      selected: [{ text: `${namespace}:option.${n}.selected` }],
    })
    .withOptionPhase(async () => {
      await grantBlessing(blessing);
      return true;
    })
    .build();
}

export const WishingCrystalEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_WISHING_CRYSTAL,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A graceful fairy keeping the crystal's wish (Gardevoir).
    { species: SpeciesId.GARDEVOIR, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Roll the blessing tier up front (mostly Great, rarely Ultra/Rogue) and show
    // it - the player then picks a category at that strength.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const roll = randSeedInt(100);
    const tier = roll < 12 ? ModifierTier.ROGUE : roll < 40 ? ModifierTier.ULTRA : ModifierTier.GREAT;
    encounter.misc = { tier } satisfies CrystalState;
    encounter.setDialogueToken("tierName", TIER_NAME[tier]);
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(blessingOption("power", 1))
  .withOption(blessingOption("fortune", 2))
  .withOption(blessingOption("protection", 3))
  .build();
