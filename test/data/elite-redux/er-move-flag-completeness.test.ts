/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Every ER move must carry the full set of MoveFlags its ROM data specifies
// (sound/contact/air/throw/horn/hammer/etc.), so ER flag-gated abilities work.
import { allMoves } from "#data/data-lists";
import { ER_FLAG_NAMES_LIST, ER_FLAG_TO_MOVE_FLAG } from "#data/elite-redux/er-flag-mapping";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import type { MoveFlags } from "#enums/move-flags";
import { describe, expect, it } from "vitest";

describe("ER move flag completeness", () => {
  it("no move is missing a flag its ROM data specifies", () => {
    const missing: string[] = [];
    for (const m of ER_MOVES) {
      if (!m.name || m.name === "-") {
        continue;
      }
      const pkrgId = ER_ID_MAP.moves[m.id];
      const move = pkrgId == null ? undefined : allMoves[pkrgId];
      if (!move) {
        continue;
      }
      for (const idx of (m as unknown as { flags?: number[] }).flags ?? []) {
        const flagName = ER_FLAG_NAMES_LIST[idx];
        const expected = flagName === undefined ? undefined : ER_FLAG_TO_MOVE_FLAG[flagName];
        if (expected != null && !move.hasFlag(expected as MoveFlags)) {
          missing.push(`${m.name} missing ${flagName}`);
        }
      }
    }
    expect(missing, missing.slice(0, 20).join("; ")).toHaveLength(0);
  });
});
