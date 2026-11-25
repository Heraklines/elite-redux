/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. Codecs for the type-gated archetype classes (a helper, not a declaration: the registry only collects `*.decl.ts` and
// `bindings.ts`). Staff read and write plain words; the classes take enum numbers and options objects.
//
//   typeInOptionsCodec("type")       "FIGHTING"  <->  opts.type (the class keeps one options object and the codec reads the key back)
//   flagInOptionsCodec               "SOUND_BASED" <-> opts.flag (a MoveFlags bit)
//   statChangesInOptionsCodec        "Speed +1"  <->  opts.stats ([{ stat, stages }])
//   hazardSwitchCodec                true/false  <->  opts.clearHazards (left out = false)
//   statListCodec                    "Attack, Speed" <-> [Stat.ATK, Stat.SPD]  (the five core stats, in the order written)
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { formatStatChanges, parseStatChanges } from "./b12-chunk1-codecs";

type OptionsBag = Readonly<Record<string, unknown>> | undefined;

function nameOfEnumValue(table: Readonly<Record<string, string | number>>, raw: unknown): string | undefined {
  if (typeof raw !== "number") {
    return;
  }
  return Object.keys(table).find(key => table[key] === raw && Number.isNaN(Number(key)));
}

// ---------------------------------------------------------------------------------------------------------------
// Values inside a constructor options object

/** A type name ("FIGHTING") to the type number, and back from `opts[key]`. */
export function typeInOptionsCodec(key: string): ParamCodec {
  return {
    toCtor: value => {
      const resolved = (PokemonType as unknown as Record<string, string | number>)[String(value)];
      if (typeof resolved !== "number") {
        throw new Error(`"${String(value)}" is not a known type`);
      }
      return resolved;
    },
    fromInstance: raw =>
      nameOfEnumValue(PokemonType as unknown as Record<string, string | number>, (raw as OptionsBag)?.[key]),
  };
}

/** A move property name ("SOUND_BASED") to its flag bit, and back from `opts.flag`. */
export const flagInOptionsCodec: ParamCodec = {
  toCtor: value => {
    const resolved = (MoveFlags as unknown as Record<string, string | number>)[String(value)];
    if (typeof resolved !== "number") {
      throw new Error(`"${String(value)}" is not a known move property`);
    }
    return resolved;
  },
  fromInstance: raw =>
    nameOfEnumValue(MoveFlags as unknown as Record<string, string | number>, (raw as OptionsBag)?.flag),
};

/** "Speed +1, Attack -1" to the list the class takes, and back from `opts.stats`. */
export const statChangesInOptionsCodec: ParamCodec = {
  toCtor: value => parseStatChanges(String(value)),
  fromInstance: raw => formatStatChanges((raw as OptionsBag)?.stats),
};

/** The yes/no switch "also clear the entry hazards on my side"; an options object without it means no. */
export const hazardSwitchCodec: ParamCodec = {
  toCtor: value => value === true,
  fromInstance: raw => (raw as OptionsBag)?.clearHazards === true,
};

// ---------------------------------------------------------------------------------------------------------------
// A list of the five core stats

/** The five stats "all stats" means (accuracy and evasion are not part of it). */
const CORE_STAT_WORDS: readonly (readonly [stat: Stat, word: string])[] = [
  [Stat.ATK, "Attack"],
  [Stat.DEF, "Defense"],
  [Stat.SPATK, "Sp. Atk"],
  [Stat.SPDEF, "Sp. Def"],
  [Stat.SPD, "Speed"],
];

export const CORE_STAT_LIST_WORDS: readonly string[] = CORE_STAT_WORDS.map(([, word]) => word);

/** "Attack, Speed" to [ATK, SPD]; throws a plain sentence for an empty list or a word that is not one of the five stats. */
export function parseStatList(text: string): Stat[] {
  const parts = text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    throw new Error("name at least one stat, for example Attack");
  }
  return parts.map(part => {
    const found = CORE_STAT_WORDS.find(([, word]) => word.toLowerCase() === part.toLowerCase());
    if (found === undefined) {
      throw new Error(`"${part}" is not one of the five stats; use Attack, Defense, Sp. Atk, Sp. Def or Speed`);
    }
    return found[0];
  });
}

/** The class's stat list to words; undefined when it holds something the words cannot say. */
export function formatStatList(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return;
  }
  const words = (raw as readonly Stat[]).map(stat => CORE_STAT_WORDS.find(([candidate]) => candidate === stat)?.[1]);
  return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
}

export const statListCodec: ParamCodec = {
  toCtor: value => parseStatList(String(value)),
  fromInstance: raw => formatStatList(raw),
};
