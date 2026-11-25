/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codecs and constructor-argument builders of B10 chunk 3 (the "after my attack" and "after I am hit" classes).
// Same idea as b10-codecs.ts: staff edit every field as its own setting (a type, a status, a move name, a number); the
// `build...` functions turn the settings into the ONE options object the class constructor wants (declared as
// `assembleCtorArg`) and each setting's codec reads its value back out of a live instance. Nothing is parsed from a
// sentence: an unknown name throws a plain-language error.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import type { ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { type EnumTable, enumValue, fieldOf, memberNameOf, nameFromWord, readBack } from "./b10-codecs";

/** The "not used" choice of an optional setting (shown to staff as "None"). */
export const NOTHING = "NONE";

/** Every move the game knows: the base list plus the Elite Redux ones (ids from 5000). */
const ALL_MOVES: EnumTable = { ...MoveId, ...ErMoveId };

// ---- Types the target or the attacker is turned into ----

/** "Same type as the move" is the string "moveType" inside the class. */
export const MOVE_TYPE = "MOVE_TYPE";

/** A fixed type, or the type of the move that was used. */
export const changedTypeCodec: ParamCodec = {
  toCtor: value => (value === MOVE_TYPE ? "moveType" : enumValue(PokemonType, value, "type")),
  fromInstance: raw => (raw === "moveType" ? MOVE_TYPE : memberNameOf(PokemonType, raw)),
};

/** A move property the move must have (None = no such requirement). `key` reads it out of an options object. */
export function optionalFlagCodec(key?: string): ParamCodec {
  const pick = (raw: unknown): unknown => (key === undefined ? raw : fieldOf(raw)?.[key]);
  return {
    toCtor: value => (value === NOTHING ? undefined : enumValue(MoveFlags, value, "move property")),
    fromInstance: raw => {
      const flag = pick(raw);
      return flag === undefined || flag === null ? NOTHING : memberNameOf(MoveFlags, flag);
    },
  };
}

/** Which Pokemon the type change lands on, for PostDefendChangeAttackerTypeAbAttr. */
export const SIDE_ATTACKER = "THE_ATTACKER";
export const SIDE_SELF = "ME";
export const sideCodec: ParamCodec = {
  toCtor: value => (value === SIDE_SELF ? "self" : "attacker"),
  fromInstance: raw => (raw === "self" ? SIDE_SELF : raw === "attacker" ? SIDE_ATTACKER : undefined),
};

// ---- Target status list (PostAttackContactSuppressTargetAbilityAbAttr: requireTargetStatus) ----

/** The n-th (0-based) wanted status of the list; None past the end or for no list at all. */
export function statusListCodec(position: number): ParamCodec {
  return readBack(raw => {
    if (raw === null || raw === undefined) {
      return NOTHING;
    }
    if (!Array.isArray(raw) || raw.length > 2) {
      return;
    }
    const status = raw[position];
    return status === undefined ? NOTHING : memberNameOf(StatusEffect, status);
  });
}

/** The constructor argument `{ requireTargetStatus?, contactOnly }`: the key is absent when no status is wanted. */
export function buildContactSuppressOptions(params: ParamValues): unknown {
  const statuses = [params.status, params.status2]
    .filter((name): name is string => typeof name === "string" && name !== NOTHING)
    .map(name => enumValue(StatusEffect, name, "status condition"));
  return {
    contactOnly: params.contactOnly === true,
    ...(statuses.length === 0 ? {} : { requireTargetStatus: statuses }),
  };
}

// ---- Free scripted move ({ moveId, power?, magnitudeRange?, hpScaledBasePower?, filters... }) ----

function moveIdOf(text: unknown): number {
  return ALL_MOVES[nameFromWord(ALL_MOVES, String(text), "move")] as number;
}

/** The move named by `key` of the options object (the object itself is what `path` reads). */
export function optionMoveCodec(key: string): ParamCodec {
  return readBack(raw => memberNameOf(ALL_MOVES, fieldOf(raw)?.[key]));
}

/** The n-th (0-based) move of the list kept under `key`; None past the end or without a list; undefined above 2 entries. */
export function optionMoveListCodec(key: string, position: number): ParamCodec {
  return readBack(raw => {
    const list = fieldOf(raw)?.[key];
    if (list === undefined || list === null) {
      return NOTHING;
    }
    if (!Array.isArray(list) || list.length > 2) {
      return;
    }
    const id = list[position];
    return id === undefined ? NOTHING : memberNameOf(ALL_MOVES, id);
  });
}

/** An optional move that may be written as None (a single option such as `allowVirtualTriggerMoveId`). */
export function optionOptionalMoveCodec(key: string): ParamCodec {
  return readBack(raw => {
    const id = fieldOf(raw)?.[key];
    return id === undefined || id === null ? NOTHING : memberNameOf(ALL_MOVES, id);
  });
}

export function optionNumberOrZero(key: string): ParamCodec {
  return readBack(raw => {
    const value = fieldOf(raw)?.[key];
    return typeof value === "number" ? value : 0;
  });
}

