/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { enSpeciesName } from "#data/elite-redux/er-canonical-names";
import type { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export const ER_UPCYCLE_ABILITY_ID = 5969;
export const ER_SUGAR_RUSH_ABILITY_ID = 5356;

/** Vanilla family roots tagged as Food. Form-specific exclusions are applied below. */
export const ER_FOOD_FAMILY_ROOTS: ReadonlySet<SpeciesId> = new Set([
  SpeciesId.MILCERY,
  SpeciesId.APPLIN,
  SpeciesId.SMOLIV,
  SpeciesId.TORCHIC,
  SpeciesId.BOUNSWEET,
  SpeciesId.CAPSAKID,
  SpeciesId.CHESPIN,
  SpeciesId.FIDOUGH,
  SpeciesId.EXEGGCUTE,
  SpeciesId.FARFETCHD,
  SpeciesId.GALAR_FARFETCHD,
  SpeciesId.FERROSEED,
  SpeciesId.NACLI,
  SpeciesId.PUMPKABOO,
  SpeciesId.SKWOVET,
  SpeciesId.HAPPINY,
  SpeciesId.LECHONK,
  SpeciesId.SWIRLIX,
  SpeciesId.SLUGMA,
  SpeciesId.MUNCHLAX,
  SpeciesId.POLTCHAGEIST,
  SpeciesId.SINISTEA,
  SpeciesId.TOEDSCOOL,
  SpeciesId.VANILLITE,
]);

const FOOD_SINGLE_SPECIES: ReadonlySet<SpeciesId> = new Set([
  SpeciesId.TROPIUS,
  SpeciesId.MOLTRES,
  SpeciesId.GALAR_MOLTRES,
  SpeciesId.CELEBI,
  SpeciesId.CHERUBI,
  SpeciesId.DONDOZO,
  SpeciesId.GUZZLORD,
  SpeciesId.MORPEKO,
  SpeciesId.PASSIMIAN,
  SpeciesId.PECHARUNT,
  SpeciesId.SHUCKLE,
  SpeciesId.TATSUGIRI,
  SpeciesId.TOGEPI,
  SpeciesId.TOGETIC,
  SpeciesId.VELUZA,
  SpeciesId.COMBEE,
  SpeciesId.VESPIQUEN,
]);

const REDUX_EXCLUDED_ROOTS: ReadonlySet<SpeciesId> = new Set([SpeciesId.BOUNSWEET, SpeciesId.NACLI, SpeciesId.HAPPINY]);

const FOOD_CUSTOM_ROOT_NAMES: ReadonlySet<string> = new Set([
  "Corm",
  "Corn Tyrant",
  "Escarginite Redux",
  "Heracreus",
  "Hippopotato",
  "Sinistea Redux",
  "Swinub Redux",
]);

const FOOD_CUSTOM_EXACT_NAMES: ReadonlySet<string> = new Set(["Amphybuzz", "Mawile Redux"]);

/** Central Food tag used by Sugar Rush and future food-aware mechanics. */
export function isErFoodPokemon(pokemon: Pokemon): boolean {
  const speciesId = pokemon.species.speciesId;
  const formKey = pokemon.getFormKey().toLowerCase();
  const speciesName = enSpeciesName(pokemon.species);
  const rootId = pokemon.species.getRootSpeciesId();
  const rootSpecies = getPokemonSpecies(rootId);
  const rootName = rootSpecies ? enSpeciesName(rootSpecies) : speciesName;

  if (FOOD_CUSTOM_EXACT_NAMES.has(speciesName)) {
    return true;
  }
  if (FOOD_CUSTOM_ROOT_NAMES.has(rootName)) {
    return true;
  }
  if (FOOD_SINGLE_SPECIES.has(speciesId)) {
    return true;
  }
  if (REDUX_EXCLUDED_ROOTS.has(rootId) && formKey.includes("redux")) {
    return false;
  }
  return ER_FOOD_FAMILY_ROOTS.has(rootId);
}

/** Upcycle is a marker ability; Sugar Rush owns the actual damage modifiers. */
export function holderHasUpcycle(pokemon: Pokemon): boolean {
  return pokemon.hasAbility(ER_UPCYCLE_ABILITY_ID as AbilityId);
}
