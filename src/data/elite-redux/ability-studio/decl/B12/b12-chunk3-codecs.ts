/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. Codecs of the type, trap, recoil and decay classes (a helper, not a declaration: the registry only collects
// `*.decl.ts` and `bindings.ts`). Staff read and write plain words and percents; the classes take enum numbers and fractions.
//
//   percentOfFractionCodec  10 <-> 0.1                       (the recoil share)
//   hpLineCodec             33.3333333333 <-> 1/3 exactly     (the low-HP line: one third stays EXACTLY one third)
//   optionalMultiplierCodec 0 <-> "not set" (undefined/null)  (the extra boost under the HP line)
//   weatherListCodec        "Rain, Sun" <-> [RAIN, SUNNY]      (empty text <-> no weather needed)
//   moveListCodec           "Fire Spin, Wrap" <-> [FIRE_SPIN, WRAP]  (empty text <-> every trapping move)
//   optionPick              the fields of the trap class's options object
//   conversionSourceCodec   "Normal" / "Sound moves that are Normal" <-> the source filter
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { playerName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";

// ---------------------------------------------------------------------------------------------------------------
// Percent and HP line

/** Whole-number and half percents stay clean (0.05 reads as 5, never 5.000000000000001). */
function cleanPercent(fraction: number): number {
  return Number((fraction * 100).toPrecision(12));
}

/** A share of the damage dealt: 10 (percent) to the constructor's 0.1. */
export const percentOfFractionCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? cleanPercent(raw) : undefined),
};

/**
 * The low-HP line: a percent of max HP to the constructor's ratio. A line that is one Nth (33.33 percent, 25, 20, 50...)
 * is snapped to exactly 1/N, so "one third" reaches the class as `1 / 3` and not as 0.33333333333333326, which would move
 * the boundary at exactly one third HP.
 */
export const hpLineCodec: ParamCodec = {
  toCtor: value => {
    const ratio = Number(value) / 100;
    const n = Math.round(1 / ratio);
    return n >= 2 && Math.abs(ratio - 1 / n) < 5e-5 ? 1 / n : ratio;
  },
  fromInstance: raw => (typeof raw === "number" ? cleanPercent(raw) : undefined),
};

/** An optional multiplier: 0 means "not set" (the constructor argument is left out). */
export const optionalMultiplierCodec: ParamCodec = {
  toCtor: value => (Number(value) === 0 ? undefined : Number(value)),
  fromInstance: raw => (typeof raw === "number" ? raw : raw === null || raw === undefined ? 0 : undefined),
};

// ---------------------------------------------------------------------------------------------------------------
// Weather list

const WEATHER_WORDS: readonly (readonly [weather: WeatherType, word: string])[] = [
  [WeatherType.SUNNY, "Sun"],
  [WeatherType.RAIN, "Rain"],
  [WeatherType.SANDSTORM, "Sandstorm"],
  [WeatherType.HAIL, "Hail"],
  [WeatherType.SNOW, "Snow"],
  [WeatherType.FOG, "Fog"],
  [WeatherType.HEAVY_RAIN, "Heavy rain"],
  [WeatherType.HARSH_SUN, "Extremely harsh sunlight"],
  [WeatherType.STRONG_WINDS, "Strong winds"],
  [WeatherType.TEMPEST_STORM, "Tempest storm"],
  [WeatherType.SNOWY_WRATH, "Snowy wrath"],
  [WeatherType.EERIE_FOG, "Eerie fog"],
];

export const WEATHER_LIST_WORDS: readonly string[] = WEATHER_WORDS.map(([, word]) => word);

export function parseWeatherList(text: string): WeatherType[] {
  return text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => {
      const found = WEATHER_WORDS.find(([, word]) => word.toLowerCase() === part.toLowerCase());
      if (found === undefined) {
        throw new Error(`"${part}" is not a weather; use ${WEATHER_LIST_WORDS.join(", ")}`);
      }
      return found[0];
    });
}

