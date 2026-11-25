/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { playerName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import { PokemonType } from "#enums/pokemon-type";

// Hand-written codecs for the B11 chunk 5 declarations. Staff see and pick player words ("Fire", "Any type", "Myself"); the
// classes want enum numbers, a missing value or a yes/no flag. Every parser throws a plain-language error for text it does
// not understand, so a typo never builds a half-formed attr.

type EnumTable = Readonly<Record<string, string | number>>;

// ---------------------------------------------------------------------------------------------------------------
// The one move type that gains the same-type bonus (StabAddAbAttr `targetType`). No type at all means "every move whose type
// I do not share", which the class stores as null.

export const ANY_MOVE_TYPE = "Any type";
export const MOVE_TYPE_WORDS: readonly string[] = [ANY_MOVE_TYPE, ...TYPE_OPTIONS.map(name => playerName(name))];

export const optionalMoveTypeCodec: ParamCodec = {
  toCtor: value => {
    if (value === ANY_MOVE_TYPE) {
      return;
    }
    const name = TYPE_OPTIONS.find(candidate => playerName(candidate) === value);
    if (name === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${MOVE_TYPE_WORDS.join(", ")}`);
    }
    return (PokemonType as unknown as EnumTable)[name];
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return ANY_MOVE_TYPE;
    }
    const name = TYPE_OPTIONS.find(candidate => (PokemonType as unknown as EnumTable)[candidate] === raw);
    return name === undefined ? undefined : playerName(name);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Who gets the stat change after my attack (StatChangeOnAttackAbAttr `selfTarget`, a flag that means two things).

export const STAT_CHANGE_RECIPIENT_WORDS = ["The Pokemon I hit", "Myself"] as const;

export const statChangeRecipientCodec: ParamCodec = {
  toCtor: value => {
    if (value === STAT_CHANGE_RECIPIENT_WORDS[0]) {
      return false;
    }
    if (value === STAT_CHANGE_RECIPIENT_WORDS[1]) {
      return true;
    }
    throw new Error(`"${String(value)}" is not one of: ${STAT_CHANGE_RECIPIENT_WORDS.join(", ")}`);
  },
  fromInstance: raw =>
    raw === true ? STAT_CHANGE_RECIPIENT_WORDS[1] : raw === false ? STAT_CHANGE_RECIPIENT_WORDS[0] : undefined,
};
