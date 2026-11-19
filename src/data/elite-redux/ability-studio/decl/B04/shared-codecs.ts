/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Setting translators shared by the B04 stat and status declarations. The file is not a declaration (the registry only
// collects *.decl.ts and bindings.ts); it only holds the two codecs those declarations have in common.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

/** The value staff pick for "every stat". The class stores it as `undefined` (no protected stat). */
export const EVERY_STAT = "ALL";

const oneStat = enumCodec(Stat, "stat");

/** One stat name, or "ALL" for the constructor's "no stat given" (`undefined`). */
export const oneStatOrEveryCodec: ParamCodec = {
  toCtor: value => (String(value) === EVERY_STAT ? undefined : oneStat.toCtor(value)),
  fromInstance: raw => (raw === undefined || raw === null ? EVERY_STAT : oneStat.fromInstance(raw)),
};

const statusList = enumListCodec(StatusEffect, "status");

/** A comma separated list of status names; an empty text means "every status" (the classes take an empty list). */
export const statusListCodec: ParamCodec = statusList;

/** The same list, read back from a class that keeps the statuses in a Set. */
export const statusSetCodec: ParamCodec = {
  toCtor: statusList.toCtor,
  fromInstance: raw => statusList.fromInstance(raw instanceof Set ? [...raw] : raw),
};

/** "Attack" / "Sp. Atk" / ... or "every stat" for a summary (summaries receive player-facing words already). */
export function statWords(value: unknown): string {
  const text = String(value);
  return text === EVERY_STAT || text === "All" ? "every stat" : text;
}

/** "Burn, Poison" or "every status condition" for a summary. */
export function statusWords(value: unknown): string {
  const text = String(value).trim();
  return text.length === 0 ? "every status condition" : text;
}
