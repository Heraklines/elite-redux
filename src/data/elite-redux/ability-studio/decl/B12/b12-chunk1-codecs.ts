/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. Codecs for the stat-trigger archetype family (a helper, not a declaration: the registry only collects
// `*.decl.ts` and `bindings.ts`). Staff read and write plain words; the classes take enum numbers and small objects.
//
//   statChangesCodec   "Attack +1, Speed +2"  <->  [{ stat: ATK, stages: 1 }, { stat: SPD, stages: 2 }]
//   hitFilterCodec     "Fire, Flying, Contact" <->  { types: [FIRE, FLYING], flags: [MAKES_CONTACT] } (or no filter)
//   perFaintPercent    5 (% per faint)         <->  0.05
//   lowerScopeCodec    "Once for each stat lowered" <-> "side"
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";

// ---------------------------------------------------------------------------------------------------------------
// Stat changes

/** Player words for the seven stats a stat change can name. */
const STAT_WORDS: readonly (readonly [stat: Stat, word: string])[] = [
  [Stat.ATK, "Attack"],
  [Stat.DEF, "Defense"],
  [Stat.SPATK, "Sp. Atk"],
  [Stat.SPDEF, "Sp. Def"],
  [Stat.SPD, "Speed"],
  [Stat.ACC, "Accuracy"],
  [Stat.EVA, "Evasion"],
];

/** Largest stage number the constructor accepts without complaint (Petal Shield asks for +12; the game stops at 6). */
export const MAX_STAGES = 12;

export interface StatChangeValue {
  readonly stat: Stat;
  readonly stages: number;
}

function statOfWord(word: string): Stat | undefined {
  const wanted = word.trim().toLowerCase();
  const found = STAT_WORDS.find(([, name]) => name.toLowerCase() === wanted);
  return found?.[0];
}

/** "Attack +1, Speed +2" to the constructor list; throws a plain sentence for anything it cannot read. */
export function parseStatChanges(text: string): StatChangeValue[] {
  const parts = text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    throw new Error("name at least one stat change, for example Attack +1");
  }
  return parts.map(part => {
    const match = /^(.*?)\s*([+-])\s*(\d+)$/.exec(part);
    if (match === null) {
      throw new Error(`"${part}" is not a stat change; write a stat and a number such as Attack +1 or Speed -2`);
    }
    const stat = statOfWord(match[1]);
    if (stat === undefined) {
      throw new Error(`"${match[1]}" is not a stat; use Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion`);
    }
    const stages = (match[2] === "-" ? -1 : 1) * Number(match[3]);
    if (stages === 0 || Math.abs(stages) > MAX_STAGES) {
      throw new Error(`"${part}" needs a number of stages from 1 to ${MAX_STAGES}, not zero`);
    }
    return { stat, stages };
  });
}

/** The constructor list to text; undefined when it holds something the words cannot say. */
export function formatStatChanges(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return;
  }
  const parts: string[] = [];
  for (const entry of raw as readonly Partial<StatChangeValue>[]) {
    const word = STAT_WORDS.find(([stat]) => stat === entry.stat)?.[1];
    if (word === undefined || typeof entry.stages !== "number") {
      return;
    }
    parts.push(`${word} ${entry.stages > 0 ? "+" : "-"}${Math.abs(entry.stages)}`);
  }
  return parts.join(", ");
}

export const statChangesCodec: ParamCodec = {
  toCtor: value => parseStatChanges(String(value)),
  fromInstance: raw => formatStatChanges(raw),
};

// ---------------------------------------------------------------------------------------------------------------
// The "only when hit by ..." filter

/** Player words for the move properties a filter can name (the same list the library's property atom offers). */
const FLAG_WORDS: readonly (readonly [name: string, word: string])[] = [
  ["MAKES_CONTACT", "Contact"],
  ["SOUND_BASED", "Sound"],
  ["BITING_MOVE", "Biting"],
  ["PULSE_MOVE", "Pulse"],
  ["PUNCHING_MOVE", "Punching"],
  ["SLICING_MOVE", "Slicing"],
  ["RECKLESS_MOVE", "Reckless"],
  ["BALLBOMB_MOVE", "Ball or bomb"],
  ["POWDER_MOVE", "Powder"],
  ["DANCE_MOVE", "Dance"],
  ["WIND_MOVE", "Wind"],
  ["TRIAGE_MOVE", "Triage"],
  ["AIR_BASED", "Air"],
  ["ARROW_BASED", "Arrow"],
  ["BONE_BASED", "Bone"],
  ["DRILL_BASED", "Drill"],
  ["FIELD_BASED", "Field"],
  ["HAMMER_BASED", "Hammer"],
  ["HORN_BASED", "Horn"],
  ["KICKING_MOVE", "Kicking"],
  ["LUNAR_MOVE", "Lunar"],
  ["THROW_BASED", "Throwing"],
  ["WEATHER_BASED", "Weather"],
];

