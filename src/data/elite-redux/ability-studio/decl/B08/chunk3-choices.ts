/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
// Shared by the B08 chunk 3 declarations (copy-a-move, counter-attack and the critical-hit classes): the player-facing
// words for the choices of those classes and the codecs that turn them into what the constructors want.
// This is not a declaration (the registry only collects `*.decl.ts` and `bindings.ts`).
import {
  FLAG_WORDS,
  NO_FILTER,
  PROPERTY_CHOICES,
  propertyCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";

const FLAG_VALUES = MoveFlags as unknown as Record<string, number>;
const TYPE_VALUES = PokemonType as unknown as Record<string, number>;

function nameOfFlag(raw: unknown): string | undefined {
  const flag = MOVE_FLAG_OPTIONS.find(name => FLAG_VALUES[name] === raw);
  return flag === undefined ? undefined : FLAG_WORDS[flag];
}

// ---------------------------------------------------------------------------------------------------------------
// One move, by the name a player knows ("Icicle spear").

/** "FOCUS_BLAST" -> "Focus blast": spaces instead of underscores, only the first letter is a capital. */
function words(constant: string): string {
  const text = constant.toLowerCase().split("_").join(" ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Every move a player can know, vanilla AND the Elite Redux custom moves (ids from 5000, which live in their own table
 * ErMoveId and have no forward name in MoveId). The chunk 2 name table lists the vanilla moves only; the counter-attack of
 * Brain Mass (Drain Brain) and the filter of Penta-Punch (Five-Star Fury) are custom moves, so this chunk keeps its own.
 */
const MOVE_BY_NAME = new Map<string, number>();
const NAME_BY_MOVE = new Map<number, string>();
for (const table of [MoveId, ErMoveId] as Readonly<Record<string, string | number>>[]) {
  for (const constant of Object.keys(table)) {
    const value = table[constant];
    if (typeof value !== "number" || !Number.isNaN(Number(constant)) || NAME_BY_MOVE.has(value)) {
      continue;
    }
    let shown = words(constant);
    if (MOVE_BY_NAME.has(shown.toLowerCase())) {
      shown = `${shown} (${constant.toLowerCase().split("_").join(" ")})`;
    }
    MOVE_BY_NAME.set(shown.toLowerCase(), value);
    NAME_BY_MOVE.set(value, shown);
  }
}

/** Every move by the name a player knows, custom moves included. */
export const ALL_MOVE_NAMES: readonly string[] = [...NAME_BY_MOVE.values()];

function moveOfName(name: string): number {
  const trimmed = name.trim();
  const id = MOVE_BY_NAME.get(trimmed.toLowerCase());
  if (id === undefined) {
    throw new Error(`"${trimmed}" is not a known move`);
  }
  return id;
}

/** One move by its player name <-> the move id. */
export const singleMoveCodec: ParamCodec = {
  toCtor: value => moveOfName(String(value)),
  fromInstance: raw => (typeof raw === "number" ? NAME_BY_MOVE.get(raw) : undefined),
};

function moveListOfText(text: string): number[] {
  return text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(moveOfName);
}

function moveListToText(ids: unknown): string | undefined {
  if (!Array.isArray(ids)) {
    return;
  }
  const shown = ids.map(id => NAME_BY_MOVE.get(id as number));
  return shown.every((name): name is string => name !== undefined) ? shown.join(", ") : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Counter-attack: which hits answer (the filter object) and the optional damage style.

export const EVERY_HIT = "Every damaging hit";
export const CONTACT_ONLY = "Only moves that make contact";
export const NON_CONTACT_ONLY = "Only moves that do not make contact";

const COUNTER_FLAG_NAMES = MOVE_FLAG_OPTIONS.filter(flag => flag !== "MAKES_CONTACT").map(flag => FLAG_WORDS[flag]);
export const COUNTER_FILTER_CHOICES: readonly string[] = [
  EVERY_HIT,
  CONTACT_ONLY,
  NON_CONTACT_ONLY,
  ...COUNTER_FLAG_NAMES.map(words => `Only ${words.toLowerCase()}`),
];

function counterFlagOf(text: string): string | undefined {
  return MOVE_FLAG_OPTIONS.find(flag => flag !== "MAKES_CONTACT" && `Only ${FLAG_WORDS[flag].toLowerCase()}` === text);
}

/**
 * The filter object <-> one choice. The class also supports a move category inside the filter; it does nothing
 * (see the declaration's notes), no live ability sets it, so it is not representable and reads back as undefined.
 */
export const counterFilterCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value);
    if (text === EVERY_HIT) {
      return;
    }
    if (text === CONTACT_ONLY) {
      return { contactRequired: true };
    }
    if (text === NON_CONTACT_ONLY) {
      return { contactExcluded: true };
    }
    const flag = counterFlagOf(text);
    if (flag === undefined) {
      throw new Error(`"${text}" is not a known counter-attack filter`);
    }
    return { flag: FLAG_VALUES[flag] };
  },
  fromInstance: raw => {
    const filter = (raw ?? {}) as {
      contactRequired?: boolean;
      contactExcluded?: boolean;
      flag?: number;
      category?: string;
    };
    if (filter.category !== undefined) {
      return;
    }
    const keys = Object.keys(filter).filter(key => (filter as Record<string, unknown>)[key] !== undefined);
    if (keys.length === 0) {
      return EVERY_HIT;
    }
    if (keys.length !== 1) {
      return;
    }
    if (filter.contactRequired === true) {
      return CONTACT_ONLY;
    }
    if (filter.contactExcluded === true) {
      return NON_CONTACT_ONLY;
    }
    if (filter.flag !== undefined) {
      const words = nameOfFlag(filter.flag);
      return words === undefined ? undefined : `Only ${words.toLowerCase()}`;
    }
    return;
  },
};

