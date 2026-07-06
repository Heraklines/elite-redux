/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 OUTCOME detection (C6). Pure: KO sweep -> winner; forfeit/timeout -> the
// other side wins; void -> no winner. Feeds the showdownResult / showdownVoid wire decision.

import {
  detectKoSweepWinner,
  detectShowdownVictory,
  forfeitResult,
  otherRole,
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
});
