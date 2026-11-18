/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Codecs for declared params whose constructor argument is not what staff see. Staff and the AI use
// names ("GROUND", "BURN"); the classes want enum numbers. A codec is the only place the two meet, so a
// declaration never hard-codes a number and a rename in the enum cannot silently change an ability.

import type { ParamCodec } from "./define-decl";

type EnumTable = Readonly<Record<string, string | number>>;

function nameOf(table: EnumTable, raw: unknown): string | undefined {
  if (typeof raw !== "number") {
    return;
  }
  // TypeScript numeric enums also map number -> name, so only keys whose value is the number and whose key is not a number.
  return Object.keys(table).find(key => table[key] === raw && Number.isNaN(Number(key)));
}

/** One enum value, shown as its member name: PokemonType.GROUND <-> "GROUND". */
export function enumCodec(table: EnumTable, what: string): ParamCodec {
  return {
    toCtor: value => {
      const resolved = table[String(value)];
      if (typeof resolved !== "number") {
        throw new Error(`"${String(value)}" is not a known ${what}`);
      }
      return resolved;
    },
    fromInstance: raw => nameOf(table, raw),
  };
}

/**
 * A list of enum values shown as comma separated names ("POISON,PARALYSIS"), for constructors that take
 * the list as rest arguments (pair it with `spread: true`) or as an array.
 */
export function enumListCodec(table: EnumTable, what: string): ParamCodec {
  return {
    toCtor: value =>
      String(value)
        .split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .map(part => {
          const resolved = table[part];
          if (typeof resolved !== "number") {
            throw new Error(`"${part}" is not a known ${what}`);
          }
          return resolved;
        }),
    fromInstance: raw => {
      if (!Array.isArray(raw)) {
        return;
      }
      const names = raw.map(item => nameOf(table, item));
      return names.every((name): name is string => name !== undefined) ? names.join(",") : undefined;
    },
  };
}

/** For `select` params whose options are enum member names, the list of valid names. */
export function enumOptions(table: EnumTable): string[] {
  return Object.keys(table).filter(key => Number.isNaN(Number(key)));
}
