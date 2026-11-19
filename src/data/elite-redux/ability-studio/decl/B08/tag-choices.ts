/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared by the B08 chunk 2 declarations (the chance-on-hit and chance-on-attack classes): the player-facing words
// for the lasting effects and move filters, and the codecs that turn them into what the constructors want.
// This is not a declaration (the registry only collects `*.decl.ts` and `bindings.ts`).
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

/** The lasting effects the live users hand out (and a few siblings), in the words a player uses. */
export const TAG_CHOICES: readonly (readonly [name: string, tag: BattlerTagType])[] = [
  ["Confused", BattlerTagType.CONFUSED],
  ["Infatuated", BattlerTagType.INFATUATED],
  ["Flinching", BattlerTagType.FLINCHED],
  ["Disabled", BattlerTagType.DISABLED],
  ["Encored", BattlerTagType.ENCORE],
  ["Cursed", BattlerTagType.CURSED],
  ["Leech Seed", BattlerTagType.SEEDED],
  ["Trapped", BattlerTagType.TRAPPED],
  ["Wrapped", BattlerTagType.WRAP],
  ["Bound", BattlerTagType.BIND],
  ["Infested", BattlerTagType.INFESTATION],
  ["Bleeding", BattlerTagType.ER_BLEED],
  ["Frostbitten", BattlerTagType.ER_FROSTBITE],
  ["Afraid", BattlerTagType.ER_FEAR],
  ["Infected by parasitic spores", BattlerTagType.ER_PARASITIC_SPORES],
  ["Puppet-controlled", BattlerTagType.ER_COMMANDED],
  ["Enraged", BattlerTagType.ER_ENRAGE],
];

export const TAG_NAMES: readonly string[] = TAG_CHOICES.map(([name]) => name);

function tagOf(name: string): BattlerTagType {
  const entry = TAG_CHOICES.find(([candidate]) => candidate === name.trim());
  if (entry === undefined) {
    throw new Error(`"${name}" is not a known lasting effect`);
  }
  return entry[1];
}

function nameOfTag(tag: unknown): string | undefined {
  return TAG_CHOICES.find(([, candidate]) => candidate === tag)?.[0];
}

/** "Confused, Bleeding" <-> [CONFUSED, ER_BLEED]. */
export const tagNamesCodec: ParamCodec = {
  toCtor: value =>
    String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .map(tagOf),
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    const names = raw.map(nameOfTag);
    return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
  },
};

/**
 * The same list read back from a pooled outcome list ([...statuses, ...tags], each { kind, value }), because
 * ChanceStatusOnAttackAbAttr keeps no list of tags of its own.
 */
export const tagOutcomesCodec: ParamCodec = {
  toCtor: tagNamesCodec.toCtor,
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    const names = raw
      .filter((item): item is { kind: "tag"; value: BattlerTagType } => item?.kind === "tag")
      .map(item => nameOfTag(item.value));
    return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
  },
};

/** One lasting effect, or "None" for no requirement. */
export const optionalTagCodec: ParamCodec = {
  toCtor: value => (value === "None" ? undefined : tagOf(String(value))),
  fromInstance: raw => (raw === undefined || raw === null ? "None" : nameOfTag(raw)),
};

/** One status condition, or "None" for no requirement. */
export const optionalStatusCodec: ParamCodec = {
  toCtor: value =>
    value === "None" ? undefined : (StatusEffect as unknown as Record<string, number>)[String(value).toUpperCase()],
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "None";
    }
    const name = Object.keys(StatusEffect).find(
      key => Number.isNaN(Number(key)) && (StatusEffect as unknown as Record<string, number>)[key] === raw,
    );
    return name === undefined ? undefined : name.charAt(0) + name.slice(1).toLowerCase();
  },
};

/** 0 means "leave it to the game" (the constructor option is then left out). */
export const zeroMeansDefaultCodec: ParamCodec = {
  toCtor: value => (Number(value) === 0 ? undefined : Number(value)),
  fromInstance: raw => (raw === undefined || raw === null ? 0 : typeof raw === "number" ? raw : undefined),
};

/** "4-5" <-> [4, 5]; an empty text means no range. */
export const turnRangeCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === "") {
      return;
    }
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(text);
    if (match === null) {
      throw new Error(`"${text}" is not a turn range such as 4-5`);
    }
    return [Number(match[1]), Number(match[2])] as const;
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "";
    }
    return Array.isArray(raw) && raw.length === 2 ? `${raw[0]}-${raw[1]}` : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The "only for these moves" filter of the offensive classes: a move property or a move type.

const FLAG_WORDS: Readonly<Record<string, string>> = {
  MAKES_CONTACT: "Contact moves",
  SOUND_BASED: "Sound moves",
  BITING_MOVE: "Biting moves",
  PULSE_MOVE: "Pulse moves",
  PUNCHING_MOVE: "Punching moves",
  SLICING_MOVE: "Slicing moves",
  RECKLESS_MOVE: "Reckless moves",
  BALLBOMB_MOVE: "Ball and bomb moves",
  POWDER_MOVE: "Powder moves",
  DANCE_MOVE: "Dance moves",
  WIND_MOVE: "Wind moves",
  TRIAGE_MOVE: "Triage moves",
  AIR_BASED: "Air moves",
  ARROW_BASED: "Arrow moves",
  BONE_BASED: "Bone moves",
  DRILL_BASED: "Drill moves",
  FIELD_BASED: "Field moves",
  HAMMER_BASED: "Hammer moves",
  HORN_BASED: "Horn moves",
  KICKING_MOVE: "Kicking moves",
  LUNAR_MOVE: "Lunar moves",
  THROW_BASED: "Throwing moves",
  WEATHER_BASED: "Weather moves",
};

function typeWords(type: string): string {
  return `${type.charAt(0)}${type.slice(1).toLowerCase()}-type moves`;
}

export const NO_FILTER = "Every move";

/** What staff may pick for the move filter of the offensive classes. */
export const FILTER_CHOICES: readonly string[] = [
  NO_FILTER,
  ...MOVE_FLAG_OPTIONS.map(flag => FLAG_WORDS[flag]),
  ...TYPE_OPTIONS.map(typeWords),
];

/**
 * { flag } or { type } <-> "Biting moves" or "Fire-type moves". A filter on one move id or on a move category
 * (the class supports them, no live ability uses them) is not representable and reads back as undefined.
 */
export const moveFilterCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value);
    if (text === NO_FILTER) {
      return;
    }
    const flag = MOVE_FLAG_OPTIONS.find(candidate => FLAG_WORDS[candidate] === text);
    if (flag !== undefined) {
      return { flag: (MoveFlags as unknown as Record<string, number>)[flag] };
    }
    const type = TYPE_OPTIONS.find(candidate => typeWords(candidate) === text);
    if (type !== undefined) {
      return { type: (PokemonType as unknown as Record<string, number>)[type] };
    }
    throw new Error(`"${text}" is not a known move filter`);
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return NO_FILTER;
    }
    const filter = raw as { flag?: number; type?: number; moveId?: number; category?: number };
    if (filter.flag !== undefined) {
      const flag = MOVE_FLAG_OPTIONS.find(
        name => (MoveFlags as unknown as Record<string, number>)[name] === filter.flag,
      );
      return flag === undefined ? undefined : FLAG_WORDS[flag];
    }
    if (filter.type !== undefined) {
      const type = TYPE_OPTIONS.find(name => (PokemonType as unknown as Record<string, number>)[name] === filter.type);
      return type === undefined ? undefined : typeWords(type);
    }
    return;
  },
};
