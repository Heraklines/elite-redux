/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Setting translators shared by the B04 stat and status declarations. The file is not a declaration (the registry only
// collects *.decl.ts and bindings.ts); it only holds the codecs those declarations have in common.
//
// Staff see PLAYER words ("Attack", "Sp. Atk", "Bad poison"), never the enum constants (ATK, SPATK, TOXIC). The codecs
// translate in both directions. They also accept the old constant spelling (case-insensitive) so a saved value written
// before the rename still builds the same attr.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

/** The value staff pick for "every stat". The class stores it as `undefined` (no protected stat). */
export const EVERY_STAT = "Every stat";

/** Player name of each stat that can be lowered, in the order the pickers show them. */
const STAT_NAMES: ReadonlyArray<readonly [string, Stat]> = [
  ["Attack", Stat.ATK],
  ["Defense", Stat.DEF],
  ["Sp. Atk", Stat.SPATK],
  ["Sp. Def", Stat.SPDEF],
  ["Speed", Stat.SPD],
  ["Accuracy", Stat.ACC],
  ["Evasion", Stat.EVA],
];

/** The stat choices staff see (after "Every stat"). */
export const STAT_CHOICES: readonly string[] = STAT_NAMES.map(([name]) => name);

/** Player name of each status condition, in the order the pickers show them. */
const STATUS_NAMES: ReadonlyArray<readonly [string, StatusEffect]> = [
  ["Poison", StatusEffect.POISON],
  ["Bad poison", StatusEffect.TOXIC],
  ["Paralysis", StatusEffect.PARALYSIS],
  ["Sleep", StatusEffect.SLEEP],
  ["Freeze", StatusEffect.FREEZE],
  ["Burn", StatusEffect.BURN],
];

/** The status choices staff see. */
export const STATUS_CHOICES: readonly string[] = STATUS_NAMES.map(([name]) => name);

/** Player name of each battle effect the confusion-after-status class can apply for a chosen number of turns. */
const TAG_NAMES: ReadonlyArray<readonly [string, BattlerTagType]> = [
  ["Confusion", BattlerTagType.CONFUSED],
];

/** The battle effect choices staff see. */
export const TAG_CHOICES: readonly string[] = TAG_NAMES.map(([name]) => name);

/** Loose comparison key: lower case, letters and digits only ("Sp. Atk" and "SPATK" both become "spatk"). */
function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookup<T>(table: ReadonlyArray<readonly [string, T]>, enumNames: Readonly<Record<string, T>>, text: string): T | undefined {
  const wanted = key(text);
  const player = table.find(([name]) => key(name) === wanted);
  if (player !== undefined) {
    return player[1];
  }
  const legacy = Object.keys(enumNames).find(name => key(name) === wanted);
  return legacy === undefined ? undefined : enumNames[legacy];
}

function nameFor<T>(table: ReadonlyArray<readonly [string, T]>, raw: unknown): string | undefined {
  return table.find(([, value]) => value === raw)?.[0];
}

const STAT_ENUM = Stat as unknown as Readonly<Record<string, Stat>>;
const STATUS_ENUM = StatusEffect as unknown as Readonly<Record<string, StatusEffect>>;
const TAG_ENUM = BattlerTagType as unknown as Readonly<Record<string, BattlerTagType>>;

/** One stat by its player name, or "Every stat" for the constructor's "no stat given" (`undefined`). */
export const oneStatOrEveryCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value);
    if (key(text) === key(EVERY_STAT) || key(text) === "all") {
      return undefined;
    }
    const stat = lookup(STAT_NAMES, STAT_ENUM, text);
    if (stat === undefined) {
      throw new Error(`"${text}" is not a known stat`);
    }
    return stat;
  },
  fromInstance: raw => (raw === undefined || raw === null ? EVERY_STAT : nameFor(STAT_NAMES, raw)),
};

function statusNames(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) {
    return;
  }
  const names = raw.map(item => nameFor(STATUS_NAMES, item));
  return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
}

/** A comma separated list of status names; an empty text means "every status" (the classes take an empty list). */
export const statusListCodec: ParamCodec = {
  toCtor: value =>
    String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .map(part => {
        const status = lookup(STATUS_NAMES, STATUS_ENUM, part);
        if (status === undefined) {
          throw new Error(`"${part}" is not a known status condition`);
        }
        return status;
      }),
  fromInstance: statusNames,
};

/** The same list, read back from a class that keeps the statuses in a Set. */
export const statusSetCodec: ParamCodec = {
  toCtor: statusListCodec.toCtor,
  fromInstance: raw => statusNames(raw instanceof Set ? [...raw] : raw),
};

/** One battle effect by its player name ("Confusion"). */
export const battleEffectCodec: ParamCodec = {
  toCtor: value => {
    const tag = lookup(TAG_NAMES, TAG_ENUM, String(value));
    if (tag === undefined) {
      throw new Error(`"${String(value)}" is not a known battle effect`);
    }
    return tag;
  },
  fromInstance: raw => nameFor(TAG_NAMES, raw),
};

/** "Attack" / "Sp. Atk" / ... or "every stat" for a summary (summaries receive player-facing words already). */
export function statWords(value: unknown): string {
  const text = String(value);
  return key(text) === key(EVERY_STAT) || key(text) === "all" ? "every stat" : text;
}

/** "Burn, Poison" or "every status condition" for a summary. */
export function statusWords(value: unknown): string {
  const text = String(value).trim();
  return text.length === 0 ? "every status condition" : text;
}
