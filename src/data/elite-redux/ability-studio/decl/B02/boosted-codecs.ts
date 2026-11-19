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
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";

type Closure = (...args: unknown[]) => unknown;

const TYPE_NUMBERS: readonly number[] = Object.values(PokemonType).filter((v): v is number => typeof v === "number");
const CATEGORY_NUMBERS: readonly number[] = Object.values(MoveCategory).filter((v): v is number => typeof v === "number");

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

const categoryNames = enumListCodec(MoveCategory, "move kind");

/** A list of move categories, shown as "PHYSICAL,SPECIAL"; read back from the closure `(_, _, move) => list.includes(move.category)`. */
export const boostedCategoriesCodec: ParamCodec = {
  toCtor: categoryNames.toCtor,
  fromInstance: raw => {
    if (typeof raw !== "function") {
      return;
    }
    const accepted = CATEGORY_NUMBERS.filter(category => (raw as Closure)(undefined, undefined, { category }) === true);
    return accepted.length === 0 ? undefined : accepted.map(category => MoveCategory[category] as string).join(",");
  },
};
