/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { FLAG_WORDS, PROPERTY_CHOICES, propertyCodec } from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS, WEATHER_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// Shared by the B08 chunk 4 declarations (damage reduction, defense-stat swap, effect chance): the player-facing words for
// the choices of those classes and the codecs that turn them into what the constructors want.
// This is not a declaration (the registry only collects `*.decl.ts` and `bindings.ts`).
import { playerName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import type { DamageReductionFilter } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";

const TYPE_VALUES = PokemonType as unknown as Record<string, number>;
const WEATHER_VALUES = WeatherType as unknown as Record<string, number>;
const FLAG_VALUES = MoveFlags as unknown as Record<string, number>;

// ---------------------------------------------------------------------------------------------------------------
// Damage reduction: which incoming moves the reduction is for.

const PHYSICAL = 0;
const SPECIAL = 1;

function typeWords(type: string): string {
  return `${type.charAt(0)}${type.slice(1).toLowerCase()}-type moves`;
}

function weatherWords(weather: string): string {
  return playerName(weather).toLowerCase();
}

/** Every choice, in the words a player uses, with the filter object the class constructor wants. */
export const REDUCTION_FILTERS: readonly (readonly [name: string, filter: DamageReductionFilter])[] = [
  ["Every damaging move", { kind: "all" }],
  ["Physical moves", { kind: "category", category: PHYSICAL }],
  ["Special moves", { kind: "category", category: SPECIAL }],
  ["Moves that make contact", { kind: "contact" }],
  ["Super effective moves", { kind: "super-effective" }],
  ["Resisted moves", { kind: "resisted" }],
  ["Any damaging move while I am at full HP", { kind: "full-hp" }],
  ["Critical hits", { kind: "crit" }],
  ...TYPE_OPTIONS.filter(type => type !== "STELLAR").map((type): readonly [string, DamageReductionFilter] => [
    typeWords(type),
    { kind: "move-type", type: TYPE_VALUES[type] as PokemonType },
  ]),
  ...WEATHER_OPTIONS.filter(weather => weather !== "NONE").flatMap((weather): [string, DamageReductionFilter][] => [
    [
      `Physical moves while the weather is ${weatherWords(weather)}`,
      { kind: "category-in-weather", category: PHYSICAL, weather: WEATHER_VALUES[weather] as WeatherType },
    ],
    [
      `Special moves while the weather is ${weatherWords(weather)}`,
      { kind: "category-in-weather", category: SPECIAL, weather: WEATHER_VALUES[weather] as WeatherType },
    ],
  ]),
];

export const REDUCTION_FILTER_NAMES: readonly string[] = REDUCTION_FILTERS.map(([name]) => name);

/** "Special moves" <-> { kind: "category", category: SPECIAL }. */
export const reductionFilterCodec: ParamCodec = {
  toCtor: value => {
    const entry = REDUCTION_FILTERS.find(([name]) => name === String(value));
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a known kind of move`);
    }
    return { ...entry[1] };
  },
  fromInstance: raw =>
    REDUCTION_FILTERS.find(([, candidate]) => JSON.stringify(candidate) === JSON.stringify(raw))?.[0],
};

// ---------------------------------------------------------------------------------------------------------------
// Defense-stat swap: the move property that triggers it and which defense the move hits.

/** The move properties staff may name, in words ("Punching moves"). Unlike the optional filter there is always one. */
export const SWAP_FLAG_CHOICES: readonly string[] = MOVE_FLAG_OPTIONS.map(flag => FLAG_WORDS[flag]);

/** { flag, swap } object of the class <-> the property in words (the object is what the live instance keeps in `opts`). */
export const swapFlagCodec: ParamCodec = {
  toCtor: value => {
    const flag = MOVE_FLAG_OPTIONS.find(candidate => FLAG_WORDS[candidate] === String(value));
    if (flag === undefined) {
      throw new Error(`"${String(value)}" is not a known move property`);
    }
    return FLAG_VALUES[flag];
  },
  fromInstance: raw => {
    const flag = (raw as { flag?: number } | undefined)?.flag;
    const name = MOVE_FLAG_OPTIONS.find(candidate => FLAG_VALUES[candidate] === flag);
    return name === undefined ? undefined : FLAG_WORDS[name];
  },
};

const SWAPS: readonly (readonly [name: string, swap: string])[] = [
  ["Physical moves hit Sp. Def instead of Defense", "target-spdef-instead-of-def"],
  ["Special moves hit Defense instead of Sp. Def", "target-def-instead-of-spdef"],
  ["Every move hits whichever of Defense and Sp. Def is lower", "target-lower-defense"],
];

export const SWAP_CHOICES: readonly string[] = SWAPS.map(([name]) => name);

export const swapCodec: ParamCodec = {
  toCtor: value => {
    const entry = SWAPS.find(([name]) => name === String(value));
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a known way to change the defense stat`);
    }
    return entry[1];
  },
  fromInstance: raw => {
    const swap = (raw as { swap?: string } | undefined)?.swap;
    return SWAPS.find(([, candidate]) => candidate === swap)?.[0];
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Effect chance: the optional move property (the flag lives in the class as a plain field).

export { PROPERTY_CHOICES, propertyCodec };
