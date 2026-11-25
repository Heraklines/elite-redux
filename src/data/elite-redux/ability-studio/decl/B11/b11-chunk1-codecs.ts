/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { playerName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

// Hand-written codecs for the B11 chunk 1 declarations. Staff see and pick player words ("Speed", "Burn", "Circle throw",
// "Trap when the stage reaches -3 or lower"); the classes want enum numbers, an options object with absent keys, or a plain
// number that means "not set". Every parser throws a plain-language error for text it does not understand, so a typo never
// builds a half-formed attr. Nothing here is typed free except a move name, and a move name must be a real move.

type EnumTable = Readonly<Record<string, string | number>>;

function memberNameOf(table: EnumTable, raw: unknown): string | undefined {
  return Object.keys(table).find(name => Number.isNaN(Number(name)) && table[name] === raw);
}

/**
 * Lifts a codec so it reads one key out of an options object. PostTurnFoeStatDropAbAttr keeps its constructor options in
 * the private field `opts`, so every param of it has the path `opts` and picks its own key here.
 */
export function fromOptionsKey(key: string, inner: ParamCodec): ParamCodec {
  return {
    toCtor: inner.toCtor,
    fromInstance: raw =>
      typeof raw === "object" && raw !== null ? inner.fromInstance((raw as Record<string, unknown>)[key]) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A stat the foe can lose (Attack ... Evasion), as the words players use.

const BATTLE_STATS = [
  { word: playerName("ATK"), stat: Stat.ATK },
  { word: playerName("DEF"), stat: Stat.DEF },
  { word: playerName("SPATK"), stat: Stat.SPATK },
  { word: playerName("SPDEF"), stat: Stat.SPDEF },
  { word: playerName("SPD"), stat: Stat.SPD },
  { word: playerName("ACC"), stat: Stat.ACC },
  { word: playerName("EVA"), stat: Stat.EVA },
] as const;

export const BATTLE_STAT_OPTIONS: readonly string[] = BATTLE_STATS.map(entry => entry.word);

export const battleStatCodec: ParamCodec = {
  toCtor: value => {
    const entry = BATTLE_STATS.find(candidate => candidate.word === value);
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${BATTLE_STAT_OPTIONS.join(", ")}`);
    }
    return entry.stat;
  },
  fromInstance: raw => BATTLE_STATS.find(entry => entry.stat === raw)?.word,
};

/** A plain number the class reads as it is (the number of stages). */
export const plainNumberCodec: ParamCodec = {
  toCtor: value => Number(value),
  fromInstance: raw => (typeof raw === "number" ? raw : undefined),
};

// ---------------------------------------------------------------------------------------------------------------
// "Trap the foe when its stage reaches ...". The class takes an optional stage; the check is `stage + change <= limit`.

export const TRAP_NEVER = "Never trap";
export const TRAP_OPTIONS: readonly string[] = [
  TRAP_NEVER,
  ...[1, 2, 3, 4, 5, 6].map(stage => `When it reaches -${stage} or lower`),
];

export const trapAtStageCodec: ParamCodec = {
  toCtor: value => {
    if (value === TRAP_NEVER) {
      return;
    }
    const index = TRAP_OPTIONS.indexOf(String(value));
    if (index < 1) {
      throw new Error(`"${String(value)}" is not one of: ${TRAP_OPTIONS.join("; ")}`);
    }
    return -index;
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return TRAP_NEVER;
    }
    return typeof raw === "number" && Number.isInteger(raw) && raw <= -1 && raw >= -6 ? TRAP_OPTIONS[-raw] : undefined;
  },
};

/** A yes/no setting the class keeps as "true or absent". Writing "no" builds the same attr as a user that passed nothing. */
export const trueOrAbsentCodec: ParamCodec = {
  toCtor: value => (value === true ? true : undefined),
  fromInstance: raw => raw === true,
};

// ---------------------------------------------------------------------------------------------------------------
// The status the foe also gets each turn (None = the class has no status to give).

export const STATUS_NONE = "None";
const STATUS_NAMES = ["POISON", "TOXIC", "PARALYSIS", "SLEEP", "FREEZE", "BURN"] as const;
export const GIVEN_STATUS_OPTIONS: readonly string[] = [STATUS_NONE, ...STATUS_NAMES.map(name => playerName(name))];

export const givenStatusCodec: ParamCodec = {
  toCtor: value => {
    if (value === STATUS_NONE) {
      return;
    }
    const name = STATUS_NAMES.find(candidate => playerName(candidate) === value);
    if (name === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${GIVEN_STATUS_OPTIONS.join(", ")}`);
    }
    return (StatusEffect as unknown as EnumTable)[name];
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return STATUS_NONE;
    }
    const name = memberNameOf(StatusEffect as unknown as EnumTable, raw);
    return name === undefined || !(STATUS_NAMES as readonly string[]).includes(name) ? undefined : playerName(name);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// A move, typed by its name the way a player writes it ("Circle throw", "Chilly Reception", "weather ball").

function moveKeyOf(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const moveNameCodec: ParamCodec = {
  toCtor: value => {
    const resolved = (MoveId as unknown as EnumTable)[moveKeyOf(String(value))];
    if (typeof resolved !== "number") {
      throw new Error(`"${String(value)}" is not the name of a move`);
    }
    return resolved;
  },
  fromInstance: raw => {
    const name = memberNameOf(MoveId as unknown as EnumTable, raw);
    return name === undefined ? undefined : playerName(name);
  },
};

/** The power of a scripted move, where 0 means "the move's own power" (the class takes no number at all then). */
export const optionalPowerCodec: ParamCodec = {
  toCtor: value => (Number(value) <= 0 ? undefined : Number(value)),
  fromInstance: raw => (raw === undefined || raw === null ? 0 : typeof raw === "number" ? raw : undefined),
};
