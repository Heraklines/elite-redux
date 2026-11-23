/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";
// Hand-written codecs for the B11 chunk 3 declarations. Staff see and pick player words ("Attack, Sp. Atk", "Any move",
// "My max HP", "All"); the classes want enum numbers, an options object value that may be absent, a keyword or a rest list.
// Every parser throws a plain-language error for text it does not understand, so a typo never builds a half-formed attr.
// Nothing here is typed free: every choice is a pick from a fixed list.
import { StatusEffect } from "#enums/status-effect";

type EnumTable = Readonly<Record<string, string | number>>;

function memberNameOf(table: EnumTable, raw: unknown): string | undefined {
  return Object.keys(table).find(name => Number.isNaN(Number(name)) && table[name] === raw);
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
        throw new Error(`"${String(value)}" is not a known move property`);
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

// ---------------------------------------------------------------------------------------------------------------
// Which stats to compare (SelfHighestStatBoostOnSummonAbAttr).
//
// The class compares the stats in the order it is given and the FIRST listed wins a tie, so every choice keeps the fixed
// order Attack, Defense, Sp. Atk, Sp. Def, Speed (the order every shipped user already has). A pick list of every
// non-empty subset replaces typed text, so there is nothing to misspell.

const COMPARABLE_STATS = [
  { word: playerName("ATK"), stat: Stat.ATK },
  { word: playerName("DEF"), stat: Stat.DEF },
  { word: playerName("SPATK"), stat: Stat.SPATK },
  { word: playerName("SPDEF"), stat: Stat.SPDEF },
  { word: playerName("SPD"), stat: Stat.SPD },
] as const;

interface StatChoice {
  readonly words: string;
  readonly stats: readonly number[];
}

const STAT_CHOICES: readonly StatChoice[] = Array.from({ length: 31 }, (_unused, index) => index + 1)
  .map(mask => COMPARABLE_STATS.filter((_stat, bit) => (mask & (1 << bit)) !== 0))
  .map(members => ({ words: members.map(member => member.word).join(", "), stats: members.map(member => member.stat) }))
  // The set of all five first (the common choice), then smaller sets.
  .sort((a, b) => b.stats.length - a.stats.length);

/** Every choice of "which stats to compare", as the words staff pick. */
export const STAT_SET_OPTIONS: readonly string[] = STAT_CHOICES.map(choice => choice.words);

export const statSetCodec: ParamCodec = {
  toCtor: value => {
    const choice = STAT_CHOICES.find(candidate => candidate.words === value);
    if (choice === undefined) {
      throw new Error(`"${String(value)}" is not one of the stat choices`);
    }
    return [...choice.stats];
  },
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    return STAT_CHOICES.find(
      choice => choice.stats.length === raw.length && choice.stats.every((stat, index) => stat === raw[index]),
    )?.words;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Which status condition to block (SandStatusImmunityAbAttr). The class takes the statuses as rest arguments: none at
// all means every status except fainting, one means just that one.

export const BLOCKED_STATUS_ALL = "ALL";
export const BLOCKED_STATUS_OPTIONS = [
  BLOCKED_STATUS_ALL,
  "POISON",
  "TOXIC",
  "PARALYSIS",
  "SLEEP",
  "FREEZE",
  "BURN",
] as const;

export const blockedStatusCodec: ParamCodec = {
  toCtor: value => {
    if (String(value) === BLOCKED_STATUS_ALL) {
      return [];
    }
    const resolved = (StatusEffect as unknown as EnumTable)[String(value)];
    if (typeof resolved !== "number") {
      throw new Error(`"${String(value)}" is not a status condition`);
    }
    return [resolved];
  },
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    if (raw.length === 0) {
      return BLOCKED_STATUS_ALL;
    }
    return raw.length === 1 ? memberNameOf(StatusEffect as unknown as EnumTable, raw[0]) : undefined;
  },
};
