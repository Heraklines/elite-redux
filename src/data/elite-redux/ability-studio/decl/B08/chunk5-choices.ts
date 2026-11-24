/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared by the B08 chunk 5 declarations (the two entry-effect classes): the player-facing words for the field effects,
// traps, weathers, terrains, types, stats and moves they hand out, and the codecs that turn them into what the constructors
// want. This is not a declaration (the registry only collects `*.decl.ts` and `bindings.ts`).
//
// EntryEffectAbAttr takes ONE options object `{ kind, weather, turns, ... }` whose keys depend on the kind. A key a kind does
// not use must stay OUT of the object (the build leaves an option out when its codec answers undefined), so every kind-specific
// setting has a "Not used" choice (or 0 for a number) that the codec turns into undefined, and reads an absent key back as that.
import { ALL_MOVE_NAMES, singleMoveCodec } from "#data/elite-redux/ability-studio/decl/B08/chunk3-choices";
import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS, WEATHER_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";

export const NOT_USED = "Not used";

/** The id of the Forewarn-only Future Sight copy (80 power, never misses): a move that is not in any move enum. */
export const FOREWARN_FUTURE_SIGHT = 9500;

type Pair<T> = readonly (readonly [name: string, value: T])[];

/** A choice list <-> a constructor value, with "Not used" meaning "leave the option out". */
function choiceCodec<T>(pairs: Pair<T>, what: string): ParamCodec {
  return {
    toCtor: value => {
      if (value === NOT_USED) {
        return;
      }
      const entry = pairs.find(([name]) => name === String(value));
      if (entry === undefined) {
        throw new Error(`"${String(value)}" is not a known ${what}`);
      }
      return entry[1];
    },
    fromInstance: raw => {
      if (raw === undefined || raw === null) {
        return NOT_USED;
      }
      return pairs.find(([, value]) => value === raw)?.[0];
    },
  };
}

