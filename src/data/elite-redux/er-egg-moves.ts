/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — hand-audited egg moves for ER-custom species.
//
// The DATA now lives in `er-egg-moves.json` (speciesConst → 4 move NAMES) so the
// team egg-move editor can read/write it without touching TypeScript. This
// module loads that JSON and resolves each move name to its `MoveId` enum value
// (every name is a real MoveId member, vanilla or ER-custom). The export shape
// is unchanged, so `init-elite-redux-egg-moves.ts` consumes it exactly as before.
//
// Per-species rationale for each kit lives in docs/plans/er-egg-moves-worktable.md.
// =============================================================================

import { MoveId } from "#enums/move-id";
import eggMovesByName from "./er-egg-moves.json";

/** Reverse lookup: move enum NAME (as stored in the JSON) → MoveId value. */
const MOVE_BY_NAME = MoveId as unknown as Record<string, MoveId | undefined>;

/** ER base species (by speciesConst) → its hand-audited egg moves. */
export const ER_EGG_MOVES: Readonly<Record<string, readonly MoveId[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(eggMovesByName as Record<string, readonly string[]>).map(([speciesConst, names]) => [
      speciesConst,
      names.map(name => MOVE_BY_NAME[name]).filter((id): id is MoveId => id !== undefined),
    ]),
  ),
);
