/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
// Hand-written codecs and constructor-argument builders for the B10 declarations. Several classes take ONE structured
// object (a list of type matchup rules, one of seven "when I faint" payloads, `{ moveId, power? }`). Staff edit every
// field as its own setting (a type, a number of percent, a stat, a number of stages); the `build...` functions below turn
// the settings into the object the class wants (declared as `assembleCtorArg`), and each setting's codec reads its value
// back out of a live instance. Nothing is parsed from free text: an unknown name throws a plain-language error.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import type { ParamValue, ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
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

// ---------------------------------------------------------------------------------------------------------------
// Chunk 1: structured settings (the owner requirement: every number, type, stat and status is its own setting).

/** A codec for a setting that is only ever built by `assembleCtorArg`: `toCtor` is not used, `fromInstance` reads one field back. */
function readBack(read: (raw: unknown) => ParamValue | undefined): ParamCodec {
  return { toCtor: value => value, fromInstance: read };
}

function fieldOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
}

function enumValue(table: EnumTable, name: unknown, what: string): number | string {
  const value = table[String(name)];
  if (value === undefined) {
    throw new Error(`"${String(name)}" is not a known ${what}`);
  }
  return value;
}

/** Percent shown to staff for a stored fraction (0.25 -> 25), without float noise. */
function asPercent(fraction: unknown): number | undefined {
  return typeof fraction === "number" ? Number((fraction * 100).toPrecision(12)) : undefined;
}

// ---- Type matchup (OffensiveTypeChartOverrideAbAttr): { rules: [{ attackType, defenderType, newMultiplier }] } ----

/** The "no second/third type" choice of an optional type setting. */
export const NO_TYPE = "NONE";

/** The rule list of a live instance, when every rule shares one move type and one multiplier (all live users do). */
function sharedRules(raw: unknown): { attackType: number; multiplier: number; targets: number[] } | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) {
    return;
  }
  const first = raw[0] as { attackType: number; newMultiplier: number };
  if (!raw.every(rule => rule.attackType === first.attackType && rule.newMultiplier === first.newMultiplier)) {
    return;
  }
  return {
    attackType: first.attackType,
    multiplier: first.newMultiplier,
    targets: raw.map(rule => (rule as { defenderType: number }).defenderType),
  };
}

export const matchupAttackTypeCodec: ParamCodec = readBack(raw => {
  const shared = sharedRules(raw);
  return shared === undefined ? undefined : memberNameOf(PokemonType, shared.attackType);
});

export const matchupMultiplierCodec: ParamCodec = readBack(raw => sharedRules(raw)?.multiplier);

/** The n-th (0-based) target type of the rule list; "NONE" past the end. */
export function matchupTargetCodec(position: number): ParamCodec {
  return readBack(raw => {
    const shared = sharedRules(raw);
    if (shared === undefined) {
      return;
    }
    const target = shared.targets[position];
    return target === undefined ? NO_TYPE : memberNameOf(PokemonType, target);
  });
}

/** The constructor argument `{ rules }`: one rule per chosen target type, all with the same move type and multiplier. */
export function buildMatchupRules(params: ParamValues): unknown {
  const attackType = enumValue(PokemonType, params.attackType, "type");
  const targets = [params.targetType, params.targetType2, params.targetType3].filter(
    (name): name is string => typeof name === "string" && name !== NO_TYPE,
  );
  if (targets.length === 0) {
    throw new Error("Choose at least one target type");
  }
  return {
    rules: targets.map(name => ({
      attackType,
      defenderType: enumValue(PokemonType, name, "type"),
      newMultiplier: Number(params.multiplier),
    })),
  };
}

// ---- A free scripted move ({ moveId, power? }) ----

/** Power 0 means "the move's own power": the `power` key is then absent, exactly as in the live users. */
export function buildScriptedMove(params: ParamValues): unknown {
  const moveId = MoveId[nameFromWord(MoveId, String(params.moveId), "move") as keyof typeof MoveId];
  const power = Number(params.power);
  return power > 0 ? { moveId, power } : { moveId };
}

