/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression guard for #151 — ER move id-map collisions.
//
// Every vanilla ER move (one whose pokerogue id resolves below the custom
// cutoff) must map to the pokerogue `MoveId` whose enum name matches the ER
// `moveConst` (e.g. MOVE_FLOWER_TRICK -> MoveId.FLOWER_TRICK). A scrambled
// gen8/9 block previously mapped 35 of these to neighbouring (wrong) ids, so
// e.g. Axe Kick resolved to Trailblaze and got the wrong rebalance + effects.
//
// This test also asserts the map is a clean bijection (no two ER moves resolve
// to the same pokerogue id).
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

describe("ER move id-map consistency (#151)", () => {
  it("every vanilla ER move maps to the MoveId matching its moveConst", () => {
    const mismatches: string[] = [];
    for (const draft of ER_MOVES) {
      const moveConst = (draft as { moveConst?: string }).moveConst;
      if (!moveConst || moveConst === "MOVE_NONE") {
        continue;
      }
      const pk = ER_ID_MAP.moves[draft.id];
      if (pk === undefined || pk >= VANILLA_ID_CUTOFF) {
        continue; // ER custom — has no vanilla MoveId counterpart
      }
      const expectedName = moveConst.replace(/^MOVE_/, "");
      const actualName = MoveId[pk];
      if (actualName !== expectedName) {
        mismatches.push(`er ${draft.id} ${moveConst} -> pk ${pk} = ${actualName ?? "<undefined>"}`);
      }
    }
    expect(mismatches, `mismapped vanilla moves:\n${mismatches.join("\n")}`).toHaveLength(0);
  });

  it("vanilla ER move ids form a bijection (no two ER moves share a pokerogue id)", () => {
    const seen = new Map<number, number>();
    const collisions: string[] = [];
    for (const draft of ER_MOVES) {
      const moveConst = (draft as { moveConst?: string }).moveConst;
      if (!moveConst || moveConst === "MOVE_NONE") {
        continue;
      }
      const pk = ER_ID_MAP.moves[draft.id];
      if (pk === undefined || pk >= VANILLA_ID_CUTOFF) {
        continue;
      }
      const prev = seen.get(pk);
      if (prev === undefined) {
        seen.set(pk, draft.id);
      } else {
        collisions.push(`pk ${pk} claimed by er ${prev} and er ${draft.id}`);
      }
    }
    expect(collisions, `colliding vanilla move ids:\n${collisions.join("\n")}`).toHaveLength(0);
  });
});
