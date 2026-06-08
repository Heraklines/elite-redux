/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — egg moves for the FULL roster (vanilla + ER-custom species).
//
// The DATA lives in `er-egg-moves.json` (speciesConst → move NAMES) so the team
// egg-move editor can read/write it without touching TypeScript. It holds BOTH
// the vanilla base species (migrated from `#balance/moves/egg-moves`) and the
// hand-audited ER customs — `init-elite-redux-egg-moves.ts` applies the whole
// table over `speciesEggMoves`.
//
// Resolving a move NAME → id covers both pools:
//   - vanilla moves: the static `MoveId` enum (name → value).
//   - ER-custom moves: NOT in the static enum (their reverse-map is installed at
//     runtime, value→name only), so we build name → pokerogue-id straight from
//     the ER move drafts (`moveNameToEnumKey(draft.name)` → `ER_ID_MAP.moves`).
// All inputs are static module data, so this resolves correctly at import time.
//
// Per-species rationale for the ER kits lives in docs/plans/er-egg-moves-worktable.md.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { MoveId } from "#enums/move-id";
import eggMovesByName from "./er-egg-moves.json";

/** Mirror of `moveNameToEnumKey` in init-elite-redux-custom-moves.ts (the key style
 *  the runtime installs for ER custom moves), so our name lookup matches the game. */
function moveNameToEnumKey(moveName: string): string {
  return moveName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Move enum NAME (as stored in the JSON) → MoveId value, for vanilla + ER customs. */
const MOVE_BY_NAME: Record<string, MoveId | undefined> = Object.create(null);
// Vanilla: name → value direction of the static enum.
for (const [key, value] of Object.entries(MoveId)) {
  if (typeof value === "number") {
    MOVE_BY_NAME[key] = value;
  }
}
// ER customs (and ER-rebalanced vanilla): name → pokerogue id from the drafts.
// Vanilla wins on a name collision (don't clobber an existing enum entry).
for (const draft of ER_MOVES) {
  const pkrgId = ER_ID_MAP.moves[draft.id];
  if (pkrgId === undefined) {
    continue;
  }
  const key = moveNameToEnumKey(draft.name);
  if (MOVE_BY_NAME[key] === undefined) {
    MOVE_BY_NAME[key] = pkrgId as MoveId;
  }
}

/** Base species (by speciesConst) → its egg moves (vanilla + ER customs). */
export const ER_EGG_MOVES: Readonly<Record<string, readonly MoveId[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(eggMovesByName as Record<string, readonly string[]>).map(([speciesConst, names]) => [
      speciesConst,
      names.map(name => MOVE_BY_NAME[name]).filter((id): id is MoveId => id !== undefined),
    ]),
  ),
);
