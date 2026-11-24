/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6: the player words that stand for engine values in the declarations of this chunk. Not a declaration, so the
// registry (which only collects `*.decl.ts` and `bindings.ts`) does not load it.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MoveId } from "#enums/move-id";

/** "Discharge", "discharge", "Thunder Wave", "THUNDER_WAVE" all name a move; the class wants the move id. */
function moveKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function moveTitle(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** A move shown by its name (Discharge), kept by the class as a move id. */
export const moveNameCodec: ParamCodec = {
  toCtor: value => {
    const resolved = (MoveId as unknown as Record<string, string | number>)[moveKey(String(value))];
    if (typeof resolved !== "number" || resolved === MoveId.NONE) {
      throw new Error(`"${String(value)}" is not a known move name`);
    }
    return resolved;
  },
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    const key = Object.keys(MoveId).find(name => Number.isNaN(Number(name)) && (MoveId as never)[name] === raw);
    return key === undefined ? undefined : moveTitle(key);
  },
};
