/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
// Hand-written text codecs for the B10 declarations whose constructor takes a structured object (a list of type
// matchup rules, one of seven "when I faint" effects). Staff see and type plain words ("Poison > Steel = 2",
// "Set the weather: Sandstorm"); the codec turns that sentence into the object the class wants and back.
//
// Why a sentence and not several params: a declared param fills ONE constructor slot (or one key of an options
// object), and these classes read ONE object (`{ rules }`, `{ effect }`). The sentence is the smallest honest
// way to let staff edit it without changing the class. Every parser throws a plain-language error for text it does
// not understand, so a typo never builds a half-formed attr.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

type EnumTable = Readonly<Record<string, string | number>>;

/** Member names of an enum (the numeric reverse keys of a TypeScript numeric enum are dropped). */
function memberNames(table: EnumTable): string[] {
  return Object.keys(table).filter(key => Number.isNaN(Number(key)));
}

/** "STEALTH_ROCK" -> "Stealth rock": the word players use for one enum member. */
export function wordOf(name: string): string {
  return playerName(name);
}

/** The member name a typed word stands for ("stealth rock", "Stealth_Rock" and "STEALTH_ROCK" all mean STEALTH_ROCK). */
function nameFromWord(table: EnumTable, word: string, what: string): string {
  const wanted = word
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");
  for (const name of memberNames(table)) {
    if (name.toLowerCase().replace(/_/g, " ") === wanted || wordOf(name).toLowerCase() === wanted) {
      return name;
    }
  }
  throw new Error(`"${word.trim()}" is not a known ${what}`);
}

function memberNameOf(table: EnumTable, raw: unknown): string | undefined {
  return memberNames(table).find(name => table[name] === raw);
}

// ---------------------------------------------------------------------------------------------------------------
// Type matchup rules: "Poison > Steel = 2; Fire > Rock = 2"

/** One matchup rule as the class stores it (OffensiveTypeChartRule). */
interface MatchupRule {
  readonly attackType: PokemonType;
  readonly defenderType: PokemonType;
  readonly newMultiplier: number;
}

const RULE = /^\s*([A-Za-z_ ]+?)\s*>\s*([A-Za-z_ ]+?)\s*=\s*(\d+(?:\.\d+)?)\s*$/;