const FLAG_TABLE = MoveFlags as unknown as Readonly<Record<string, number>>;
const TYPE_TABLE = PokemonType as unknown as Readonly<Record<string, number>>;

export const NO_FILTER = "Any move";

/** Every word the filter text accepts, for the label and for tests. */
export const FILTER_TYPE_WORDS: readonly string[] = Object.keys(TYPE_TABLE)
  .filter(name => Number.isNaN(Number(name)) && name !== "UNKNOWN" && name !== "NONE")
  .map(name => name.charAt(0) + name.slice(1).toLowerCase());
export const FILTER_FLAG_WORDS: readonly string[] = FLAG_WORDS.map(([, word]) => word);

export interface HitFilterValue {
  readonly types?: readonly number[];
  readonly flags?: readonly number[];
}

/** "Fire, Flying, Contact" to the filter object (types and flags kept in the order written); "Any move" to no filter. */
export function parseHitFilter(text: string): HitFilterValue | undefined {
  const words = text
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (words.length === 0 || (words.length === 1 && words[0].toLowerCase() === NO_FILTER.toLowerCase())) {
    return;
  }
  const types: number[] = [];
  const flags: number[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    const flag = FLAG_WORDS.find(([, name]) => name.toLowerCase() === lower);
    if (flag !== undefined) {
      flags.push(FLAG_TABLE[flag[0]]);
      continue;
    }
    const typeName = Object.keys(TYPE_TABLE).find(name => name.toLowerCase() === lower && Number.isNaN(Number(name)));
    if (typeName === undefined || typeName === "UNKNOWN" || typeName === "NONE") {
      throw new Error(`"${word}" is not a move type or move property; write for example Fire, Flying or Contact`);
    }
    types.push(TYPE_TABLE[typeName]);
  }
  return {
    ...(types.length > 0 ? { types } : {}),
    ...(flags.length > 0 ? { flags } : {}),
  };
}

export function formatHitFilter(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return NO_FILTER;
  }
  if (typeof raw !== "object") {
    return;
  }
  const filter = raw as HitFilterValue;
  const words: string[] = [];
  for (const type of filter.types ?? []) {
    const name = Object.keys(TYPE_TABLE).find(key => TYPE_TABLE[key] === type && Number.isNaN(Number(key)));
    if (name === undefined || name === "UNKNOWN" || name === "NONE") {
      return;
    }
    words.push(name.charAt(0) + name.slice(1).toLowerCase());
  }
  for (const flag of filter.flags ?? []) {
    const word = FLAG_WORDS.find(([name]) => FLAG_TABLE[name] === flag)?.[1];
    if (word === undefined) {
      return;
    }
    words.push(word);
  }
  // A filter with an empty list never matches anything; no words can say that.
  return words.length === 0 || filter.types?.length === 0 || filter.flags?.length === 0 ? undefined : words.join(", ");
}

export const hitFilterCodec: ParamCodec = {
  toCtor: value => parseHitFilter(String(value)),
  fromInstance: raw => formatHitFilter(raw),
};

// ---------------------------------------------------------------------------------------------------------------
// Smaller settings

/** The boost per faint is a fraction in the class (0.05) and a percent for staff (5). */
export const perFaintPercentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};

export const SCOPE_EACH_DROP = "Once for each stat lowered";
export const SCOPE_ONCE = "Once per drop";
export const LOWER_SCOPE_OPTIONS: readonly string[] = [SCOPE_ONCE, SCOPE_EACH_DROP];

/** scope ("self" | "side") <-> words. */
export const lowerScopeCodec: ParamCodec = {
  toCtor: value => {
    if (value === SCOPE_ONCE) {
      return "self";
    }
    if (value === SCOPE_EACH_DROP) {
      return "side";
    }
    throw new Error(`"${String(value)}" is not a way to count stat drops`);
  },
  fromInstance: raw => (raw === "self" ? SCOPE_ONCE : raw === "side" ? SCOPE_EACH_DROP : undefined),
};
