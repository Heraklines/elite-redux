/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codecs and constructor-argument builders of B10 chunk 4 (the "when I faint", "when I enter" and "after I am hit"
// classes). Same idea as b10-codecs.ts and c3-codecs.ts: staff edit every field as its own setting (a stat, a number of stages, a
// terrain, a percent); the `build...` function turns the settings into the ONE options object the class constructor wants (declared
// as `assembleCtorArg`) and each setting's codec reads its value back out of a live instance. Nothing is parsed from a sentence:
// an unknown name throws a plain-language error.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import type { ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { TerrainType } from "#data/terrain";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { asPercent, fieldOf, memberNameOf, NO_STAT, nameFromWord, readBack } from "./b10-codecs";

// ---- A lasting effect (the choice of tag) kept as a plain string in the class ----

/** Lasting effects a staff member can put on MYSELF (the class takes any; these are the ones that make sense on the holder). */
export const SELF_TAGS = [
  "NO_RETREAT",
  "TRAPPED",
  "AQUA_RING",
  "INGRAIN",
  "CRIT_BOOST",
  "DRAGON_CHEER",
  "CHARGED",
  "MINIMIZED",
] as const;

/** Lasting effects a staff member can put on every foe on entry (the class takes any; these are the ones that make sense on a foe). */
export const FOE_TAGS = [
  "HEAL_BLOCK",
  "SYRUP_BOMB",
  "TAUNT",
  "TORMENT",
  "CONFUSED",
  "CURSED",
  "SEEDED",
  "SALT_CURED",
  "DROWSY",
  "TAR_SHOT",
] as const;

/** One string stored under `key` of the options object the path points at (`{ tag: "HEAL_BLOCK", turns: 5 }`). */
export function optionText(key: string): ParamCodec {
  return readBack(raw => {
    const value = fieldOf(raw)?.[key];
    return typeof value === "string" ? value : undefined;
  });
}

// ---- A list of weathers or terrains that must be active (null = no requirement) ----

/** "No requirement" for the weather and terrain lists. */
export const NO_REQUIREMENT = "NONE";

function listOf(table: Readonly<Record<string, string | number>>, text: unknown, what: string): number[] | undefined {
  const words = String(text)
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (words.length === 0 || (words.length === 1 && words[0].toUpperCase() === NO_REQUIREMENT)) {
    return;
  }
  return words.map(word => table[nameFromWord(table, word, what)] as number);
}

function namesOf(table: Readonly<Record<string, string | number>>, raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return NO_REQUIREMENT;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return;
  }
  const names = raw.map(item => memberNameOf(table, item));
  return names.every((name): name is string => name !== undefined) ? names.join(",") : undefined;
}

/** The weathers that must be active, as names ("FOG,EERIE_FOG"); None = any weather. `toCtor` gives the list, or leaves the option out. */
export const weatherListCodec: ParamCodec = {
  toCtor: value => listOf(WeatherType, value, "weather"),
  fromInstance: raw => namesOf(WeatherType, raw),
};

/** The terrains that must be active, as names ("ELECTRIC"); None = any terrain. */
export const terrainListCodec: ParamCodec = {
  toCtor: value => listOf(TerrainType, value, "terrain"),
  fromInstance: raw => namesOf(TerrainType, raw),
};

// ---- Clearing a terrain (PostSummonClearTerrainAbAttr): { onCleared, byTerrain, healFractionOnCleared } ----

/** The terrains the class can raise a stat for, in the order the live user keeps them. */
export const CLEAR_TERRAIN_SLOTS = ["GRASSY", "ELECTRIC", "MISTY", "PSYCHIC", "TOXIC"] as const;
export type ClearTerrainSlot = (typeof CLEAR_TERRAIN_SLOTS)[number];

interface TerrainRaise {
  readonly terrain: number;
  readonly stat: number;
  readonly stages: number;
}

/**
 * The per-terrain list of a live instance when it fits the settings (each terrain at most once, in the slot order), else
 * undefined (not representable: the L1 identity check then reports it instead of silently dropping an entry).
 */
function representableByTerrain(raw: unknown): TerrainRaise[] | undefined {
  if (!Array.isArray(raw)) {
    return;
  }
  let last = -1;
  for (const entry of raw as TerrainRaise[]) {
    const slot = CLEAR_TERRAIN_SLOTS.findIndex(name => TerrainType[name] === entry?.terrain);
    if (slot <= last) {
      return;
    }
    last = slot;
  }
  return raw as TerrainRaise[];
}

/** The stat raised for one terrain; None when the terrain has no entry. */
export function terrainRaiseStatCodec(slot: ClearTerrainSlot): ParamCodec {
  return readBack(raw => {
    const list = representableByTerrain(raw);
    if (list === undefined) {
      return;
    }
    const entry = list.find(item => item.terrain === TerrainType[slot]);
    return entry === undefined ? NO_STAT : memberNameOf(Stat, entry.stat);
  });
}

/** The stages for one terrain; 1 (the default shown) when the terrain has no entry. */
export function terrainRaiseStagesCodec(slot: ClearTerrainSlot): ParamCodec {
  return readBack(raw => {
    const list = representableByTerrain(raw);
    if (list === undefined) {
      return;
    }
    return list.find(item => item.terrain === TerrainType[slot])?.stages ?? 1;
  });
}

/** `onCleared` holds at most one entry in every live user; a longer list is not representable. */
export const clearedStatCodec: ParamCodec = readBack(raw => {
  if (!Array.isArray(raw) || raw.length > 1) {
    return;
  }
  return raw.length === 0 ? NO_STAT : memberNameOf(Stat, (raw[0] as { stat: number }).stat);
});

export const clearedStagesCodec: ParamCodec = readBack(raw => {
  if (!Array.isArray(raw) || raw.length > 1) {
    return;
  }
  return raw.length === 0 ? 1 : (raw[0] as { stages: number }).stages;
});

export const healPercentCodec: ParamCodec = readBack(raw => asPercent(raw));

const statOf = (name: unknown): number => {
  const stat = (Stat as unknown as Record<string, number>)[String(name)];
  if (typeof stat !== "number") {
    throw new Error(`"${String(name)}" is not a known stat`);
  }
  return stat;
};

/** The settings back into the one options object. A stat of None leaves its entry out. */
export function buildClearTerrainOptions(params: ParamValues): unknown {
  const onCleared =
    params.clearedStat === NO_STAT ? [] : [{ stat: statOf(params.clearedStat), stages: Number(params.clearedStages) }];
  const byTerrain = CLEAR_TERRAIN_SLOTS.flatMap(slot => {
    const stat = params[`${slot.toLowerCase()}Stat`];
    return stat === NO_STAT
      ? []
      : [{ terrain: TerrainType[slot], stat: statOf(stat), stages: Number(params[`${slot.toLowerCase()}Stages`]) }];
  });
  return { onCleared, byTerrain, healFractionOnCleared: Number(params.healPercent) / 100 };
}
