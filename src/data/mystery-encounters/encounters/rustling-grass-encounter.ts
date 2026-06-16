/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - Rustling Grass. A TALL_GRASS-biome catch event (design PART IX s11).
// The grass shakes - something rare is hiding in it. Flush it out for a battle
// (weaken it, then throw a Ball to add it to your team), or leave it be. Built on
// the proven catch substrate (withCatchAllowed + an isBoss enemyPartyConfig).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import { initBattleWithEnemyConfig, leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/rustlingGrass";

/** Rare mons that hide in tall grass - a desirable catch. */
const HIDDEN_SPECIES: SpeciesId[] = [SpeciesId.DITTO, SpeciesId.CHANSEY, SpeciesId.KANGASKHAN, SpeciesId.BOUFFALANT];

export const RustlingGrassEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_RUSTLING_GRASS,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    { spriteKey: "", fileRoot: "", species: SpeciesId.CHANSEY, hasShadow: true, tint: 0.4, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const species = getPokemonSpecies(randSeedItem(HIDDEN_SPECIES));
    const pokemonConfig: EnemyPokemonConfig = { species, isBoss: true };
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
      // Flush it out and battle it - weaken it, then a Ball captures it.
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
      // Leave it hidden - no battle, no cost.
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