export const matchupRulesCodec: ParamCodec = {
  toCtor: value => {
    const parts = String(value)
      .split(";")
      .filter(part => part.trim().length > 0);
    if (parts.length === 0) {
      throw new Error("Write at least one matchup, for example: Poison > Steel = 2");
    }
    return parts.map((part): MatchupRule => {
      const match = RULE.exec(part);
      if (match === null) {
        throw new Error(`"${part.trim()}" is not a matchup; write it like: Poison > Steel = 2`);
      }
      const attackName = nameFromWord(PokemonType, match[1], "type");
      const defenderName = nameFromWord(PokemonType, match[2], "type");
      return {
        attackType: PokemonType[attackName as keyof typeof PokemonType],
        defenderType: PokemonType[defenderName as keyof typeof PokemonType],
        newMultiplier: Number(match[3]),
      };
    });
  },
  fromInstance: raw => {
    if (!Array.isArray(raw) || raw.length === 0) {
      return;
    }
    const parts: string[] = [];
    for (const rule of raw as MatchupRule[]) {
      const attack = memberNameOf(PokemonType, rule.attackType);
      const defender = memberNameOf(PokemonType, rule.defenderType);
      if (attack === undefined || defender === undefined) {
        return;
      }
      parts.push(`${wordOf(attack)} > ${wordOf(defender)} = ${rule.newMultiplier}`);
    }
    return parts.join("; ");
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The seven "when I faint" effects (OnFaintEffect)

const BATTLE_STATS = {
  ATK: Stat.ATK,
  DEF: Stat.DEF,
  SPATK: Stat.SPATK,
  SPDEF: Stat.SPDEF,
  SPD: Stat.SPD,
  ACC: Stat.ACC,
  EVA: Stat.EVA,
};
const WEATHER_NAMES = memberNames(WeatherType).filter(name => name !== "NONE");

interface StatChange {
  readonly stat: number;
  readonly stages: number;
}

function statChangesText(changes: readonly StatChange[]): string {
  return changes
    .map(change => {
      const name = memberNameOf(BATTLE_STATS, change.stat) ?? "?";
      return `${wordOf(name)} ${change.stages > 0 ? "+" : ""}${change.stages}`;
    })
    .join(", ");
}

function parseStatChanges(text: string): StatChange[] {
  return text
    .split(",")
    .filter(part => part.trim().length > 0)
    .map(part => {
      const match = /^\s*(.+?)\s*([+-]\d+)\s*$/.exec(part);
      if (match === null) {
        throw new Error(`"${part.trim()}" is not a stat change; write it like: Attack -2`);
      }
      const name = nameFromWord(BATTLE_STATS, match[1], "stat");
      return { stat: BATTLE_STATS[name as keyof typeof BATTLE_STATS], stages: Number(match[2]) };
    });
}

const PREFIX = {
  weather: "Set the weather: ",
  terrain: "Set the terrain: ",
  damage: "Hurt the Pokemon that knocked me out: ",
  hazard: "Set a hazard on the foe's side: ",
  tag: "Put a lasting effect on the Pokemon that knocked me out: ",
  stats: "Change the stats of the Pokemon that knocked me out: ",
  pp: "Drain the PP of the move that knocked me out",
} as const;

/** Effect object as the class stores it (a loose view of OnFaintEffect: the codec checks each kind itself). */
interface LooseEffect {
  readonly kind: string;
  readonly weather?: number;
  readonly terrain?: number;
  readonly maxHpFraction?: number;
  readonly hazard?: string;
  readonly layers?: number;
  readonly tagType?: string;
  readonly turns?: number;
  readonly excludeAttackerTypes?: readonly number[];
  readonly stats?: readonly StatChange[];
  readonly allyStats?: readonly StatChange[];
}

export const onFaintEffectCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === PREFIX.pp) {
      return { kind: "attacker-pp-drain" };
    }
    if (text.startsWith(PREFIX.weather)) {
      const name = nameFromWord(WeatherType, text.slice(PREFIX.weather.length), "weather");
      if (!WEATHER_NAMES.includes(name)) {
        throw new Error("Pick a real weather");
      }
      return { kind: "set-weather", weather: WeatherType[name as keyof typeof WeatherType] };
    }
    if (text.startsWith(PREFIX.terrain)) {
      const name = nameFromWord(TerrainType, text.slice(PREFIX.terrain.length), "terrain");
      return { kind: "set-terrain", terrain: TerrainType[name as keyof typeof TerrainType] };
    }
    if (text.startsWith(PREFIX.damage)) {
      const match = /^(\d+(?:\.\d+)?)%\s+of\s+its\s+max\s+HP$/.exec(text.slice(PREFIX.damage.length).trim());
      if (match === null) {
        throw new Error("Write the damage like: 25% of its max HP");
      }
      return { kind: "attacker-damage-flat", maxHpFraction: Number(match[1]) / 100 };
    }
    if (text.startsWith(PREFIX.hazard)) {
      const match = /^(.+?)(?:\s+x(\d+))?$/.exec(text.slice(PREFIX.hazard.length).trim());
      if (match === null) {
        throw new Error("Write the hazard like: Stealth rock x1");
      }
      const name = nameFromWord(ArenaTagType, match[1], "hazard");
      const hazard = ArenaTagType[name as keyof typeof ArenaTagType];
      return match[2] === undefined
        ? { kind: "set-hazard", hazard }
        : { kind: "set-hazard", hazard, layers: Number(match[2]) };
    }
    if (text.startsWith(PREFIX.tag)) {
      const match = /^(.+?)(?:\s+for\s+(\d+)\s+turns)?(?:,\s*not\s+against\s+(.+))?$/.exec(
        text.slice(PREFIX.tag.length).trim(),
      );
      if (match === null) {
        throw new Error("Write the effect like: Cursed, or Cursed for 3 turns, not against Ghost");
      }
      const name = nameFromWord(BattlerTagType, match[1], "lasting effect");
      // A part that is not written stays absent, so an effect built without it equals the original (no turns key, no list).
      const effect: Record<string, unknown> = {
        kind: "attacker-battler-tag",
        tagType: BattlerTagType[name as keyof typeof BattlerTagType],
      };
      if (match[2] !== undefined) {
        effect.turns = Number(match[2]);
      }
      if (match[3] !== undefined) {
        effect.excludeAttackerTypes = match[3]
          .split("/")
          .filter(part => part.trim().length > 0)
          .map(part => PokemonType[nameFromWord(PokemonType, part, "type") as keyof typeof PokemonType]);
      }
      return effect;
    }
    if (text.startsWith(PREFIX.stats)) {
      const [own, allies] = text.slice(PREFIX.stats.length).split(/;\s*its allies:\s*/);
      const stats = parseStatChanges(own);
      return allies === undefined
        ? { kind: "attacker-stat-change", stats }
        : { kind: "attacker-stat-change", stats, allyStats: parseStatChanges(allies) };
    }
    throw new Error(`"${text}" is not one of the faint effects; start it like "${PREFIX.weather}Sandstorm"`);
  },
  fromInstance: raw => {
    const effect = raw as LooseEffect | undefined;
    if (effect === undefined || effect === null) {
      return;
    }
    switch (effect.kind) {
      case "attacker-pp-drain":
        return PREFIX.pp;
      case "set-weather": {
        const name = memberNameOf(WeatherType, effect.weather);
        return name === undefined ? undefined : `${PREFIX.weather}${wordOf(name)}`;
      }
      case "set-terrain": {
        const name = memberNameOf(TerrainType, effect.terrain);
        return name === undefined ? undefined : `${PREFIX.terrain}${wordOf(name)}`;
      }
      case "attacker-damage-flat":
        return effect.maxHpFraction === undefined
          ? undefined
          : `${PREFIX.damage}${Number((effect.maxHpFraction * 100).toFixed(4))}% of its max HP`;
      case "set-hazard": {
        const name = memberNameOf(ArenaTagType, effect.hazard);
        return name === undefined
          ? undefined
          : `${PREFIX.hazard}${wordOf(name)}${effect.layers === undefined ? "" : ` x${effect.layers}`}`;
      }
      case "attacker-battler-tag": {
        const name = memberNameOf(BattlerTagType, effect.tagType);
        if (name === undefined) {
          return;
        }
        const excluded = (effect.excludeAttackerTypes ?? []).map(type => {
          const typeName = memberNameOf(PokemonType, type);
          return typeName === undefined ? "?" : wordOf(typeName);
        });
        const turns = effect.turns === undefined ? "" : ` for ${effect.turns} turns`;
        const tail = excluded.length === 0 ? "" : `, not against ${excluded.join("/")}`;
        return `${PREFIX.tag}${wordOf(name)}${turns}${tail}`;
      }
      case "attacker-stat-change": {
        if (effect.stats === undefined) {
          return;
        }
        const allies =
          effect.allyStats === undefined || effect.allyStats.length === 0
            ? ""
            : `; its allies: ${statChangesText(effect.allyStats)}`;
        return `${PREFIX.stats}${statChangesText(effect.stats)}${allies}`;
      }
      default:
        return;
    }
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Options-object helpers: the class keeps `{ n, stages }` or `{ moveId, power }` in ONE private field, so the declared
// path reads that object and the codec picks its key back out.

/** A codec that reads `key` out of the options object the path points at (the value itself passes through). */
export function optionNumber(key: string): ParamCodec {
  return {
    toCtor: value => value,
    fromInstance: raw => {
      const value = (raw as Record<string, unknown> | undefined)?.[key];
      return typeof value === "number" ? value : undefined;
    },
  };
}

/**
 * The scripted move of a constructor `{ moveId, power? }` as one sentence: "Pursuit" or "Pursuit at 20 power". One param
 * builds the whole options object, so a move without a power override has no `power` key at all (a separate power param
 * would add the key as undefined and the rebuilt attr would not equal the original).
 */
export function scriptedMoveCodec(moves: EnumTable): ParamCodec {
  return {
    toCtor: value => {
      const match = /^(.+?)(?:\s+at\s+(\d+)\s+power)?$/.exec(String(value).trim());
      if (match === null) {
        throw new Error("Write the move like: Pursuit, or Pursuit at 20 power");
      }
      const name = nameFromWord(moves, match[1], "move");
      const moveId = moves[name];
      return match[2] === undefined ? { moveId } : { moveId, power: Number(match[2]) };
    },
    fromInstance: raw => {
      const options = raw as { moveId?: unknown; power?: unknown } | undefined;
      const name = memberNameOf(moves, options?.moveId);
      if (name === undefined) {
        return;
      }
      return typeof options?.power === "number" ? `${wordOf(name)} at ${options.power} power` : wordOf(name);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Chunk 2 helpers.

/** One enum value stored under `key` of the options object the path points at ({ type: 12, factor: 2 }), shown as its member name. */
export function optionEnumCodec(table: EnumTable, key: string, what: string): ParamCodec {
  return {
    toCtor: value => {
      const resolved = table[String(value)];
      if (typeof resolved !== "number") {
        throw new Error(`"${String(value)}" is not a known ${what}`);
      }
      return resolved;
    },
    fromInstance: raw => memberNameOf(table, (raw as Record<string, unknown> | undefined)?.[key]),
  };
}

/**
 * A heal share kept by the class as a fraction of max HP (0.125) and shown to staff as a percent (12.5). Both
 * directions are exact for the shares in use (1/16, 1/8, 1/4): every one of them is a power-of-two fraction.
 */
export const fractionAsPercentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};

// ---------------------------------------------------------------------------------------------------------------
// The situation of PassiveRecovery ("always", "asleep", "in Misty Terrain", "at most 50% HP", "I am Ice type").

const AURA_STATS = { ATK: Stat.ATK, DEF: Stat.DEF, SPATK: Stat.SPATK, SPDEF: Stat.SPDEF, SPD: Stat.SPD };

/** The condition object of PassiveRecoveryAbAttr (a loose view: the codec checks each kind itself). */
interface LooseRecoveryCondition {
  readonly kind: string;
  readonly status?: number;
  readonly weathers?: readonly number[];
  readonly terrains?: readonly number[];
  readonly fraction?: number;
  readonly type?: number;
}

const RECOVERY_ALWAYS = "Always";
const RECOVERY_STATUS = "While my status is ";
const RECOVERY_WEATHER = "While the weather is ";
const RECOVERY_TERRAIN = "While the terrain is ";
const RECOVERY_HP = "While my HP is at most ";
const RECOVERY_TYPE = "While I have the ";

function wordsList(table: EnumTable, raw: readonly number[] | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) {
    return;
  }
  const names = raw.map(value => memberNameOf(table, value));
  return names.every((name): name is string => name !== undefined)
    ? names.map(name => wordOf(name)).join(" or ")
    : undefined;
}

function parseWordsList(table: EnumTable, text: string, what: string): number[] {
  return text
    .split(/\s+or\s+/)
    .filter(part => part.trim().length > 0)
    .map(part => table[nameFromWord(table, part, what)] as number);
}

export const passiveRecoveryWhenCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === RECOVERY_ALWAYS) {
      return { kind: "always" };
    }
    if (text.startsWith(RECOVERY_STATUS)) {
      const name = nameFromWord(StatusEffect, text.slice(RECOVERY_STATUS.length), "status condition");
      return { kind: "status", status: StatusEffect[name as keyof typeof StatusEffect] };
    }
    if (text.startsWith(RECOVERY_WEATHER)) {
      return { kind: "weather", weathers: parseWordsList(WeatherType, text.slice(RECOVERY_WEATHER.length), "weather") };
    }
    if (text.startsWith(RECOVERY_TERRAIN)) {
      return { kind: "terrain", terrains: parseWordsList(TerrainType, text.slice(RECOVERY_TERRAIN.length), "terrain") };
    }
    if (text.startsWith(RECOVERY_HP)) {
      const match = /^(\d+(?:\.\d+)?)% of my max HP$/.exec(text.slice(RECOVERY_HP.length).trim());
      if (match === null) {
        throw new Error("Write the HP limit like: While my HP is at most 50% of my max HP");
      }
      return { kind: "hp-below-fraction", fraction: Number(match[1]) / 100 };
    }
    if (text.startsWith(RECOVERY_TYPE)) {
      const match = /^(.+?) type$/.exec(text.slice(RECOVERY_TYPE.length).trim());
      if (match === null) {
        throw new Error("Write the type like: While I have the Ice type");
      }
      const name = nameFromWord(PokemonType, match[1], "type");
      return { kind: "self-type", type: PokemonType[name as keyof typeof PokemonType] };
    }
    throw new Error(
      `"${text}" is not a situation; start it like "${RECOVERY_TERRAIN}Misty" or write "${RECOVERY_ALWAYS}"`,
    );
  },
  fromInstance: raw => {
    const condition = raw as LooseRecoveryCondition | undefined;
    if (condition === undefined || condition === null) {
      return;
    }
    switch (condition.kind) {
      case "always":
        return RECOVERY_ALWAYS;
      case "status": {
        const name = memberNameOf(StatusEffect, condition.status);
        return name === undefined ? undefined : `${RECOVERY_STATUS}${wordOf(name)}`;
      }
      case "weather": {
        const list = wordsList(WeatherType, condition.weathers);
        return list === undefined ? undefined : `${RECOVERY_WEATHER}${list}`;
      }
      case "terrain": {
        const list = wordsList(TerrainType, condition.terrains);
        return list === undefined ? undefined : `${RECOVERY_TERRAIN}${list}`;
      }
      case "hp-below-fraction":
        return typeof condition.fraction === "number"
          ? `${RECOVERY_HP}${Number((condition.fraction * 100).toPrecision(12))}% of my max HP`
          : undefined;
      case "self-type": {
        const name = memberNameOf(PokemonType, condition.type);
        return name === undefined ? undefined : `${RECOVERY_TYPE}${wordOf(name)} type`;
      }
      default:
        return;
    }
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The side aura (PersistentFieldAura): which stats, and which allies.

/** The five stats an aura can touch, as a list of player words: "Attack, Sp. Atk, Speed". */
export const auraStatsCodec: ParamCodec = {
  toCtor: value => {
    const parts = String(value)
      .split(",")
      .filter(part => part.trim().length > 0);
    if (parts.length === 0) {
      throw new Error("Write at least one stat, for example: Attack, Speed");
    }
    return parts.map(part => AURA_STATS[nameFromWord(AURA_STATS, part, "stat") as keyof typeof AURA_STATS]);
  },
  fromInstance: raw => {
    if (!Array.isArray(raw) || raw.length === 0) {
      return;
    }
    const names = raw.map(value => memberNameOf(AURA_STATS, value));
    return names.every((name): name is string => name !== undefined)
      ? names.map(name => wordOf(name)).join(", ")
      : undefined;
  },
};

export const AURA_ALL_ALLIES = "Every Pokemon on my side";
const AURA_BST = /^Only Pokemon whose base stat total is below (\d+)$/;

/** Predicate of the aura for a stand-in ally whose six base stats add up to `total`. */
function standIn(total: number): { species: { baseStats: number[] } } {
  return { species: { baseStats: [total, 0, 0, 0, 0, 0] } };
}

/**
 * Which allies the aura reaches. The class keeps a predicate FUNCTION (ally, holder) => boolean in its options. A function
 * cannot be written by staff, so the choices are the two shapes the game uses: everyone on my side, or only Pokemon whose base
 * stat total is below a number. Reading a live predicate back is done by asking it about stand-in allies (a total of 0, then a
 * search for the first total that it refuses); a predicate that is neither shape is not representable and stays unread.
 */
export const auraAlliesCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === AURA_ALL_ALLIES) {
      return;
    }
    const match = AURA_BST.exec(text);
    if (match === null) {
      throw new Error(`Write "${AURA_ALL_ALLIES}" or "Only Pokemon whose base stat total is below 400"`);
    }
    const limit = Number(match[1]);
    return (ally: { species: { baseStats: readonly number[] } }) =>
      ally.species.baseStats.reduce((sum, stat) => sum + stat, 0) < limit;
  },
  fromInstance: raw => {
    if (typeof raw !== "function") {
      return;
    }
    const ask = (total: number): boolean | undefined => {
      try {
        return Boolean((raw as (ally: unknown, holder: unknown) => unknown)(standIn(total), {}));
      } catch {
        return;
      }
    };
    // A spread of totals: both sides of the usual 300 to 600 range, the small numbers where a parity rule would show, and a huge one.
    const totals = [0, 1, 2, 3, 100, 299, 300, 399, 400, 401, 450, 499, 500, 600, 999, 1000, 2000, 5000];
    const answers = totals.map(ask);
    if (answers.some(answer => answer === undefined)) {
      return;
    }
    if (answers.every(answer => answer === true)) {
      return AURA_ALL_ALLIES;
    }
    // "Below N": true up to a point and false from there on. Anything else (a parity rule, an upper bound only) is not representable.
    const firstRefusal = answers.indexOf(false);
    if (firstRefusal <= 0 || answers.slice(firstRefusal).some(answer => answer === true)) {
      return;
    }
    let good = totals[firstRefusal - 1];
    let bad = totals[firstRefusal];
    while (bad - good > 1) {
      const middle = Math.floor((good + bad) / 2);
      if (ask(middle) === true) {
        good = middle;
      } else {
        bad = middle;
      }
    }
    // `bad` is the first total refused; confirm it is a clean cut on both sides of it.
    return ask(bad - 1) === true && ask(bad) === false
      ? `Only Pokemon whose base stat total is below ${bad}`
      : undefined;
  },
};
