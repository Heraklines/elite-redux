/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 OUTCOME detection (C6). Pure: KO sweep -> winner; forfeit/timeout -> the
// other side wins; void -> no winner. Feeds the showdownResult / showdownVoid wire decision.

import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import {
  detectKoSweepWinner,
  detectShowdownVictory,
  forfeitResult,
  otherRole,
  selectShowdownResultLine,
  timeoutResult,
  voidResult,
  winnerFromLocalResult,
} from "#data/elite-redux/showdown/showdown-outcome";
import { describe, expect, it } from "vitest";

describe("showdown outcome detection (C6)", () => {
  it("KO sweep of the host team -> guest wins by victory", () => {
    expect(detectKoSweepWinner(true, false)).toBe("guest");
    expect(detectShowdownVictory(true, false)).toEqual({ kind: "result", winner: "guest", reason: "victory" });
  });

  it("KO sweep of the guest team -> host wins by victory", () => {
    expect(detectKoSweepWinner(false, true)).toBe("host");
    expect(detectShowdownVictory(false, true)).toEqual({ kind: "result", winner: "host", reason: "victory" });
  });

  it("no sweep or a simultaneous double sweep is undecided (null)", () => {
    expect(detectKoSweepWinner(false, false)).toBeNull();
    expect(detectKoSweepWinner(true, true)).toBeNull();
    expect(detectShowdownVictory(false, false)).toBeNull();
    expect(detectShowdownVictory(true, true)).toBeNull();
  });

  it("forfeit / timeout award the win to the OTHER side", () => {
    expect(forfeitResult("host")).toEqual({ kind: "result", winner: "guest", reason: "forfeit" });
    expect(forfeitResult("guest")).toEqual({ kind: "result", winner: "host", reason: "forfeit" });
    expect(timeoutResult("guest")).toEqual({ kind: "result", winner: "host", reason: "timeout" });
  });

  it("void carries the reason and no winner", () => {
    expect(voidResult("checksum")).toEqual({ kind: "void", reason: "checksum" });
    expect(voidResult("illegalTeam")).toEqual({ kind: "void", reason: "illegalTeam" });
    expect(voidResult("earlyDisconnect")).toEqual({ kind: "void", reason: "earlyDisconnect" });
  });

  it("otherRole flips the role", () => {
    expect(otherRole("host")).toBe("guest");
    expect(otherRole("guest")).toBe("host");
  });

  it("winnerFromLocalResult maps THIS client's (role, localWon) to the absolute winner role", () => {
    // Won -> the local role IS the winner; lost -> the other role wins. All 4 combinations.
    expect(winnerFromLocalResult("host", true)).toBe("host");
    expect(winnerFromLocalResult("host", false)).toBe("guest");
    expect(winnerFromLocalResult("guest", true)).toBe("guest");
    expect(winnerFromLocalResult("guest", false)).toBe("host");
  });

  describe("selectShowdownResultLine (Task C7 - opponent win/lose line)", () => {
    // Ghost semantics: `defeated` = the opponent's line when IT is defeated (we WON);
    // `defeatPlayer` = the opponent's line when IT wins (we LOST).
    const profile: GhostTrainerProfile = {
      dialogue: { defeated: "You bested me!", defeatPlayer: "You never had a chance." },
    };

    it("WINNER hears the opponent's `defeated` line; LOSER hears `defeatPlayer`", () => {
      expect(selectShowdownResultLine(profile, true, false)).toBe("You bested me!");
      expect(selectShowdownResultLine(profile, false, false)).toBe("You never had a chance.");
    });

    it("a VOID shows NO line regardless of win/lose", () => {
      expect(selectShowdownResultLine(profile, true, true)).toBeUndefined();
      expect(selectShowdownResultLine(profile, false, true)).toBeUndefined();
    });

    it("returns undefined when the opponent has no profile / no dialogue / the specific line is absent", () => {
      expect(selectShowdownResultLine(null, true, false)).toBeUndefined();
      expect(selectShowdownResultLine(undefined, false, false)).toBeUndefined();
      expect(selectShowdownResultLine({}, true, false)).toBeUndefined();
      // Only `defeated` authored: the LOSER (needs `defeatPlayer`) gets nothing, the WINNER gets the line.
      const onlyDefeated: GhostTrainerProfile = { dialogue: { defeated: "GG." } };
      expect(selectShowdownResultLine(onlyDefeated, true, false)).toBe("GG.");
      expect(selectShowdownResultLine(onlyDefeated, false, false)).toBeUndefined();
    });
  });
});