export function formatWeatherList(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return "";
  }
  if (!Array.isArray(raw)) {
    return;
  }
  const words = raw.map(item => WEATHER_WORDS.find(([weather]) => weather === item)?.[1]);
  return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
}

/** Empty text is "no weather needed" (the option is left out); a list asks for one of those weathers. */
export const weatherListCodec: ParamCodec = {
  toCtor: value => {
    const list = parseWeatherList(String(value));
    return list.length === 0 ? undefined : list;
  },
  fromInstance: raw => formatWeatherList(raw),
};

// ---------------------------------------------------------------------------------------------------------------
// Move list (the trapping moves)

function moveWord(id: MoveId): string | undefined {
  const key = MoveId[id];
  if (typeof key !== "string") {
    return;
  }
  return key
    .toLowerCase()
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseMoveList(text: string): MoveId[] {
  return text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => {
      const key = part.toUpperCase().replace(/\s+/g, "_");
      const id = (MoveId as unknown as Record<string, unknown>)[key];
      if (typeof id !== "number") {
        throw new Error(`"${part}" is not a move; write its name, for example Fire Spin`);
      }
      return id as MoveId;
    });
}

export function formatMoveList(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return "";
  }
  if (!Array.isArray(raw)) {
    return;
  }
  const words = raw.map(item => moveWord(item as MoveId));
  return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
}