export function optionBooleanCodec(key: string): ParamCodec {
  return readBack(raw => fieldOf(raw)?.[key] === true);
}

export function optionMagnitudeCodec(position: 0 | 1): ParamCodec {
  return readBack(raw => {
    const range = fieldOf(raw)?.magnitudeRange;
    if (range === undefined || range === null) {
      return 0;
    }
    return Array.isArray(range) && typeof range[position] === "number" ? (range[position] as number) : undefined;
  });
}

export const optionCategoryCodec: ParamCodec = readBack(raw => {
  const category = fieldOf(raw)?.categoryFilter;
  return category === undefined || category === null ? NOTHING : memberNameOf(MoveCategory, category);
});

export function optionTypeListCodec(position: number): ParamCodec {
  return readBack(raw => {
    const list = fieldOf(raw)?.typeFilter;
    if (list === undefined || list === null) {
      return NOTHING;
    }
    if (!Array.isArray(list) || list.length > 2) {
      return;
    }
    const type = list[position];
    return type === undefined ? NOTHING : memberNameOf(PokemonType, type);
  });
}

/** The scripted move's `opts` object, key by key; a key is left out when its setting says "not used". */
export function buildScriptedMoveOptions(params: ParamValues): unknown {
  const opts: Record<string, unknown> = { moveId: moveIdOf(params.moveId) };
  if (Number(params.power) > 0) {
    opts.power = Number(params.power);
  }
  if (params.category !== NOTHING) {
    opts.categoryFilter = enumValue(MoveCategory, params.category, "move category");
  }
  const types = [params.type, params.type2]
    .filter((name): name is string => typeof name === "string" && name !== NOTHING)
    .map(name => enumValue(PokemonType, name, "type"));
  if (types.length > 0) {
    opts.typeFilter = types;
  }
  if (params.flag !== NOTHING) {
    opts.flagFilter = enumValue(MoveFlags, params.flag, "move property");
  }
  const low = Number(params.magnitudeLow);
  const high = Number(params.magnitudeHigh);
  if (low > 0 || high > 0) {
    if (low <= 0 || high < low) {
      throw new Error("Give both Magnitude limits, and keep the highest at or above the lowest");
    }
    opts.magnitudeRange = [low, high];
  }
  if (Number(params.hpScaledPower) > 0) {
    opts.hpScaledBasePower = Number(params.hpScaledPower);
  }
  const triggers = [params.triggerMove, params.triggerMove2]
    .filter((name): name is string => typeof name === "string" && name !== NOTHING)
    .map(name => moveIdOf(name));
  if (triggers.length > 0) {
    opts.triggerMoveIds = triggers;
  }
  if (params.targetStatsDecreased === true) {
    opts.targetStatsDecreased = true;
  }
  if (params.allowVirtualMove !== NOTHING) {
    opts.allowVirtualTriggerMoveId = moveIdOf(params.allowVirtualMove);
  }
  return opts;
}

// ---- Terrain by move type (PostAttackSetTerrainByMoveTypeAbAttr: a Map of type -> terrain) ----

/** The n-th (0-based) type of the map; None past the end; undefined above 4 pairs. */
export function terrainPairTypeCodec(position: number): ParamCodec {
  return readBack(raw => {
    if (!(raw instanceof Map) || raw.size > 4) {
      return;
    }
    const entry = [...raw.entries()][position];
    return entry === undefined ? NOTHING : memberNameOf(PokemonType, entry[0]);
  });
}

export function terrainPairTerrainCodec(position: number): ParamCodec {
  return readBack(raw => {
    if (!(raw instanceof Map) || raw.size > 4) {
      return;
    }
    const entry = [...raw.entries()][position];
    return entry === undefined ? NOTHING : memberNameOf(TerrainType, entry[1]);
  });
}

/** The constructor argument: a Map from move type to terrain, one entry per pair that has a type. */
export function buildTerrainByType(params: ParamValues): unknown {
  const map = new Map<PokemonType, TerrainType>();
  for (const position of [1, 2, 3, 4]) {
    const typeName = params[`type${position}`];
    const terrainName = params[`terrain${position}`];
    if (typeName === NOTHING || typeName === undefined) {
      continue;
    }
    if (terrainName === NOTHING || terrainName === undefined) {
      throw new Error(`Choose a terrain for the ${String(typeName)} moves, or set their type to None`);
    }
    map.set(
      enumValue(PokemonType, typeName, "type") as PokemonType,
      enumValue(TerrainType, terrainName, "terrain") as TerrainType,
    );
  }
  if (map.size === 0) {
    throw new Error("Choose at least one move type that sets a terrain");
  }
  return map;
}

// ---- Hazard (PostAttackSetHazardByMoveTypeAbAttr: an ArenaTagType string) ----

export const HAZARD_CHOICES = ["SPIKES", "TOXIC_SPIKES", "STEALTH_ROCK", "STICKY_WEB"] as const;

export const hazardCodec: ParamCodec = {
  toCtor: value => enumValue(ArenaTagType, value, "hazard"),
  fromInstance: raw => memberNameOf(ArenaTagType, raw),
};
