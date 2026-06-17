/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #526 - The Regional Emissary. An ISLAND exhibition event (design PART XIX /
// transcript line 124231), the rework of the old Import Bazaar and the home for
// regional forms. An island trainer fields a team of unfamiliar regional variants
// and offers an exhibition: beat them, and you may KEEP one of their stars.
//
//   BATTLE FOR A STAR: pick which marquee regional mon you want, then fight the
//     whole exhibition team. Win and that regional Pokemon joins YOUR party (the
//     maintainer's "win -> keep one of their Pokemon, you choose which"). Granted
//     post-victory via doContinueEncounter + catchPokemon.
//   DECLINE: wave the exhibition off, no fight, no cost.
//
// New mechanic: a post-win party grant of a CHOSEN enemy regional form. Built on
// the trainer-battle config + the salesman's catchPokemon add-to-party flow + the
// doContinueEncounter post-battle hook (no engine changes).
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPokemon } from "#field/pokemon";
import { PlayerPokemon } from "#field/pokemon";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { catchPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { PokemonData } from "#system/pokemon-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const namespace = "mysteryEncounters/regionalEmissary";

interface RegionalForm {
  speciesId: SpeciesId;
  /** The regional variant's form index. */
  formIndex: number;
}

/** The exhibition team - a spread of regional variants. The two stars are claimable. */
const STAR_NINETALES: RegionalForm = { speciesId: SpeciesId.NINETALES, formIndex: 1 }; // Alolan
const STAR_ZOROARK: RegionalForm = { speciesId: SpeciesId.ZOROARK, formIndex: 1 }; // Hisuian
const TEAMMATE_WEEZING: RegionalForm = { speciesId: SpeciesId.WEEZING, formIndex: 1 }; // Galarian

interface EmissaryMisc {
  /** The star the player chose to play for. */
  claim: RegionalForm;
}

/** Level the exhibition (and the claimed mon) is pinned to: strongest party member / wave. */
function emissaryLevel(): number {
  let top = 0;
  for (const m of globalScene.getPlayerParty()) {
    if (m.level > top) {
      top = m.level;
    }
  }
  const waveLvl = globalScene.currentBattle?.getLevelForWave?.() ?? top;
  return Math.max(1, top, Math.round(waveLvl));
}

/** Build the exhibition trainer battle: the full regional team. */
function buildEmissaryBattle(): EnemyPartyConfig {
  const level = emissaryLevel();
  const team: RegionalForm[] = [STAR_NINETALES, TEAMMATE_WEEZING, STAR_ZOROARK];
  const pokemonConfigs: EnemyPokemonConfig[] = team.map(r => ({
    species: getPokemonSpecies(r.speciesId),
    isBoss: false,
    formIndex: r.formIndex,
    level,
  }));
  const trainerConfig = trainerConfigs[TrainerType.ACE_TRAINER]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(pokemonConfigs.length, PartyMemberStrength.STRONGER));
  return { trainerConfig, pokemonConfigs };
}

/** After winning the exhibition, the chosen regional form joins the player's party. */
async function grantClaim(claim: RegionalForm): Promise<void> {
  const species = getPokemonSpecies(claim.speciesId);
  const mon = new PlayerPokemon(species, emissaryLevel(), undefined, claim.formIndex);
  mon.generateAndPopulateMoveset();
  const data = new PokemonData(mon);
  data.player = false;
  await catchPokemon(data.toPokemon() as EnemyPokemon, null, PokeballType.POKEBALL, true, true);
  leaveEncounterWithoutBattle(true);
}

/** Fight the exhibition for the given star; the star joins your party on a win. */
async function battleForStar(claim: RegionalForm): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc = { claim } satisfies EmissaryMisc;
  encounter.doContinueEncounter = async () => {
    encounter.doContinueEncounter = undefined;
    await grantClaim((encounter.misc as EmissaryMisc).claim);
  };
  await transitionMysteryEncounterIntroVisuals(true, false);
  await initBattleWithEnemyConfig(buildEmissaryBattle());
}

export const RegionalEmissaryEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_REGIONAL_EMISSARY,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // The emissary's headliner species (Ninetales - the Alolan star is fielded in battle).
    { species: SpeciesId.NINETALES, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
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
      await battleForStar(STAR_NINETALES);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      await battleForStar(STAR_ZOROARK);
      return true;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [{ text: `${namespace}:option.3.selected` }],
    },
    async () => {
      // Decline the exhibition - no fight, no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
