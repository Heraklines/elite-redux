/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type GhostMember,
  type GhostTeamSnapshot,
  selectErEndlessBossHeldItems,
} from "#data/elite-redux/er-ghost-teams";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

function member(heldItems: GhostMember["heldItems"]): GhostMember {
  return {
    speciesId: SpeciesId.RATTATA,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    nature: 0,
    level: 200,
    gender: 0,
    shiny: false,
    variant: 0,
    passive: true,
    moves: [],
    heldItems,
  };
}

function snapshot(id: string, party: GhostMember[]): GhostTeamSnapshot {
  return {
    id,
    trainerName: id,
    difficulty: "hell",
    mode: "classic",
    waveReached: 200,
    isVictory: true,
    timestamp: 1,
    party,
  };
}

describe("Elite Redux Endless raid ghost item loadouts", () => {
  it("prefers one real ghost member carrying at least ten saved stacks", () => {
    const loadout = selectErEndlessBossHeldItems(
      [
        snapshot("large-member", [member([["LEFTOVERS", 11]])]),
        snapshot("spread-team", [member([["WIDE_LENS", 6]]), member([["SHELL_BELL", 5]])]),
      ],
      "fixed",
    );
    expect(loadout).toEqual([["LEFTOVERS", 11]]);
  });

  it("falls back to a victorious team's combined ten-stack inventory", () => {
    const loadout = selectErEndlessBossHeldItems(
      [snapshot("spread-team", [member([["WIDE_LENS", 6]]), member([["SHELL_BELL", 5]])])],
      "fixed",
    );
    expect(loadout.reduce((sum, [, stack]) => sum + stack, 0)).toBe(11);
    expect(loadout.map(([typeId]) => typeId)).toEqual(["WIDE_LENS", "SHELL_BELL"]);
  });
});
