/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codecs and constructor-argument builders of B10 chunk 5 (the "when I enter" scripted move, the entry terrain plus field
// effect, and the "at the end of every turn" drain). Same idea as b10-codecs.ts, c3-codecs.ts and c4-codecs.ts: staff edit every field
// as its own setting; the `build...` function turns the settings into the ONE options object the class constructor wants (declared as
// `assembleCtorArg`) and each setting's codec reads its value back out of a live instance. Nothing is parsed from a sentence: an unknown
// name throws a plain-language error.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import type { ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErMoveId } from "#enums/er-move-id";
import { MoveId } from "#enums/move-id";
import { type EnumTable, enumValue, fieldOf, memberNameOf, nameFromWord, readBack } from "./b10-codecs";
import { NOTHING } from "./c3-codecs";

const ALL_MOVES: EnumTable = { ...MoveId, ...ErMoveId };

function moveIdOf(text: unknown): number {
  return ALL_MOVES[nameFromWord(ALL_MOVES, String(text), "move")] as number;
}

// ---- The scripted move cast on entry (PostSummonScriptedMoveAbAttr) ----

/** Who the cast is aimed at (`targetsSelf` and `allOpponents` of the class, as one choice). */
export const AIM_FIRST_FOE = "THE_FIRST_FOE";
export const AIM_EVERY_FOE = "EVERY_FOE";
export const AIM_ME = "ME";
export const AIM_CHOICES = [AIM_FIRST_FOE, AIM_EVERY_FOE, AIM_ME] as const;

/**
 * The aim of a live instance. `targetsSelf` wins over `allOpponents` in the class (it is tested first), so a live instance with both
 * set reads as "Me" and the builder never writes both.
 */
export const aimCodec: ParamCodec = readBack(raw => {
  const opts = fieldOf(raw);
  if (opts?.targetsSelf === true) {
    return AIM_ME;
  }
  return opts?.allOpponents === true ? AIM_EVERY_FOE : AIM_FIRST_FOE;
});

/** A setting that is true when the key is set to true and false otherwise (an absent key is false). */
export function optionFlagCodec(key: string): ParamCodec {
  return readBack(raw => fieldOf(raw)?.[key] === true);
}

/** The name of the memory the class keeps its once-per-battle marker under; None when the cast has no per-battle limit. */
export const memoryKeyCodec: ParamCodec = readBack(raw => {
  const key = fieldOf(raw)?.oncePerBattleKey;
  return typeof key === "string" ? key : NOTHING;
});

/** The cap on casts per battle; 0 = no cap (a single marker, once per battle, when there is a memory name). */
export const maxUsesCodec: ParamCodec = readBack(raw => {
  const max = fieldOf(raw)?.maxUsesPerBattle;
  return typeof max === "number" ? max : 0;
});

/** The cast's `opts` object: a key is left out when its setting says "not used". */
export function buildEntryMoveOptions(params: ParamValues): unknown {
  const opts: Record<string, unknown> = { moveId: moveIdOf(params.moveId) };
  if (Number(params.power) > 0) {
    opts.power = Number(params.power);
  }
  if (params.aim === AIM_ME) {
    opts.targetsSelf = true;
  } else if (params.aim === AIM_EVERY_FOE) {
    opts.allOpponents = true;
  } else if (params.aim !== AIM_FIRST_FOE) {
    throw new Error(`"${String(params.aim)}" is not a known aim (the first foe, every foe or me)`);
  }
  if (params.alwaysHit === true) {
    opts.alwaysHit = true;
  }
  if (params.memoryKey !== NOTHING) {
    opts.oncePerBattleKey = String(params.memoryKey);
    if (Number(params.maxUses) > 0) {
      opts.maxUsesPerBattle = Number(params.maxUses);
    }
  } else if (Number(params.maxUses) > 0) {
    throw new Error("A cap on casts per battle needs a memory name too");
  }
  if (params.nonReflectable === true) {
    opts.nonReflectable = true;
  }
  return opts;
}

// ---- A terrain plus up to two field effects (PostSummonStackSetEffectsAbAttr: { terrain?, tags? }) ----

/** Terrains a staff member can set; None leaves the terrain alone. */
export const STACK_TERRAINS = ["NONE", "MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"] as const;

/** Field effects a staff member can choose (the class takes any field effect; these are the ones that make sense as a team buff or a room). */
export const STACK_FIELD_EFFECTS = [
  "TAILWIND",
  "TRICK_ROOM",
  "LIGHT_SCREEN",
  "REFLECT",
  "AURORA_VEIL",
  "SAFEGUARD",
  "MIST",
  "GRAVITY",
] as const;

export const SIDE_MINE = "MY_SIDE";
export const SIDE_FOES = "THE_FOES_SIDE";
export const SIDE_BOTH = "BOTH_SIDES";
export const STACK_SIDES = [SIDE_MINE, SIDE_FOES, SIDE_BOTH] as const;

const SIDE_OF_CHOICE: Readonly<Record<string, ArenaTagSide>> = {
  [SIDE_MINE]: ArenaTagSide.PLAYER,
  [SIDE_FOES]: ArenaTagSide.ENEMY,
  [SIDE_BOTH]: ArenaTagSide.BOTH,
};

/** At most two field effects are representable; a longer list, or a side the choices do not have, reads back as undefined. */
function representableTags(raw: unknown): { type: string; turns: number; side: number }[] | undefined {
  const tags = fieldOf(raw)?.tags;
  if (tags === undefined || tags === null) {
    return [];
  }
  if (!Array.isArray(tags) || tags.length > 2) {
    return;
  }
  return tags.every(tag => Object.values(SIDE_OF_CHOICE).includes(tag?.side)) ? tags : undefined;
}

/** The terrain a live instance sets; None when it sets none. An explicit terrain None (clear it) is not representable. */
export const stackTerrainCodec: ParamCodec = readBack(raw => {
  const terrain = fieldOf(raw)?.terrain;
  if (terrain === undefined || terrain === null) {
    return "NONE";
  }
  return terrain === TerrainType.NONE ? undefined : memberNameOf(TerrainType, terrain);
});

export function stackTagTypeCodec(position: 0 | 1): ParamCodec {
  return readBack(raw => {
    const tags = representableTags(raw);
    if (tags === undefined) {
      return;
    }
    const tag = tags[position];
    return tag === undefined ? NOTHING : memberNameOf(ArenaTagType, tag.type);
  });
}

export function stackTagTurnsCodec(position: 0 | 1): ParamCodec {
  return readBack(raw => {
    const tags = representableTags(raw);
    return tags === undefined ? undefined : (tags[position]?.turns ?? 5);
  });
}

export function stackTagSideCodec(position: 0 | 1): ParamCodec {
  return readBack(raw => {
    const tags = representableTags(raw);
    if (tags === undefined) {
      return;
    }
    const tag = tags[position];
    if (tag === undefined) {
      return SIDE_MINE;
    }
    return tag.side === ArenaTagSide.PLAYER ? SIDE_MINE : tag.side === ArenaTagSide.ENEMY ? SIDE_FOES : SIDE_BOTH;
  });
}

/** The settings back into `{ terrain, tags }`. A terrain or a field effect of None leaves its entry out; a second effect needs a first. */
export function buildStackOptions(params: ParamValues): unknown {
  const opts: { terrain?: number; tags: { type: ArenaTagType; turns: number; side: ArenaTagSide }[] } = { tags: [] };
  if (params.terrain !== "NONE") {
    opts.terrain = enumValue(TerrainType, params.terrain, "terrain") as number;
  }
  const slots = [
    [params.tagType1, params.tagTurns1, params.tagSide1],
    [params.tagType2, params.tagTurns2, params.tagSide2],
  ] as const;
  if (slots[0][0] === NOTHING && slots[1][0] !== NOTHING) {
    throw new Error("Set the first field effect before the second one");
  }
  for (const [type, turns, side] of slots) {
    if (type === NOTHING) {
      continue;
    }
    const sideValue = SIDE_OF_CHOICE[String(side)];
    if (sideValue === undefined) {
      throw new Error(`"${String(side)}" is not a known side (my side, the foes' side or both sides)`);
    }
    opts.tags.push({
      type: enumValue(ArenaTagType, type, "field effect") as ArenaTagType,
      turns: Number(turns),
      side: sideValue,
    });
  }
  return opts;
}

// ---- A share of max HP kept as a fraction (PostTurnDrainAbAttr) ----

/**
 * A share shown to staff as a percent (10 = a tenth, 16.6667 = a sixth) and kept by the class as a fraction (0.1, 1 / 6). A plain
 * `percent / 100` would turn the sixth into 0.16666666666666663 and change the drain by a point of HP at some max HP values, so a
 * value within a hundred-thousandth of a unit fraction (1/2 ... 1/100) is snapped to that exact fraction. Every live share (a tenth,
 * a sixth) is one of them.
 */
export const shareOfMaxHpCodec: ParamCodec = {
  toCtor: value => {
    const fraction = Number(value) / 100;
    const n = Math.round(1 / fraction);
    return n >= 2 && n <= 100 && Math.abs(fraction - 1 / n) < 1e-5 ? 1 / n : fraction;
  },
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toFixed(4)) : undefined),
};
