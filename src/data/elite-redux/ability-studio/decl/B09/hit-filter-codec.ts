/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B09 chunk 3. The one codec shared by HitMultiplierAbAttr and HitMultiplierPowerAbAttr (a helper, not a declaration: the
// registry only collects `*.decl.ts` and `bindings.ts`).
//
// Both classes take their move filter as ONE nested object inside the options object, `{ type?, flag?, flagsAny? }`
// (archetypes/hit-multiplier.ts, HitMultiplierFilter). A declared param maps to one key of the options object, so the
// whole filter is one param whose value is a short text, and this codec translates between that text and the object:
//
//   "any move"                       {}                                    no filter (Hyper Aggressive, Witch Broom ...)
//   "type=FIRE"                      { type: PokemonType.FIRE }
//   "flag=PUNCHING_MOVE"             { flag: MoveFlags.PUNCHING_MOVE }
//   "flag=PULSE_MOVE|SLICING_MOVE"   { flag: PULSE_MOVE | SLICING_MOVE }   one combined mask (Dual Wield), tested as ONE flag
//   "flagsAny=KICKING_MOVE|ARROW_BASED"  { flagsAny: [KICKING_MOVE, ARROW_BASED] }   any of the listed properties (Flurry)
//   parts can be joined with ";" (both a type and a flag must match, as in the class).
//
// The filter is never edited through this text: it decides the SHAPE of the gate (which atoms), so the param is not
// editable and staff change the move test through the gate condition instead.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";

export const NO_FILTER_TEXT = "any move";

const FLAG_TABLE = MoveFlags as unknown as Record<string, number>;
const TYPE_TABLE = PokemonType as unknown as Record<string, number>;

/** The names of every single-bit flag set in `mask`, or undefined when a bit has no name. */
function flagNames(mask: number): string[] | undefined {
  const names: string[] = [];
  let left = mask;
  for (const key of Object.keys(FLAG_TABLE)) {
    const bit = FLAG_TABLE[key];
    if (
      typeof bit === "number"
      && Number.isNaN(Number(key))
      && bit !== 0
      && (bit & (bit - 1)) === 0
      && (mask & bit) !== 0
    ) {
      names.push(key);
      left &= ~bit;
    }
  }
  return left === 0 && names.length > 0 ? names : undefined;
}

function flagMask(text: string): number {
  return text
    .split("|")
    .map(part => part.trim())
    .reduce((mask, name) => {
      const bit = FLAG_TABLE[name];
      if (typeof bit !== "number") {
        throw new Error(`"${name}" is not a known move property`);
      }
      return mask | bit;
    }, 0);
}

interface RawFilter {
  readonly type?: number;
  readonly flag?: number;
  readonly flagsAny?: readonly number[];
}

export const hitFilterCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    const filter: { type?: number; flag?: number; flagsAny?: number[] } = {};
    if (text === NO_FILTER_TEXT || text === "") {
      return filter;
    }
    for (const part of text.split(";")) {
      const [key, rest = ""] = part.split("=");
      switch (key.trim()) {
        case "type": {
          const type = TYPE_TABLE[rest.trim()];
          if (typeof type !== "number") {
            throw new Error(`"${rest.trim()}" is not a known type`);
          }
          filter.type = type;
          break;
        }
        case "flag":
          filter.flag = flagMask(rest);
          break;
        case "flagsAny":
          filter.flagsAny = rest.split("|").map(name => flagMask(name));
          break;
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
    const filter = raw as RawFilter;
    const parts: string[] = [];
    if (filter.type !== undefined) {
      const name = Object.keys(TYPE_TABLE).find(key => TYPE_TABLE[key] === filter.type && Number.isNaN(Number(key)));
      if (name === undefined) {
        return;
      }
      parts.push(`type=${name}`);
    }
    if (filter.flag !== undefined) {
      const names = flagNames(filter.flag);
      if (names === undefined) {
        return;
      }
      parts.push(`flag=${names.join("|")}`);
    }
    if (filter.flagsAny !== undefined) {
      const lists = filter.flagsAny.map(flag => flagNames(flag));
      if (lists.some(list => list === undefined || list.length !== 1)) {
        return;
      }
      parts.push(`flagsAny=${lists.map(list => (list as string[])[0]).join("|")}`);
    }
    return parts.length === 0 ? NO_FILTER_TEXT : parts.join(";");
  },
};
