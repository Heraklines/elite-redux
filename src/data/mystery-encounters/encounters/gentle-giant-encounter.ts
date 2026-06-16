/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Gentle Giant. A GRASS-biome catch event (design PART IX s9). A
// huge, docile Grass-type dozes in a sunlit clearing. Approach it for a battle
// (the wild-boss catch flow: weaken it, then throw a Ball to add it to your team),
// or leave it to its nap. Built on the proven Slumbering Snorlax catch substrate
// (withCatchAllowed + an isBoss enemyPartyConfig) - no new engine.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { CustomPokemonData } from "#data/pokemon-data";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import { initBattleWithEnemyConfig, leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/gentleGiant";

/** Thematic docile Grass titans. One is picked at random for the clearing. */
const GIANT_SPECIES: SpeciesId[] = [SpeciesId.TORTERRA, SpeciesId.TANGROWTH, SpeciesId.GOGOAT, SpeciesId.TSAREENA];

export const GentleGiantEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_GENTLE_GIANT,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.TORTERRA,
      hasShadow: true,
      tint: 0.25,
      scale: 1.5,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const species = getPokemonSpecies(randSeedItem(GIANT_SPECIES));
    const pokemonConfig: EnemyPokemonConfig = {
      species,
      isBoss: true,
      // A gentle, dozing giant: docile and asleep, easy to weaken for a catch.
      status: [StatusEffect.SLEEP, 5],
      nature: Nature.DOCILE,
      customPokemonData: new CustomPokemonData({ spriteScale: 1.5 }),
    };
    encounter.enemyPartyConfigs = [{ levelAdditiveModifier: 0.5, pokemonConfigs: [pokemonConfig] }];
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
      // Approach and battle it - weaken it, then a Ball captures it (catch allowed).
      const encounter = globalScene.currentBattle.mysteryEncounter!;
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
      // Leave the giant to its nap - no battle, no cost.
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
