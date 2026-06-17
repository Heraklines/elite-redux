/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #518 - Frozen in Time. An ICE_CAVE preservation event (design PART XV s57 /
// transcript line 124156). Something huge is frozen solid in a wall of ancient,
// clear ice - a shape that hasn't moved in ages. Ice = preservation, so the
// choice is greed (the mon) vs safety (the loot):
//
//   - THAW IT (with Fire) -> the ancient mon wakes and you can catch it. If you
//     have a Fire-blooded partner (a Fire type or a Fire move) the thaw is gentle
//     and it wakes drowsy and docile (an easy catch). With no flame to thaw it
//     gently you crack the ice the hard way and it wakes HOSTILE - a real fight
//     first, though it is still catchable once weakened.
//   - CHIP IT OUT BY HAND -> the crystal-preserved held item it died clutching
//     (ice preserves perfectly): a Never-Melt Ice, or sometimes a healing item.
//     No fight.
//
// Built on the proven Slumbering Snorlax / Gentle Giant catch substrate
// (withCatchAllowed + an isBoss enemyPartyConfig) - no new engine.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/frozenInTime";

/**
 * Ancient mons that history left frozen in the ice - Galar permafrost fossils
 * (Arctozolt/Arctovish) and the Tundra fossils (Amaura/Aurorus). One is picked
 * for the shape in the wall.
 */
const FROZEN_SPECIES: SpeciesId[] = [SpeciesId.ARCTOZOLT, SpeciesId.ARCTOVISH, SpeciesId.AURORUS, SpeciesId.AMAURA];

/** The signature preserved loot: a Never-Melt Ice ("Evermelt Ice"). */
const ICE_BOOSTER: ModifierTypeFunc = () => generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [PokemonType.ICE])!;

/**
 * The chip-out reward pool (#518): ONE thematic, ice-cavern-appropriate item.
 * Heavily weighted toward the signature Never-Melt Ice, with a chance at a
 * Mystical Rock (the weather rock - fitting for an ICE_CAVE's hail/snow) and a
 * rarer perfectly-preserved healing item the frozen mon died clutching.
 */
const CHIP_POOL: { func: ModifierTypeFunc; weight: number }[] = [
  { func: ICE_BOOSTER, weight: 50 }, // Never-Melt Ice ("Evermelt Ice")
  { func: modifierTypes.MYSTICAL_ROCK, weight: 30 }, // the "weather rock"
  { func: modifierTypes.FULL_RESTORE, weight: 8 },
  { func: modifierTypes.MAX_REVIVE, weight: 8 },
  { func: modifierTypes.SACRED_ASH, weight: 4 },
];

/** Roll ONE reward func from the weighted chip-out pool. */
function rollChipReward(): ModifierTypeFunc {
  const total = CHIP_POOL.reduce((sum, e) => sum + e.weight, 0);
  let roll = randSeedInt(total);
  for (const entry of CHIP_POOL) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.func;
    }
  }
  return ICE_BOOSTER;
}

interface FrozenState {
  speciesId: SpeciesId;
  /** True if the party can thaw the ice gently (a Fire type or a Fire move). */
  careful: boolean;
}

/** Whether any party mon brings flame to thaw the ice gently (Fire type or Fire move). */
function partyHasFireSource(): boolean {
  return globalScene
    .getPlayerParty()
    .some(p => p.getTypes().includes(PokemonType.FIRE) || p.moveset.some(m => m?.getMove().type === PokemonType.FIRE));
}

export const FrozenInTimeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_FROZEN_IN_TIME,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A vast shape suspended in clear ice (Aurorus), frosted over with a pale tint.
    {
      species: SpeciesId.AURORUS,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      tint: 0.35,
      scale: 1.4,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    // Resolve the frozen mon and whether the party can thaw it gently up front, so
    // the description can warn the player how the thaw will go before they choose.
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const speciesId = randSeedItem(FROZEN_SPECIES);
    const careful = partyHasFireSource();
    encounter.misc = { speciesId, careful } satisfies FrozenState;
    encounter.setDialogueToken(
      "thawTell",
      careful
        ? "You have a Fire-blooded partner to melt the ice gently - it should wake calm enough to catch."
        : "You have no flame to thaw it gently, so you would have to crack the ice the hard way - it may wake up angry.",
    );
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [{ text: `${namespace}:option.1.selected` }],
    },
    async () => {
      // Thaw it and wake it: a catchable wild battle. Gentle thaw -> drowsy & docile
      // (easy catch); careless thaw -> a hostile boss that must be weakened first.
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const { speciesId, careful } = encounter.misc as FrozenState;
      const species = getPokemonSpecies(speciesId);
      const pokemonConfig: EnemyPokemonConfig = careful
        ? { species, isBoss: false, status: [StatusEffect.SLEEP, 4], nature: Nature.DOCILE }
        : { species, isBoss: true };
      encounter.enemyPartyConfigs = [{ levelAdditiveModifier: careful ? 0 : 0.5, pokemonConfigs: [pokemonConfig] }];
      queueEncounterMessage(careful ? `${namespace}:thawGentle` : `${namespace}:thawHard`);
      await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Chip out the preserved held item by hand: ONE thematic reward (Never-Melt
      // Ice, the weather rock, or a preserved healing item). No fight.
      setEncounterRewards({ guaranteedModifierTypeFuncs: [rollChipReward()], fillRemaining: false });
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(false);
      return true;
    },
  )
  .build();