/** The same codec, but the live value is one key of the entry-effect options object the attribute keeps. */
function fieldOf(inner: ParamCodec, key: string): ParamCodec {
  return {
    toCtor: inner.toCtor,
    fromInstance: raw => inner.fromInstance((raw as Record<string, unknown> | undefined)?.[key]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What a field effect is called, for the two classes that lay one on the field.

/** Screens, rooms and other timed field effects (the "screen or room" kind and the pledge classes). */
export const FIELD_EFFECT_CHOICES: Pair<ArenaTagType> = [
  ["Reflect", ArenaTagType.REFLECT],
  ["Light Screen", ArenaTagType.LIGHT_SCREEN],
  ["Aurora Veil", ArenaTagType.AURORA_VEIL],
  ["Tailwind", ArenaTagType.TAILWIND],
  ["Mist", ArenaTagType.MIST],
  ["Smokescreen", ArenaTagType.ER_SMOKESCREEN],
  ["Safeguard", ArenaTagType.SAFEGUARD],
  ["Happy Hour", ArenaTagType.HAPPY_HOUR],
  ["Trick Room", ArenaTagType.TRICK_ROOM],
  ["Inverse Room", ArenaTagType.INVERSE_ROOM],
  ["Magic Room", ArenaTagType.MAGIC_ROOM],
  ["Wonder Room", ArenaTagType.WONDER_ROOM],
  ["Swirly Room", ArenaTagType.SWIRLY_ROOM],
  ["Gravity", ArenaTagType.GRAVITY],
  ["Mud Sport", ArenaTagType.MUD_SPORT],
  ["Water Sport", ArenaTagType.WATER_SPORT],
  ["Ion Deluge", ArenaTagType.ION_DELUGE],
  ["Fairy Lock", ArenaTagType.FAIRY_LOCK],
  ["Rainbow (Water and Fire pledge)", ArenaTagType.WATER_FIRE_PLEDGE],
  ["Swamp (Grass and Water pledge)", ArenaTagType.GRASS_WATER_PLEDGE],
  ["Sea of fire (Fire and Grass pledge)", ArenaTagType.FIRE_GRASS_PLEDGE],
];

/** Traps that wait on a side of the field for the next Pokemon to switch in. */
export const TRAP_CHOICES: Pair<ArenaTagType> = [
  ["Spikes", ArenaTagType.SPIKES],
  ["Toxic Spikes", ArenaTagType.TOXIC_SPIKES],
  ["Stealth Rock", ArenaTagType.STEALTH_ROCK],
  ["Sticky Web", ArenaTagType.STICKY_WEB],
  ["Foamy Web", ArenaTagType.FOAMY_WEB],
  ["Hot Coals", ArenaTagType.HOT_COALS],
  ["Creeping Thorns", ArenaTagType.CREEPING_THORNS],
];

/** The pledge class lays any of the above. */
export const EVERY_FIELD_CHOICE: Pair<ArenaTagType> = [...FIELD_EFFECT_CHOICES, ...TRAP_CHOICES];

export const FIELD_EFFECT_NAMES: readonly string[] = FIELD_EFFECT_CHOICES.map(([name]) => name);
export const TRAP_NAMES: readonly string[] = TRAP_CHOICES.map(([name]) => name);
export const EVERY_FIELD_NAMES: readonly string[] = EVERY_FIELD_CHOICE.map(([name]) => name);

/** One field effect, always present (EntryArenaTagOnFoeSideAbAttr). */
export const fieldEffectCodec: ParamCodec = choiceCodec(EVERY_FIELD_CHOICE, "field effect");

// ---------------------------------------------------------------------------------------------------------------
// The entry-effect kinds and the settings each one reads.

const KIND_CHOICES: Pair<string> = [
  ["Set the weather", "set-weather"],
  ["Set a terrain", "set-terrain"],
  ["Set one terrain picked at random", "set-terrain-random"],
  ["Lay a trap on the field", "set-hazard"],
  ["Set a screen, room or other field effect", "set-screen-or-room"],
  ["Add a type to myself", "add-self-type"],
  ["Change one of my own stats", "self-stat-boost"],
  ["Use a move", "scripted-move"],
];
export const KIND_NAMES: readonly string[] = KIND_CHOICES.map(([name]) => name);

/** The kind is always present, so it has no "Not used". */
export const kindCodec: ParamCodec = {
  toCtor: value => {
    const entry = KIND_CHOICES.find(([name]) => name === String(value));
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a known entry effect`);
    }
    return entry[1];
  },
  fromInstance: raw => {
    const kind = (raw as { kind?: unknown } | undefined)?.kind;
    return KIND_CHOICES.find(([, value]) => value === kind)?.[0];
  },
};

const WEATHER_VALUES = WeatherType as unknown as Record<string, number>;
const WEATHER_CHOICES: Pair<number> = WEATHER_OPTIONS.filter(weather => weather !== "NONE").map(weather => [
  playerName(weather),
  WEATHER_VALUES[weather],
]);
export const WEATHER_NAMES: readonly string[] = [NOT_USED, ...WEATHER_CHOICES.map(([name]) => name)];
export const weatherCodec: ParamCodec = fieldOf(choiceCodec(WEATHER_CHOICES, "weather"), "weather");

const TERRAIN_CHOICES: Pair<TerrainType> = [
  ["Misty", TerrainType.MISTY],
  ["Electric", TerrainType.ELECTRIC],
  ["Grassy", TerrainType.GRASSY],
  ["Psychic", TerrainType.PSYCHIC],
  ["Toxic", TerrainType.TOXIC],
];
export const TERRAIN_NAMES: readonly string[] = [NOT_USED, ...TERRAIN_CHOICES.map(([name]) => name)];
export const terrainCodec: ParamCodec = fieldOf(choiceCodec(TERRAIN_CHOICES, "terrain"), "terrain");

/** "Grassy, Psychic" <-> [GRASSY, PSYCHIC]; empty text = the option is left out. */
export const terrainListCodec: ParamCodec = {
  toCtor: value => {
    const parts = String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0);
    if (parts.length === 0) {
      return;
    }
    return parts.map(part => {
      const entry = TERRAIN_CHOICES.find(([name]) => name.toLowerCase() === part.toLowerCase());
      if (entry === undefined) {
        throw new Error(`"${part}" is not a known terrain`);
      }
      return entry[1];
    });
  },
  fromInstance: raw => {
    const list = (raw as { terrains?: unknown } | undefined)?.terrains;
    if (list === undefined) {
      return "";
    }
    if (!Array.isArray(list)) {
      return;
    }
    const names = list.map(item => TERRAIN_CHOICES.find(([, value]) => value === item)?.[0]);
    return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
  },
};

export const TRAP_OPTION_NAMES: readonly string[] = [NOT_USED, ...TRAP_NAMES];
export const trapCodec: ParamCodec = fieldOf(choiceCodec(TRAP_CHOICES, "trap"), "hazard");

export const FIELD_OPTION_NAMES: readonly string[] = [NOT_USED, ...FIELD_EFFECT_NAMES];
export const fieldCodec: ParamCodec = fieldOf(choiceCodec(FIELD_EFFECT_CHOICES, "field effect"), "tag");

/** The side a trap goes on. Left out, the class lays it on BOTH sides (its old behaviour). */
export const HAZARD_SIDE_NAMES: readonly string[] = [NOT_USED, "The foes' side", "My own side", "Both sides"];
export const hazardSideCodec: ParamCodec = {
  toCtor: value => {
    switch (String(value)) {
      case NOT_USED:
        return;
      case "The foes' side":
        return "foe";
      case "My own side":
        return "self";
      case "Both sides":
        return "both";
      default:
        throw new Error(`"${String(value)}" is not a known side`);
    }
  },
  fromInstance: raw => {
    const side = (raw as { side?: unknown } | undefined)?.side;
    if (side === undefined) {
      return NOT_USED;
    }
    // A screen keeps an absolute ArenaTagSide number here; only the trap kind's words are readable.
    return side === "foe"
      ? "The foes' side"
      : side === "self"
        ? "My own side"
        : side === "both"
          ? "Both sides"
          : undefined;
  },
};

const TYPE_VALUES = PokemonType as unknown as Record<string, number>;
const TYPE_CHOICES: Pair<number> = TYPE_OPTIONS.filter(type => type !== "STELLAR").map(type => [
  playerName(type),
  TYPE_VALUES[type],
]);
export const TYPE_NAMES: readonly string[] = [NOT_USED, ...TYPE_CHOICES.map(([name]) => name)];
export const typeCodec: ParamCodec = fieldOf(choiceCodec(TYPE_CHOICES, "type"), "type");

const STAT_CHOICES: Pair<number> = [
  ["Attack", Stat.ATK],
  ["Defense", Stat.DEF],
  ["Sp. Atk", Stat.SPATK],
  ["Sp. Def", Stat.SPDEF],
  ["Speed", Stat.SPD],
  ["Accuracy", Stat.ACC],
  ["Evasion", Stat.EVA],
];
export const STAT_NAMES: readonly string[] = [NOT_USED, ...STAT_CHOICES.map(([name]) => name)];
export const statCodec: ParamCodec = fieldOf(choiceCodec(STAT_CHOICES, "stat"), "stat");

/** A number setting where 0 means "not used" (the key stays out of the options object). */
export function zeroLeavesOut(key: string): ParamCodec {
  return {
    toCtor: value => (Number(value) === 0 ? undefined : Number(value)),
    fromInstance: raw => {
      const value = (raw as Record<string, unknown> | undefined)?.[key];
      return value === undefined ? 0 : typeof value === "number" ? value : undefined;
    },
  };
}

/** The move the entry-effect uses. 9500 is the Forewarn-only Future Sight copy, which no move table names. */
const FUTURE_SIGHT_COPY = "Future Sight (80 power, never misses)";
export const MOVE_NAMES: readonly string[] = [NOT_USED, FUTURE_SIGHT_COPY, ...ALL_MOVE_NAMES];
export const moveCodec: ParamCodec = {
  toCtor: value => {
    if (value === NOT_USED) {
      return;
    }
    if (value === FUTURE_SIGHT_COPY) {
      return FOREWARN_FUTURE_SIGHT;
    }
    return singleMoveCodec.toCtor(value);
  },
  fromInstance: raw => {
    const move = (raw as { move?: unknown } | undefined)?.move;
    if (move === undefined) {
      return NOT_USED;
    }
    return move === FOREWARN_FUTURE_SIGHT ? FUTURE_SIGHT_COPY : singleMoveCodec.fromInstance(move);
  },
};