export const scriptedMoveIdCodec: ParamCodec = readBack(raw => memberNameOf(MoveId, fieldOf(raw)?.moveId));

export const scriptedMovePowerCodec: ParamCodec = readBack(raw => {
  const power = fieldOf(raw)?.power;
  return typeof power === "number" ? power : 0;
});

// ---- When I faint (OnFaintEffectAbAttr): { effect: one of seven payloads } ----

export const FAINT_KIND_WEATHER = "Set the weather";
export const FAINT_KIND_TERRAIN = "Set the terrain";
export const FAINT_KIND_HURT = "Hurt the Pokemon that knocked me out";
export const FAINT_KIND_HAZARD = "Set a hazard on the foe's side";
export const FAINT_KIND_TAG = "Put a lasting effect on the Pokemon that knocked me out";
export const FAINT_KIND_STATS = "Change the stats of the Pokemon that knocked me out";
export const FAINT_KIND_PP = "Drain the PP of the move that knocked me out";

export const FAINT_KINDS = [
  FAINT_KIND_WEATHER,
  FAINT_KIND_TERRAIN,
  FAINT_KIND_HURT,
  FAINT_KIND_HAZARD,
  FAINT_KIND_TAG,
  FAINT_KIND_STATS,
  FAINT_KIND_PP,
] as const;

const FAINT_KIND_OF: Readonly<Record<string, string>> = {
  "set-weather": FAINT_KIND_WEATHER,
  "set-terrain": FAINT_KIND_TERRAIN,
  "attacker-damage-flat": FAINT_KIND_HURT,
  "set-hazard": FAINT_KIND_HAZARD,
  "attacker-battler-tag": FAINT_KIND_TAG,
  "attacker-stat-change": FAINT_KIND_STATS,
  "attacker-pp-drain": FAINT_KIND_PP,
};

/** Hazards a staff member can choose (the class takes any field effect; these are the entry hazards). */
export const FAINT_HAZARDS = ["SPIKES", "TOXIC_SPIKES", "STEALTH_ROCK", "STICKY_WEB"] as const;

/** Lasting effects a staff member can choose (the class takes any; these are the ones that make sense on a Pokemon that knocked me out). */
export const FAINT_TAGS = [
  "CURSED",
  "CONFUSED",
  "INFATUATED",
  "SEEDED",
  "NIGHTMARE",
  "TAUNT",
  "TORMENT",
  "ENCORE",
  "HEAL_BLOCK",
  "DROWSY",
  "TRAPPED",
  "PERISH_SONG",
  "DISABLED",
  "SALT_CURED",
] as const;

export const NO_STAT = "NONE";
export const FAINT_STATS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;

interface FaintStatChange {
  readonly stat: number;
  readonly stages: number;
}

function faintStats(raw: unknown, key: "stats" | "allyStats"): readonly FaintStatChange[] | undefined {
  const list = fieldOf(raw)?.[key];
  return Array.isArray(list) ? (list as FaintStatChange[]) : undefined;
}

/** A codec that answers only for effects of one kind (a setting of another kind reads back as nothing). */
function faintOnly(kind: string, read: (effect: Record<string, unknown>) => ParamValue | undefined): ParamCodec {
  return readBack(raw => {
    const effect = fieldOf(raw);
    return effect?.kind === kind ? read(effect) : undefined;
  });
}

export const faintKindCodec: ParamCodec = readBack(raw => FAINT_KIND_OF[String(fieldOf(raw)?.kind)]);
export const faintWeatherCodec = faintOnly("set-weather", effect => memberNameOf(WeatherType, effect.weather));
export const faintTerrainCodec = faintOnly("set-terrain", effect => memberNameOf(TerrainType, effect.terrain));
export const faintHurtPercentCodec = faintOnly("attacker-damage-flat", effect => asPercent(effect.maxHpFraction));
export const faintHazardCodec = faintOnly("set-hazard", effect => memberNameOf(ArenaTagType, effect.hazard));
export const faintLayersCodec = faintOnly("set-hazard", effect =>
  typeof effect.layers === "number" ? effect.layers : 1,
);
export const faintTagCodec = faintOnly("attacker-battler-tag", effect => memberNameOf(BattlerTagType, effect.tagType));
export const faintTurnsCodec = faintOnly("attacker-battler-tag", effect =>
  typeof effect.turns === "number" ? effect.turns : 0,
);
/** The one skipped type (more than one is not representable and reads back as nothing). */
export const faintSkipTypeCodec = faintOnly("attacker-battler-tag", effect => {
  const excluded = effect.excludeAttackerTypes;
  if (!Array.isArray(excluded) || excluded.length === 0) {
    return NO_TYPE;
  }
  return excluded.length === 1 ? memberNameOf(PokemonType, excluded[0]) : undefined;
});

