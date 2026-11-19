/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3: read-back codecs for the power boosters whose constructor takes a type or a list of categories but keeps only
// a closure built from it (`pokemon?.getMoveType(move) === boostedType`, `boostedCategories.includes(move.category)`).
// The class is left untouched (adding a field would change the configuration snapshot of the 24 saved abilities that the
// frozen references guard). The live value is read back by ASKING the closure, which is a pure function of its arguments:
// the type is the one move type for which it answers yes, the categories are the ones it accepts.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";

type Closure = (...args: unknown[]) => unknown;

const TYPE_NUMBERS: readonly number[] = Object.values(PokemonType).filter((v): v is number => typeof v === "number");
const CATEGORY_NUMBERS: readonly number[] = Object.values(MoveCategory).filter(
  (v): v is number => typeof v === "number",
);

/** One move type, shown as "GROUND"; read back from the closure `(pokemon, _, move) => pokemon?.getMoveType(move) === type`. */
export const boostedTypeCodec: ParamCodec = {
  toCtor: enumCodec(PokemonType, "type").toCtor,
  fromInstance: raw => {
    if (typeof raw !== "function") {
      return;
    }
    const accepted = TYPE_NUMBERS.filter(type => (raw as Closure)({ getMoveType: () => type }, undefined, {}) === true);
    return accepted.length === 1 ? (PokemonType[accepted[0]] as string) : undefined;
  },
};

/** Player words for the three move kinds. Typing is case-insensitive, so "Special", "special" and "SPECIAL" all work. */
const CATEGORY_WORDS: Readonly<Record<string, number>> = {
  physical: MoveCategory.PHYSICAL,
  special: MoveCategory.SPECIAL,
  status: MoveCategory.STATUS,
};

/** Splits a typed list ("physical, Special") into trimmed lower-case words; "and" and "/" count as commas. */
function typedWords(value: unknown): string[] {
  return String(value)
    .toLowerCase()
    .split(/,|\/|\band\b/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/** A list of move categories, shown as "physical,special"; read back from the closure `(_, _, move) => list.includes(move.category)`. */
export const boostedCategoriesCodec: ParamCodec = {
  toCtor: value =>
    typedWords(value).map(word => {
      const resolved = CATEGORY_WORDS[word.replace(/ moves?$/, "")];
      if (typeof resolved !== "number") {
        throw new Error(`"${word}" is not a move kind; type physical, special or status`);
      }
      return resolved;
    }),
  fromInstance: raw => {
    if (typeof raw !== "function") {
      return;
    }
    const accepted = CATEGORY_NUMBERS.filter(category => (raw as Closure)(undefined, undefined, { category }) === true);
    return accepted.length === 0
      ? undefined
      : accepted.map(category => (MoveCategory[category] as string).toLowerCase()).join(",");
  },
};

/** Player word for each move property a staff member can grant, in the order shown in the list of choices. */
const FLAG_WORDS: ReadonlyArray<readonly [word: string, flag: keyof typeof MoveFlags]> = [
  ["contact", "MAKES_CONTACT"],
  ["sound", "SOUND_BASED"],
  ["biting", "BITING_MOVE"],
  ["pulse", "PULSE_MOVE"],
  ["punching", "PUNCHING_MOVE"],
  ["slicing", "SLICING_MOVE"],
  ["reckless", "RECKLESS_MOVE"],
  ["ball", "BALLBOMB_MOVE"],
  ["powder", "POWDER_MOVE"],
  ["dance", "DANCE_MOVE"],
  ["wind", "WIND_MOVE"],
  ["triage", "TRIAGE_MOVE"],
  ["air", "AIR_BASED"],
  ["arrow", "ARROW_BASED"],
  ["bone", "BONE_BASED"],
  ["drill", "DRILL_BASED"],
  ["field", "FIELD_BASED"],
  ["hammer", "HAMMER_BASED"],
  ["horn", "HORN_BASED"],
  ["kicking", "KICKING_MOVE"],
  ["lunar", "LUNAR_MOVE"],
  ["throwing", "THROW_BASED"],
  ["weather", "WEATHER_BASED"],
];

/** The words staff may type for a move property, shown as the choices of the setting. */
export const MOVE_PROPERTY_WORDS: readonly string[] = FLAG_WORDS.map(([word]) => word);

/**
 * A list of move properties typed as plain words ("punching, kicking"), case-insensitive. The old code names
 * ("PUNCHING_MOVE") are still accepted so saved abilities keep loading. Read back from the granted-flag list.
 */
export const moveFlagWordsCodec: ParamCodec = {
  toCtor: value =>
    typedWords(value).map(word => {
      const plain = word.replace(/ moves?$/, "").replace(/-/g, " ");
      const entry = FLAG_WORDS.find(([w, flag]) => w === plain || flag.toLowerCase() === plain.replace(/ /g, "_"));
      if (entry === undefined) {
        throw new Error(
          `"${word}" is not a move property; type words such as ${MOVE_PROPERTY_WORDS.slice(0, 8).join(", ")}`,
        );
      }
      return MoveFlags[entry[1]];
    }),
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    const words = raw.map(item => FLAG_WORDS.find(([, flag]) => MoveFlags[flag] === item)?.[0]);
    return words.every((word): word is string => word !== undefined) ? words.join(",") : undefined;
  },
};
