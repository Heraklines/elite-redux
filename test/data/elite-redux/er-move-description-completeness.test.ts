/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER custom moves whose draft `description` is a placeholder ("Not done yet.")
// must fall back to their real `longDescription` for the in-game description
// (`move.effect`), so no move ships with a placeholder shown to the player.
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { describe, expect, it } from "vitest";

const PLACEHOLDER = /^\s*$|not done yet|not implemented|^\s*deals damage\.?\s*$/i;

describe("ER move description completeness", () => {
  it("no custom move shows a placeholder in-game description", () => {
    const bad: string[] = [];
    for (const m of ER_MOVES) {
      if (!m.name || m.name === "-") {
        continue;
      }
      const pkrgId = ER_ID_MAP.moves[m.id];
      const move = pkrgId == null ? undefined : allMoves[pkrgId];
      if (!move) {
        continue;
      }
      const draft = m as unknown as { description?: string; longDescription?: string };
      // Only assert on moves whose draft description is a placeholder — those are
      // the ones that must have resolved to their longDescription instead.
      if (!PLACEHOLDER.test(draft.description ?? "")) {
        continue;
      }
      const effect = move.effect ?? "";
      if (PLACEHOLDER.test(effect)) {
        bad.push(`${m.name}: effect="${effect}" long="${draft.longDescription ?? ""}"`);
      }
    }
    expect(bad, bad.slice(0, 20).join(" | ")).toHaveLength(0);
  });
});
