/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";
import { buildIdMapForCategory, loadEnumValues } from "./id-map.mjs";

const CUSTOM_ID_START = 5000;

/**
 * Convert an ER move const (e.g. `MOVE_EERIE_FOG`) into the enum-key form
 * used in `er-move-id.ts` (e.g. `EERIE_FOG`). Strips the `MOVE_` prefix;
 * throws on a const that doesn't start with that prefix so we surface
 * upstream data drift loudly.
 *
 * @param {string} moveConst
 * @returns {string}
 */
export function moveConstToEnumKey(moveConst) {
  if (typeof moveConst !== "string") {
    throw new TypeError(`moveConst must be a string, got ${typeof moveConst}`);
  }
  if (!moveConst.startsWith("MOVE_")) {
    throw new Error(`moveConst missing "MOVE_" prefix: ${moveConst}`);
  }
  return moveConst.slice("MOVE_".length);
}

/**
 * Builds the `er-move-id.ts` enum body. Mirrors the id-assignment logic
 * from `scripts/elite-redux/builders/id-map.mjs` (`buildIdMapForCategory`) so
 * the values here align with `ER_ID_MAP.moves[*]` for the same entries.
 *
 * @type {import("../lib/builder-types.mjs").BuildFn}
 */
export async function build({ dump, outDir, flags }) {
  const movesEnum = await loadEnumValues("move-id.ts", 400);
  const moveRaws = /** @type {Array<{id: number, NAME?: string, name?: string}>} */ (dump.moves ?? []);

  // Mirror id-map.mjs's name-stripping rule (drop the "MOVE_" prefix
  // before normalization) so vanilla matches resolve identically.
  const movesForLookup = moveRaws.map(m => ({
    id: m.id,
    name: (m.NAME ?? m.name ?? "").replace(/^MOVE_/, ""),
  }));

  const { map } = buildIdMapForCategory(movesForLookup, movesEnum, CUSTOM_ID_START);

  /** @type {Array<[string, number]>} */
  const customEntries = [];
  for (const raw of moveRaws) {
    const assigned = map[raw.id];
    if (assigned === undefined) {
      continue; // shouldn't happen — buildIdMapForCategory covers every input
    }
    if (assigned < CUSTOM_ID_START) {
      continue; // vanilla — lives in src/enums/move-id.ts already
    }
    const enumKey = moveConstToEnumKey(raw.NAME ?? raw.name ?? "");
    customEntries.push([enumKey, assigned]);
  }

  // Drift guard: duplicate enum keys would silently flatten the map. Throw
  // loudly so a name collision in the upstream dump never gets shipped.
  const seen = new Set();
  for (const [key] of customEntries) {
    if (seen.has(key)) {
      throw new Error(`[er:erMoveIdEnum] duplicate enum key: ${key}`);
    }
    seen.add(key);
  }

  const objectBody = customEntries.map(([key, value]) => `  ${key}: ${value}`).join(",\n");
  const body = `// ER-custom move IDs. Values ≥ ${CUSTOM_ID_START} to avoid colliding with pokerogue's
// vanilla MoveId enum (which uses values ≤ ~950). Vanilla moves are
// NOT included here — they live in src/enums/move-id.ts and gain ER
// content via B3 vanilla-rebalance work; the values below are the ER customs
// registered by initEliteReduxCustomMoves() (see B2).

export const ErMoveId = {
${objectBody},
} as const;

export type ErMoveIdKey = keyof typeof ErMoveId;
export type ErMoveIdValue = (typeof ErMoveId)[ErMoveIdKey];
`;

  if (flags.dryRun) {
    console.log(`[er:erMoveIdEnum] would emit ${customEntries.length} custom move IDs`);
    return;
  }

  // This enum lives in src/enums/, not src/data/elite-redux/.
  const enumPath = resolve(outDir, "../../enums/er-move-id.ts");
  await emitModule(enumPath, body);
  console.log(`[er:erMoveIdEnum] emitted ${customEntries.length} custom move IDs`);
}
