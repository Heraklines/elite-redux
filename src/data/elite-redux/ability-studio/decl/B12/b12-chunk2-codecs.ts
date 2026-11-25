/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. Codecs of the status and entry-window classes (a helper, not a declaration: the registry only collects
// `*.decl.ts` and `bindings.ts`). Staff read and write plain words; the classes take enum numbers and small objects.
//
//   statusListCodec         "Paralysis, Bad poison" <-> [PARALYSIS, TOXIC]   (empty text <-> the empty list = every status)
//   highestStatRulesCodec   "Attack or Defense -1; Sp. Atk or Sp. Def -1"
//                           <-> [{ candidates: [ATK, DEF], stages: -1 }, { candidates: [SPATK, SPDEF], stages: -1 }]
//   optionalTextCodec       "" <-> undefined (an optional name the class may leave out)
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";

// ---------------------------------------------------------------------------------------------------------------
// Status lists

/** Player words for the six status conditions a list can name, in the order the pickers show them. */
const STATUS_WORDS: readonly (readonly [status: StatusEffect, word: string])[] = [
  [StatusEffect.POISON, "Poison"],
  [StatusEffect.TOXIC, "Bad poison"],
  [StatusEffect.PARALYSIS, "Paralysis"],
  [StatusEffect.SLEEP, "Sleep"],
  [StatusEffect.FREEZE, "Freeze"],
  [StatusEffect.BURN, "Burn"],
];

/** The words the status list accepts, for the setting's label and for tests. */
export const STATUS_LIST_WORDS: readonly string[] = STATUS_WORDS.map(([, word]) => word);

function statusOfWord(word: string): StatusEffect | undefined {
  const wanted = word.trim().toLowerCase();
  return STATUS_WORDS.find(([, name]) => name.toLowerCase() === wanted)?.[0];
}

/** "Paralysis, Bad poison" to the constructor list; empty text is the empty list ("every status"). */
export function parseStatusList(text: string): StatusEffect[] {
  return text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => {
      const status = statusOfWord(part);
      if (status === undefined) {
        throw new Error(`"${part}" is not a status condition; use ${STATUS_LIST_WORDS.join(", ")}`);
      }
      return status;
    });
}

/** The constructor list to text ("" for the empty list); undefined when it holds something the words cannot say. */
export function formatStatusList(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) {
    return;
  }
  const words = raw.map(item => STATUS_WORDS.find(([status]) => status === item)?.[1]);
  return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
}

export const statusListCodec: ParamCodec = {
  toCtor: value => parseStatusList(String(value)),
  fromInstance: raw => formatStatusList(raw),
};

// ---------------------------------------------------------------------------------------------------------------
// "Lower the highest of these stats" rules

/** The five stats that have a value to compare (accuracy and evasion are not stats a foe can be "highest" in). */
const COMPARABLE_STAT_WORDS: readonly (readonly [stat: Stat, word: string])[] = [
  [Stat.ATK, "Attack"],
  [Stat.DEF, "Defense"],
  [Stat.SPATK, "Sp. Atk"],
  [Stat.SPDEF, "Sp. Def"],
  [Stat.SPD, "Speed"],
];

export const COMPARABLE_STAT_NAMES: readonly string[] = COMPARABLE_STAT_WORDS.map(([, word]) => word);

/** The most stages a rule may name (the game stops at 6). */
export const MAX_RULE_STAGES = 6;

export interface HighestStatRuleValue {
  readonly candidates: readonly number[];
  readonly stages: number;
}

function comparableStatOfWord(word: string): number | undefined {
  const wanted = word.trim().toLowerCase();
  return COMPARABLE_STAT_WORDS.find(([, name]) => name.toLowerCase() === wanted)?.[0];
}

/** "Attack or Defense -1; Sp. Atk or Sp. Def -1" to the rule list; throws a plain sentence for anything it cannot read. */
export function parseHighestStatRules(text: string): HighestStatRuleValue[] {
  const parts = text
    .split(";")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    throw new Error("name at least one rule, for example Attack or Defense -1");
  }
  return parts.map(part => {
    const match = /^(.*?)\s*([+-])\s*(\d+)$/.exec(part);
    if (match === null) {
      throw new Error(`"${part}" is not a rule; write the stats, then a number such as Attack or Defense -1`);
    }
    const candidates = match[1]
      .split(/\s+or\s+/i)
      .map(word => word.trim())
      .filter(word => word.length > 0)
      .map(word => {
        const stat = comparableStatOfWord(word);
        if (stat === undefined) {
          throw new Error(`"${word}" is not a stat to compare; use ${COMPARABLE_STAT_NAMES.join(", ")}`);
        }
        return stat;
      });
    if (candidates.length === 0) {
      throw new Error(`"${part}" names no stat; write for example Attack or Defense -1`);
    }
    const stages = (match[2] === "-" ? -1 : 1) * Number(match[3]);
    if (stages === 0 || Math.abs(stages) > MAX_RULE_STAGES) {
      throw new Error(`"${part}" needs a number of stages from 1 to ${MAX_RULE_STAGES}, not zero`);
    }
    return { candidates, stages };
  });
}

/** The rule list to text; undefined when it holds something the words cannot say. */
export function formatHighestStatRules(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return;
  }
  const parts: string[] = [];
  for (const rule of raw as readonly Partial<HighestStatRuleValue>[]) {
    if (!Array.isArray(rule.candidates) || rule.candidates.length === 0 || typeof rule.stages !== "number") {
      return;
    }
    const words = rule.candidates.map(stat => COMPARABLE_STAT_WORDS.find(([value]) => value === stat)?.[1]);
    if (!words.every((word): word is string => word !== undefined)) {
      return;
    }
    parts.push(`${words.join(" or ")} ${rule.stages > 0 ? "+" : "-"}${Math.abs(rule.stages)}`);
  }
  return parts.join("; ");
}

export const highestStatRulesCodec: ParamCodec = {
  toCtor: value => parseHighestStatRules(String(value)),
  fromInstance: raw => formatHighestStatRules(raw),
};

// ---------------------------------------------------------------------------------------------------------------
// An optional name

/** Empty text is "no name" (the class leaves the option out); anything else is the name itself. */
export const optionalTextCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    return text.length === 0 ? undefined : text;
  },
  fromInstance: raw => (typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : undefined),
};
