/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { consumePendingDevGhostTeam, setPendingDevGhostTeam } from "#app/dev-tools/registry";
import { DEV_HELL_VICTORY_GHOST } from "#app/dev-tools/test-suite/fixtures/hell-victory-ghost";
import { describe, expect, it } from "vitest";

describe("Endless dev scenario fixtures", () => {
  it("keeps the sanitized Hell victory team complete", () => {
    expect(DEV_HELL_VICTORY_GHOST).toMatchObject({
      id: "dev-hell-victory-showcase",
      sourceUserId: "dev-fixture",
      trainerName: "Hell Victor",
      difficulty: "hell",
      mode: "classic",
      waveReached: 200,
      isVictory: true,
      timestamp: 0,
    });
    expect(DEV_HELL_VICTORY_GHOST.party).toHaveLength(6);
    expect(DEV_HELL_VICTORY_GHOST.party.every(member => member.moves.length === 4)).toBe(true);
    expect(DEV_HELL_VICTORY_GHOST.party.reduce((total, member) => total + (member.heldItems?.length ?? 0), 0)).toBe(46);
    expect(DEV_HELL_VICTORY_GHOST.relics).toEqual([
      ["bloodPact", 1, null],
      ["secondWind", 1, null],
    ]);
  });

  it("consumes a staged ghost exactly once", () => {
    consumePendingDevGhostTeam();
    setPendingDevGhostTeam(DEV_HELL_VICTORY_GHOST);

    expect(consumePendingDevGhostTeam()).toBe(DEV_HELL_VICTORY_GHOST);
    expect(consumePendingDevGhostTeam()).toBeNull();
  });
});
