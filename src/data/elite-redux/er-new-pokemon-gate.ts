/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const ENABLED_VALUES = new Set(["1", "true", "on", "enabled"]);

const AUGUST_2026_FORM_SLUGS = new Set([
  "rowlet_partner",
  "onix_partner",
  "gimmighoul_partner",
  "cryogonal_mega",
  "jirachi_mega",
  "ledian_mega",
  "rampardos_mega",
  "reuniclus_mega_x",
  "xatu_mega",
  "zangoose_mega",
  "power_plant_live_current",
  "calyrex_chariot_mega",
  "hypno_mega",
  "raichu_alolan_mega_male",
  "raichu_alolan_mega_female",
  "barbaracle_mega_y",
  "lilligant_verdant_mega",
  "uxie_corrupted",
  "golurk_mega_y",
  "skuntank_mega",
  "dodrio_mega",
  "pyukumuku_mega",
]);

const AUGUST_2026_STONE_NAMES = new Set([
  "CRYOGONALITE",
  "JIRACHITE",
  "LEDIANITE",
  "RAMPARDOSITE",
  "REUNICLUSITE_X",
  "XATUNITE",
  "ZANGOOSEITE",
  "CALYRITE",
  "HYPNITE",
  "ALORAICHUNITE",
  "BARBARACITE_Y",
  "LILLIGANITE_VERDANT",
  "DISTORTED_CHAIN",
  "GOLURKITE_Y",
  "SKUNTANKITE",
  "DODRIONITE",
  "PYUKUMUKUNITE",
]);

/** Pure resolver used by deployment-contract tests. */
export function resolveNewPokemonContentEnabled(value: string | undefined, mode: string): boolean {
  if (value !== undefined && value !== "") {
    return ENABLED_VALUES.has(value.toLowerCase());
  }
  return mode === "development" || mode === "test";
}

/**
 * The August 2026 roster is staging-only until explicitly promoted. Standalone
 * and production builds fail closed when their deployment forgot the flag.
 */
export function isNewPokemonContentEnabled(): boolean {
  return resolveNewPokemonContentEnabled(import.meta.env.VITE_ENABLE_NEW_POKEMON, import.meta.env.MODE);
}

export function isGatedNewPokemonAbilityId(abilityId: number): boolean {
  return abilityId >= 6004 && abilityId <= 6163;
}

export function isGatedNewPokemonFormSlug(slug: string): boolean {
  return AUGUST_2026_FORM_SLUGS.has(slug);
}

export function isGatedNewPokemonStoneName(name: string): boolean {
  return AUGUST_2026_STONE_NAMES.has(name);
}