export const OWN_STYLE = "The move's own style";
export const STYLE_CHOICES = [OWN_STYLE, "Physical", "Special", "Status"] as const;

/** The optional battle-only damage style of the counter. */
export const styleCodec: ParamCodec = {
  toCtor: value =>
    value === OWN_STYLE ? undefined : (MoveCategory as unknown as Record<string, number>)[String(value).toUpperCase()],
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return OWN_STYLE;
    }
    const name = Object.keys(MoveCategory).find(
      key => Number.isNaN(Number(key)) && (MoveCategory as unknown as Record<string, number>)[key] === raw,
    );
    return name === undefined ? undefined : name.charAt(0) + name.slice(1).toLowerCase();
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Copy a move: the move property list and the move list (a preset, because a list of 15 move names is longer than a setting may be).

export const NO_PROPERTIES = "";

/** "Ball and bomb moves, Throwing moves" <-> [BALLBOMB_MOVE, THROW_BASED]; an empty text means no list. */
export const propertyListCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === "") {
      return;
    }
    return text.split(",").map(part => {
      const flag = MOVE_FLAG_OPTIONS.find(candidate => FLAG_WORDS[candidate] === part.trim());
      if (flag === undefined) {
        throw new Error(`"${part.trim()}" is not a known move property`);
      }
      return FLAG_VALUES[flag];
    });
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return NO_PROPERTIES;
    }
    if (!Array.isArray(raw)) {
      return;
    }
    const names = raw.map(nameOfFlag);
    return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
  },
};

export { PROPERTY_CHOICES, propertyCodec };

export const NO_MOVE_LIST = "No list";
export const LUNAR_MOVE_LIST = "Every move with star, moon or lunar in its name";
export const MOVE_LIST_CHOICES = [NO_MOVE_LIST, LUNAR_MOVE_LIST] as const;

/** The list Lunar Affinity is built with: every registered move whose name has star, moon or lunar in it (init-elite-redux-ability-upgrades.ts). */
export function lunarMoveIds(): number[] {
  return allMoves.flatMap(move => (move !== undefined && /(?:star|moon|lunar)/i.test(move.name) ? [move.id] : []));
}

export const moveListPresetCodec: ParamCodec = {
  toCtor: value => (value === LUNAR_MOVE_LIST ? lunarMoveIds() : undefined),
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return NO_MOVE_LIST;
    }
    const lunar = lunarMoveIds();
    return Array.isArray(raw) && raw.length === lunar.length && raw.every((id, index) => id === lunar[index])
      ? LUNAR_MOVE_LIST
      : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Critical-hit stage bonus: "which moves get the bonus".

const POWER_LIMIT = /^Moves with (\d+) power or less$/;
const ONLY_MOVES = "Only these moves: ";

function typeWordsOf(type: string): string {
  return `${type.charAt(0)}${type.slice(1).toLowerCase()}-type moves`;
}

export const CRIT_FILTER_EVERY = NO_FILTER;
export const CRIT_FILTER_POWER_LIMIT = "Moves with 50 power or less";
export const CRIT_FILTER_PUNCHING = FLAG_WORDS.PUNCHING_MOVE;
export const CRIT_FILTER_CHOICES: readonly string[] = [
  NO_FILTER,
  ...MOVE_FLAG_OPTIONS.map(flag => FLAG_WORDS[flag]),
  ...TYPE_OPTIONS.map(typeWordsOf),
  CRIT_FILTER_POWER_LIMIT,
  `${ONLY_MOVES}Water shuriken`,
  `${ONLY_MOVES}Five star fury`,
];

/**
 * { flag } | { type } | { maxBasePower } | { moveIds } <-> the choice of the move filter. A filter that combines several
 * conditions is supported by the class, no live ability uses it, and it reads back as undefined.
 */
export const critFilterCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value);
    if (text === NO_FILTER) {
      return;
    }
    const flag = MOVE_FLAG_OPTIONS.find(candidate => FLAG_WORDS[candidate] === text);
    if (flag !== undefined) {
      return { flag: FLAG_VALUES[flag] };
    }
    const type = TYPE_OPTIONS.find(candidate => typeWordsOf(candidate) === text);
    if (type !== undefined) {
      return { type: TYPE_VALUES[type] };
    }
    const limit = POWER_LIMIT.exec(text);
    if (limit !== null) {
      return { maxBasePower: Number(limit[1]) };
    }
    if (text.startsWith(ONLY_MOVES)) {
      return { moveIds: moveListOfText(text.slice(ONLY_MOVES.length)) };
    }
    throw new Error(`"${text}" is not a known move filter`);
  },
  fromInstance: raw => {
    const filter = (raw ?? {}) as { flag?: number; type?: number; maxBasePower?: number; moveIds?: number[] };
    const keys = Object.keys(filter).filter(key => (filter as Record<string, unknown>)[key] !== undefined);
    if (keys.length === 0) {
      return NO_FILTER;
    }
    if (keys.length !== 1) {
      return;
    }
    if (filter.flag !== undefined) {
      return nameOfFlag(filter.flag);
    }
    if (filter.type !== undefined) {
      const type = TYPE_OPTIONS.find(name => TYPE_VALUES[name] === filter.type);
      return type === undefined ? undefined : typeWordsOf(type);
    }
    if (filter.maxBasePower !== undefined) {
      return `Moves with ${filter.maxBasePower} power or less`;
    }
    if (filter.moveIds !== undefined) {
      const names = moveListToText(filter.moveIds);
      return names === undefined ? undefined : `${ONLY_MOVES}${names}`;
    }
    return;
  },
};