/** Which stat is the first (0) or second (1) stat change of the attacker. */
export function faintStatCodec(position: 0 | 1): ParamCodec {
  return faintOnly("attacker-stat-change", effect => {
    const change = faintStats(effect, "stats")?.[position];
    return change === undefined ? NO_STAT : memberNameOf(Stat, change.stat);
  });
}

export function faintStagesCodec(position: 0 | 1): ParamCodec {
  return faintOnly("attacker-stat-change", effect => faintStats(effect, "stats")?.[position]?.stages ?? 0);
}

/** The same stat for the attacker's allies: only the stages are a setting, the stat is the one chosen for the attacker. */
export function faintAllyStagesCodec(position: 0 | 1): ParamCodec {
  return faintOnly("attacker-stat-change", effect => {
    const own = faintStats(effect, "stats")?.[position];
    const ally = faintStats(effect, "allyStats")?.find(change => change.stat === own?.stat);
    return ally?.stages ?? 0;
  });
}

/** The constructor argument `{ effect }`, built from the settings of the kind that is chosen (the other settings are ignored). */
export function buildFaintEffect(params: ParamValues): unknown {
  switch (params.kind) {
    case FAINT_KIND_WEATHER:
      return { effect: { kind: "set-weather", weather: enumValue(WeatherType, params.weather, "weather") } };
    case FAINT_KIND_TERRAIN:
      return { effect: { kind: "set-terrain", terrain: enumValue(TerrainType, params.terrain, "terrain") } };
    case FAINT_KIND_HURT:
      return { effect: { kind: "attacker-damage-flat", maxHpFraction: Number(params.hurtPercent) / 100 } };
    case FAINT_KIND_HAZARD: {
      const hazard = enumValue(ArenaTagType, params.hazard, "hazard");
      return Number(params.layers) === 1
        ? { effect: { kind: "set-hazard", hazard } }
        : { effect: { kind: "set-hazard", hazard, layers: Number(params.layers) } };
    }
    case FAINT_KIND_TAG: {
      const effect: Record<string, unknown> = {
        kind: "attacker-battler-tag",
        tagType: enumValue(BattlerTagType, params.tag, "lasting effect"),
      };
      if (Number(params.turns) > 0) {
        effect.turns = Number(params.turns);
      }
      if (params.skipType !== NO_TYPE) {
        effect.excludeAttackerTypes = [enumValue(PokemonType, params.skipType, "type")];
      }
      return { effect };
    }
    case FAINT_KIND_STATS: {
      const picks = [
        { stat: params.stat, stages: Number(params.stages), ally: Number(params.allyStages) },
        { stat: params.stat2, stages: Number(params.stages2), ally: Number(params.allyStages2) },
      ].filter(pick => pick.stat !== NO_STAT);
      const stats = picks.map(pick => ({ stat: enumValue(Stat, pick.stat, "stat") as number, stages: pick.stages }));
      const allyStats = picks
        .filter(pick => pick.ally !== 0)
        .map(pick => ({ stat: enumValue(Stat, pick.stat, "stat") as number, stages: pick.ally }));
      return { effect: { kind: "attacker-stat-change", stats, ...(allyStats.length > 0 ? { allyStats } : {}) } };
    }
    case FAINT_KIND_PP:
      return { effect: { kind: "attacker-pp-drain" } };
    default:
      throw new Error(`"${String(params.kind)}" is not something this can do when I faint`);
  }
}
