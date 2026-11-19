/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
// Hand-written codecs for the B11 chunk 3 declarations. Staff see and type player words ("Sun, Rain", "Attack, Speed",
// "Any move", "My max HP"); the classes want enum numbers, an options object value that may be absent, or a keyword.
// Every parser throws a plain-language error for text it does not understand, so a typo never builds a half-formed attr.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

type EnumTable = Readonly<Record<string, string | number>>;

/** Member names of an enum (the numeric reverse keys of a TypeScript numeric enum are dropped). */
function memberNames(table: EnumTable): string[] {
  return Object.keys(table).filter(key => Number.isNaN(Number(key)));
}

function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");
}

/** The member name a typed word stands for ("sp. atk", "Sp. Atk" and "SPATK" all mean SPATK). */
function nameFromWord(table: EnumTable, word: string, what: string): string {
  const wanted = normalise(word);
  for (const name of memberNames(table)) {
    if (normalise(name) === wanted || normalise(playerName(name)) === wanted) {
      return name;
    }
  }
  throw new Error(`"${word.trim()}" is not a known ${what}`);
}

function memberNameOf(table: EnumTable, raw: unknown): string | undefined {
  return memberNames(table).find(name => table[name] === raw);
}

/**
 * An ability number where 0 means "no ability": the class takes `undefined` for "no exception" and an AbilityId otherwise.
 * Written as a codec so a staff rule that leaves the number at 0 builds the same attr as a user that passed nothing.
 */
export const optionalAbilityNumberCodec: ParamCodec = {
  toCtor: value => (Number(value) === 0 ? undefined : Number(value)),
  fromInstance: raw => (typeof raw === "number" ? raw : 0),
};

/**
 * A list of enum members written as player words, "Sun, Extremely harsh sunlight". Empty text means "no list at all"
 * (`undefined`), which is NOT the same as an empty list: a class that tests `list !== undefined` treats an empty list as
 * "never", so the empty text must reach the constructor as a missing value.
 */
export function optionalWordListCodec(table: EnumTable, what: string): ParamCodec {
  return {
    toCtor: value => {
      const parts = String(value)
        .split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0);
      if (parts.length === 0) {
        return;
      }
      return parts.map(part => table[nameFromWord(table, part, what)]);
    },
    fromInstance: raw => {
      if (raw === undefined || raw === null) {
        return "";
      }
      if (!Array.isArray(raw)) {
        return;
      }
      const names = raw.map(item => memberNameOf(table, item));
      return names.every((name): name is string => name !== undefined)
        ? names.map(name => playerName(name)).join(", ")
        : undefined;
    },
  };
}

/** A list that must have at least one member (the class refuses an empty one). */
export function requiredWordListCodec(table: EnumTable, what: string): ParamCodec {
  const optional = optionalWordListCodec(table, what);
  return {
    toCtor: value => {
      const list = optional.toCtor(value);
      if (list === undefined) {
        throw new Error(`Pick at least one ${what}`);
      }
      return list;
    },
    fromInstance: raw => (Array.isArray(raw) ? optional.fromInstance(raw) : undefined),
  };
}

/** One enum member or a keyword for "none": the keyword (for example "ANY") means the constructor gets `undefined`. */
export function optionalEnumCodec(table: EnumTable, keyword: string): ParamCodec {
  return {
    toCtor: value => {
      if (String(value) === keyword) {
        return;
      }
      const resolved = table[String(value)];
      if (typeof resolved !== "number") {
        throw new Error(`"${String(value)}" is not a known move flag`);
      }
      return resolved;
    },
    fromInstance: raw => (raw === undefined || raw === null ? keyword : memberNameOf(table, raw)),
  };
}

/**
 * A total power multiplier cap where 0 means "no limit": the class turns a missing cap into infinity, and a staff rule
 * that writes 0 builds the same attr as a user that passed none.
 */
export const optionalCapCodec: ParamCodec = {
  toCtor: value => (Number(value) <= 0 ? undefined : Number(value)),
  fromInstance: raw => (raw === Number.POSITIVE_INFINITY ? 0 : typeof raw === "number" ? raw : undefined),
};

/** The two things the self-damage can be a share of, as words, mapped to the strings the class stores. */
export const SELF_DAMAGE_BASIS_WORDS = ["Damage I just dealt", "My max HP"] as const;
export const selfDamageBasisCodec: ParamCodec = {
  toCtor: value => {
    if (value === SELF_DAMAGE_BASIS_WORDS[0]) {
      return "damageDealt";
    }
    if (value === SELF_DAMAGE_BASIS_WORDS[1]) {
      return "maxHp";
    }
    throw new Error(`"${String(value)}" is not one of: ${SELF_DAMAGE_BASIS_WORDS.join(", ")}`);
  },
  fromInstance: raw => {
    if (raw === "damageDealt") {
      return SELF_DAMAGE_BASIS_WORDS[0];
    }
    if (raw === "maxHp") {
      return SELF_DAMAGE_BASIS_WORDS[1];
    }
    return;
  },
};
