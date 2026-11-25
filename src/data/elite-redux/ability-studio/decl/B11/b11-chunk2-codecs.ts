/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
// Hand-written codecs for the B11 chunk 2 declarations. Staff see plain numbers ("percent of max HP", "how many hits",
// "priority change", "recoil multiplier"); the classes want small option objects. Every parser throws a plain-language
// error for a value the class would refuse, so a bad setting never builds a half-formed attr.
import { playerName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";

// ---------------------------------------------------------------------------------------------------------------
// PreFaintReviveAbAttr option `gate`: `{ kind: "full-hp" }` or `{ kind: "hp-threshold", threshold }` (0 to 1).
// Staff read ONE number, "percent of max HP that is needed", where 100 means "only at full HP" (the same thing as a
// threshold of 1, because HP can never be above max) and 0 means "any HP".

interface GateShape {
  readonly kind?: unknown;
  readonly threshold?: unknown;
}

export const reviveHpGateCodec: ParamCodec = {
  toCtor: value => {
    const percent = Number(value);
    if (!(percent >= 0 && percent <= 100)) {
      throw new Error(`The HP needed to survive must be between 0 and 100 percent; got ${String(value)}`);
    }
    return percent >= 100 ? { kind: "full-hp" } : { kind: "hp-threshold", threshold: percent / 100 };
  },
  fromInstance: raw => {
    const gate = raw as GateShape | undefined;
    if (gate?.kind === "full-hp") {
      return 100;
    }
    if (gate?.kind === "hp-threshold" && typeof gate.threshold === "number") {
      return Number((gate.threshold * 100).toPrecision(12));
    }
    return;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// PreFaintReviveAbAttr option `usage`: `{ kind: "per-hit" }` or `{ kind: "first-n-hits", n }`. One number: 0 is "works
// once per turn" (the Sturdy way), 1 or more is "only the first N hits of the whole battle".

interface UsageShape {
  readonly kind?: unknown;
  readonly n?: unknown;
}

export const reviveUsageCodec: ParamCodec = {
  toCtor: value => {
    const hits = Number(value);
    if (!(Number.isInteger(hits) && hits >= 0)) {
      throw new Error(`The number of hits must be a whole number, 0 or more; got ${String(value)}`);
    }
    return hits === 0 ? { kind: "per-hit" } : { kind: "first-n-hits", n: hits };
  },
  fromInstance: raw => {
    const usage = raw as UsageShape | undefined;
    if (usage?.kind === "per-hit") {
      return 0;
    }
    if (usage?.kind === "first-n-hits" && typeof usage.n === "number") {
      return usage.n;
    }
    return;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// PriorityModifierAbAttr option `priority`: the class refuses 0 ("must be a non-zero integer"), so the plain-language
// error is raised here, before the constructor's own message.

export const priorityChangeCodec: ParamCodec = {
  toCtor: value => {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount === 0) {
      throw new Error(
        `The priority change must be a whole number other than 0 (nothing would change); got ${String(value)}`,
      );
    }
    return amount;
  },
  fromInstance: raw => (typeof raw === "number" ? raw : undefined),
};

// ---------------------------------------------------------------------------------------------------------------
// RecoilDamageMultiplierAbAttr: the class keeps its constructor options object (`{ factor }`) in a private field named
// `opts`, so a live instance is read back through the object. The class refuses a factor outside (0, 1).

export const recoilFactorCodec: ParamCodec = {
  toCtor: value => {
    const factor = Number(value);
    if (!(factor > 0 && factor < 1)) {
      throw new Error(`The recoil multiplier must be above 0 and below 1 (0.5 = half recoil); got ${String(value)}`);
    }
    return factor;
  },
  fromInstance: raw => {
    const options = raw as { readonly factor?: unknown } | undefined;
    return typeof options?.factor === "number" ? options.factor : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// PriorityModifierAbAttr options `filter` and `condition`. The class builds its private test from two small objects. Staff pick one
// plain sentence for each; every sentence is exactly one of the shapes a live ability (or the class comment) uses. The words only
// record what a built rule starts from: the rule itself is the gate's condition blocks, and an object that has no sentence reads back
// as "not representable" (the setting is then left at its default).

interface MoveFilterChoice {
  readonly words: string;
  readonly filter: Readonly<Record<string, number>>;
}

const MOVE_TYPE_NAMES = [
  "NORMAL",
  "FIGHTING",
  "FLYING",
  "POISON",
  "GROUND",
  "ROCK",
  "BUG",
  "GHOST",
  "STEEL",
  "FIRE",
  "WATER",
  "GRASS",
  "ELECTRIC",
  "PSYCHIC",
  "ICE",
  "DRAGON",
  "DARK",
  "FAIRY",
] as const;

const MOVE_FILTER_CHOICES: readonly MoveFilterChoice[] = [
  { words: "Any move", filter: {} },
  ...MOVE_TYPE_NAMES.map(name => ({
    words: `${playerName(name)}-type moves`,
    filter: { type: PokemonType[name] },
  })),
  { words: "Punching moves", filter: { flag: MoveFlags.PUNCHING_MOVE } },
  { words: "Sound moves", filter: { flag: MoveFlags.SOUND_BASED } },
  { words: "Moves with 25 base power or less", filter: { maxBasePower: 25 } },
  { words: "Moves with less than 80% accuracy", filter: { maxAccuracy: 80 } },
];

export const MOVE_FILTER_OPTIONS: readonly string[] = MOVE_FILTER_CHOICES.map(choice => choice.words);

function sameObject(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every(key => a[key] === b[key]);
}

export const moveFilterCodec: ParamCodec = {
  toCtor: value => {
    const choice = MOVE_FILTER_CHOICES.find(candidate => candidate.words === value);
    if (choice === undefined) {
      throw new Error(`"${String(value)}" is not one of the move choices`);
    }
    return { ...choice.filter };
  },
  fromInstance: raw =>
    typeof raw === "object" && raw !== null
      ? MOVE_FILTER_CHOICES.find(choice => sameObject(choice.filter, raw as Record<string, unknown>))?.words
      : undefined,
};

interface HolderConditionChoice {
  readonly words: string;
  readonly condition: Readonly<Record<string, unknown>>;
}

const HOLDER_CONDITION_CHOICES: readonly HolderConditionChoice[] = [
  { words: "Always", condition: { kind: "always" } },
  { words: "Only while I am at full HP", condition: { kind: "full-hp" } },
  { words: "Only on my first turn out", condition: { kind: "first-turn" } },
  { words: "Only while I am at half HP or less", condition: { kind: "low-hp" } },
];

export const HOLDER_CONDITION_OPTIONS: readonly string[] = HOLDER_CONDITION_CHOICES.map(choice => choice.words);

export const holderConditionCodec: ParamCodec = {
  toCtor: value => {
    const choice = HOLDER_CONDITION_CHOICES.find(candidate => candidate.words === value);
    if (choice === undefined) {
      throw new Error(`"${String(value)}" is not one of the condition choices`);
    }
    return { ...choice.condition };
  },
  fromInstance: raw => {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const condition = raw as { kind?: unknown; threshold?: unknown };
    // A low-HP rule reads back only when it uses the class default of one half (the live abilities set no threshold at all).
    const comparable =
      condition.kind === "low-hp" && (condition.threshold === undefined || condition.threshold === 0.5)
        ? { kind: "low-hp" }
        : condition;
    return HOLDER_CONDITION_CHOICES.find(choice => sameObject(choice.condition, comparable as Record<string, unknown>))
      ?.words;
  },
};
