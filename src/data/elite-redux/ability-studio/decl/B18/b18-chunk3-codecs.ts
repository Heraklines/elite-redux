/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codecs for the B18 chunk 3 stat declarations. Staff see and pick player words ("Attack, Sp. Atk", "5");
// the classes want enum numbers and fractions. Every parser throws a plain-language error for text it does not understand.
import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";

// ---------------------------------------------------------------------------------------------------------------
// Which stats to compare (HigherStatMultiplierAbAttr, AllyHigherStatMultiplierAbAttr).
//
// The classes compare the stats in the order they are given and the FIRST listed wins a tie, so every choice keeps the fixed
// order Attack, Defense, Sp. Atk, Sp. Def, Speed. Both users list Attack before Sp. Atk and Defense before Sp. Def, which is
// that same order. A pick list of every non-empty subset replaces typed text, so there is nothing to misspell.

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
  // Pairs first (the shipped choices), then the other sets.
  .sort((a, b) => Math.abs(a.stats.length - 2) - Math.abs(b.stats.length - 2));

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
// A share written as a fraction by the class (0.05) and as a whole percent by staff (5).

export const fractionAsPercentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  // toPrecision drops float noise (0.07 * 100 is 7.000000000000001 otherwise).
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};
