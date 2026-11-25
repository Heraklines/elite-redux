/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";

// Hand-written codecs for the B11 chunk 4 declarations. Staff see and pick player words ("Speed", "Replace the stat", the name
// of an ability); the classes want enum numbers, a yes/no flag or an ability id. Every parser throws a plain-language error
// for text it does not understand, so a typo never builds a half-formed attr.

// ---------------------------------------------------------------------------------------------------------------
// The stat whose value is copied or added (SpeedBonusToStatAbAttr `sourceStat`). The class documents an EffectiveStat
// (HP, Attack ... Speed); max HP is not offered because no ability uses it and it is not a combat stat.

const SOURCE_STATS = [
  { word: playerName("ATK"), stat: Stat.ATK },
  { word: playerName("DEF"), stat: Stat.DEF },
  { word: playerName("SPATK"), stat: Stat.SPATK },
  { word: playerName("SPDEF"), stat: Stat.SPDEF },
  { word: playerName("SPD"), stat: Stat.SPD },
] as const;

export const SOURCE_STAT_OPTIONS: readonly string[] = SOURCE_STATS.map(entry => entry.word);

export const sourceStatCodec: ParamCodec = {
  toCtor: value => {
    const entry = SOURCE_STATS.find(candidate => candidate.word === value);
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${SOURCE_STAT_OPTIONS.join(", ")}`);
    }
    return entry.stat;
  },
  fromInstance: raw => SOURCE_STATS.find(entry => entry.stat === raw)?.word,
};

// ---------------------------------------------------------------------------------------------------------------
// "Add on top of the stat" or "Replace the stat" (SpeedBonusToStatAbAttr `replace`, a flag that means two things).

export const BONUS_MODE_WORDS = ["Add on top of the stat", "Replace the stat"] as const;

export const bonusModeCodec: ParamCodec = {
  toCtor: value => {
    if (value === BONUS_MODE_WORDS[0]) {
      return false;
    }
    if (value === BONUS_MODE_WORDS[1]) {
      return true;
    }
    throw new Error(`"${String(value)}" is not one of: ${BONUS_MODE_WORDS.join(", ")}`);
  },
  fromInstance: raw => (raw === true ? BONUS_MODE_WORDS[1] : raw === false ? BONUS_MODE_WORDS[0] : undefined),
};

// ---------------------------------------------------------------------------------------------------------------
// An ability, typed by its name the way a player writes it ("Slow Start", "slow start"). Vanilla and Elite Redux abilities
// are both found by their display name; when two share a name the lower id (the vanilla one) wins, which is also what the
// reverse lookup answers, so reading a value back and building it again gives the same ability.

function abilityKeyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const abilityNameCodec: ParamCodec = {
  toCtor: value => {
    const key = abilityKeyOf(String(value));
    const found =
      key.length === 0
        ? undefined
        : (allAbilities as readonly ({ id: number; name: string } | undefined)[]).find(
            ability => ability !== undefined && ability.id !== 0 && abilityKeyOf(ability.name) === key,
          );
    if (found === undefined) {
      throw new Error(`"${String(value)}" is not the name of an ability`);
    }
    return found.id;
  },
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    const ability = (allAbilities as readonly ({ id: number; name: string } | undefined)[])[raw];
    return ability?.name;
  },
};
