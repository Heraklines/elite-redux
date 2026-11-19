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
