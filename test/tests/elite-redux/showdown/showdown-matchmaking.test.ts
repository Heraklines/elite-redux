/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { LobbyPlayer } from "#data/elite-redux/coop/coop-lobby";
import { pairedShowdownOpponent, SHOWDOWN_MATCH_ACCEPT_MS } from "#data/elite-redux/showdown/showdown-matchmaking";
import { describe, expect, it } from "vitest";

const player = (id: string): LobbyPlayer => ({ id, name: id, age: 0 });

describe("lobbyless Showdown matchmaking", () => {
  it("uses a 60-second acceptance window", () => {
    expect(SHOWDOWN_MATCH_ACCEPT_MS).toBe(60_000);
  });

  it("derives the same adjacent pair from either player's perspective", () => {
    const all = ["d", "b", "a", "c"];
    for (const [left, right] of [
      ["a", "b"],
      ["c", "d"],
    ] as const) {
      const leftView = all.filter(id => id !== left).map(player);
      const rightView = all.filter(id => id !== right).map(player);
      expect(pairedShowdownOpponent(left, leftView)?.id).toBe(right);
      expect(pairedShowdownOpponent(right, rightView)?.id).toBe(left);
    }
  });

  it("leaves the last presence unmatched when the queue has an odd count", () => {
    expect(pairedShowdownOpponent("c", [player("a"), player("b")])).toBeNull();
  });
});
