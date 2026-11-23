/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B09 chunk 4. Codecs shared by the lifesteal family and the type-absorb family (helpers, not declarations: the registry only
// collects `*.decl.ts` and `bindings.ts`).
//
//   percentCodec          the classes take a share as a fraction (0.25); staff see a percent (25).
//   optionalPercentCodec  the same, but 0 means "not set" and reaches the constructor as undefined (LifestealOnHit's bonus heal).
//   wholePercentCodec     a percent that must be a whole number (the loot chance: the class rounds `chance * 100`).
//   lifestealFilterCodec  LifestealOnHitAbAttr's ONE nested `filter` object `{ type?, flag?, targetTag? }` as a short text.
//   koFlagBonusCodec      LifestealOnKoAbAttr's nested `flagBonus` object `{ flag, fraction }` as "biting=50" (empty = none).
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";

/** `Number(x.toPrecision(12))` drops float noise such as 0.35 * 100 = 35.00000000000001. */
const clean = (value: number): number => Number(value.toPrecision(12));

export const percentCodec: ParamCodec = {
  toCtor: value => clean(Number(value) / 100),
  fromInstance: raw => (typeof raw === "number" ? clean(raw * 100) : undefined),
};

export const optionalPercentCodec: ParamCodec = {
  toCtor: value => (Number(value) === 0 ? undefined : clean(Number(value) / 100)),
  fromInstance: raw => (raw === null || raw === undefined ? 0 : typeof raw === "number" ? clean(raw * 100) : undefined),
};

export const wholePercentCodec: ParamCodec = {
  toCtor: value => clean(Number(value) / 100),
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    const percent = clean(raw * 100);
    return Number.isInteger(percent) ? percent : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Lifesteal filter

export const NO_LIFESTEAL_FILTER_TEXT = "any damaging move";

const FLAG_TABLE = MoveFlags as unknown as Record<string, number>;
const TYPE_TABLE = PokemonType as unknown as Record<string, number>;
const TAG_TABLE = BattlerTagType as unknown as Record<string, string>;

/** The name of the single move property bit `mask`, or undefined when it is not exactly one named bit. */
function singleFlagName(mask: number): string | undefined {
  if (mask === 0 || (mask & (mask - 1)) !== 0) {
    return;
  }
  return Object.keys(FLAG_TABLE).find(key => FLAG_TABLE[key] === mask && Number.isNaN(Number(key)));
}

interface RawLifestealFilter {
  readonly type?: number;
  readonly flag?: number;
  readonly targetTag?: string;
}

/**
 * "any damaging move", or parts joined with ";": "type=WATER", "flag=PUNCHING_MOVE", "targetTag=INFATUATED" (the live filter
 * object `{ type, flag, targetTag }`). The filter decides the SHAPE of the gate, so the param is never editable: staff change the
 * move test through the gate condition.
 */
export const lifestealFilterCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    const filter: { type?: number; flag?: number; targetTag?: string } = {};
    if (text === NO_LIFESTEAL_FILTER_TEXT || text === "") {
      return filter;
    }
    for (const part of text.split(";")) {
      const [key, rest = ""] = part.split("=");
      const name = rest.trim();
      switch (key.trim()) {
        case "type": {
          const type = TYPE_TABLE[name];
          if (typeof type !== "number") {
            throw new Error(`"${name}" is not a known type`);
          }
          filter.type = type;
          break;
        }
        case "flag": {
          const bit = FLAG_TABLE[name];
          if (typeof bit !== "number") {
            throw new Error(`"${name}" is not a known move property`);
          }
          filter.flag = bit;
          break;
        }
        case "targetTag": {
          const tag = TAG_TABLE[name];
          if (tag === undefined) {
            throw new Error(`"${name}" is not a known battle effect`);
          }
          filter.targetTag = tag;
          break;
        }
        default:
          throw new Error(`"${part}" is not a move filter`);
      }
    }
    return filter;
  },
  fromInstance: raw => {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const filter = raw as RawLifestealFilter;
    const parts: string[] = [];
    if (filter.type !== undefined) {
      const name = Object.keys(TYPE_TABLE).find(key => TYPE_TABLE[key] === filter.type && Number.isNaN(Number(key)));
      if (name === undefined) {
        return;
      }
      parts.push(`type=${name}`);
    }
    if (filter.flag !== undefined) {
      const name = singleFlagName(filter.flag);
      if (name === undefined) {
        return;
      }
      parts.push(`flag=${name}`);
    }
    if (filter.targetTag !== undefined) {
      const name = Object.keys(TAG_TABLE).find(key => TAG_TABLE[key] === filter.targetTag);
      if (name === undefined) {
        return;
      }
      parts.push(`targetTag=${name}`);
    }
    return parts.length === 0 ? NO_LIFESTEAL_FILTER_TEXT : parts.join(";");
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// On-knock-out bonus

interface RawFlagBonus {
  readonly flag?: number;
  readonly fraction?: number;
}

/** The property a player types ("biting") to the move-property constant (BITING_MOVE). */
function flagFromWord(word: string): number | undefined {
  const base = word
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  for (const candidate of [base, `${base}_MOVE`, `${base}_BASED`]) {
    const bit = FLAG_TABLE[candidate];
    if (typeof bit === "number" && singleFlagName(bit) !== undefined) {
      return bit;
    }
  }
}

/** The constant back to the word a player types: BITING_MOVE -> "biting", HORN_BASED -> "horn". */
function wordFromFlag(mask: number): string | undefined {
  const name = singleFlagName(mask);
  return name === undefined ? undefined : name.replace(/_(MOVE|BASED)$/, "").toLowerCase();
}

/**
 * "" means no bonus (the constructor gets undefined). "biting=50" means a knock-out by a move with the biting property heals 50%
 * of max HP instead of the normal share (the live object `{ flag: BITING_MOVE, fraction: 0.5 }`).
 */
export const koFlagBonusCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === "") {
      return;
    }
    const [word = "", percent = ""] = text.split("=");
    const flag = flagFromWord(word);
    if (flag === undefined) {
      throw new Error(`"${word.trim()}" is not a known move property (try biting, punching, slicing)`);
    }
    const share = Number(percent);
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      throw new Error(`"${percent.trim()}" is not a percent between 1 and 100`);
    }
    return { flag, fraction: clean(share / 100) };
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return "";
    }
    const bonus = raw as RawFlagBonus;
    if (bonus.flag === undefined || bonus.fraction === undefined) {
      return;
    }
    const word = wordFromFlag(bonus.flag);
    return word === undefined ? undefined : `${word}=${clean(bonus.fraction * 100)}`;
  },
};
