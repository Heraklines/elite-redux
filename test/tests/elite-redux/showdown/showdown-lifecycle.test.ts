/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 disconnect lifecycle (D4). Pure + time-injected, like the co-op lifecycle tests:
// a mid-match drop opens a 2-minute grace window; if it expires the match resolves by TURN reached
// (below threshold -> void earlyDisconnect; at/above -> the survivor wins by timeout); a reconnect
// inside the window is a no-op (the match resumes via the existing per-turn full-state resync).

import { COOP_DISCONNECT_GRACE_MS } from "#data/elite-redux/coop/coop-lifecycle";
import { SHOWDOWN_ABANDON_TURN_THRESHOLD, ShowdownLifecycle } from "#data/elite-redux/showdown/showdown-lifecycle";
import { describe, expect, it } from "vitest";

const AFTER_GRACE = COOP_DISCONNECT_GRACE_MS + 1;

describe("Showdown disconnect lifecycle (D4)", () => {
  it("an early-turn drop that abandons VOIDS (earlyDisconnect)", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(2); // still below the threshold
    lc.disconnect("guest", 0);
    expect(lc.resolveOnAbandon("guest", AFTER_GRACE)).toEqual({ kind: "void", reason: "earlyDisconnect" });
  });

  it("a mid-match drop that abandons awards the SURVIVOR the win by timeout", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(5); // at/above the threshold - a real match was under way
    lc.disconnect("guest", 0);
    // The guest dropped -> the HOST (survivor) wins.
    expect(lc.resolveOnAbandon("guest", AFTER_GRACE)).toEqual({ kind: "result", winner: "host", reason: "timeout" });
  });

  it("the survivor is always the OTHER role (a host drop hands the guest the win)", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(SHOWDOWN_ABANDON_TURN_THRESHOLD);
    lc.disconnect("host", 0);
    expect(lc.resolveOnAbandon("host", AFTER_GRACE)).toEqual({ kind: "result", winner: "guest", reason: "timeout" });
  });

  it("while still within grace, no outcome is decided (keep waiting for a reconnect)", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(5);
    lc.disconnect("guest", 0);
    expect(lc.withinGrace(30_000)).toBe(true);
    expect(lc.resolveOnAbandon("guest", 30_000)).toBeNull();
    expect(lc.graceRemainingMs(30_000)).toBe(COOP_DISCONNECT_GRACE_MS - 30_000);
  });

  it("a reconnect inside the grace window is a no-op - the match resumes (no outcome)", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(5);
    lc.disconnect("guest", 0);
    lc.connect("guest", 30_000); // back within the window
    // Even well past the original window the match is active again, so no abandonment outcome fires.
    expect(lc.withinGrace(AFTER_GRACE)).toBe(false);
    expect(lc.graceExpired(AFTER_GRACE)).toBe(false);
    expect(lc.resolveOnAbandon("guest", AFTER_GRACE)).toBeNull();
  });

  it("setTurn is monotonic - a stale lower turn cannot lower the threshold", () => {
    const lc = new ShowdownLifecycle();
    lc.setTurn(5);
    lc.setTurn(1); // stale
    expect(lc.turn).toBe(5);
    lc.disconnect("guest", 0);
    expect(lc.resolveOnAbandon("guest", AFTER_GRACE)).toEqual({ kind: "result", winner: "host", reason: "timeout" });
  });
});
