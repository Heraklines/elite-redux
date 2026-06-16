/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - The Dragon's Hoard. A WASTELAND-biome catch + loot event (design PART
// XVIII s134). A territorial dragon coils atop a glittering hoard. Challenge it:
// win for the hoard (a guaranteed high-tier reward), or throw a Ball to claim the
// dragon itself. Built on the catch substrate (withCatchAllowed + an isBoss
// enemyPartyConfig); rewards are set before the fight so they pay out on victory.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/dragonsHoard";

/** Thematic hoarder dragons (Wasteland is a late, extreme biome). */
const HOARDER_SPECIES: SpeciesId[] = [
  SpeciesId.HYDREIGON,
  SpeciesId.DRAGONITE,
  SpeciesId.SALAMENCE,
  SpeciesId.GARCHOMP,
];

/** The hoard: a guaranteed high-tier reward for besting the dragon. */
const HOARD_TIERS: ModifierTier[] = [ModifierTier.ROGUE, ModifierTier.ROGUE, ModifierTier.ULTRA];

export const DragonsHoardEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_DRAGONS_HOARD,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.HYDREIGON,
      hasShadow: true,
      tint: 0.3,
      scale: 1.25,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const species = getPokemonSpecies(randSeedItem(HOARDER_SPECIES));
    const pokemonConfig: EnemyPokemonConfig = { species, isBoss: true };
    encounter.enemyPartyConfigs = [{ levelAdditiveModifier: 1, pokemonConfigs: [pokemonConfig] }];
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
      // Challenge the dragon: win for the hoard, or throw a Ball to claim it.
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      setEncounterRewards({ guaranteedModifierTiers: HOARD_TIERS, fillRemaining: false });
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
      // Back away slowly - no battle, no cost.
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