/** Empty text is "every trapping move" (the option is left out); otherwise the named moves. */
export const moveListCodec: ParamCodec = {
  toCtor: value => {
    const list = parseMoveList(String(value));
    return list.length === 0 ? undefined : list;
  },
  fromInstance: raw => {
    const opts = raw as { readonly moveIds?: unknown } | undefined;
    return formatMoveList(opts?.moveIds);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The trap class keeps its three numbers in one options object; these read them back.

/** Turns the trap lasts: the options object holds `turns`. */
export const trapTurnsCodec: ParamCodec = {
  toCtor: value => Number(value),
  fromInstance: raw => {
    const turns = (raw as { readonly turns?: unknown } | undefined)?.turns;
    return typeof turns === "number" ? turns : undefined;
  },
};

/**
 * Trap damage: staff say "1 in N of max HP" (6 = one sixth); the class holds the fraction 1 / N and the game rounds
 * `1 / fraction` back to N, so the round trip is exact for every whole N.
 */
export const trapDamageDenominatorCodec: ParamCodec = {
  toCtor: value => 1 / Number(value),
  fromInstance: raw => {
    const fraction = (raw as { readonly damageFraction?: unknown } | undefined)?.damageFraction;
    return typeof fraction === "number" && fraction > 0 ? Math.round(1 / fraction) : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The type conversion's "which moves" filter

/** Player words for the move properties a conversion can look at (the flags of the game's move list). */
const FLAG_WORDS: readonly (readonly [name: string, word: string])[] = [
  ["MAKES_CONTACT", "Contact"],
  ["SOUND_BASED", "Sound"],
  ["BITING_MOVE", "Biting"],
  ["PULSE_MOVE", "Pulse"],
  ["PUNCHING_MOVE", "Punching"],
  ["SLICING_MOVE", "Slicing"],
  ["RECKLESS_MOVE", "Reckless"],
  ["BALLBOMB_MOVE", "Ball and bomb"],
  ["POWDER_MOVE", "Powder"],
  ["DANCE_MOVE", "Dance"],
  ["WIND_MOVE", "Wind"],
  ["TRIAGE_MOVE", "Triage"],
  ["AIR_BASED", "Air"],
  ["ARROW_BASED", "Arrow"],
  ["BONE_BASED", "Bone"],
  ["DRILL_BASED", "Drill"],
  ["FIELD_BASED", "Field"],
  ["HAMMER_BASED", "Hammer"],
  ["HORN_BASED", "Horn"],
  ["KICKING_MOVE", "Kicking"],
  ["LUNAR_MOVE", "Lunar"],
  ["THROW_BASED", "Throwing"],
  ["WEATHER_BASED", "Weather"],
];

const MOVE_FLAG_TABLE = MoveFlags as unknown as Record<string, number | string>;

function flagOfWord(word: string): number | undefined {
  const wanted = word.trim().toLowerCase();
  const found = FLAG_WORDS.find(([, name]) => name.toLowerCase() === wanted);
  const value = found === undefined ? undefined : MOVE_FLAG_TABLE[found[0]];
  return typeof value === "number" ? value : undefined;
}

function wordOfFlag(flag: number): string | undefined {
  const found = FLAG_WORDS.find(([name]) => MOVE_FLAG_TABLE[name] === flag);
  return found?.[1];
}

const TYPE_TABLE = PokemonType as unknown as Record<string, number | string>;

function typeOfWord(word: string): number | undefined {
  const wanted = word.trim().toLowerCase();
  for (const key of Object.keys(TYPE_TABLE)) {
    const value = TYPE_TABLE[key];
    if (typeof value === "number" && key !== "UNKNOWN" && playerName(key).toLowerCase() === wanted) {
      return value;
    }
  }
  return;
}

function wordOfType(type: number): string | undefined {
  for (const key of Object.keys(TYPE_TABLE)) {
    if (TYPE_TABLE[key] === type && key !== "UNKNOWN" && Number.isNaN(Number(key))) {
      return playerName(key);
    }
  }
  return;
}

export const CONVERSION_FLAG_WORDS: readonly string[] = FLAG_WORDS.map(([, word]) => word);

export type ConversionSourceValue =
  | { readonly kind: "type"; readonly type: number }
  | { readonly kind: "flag"; readonly flag: number; readonly requireType?: number };

/**
 * "Normal" is a move type; "Sound moves" is a move property; "Sound moves that are Normal" is both. Throws a plain sentence
 * for anything it cannot read.
 */
export function parseConversionSource(text: string): ConversionSourceValue {
  const trimmed = text.trim();
  const flagMatch = /^(.+?)\s+moves(?:\s+that\s+are\s+(.+))?$/i.exec(trimmed);
  if (flagMatch !== null) {
    const flag = flagOfWord(flagMatch[1]);
    if (flag === undefined) {
      throw new Error(`"${flagMatch[1]}" is not a move property; use ${CONVERSION_FLAG_WORDS.join(", ")}`);
    }
    if (flagMatch[2] === undefined) {
      return { kind: "flag", flag };
    }
    const requireType = typeOfWord(flagMatch[2]);
    if (requireType === undefined) {
      throw new Error(`"${flagMatch[2]}" is not a type; write a type such as Normal`);
    }
    return { kind: "flag", flag, requireType };
  }
  const type = typeOfWord(trimmed);
  if (type === undefined) {
    throw new Error(`"${trimmed}" is not a type or a move property; write Normal, or Sound moves that are Normal`);
  }
  return { kind: "type", type };
}

export function formatConversionSource(raw: unknown): string | undefined {
  const source = raw as Partial<ConversionSourceValue> | undefined;
  if (source?.kind === "type" && typeof source.type === "number") {
    return wordOfType(source.type);
  }
  if (source?.kind === "flag" && typeof source.flag === "number") {
    const word = wordOfFlag(source.flag);
    if (word === undefined) {
      return;
    }
    const requireType = (source as { readonly requireType?: number }).requireType;
    if (requireType === undefined) {
      return `${word} moves`;
    }
    const typeWord = wordOfType(requireType);
    return typeWord === undefined ? undefined : `${word} moves that are ${typeWord}`;
  }
  return;
}

export const conversionSourceCodec: ParamCodec = {
  toCtor: value => parseConversionSource(String(value)),
  fromInstance: raw => formatConversionSource(raw),
};
