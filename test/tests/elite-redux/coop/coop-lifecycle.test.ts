/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op session lifecycle (#633, P5/#639): resume-requires-both + disconnect
// grace. Pure, time-injected state machine - no game engine, no Date.now.

import { COOP_DISCONNECT_GRACE_MS, CoopLifecycle } from "#data/elite-redux/coop/coop-lifecycle";
import { describe, expect, it } from "vitest";

describe("co-op lifecycle (#633, P5)", () => {
  describe("resume-requires-both", () => {
    it("a fresh load (host present, guest not yet joined) cannot resume", () => {
      const lc = new CoopLifecycle(); // host present, guest absent
      expect(lc.bothPresent()).toBe(false);
      expect(lc.canResume()).toBe(false);
      // Not a disconnect - it's a lobby waiting for the partner, so not abandoned.
      expect(lc.state(60_000)).toBe("active");
    });

    it("resume unlocks only once the partner joins", () => {
      const lc = new CoopLifecycle();
      expect(lc.canResume()).toBe(false);
      lc.connect("guest", 1000);
      expect(lc.bothPresent()).toBe(true);
      expect(lc.canResume()).toBe(true);
    });
  });

  describe("disconnect grace", () => {
    it("a mid-run drop opens a grace window; it stays open until the grace ms elapse", () => {
      const lc = new CoopLifecycle({ guestPresent: true }); // both present
      expect(lc.state(0)).toBe("active");

      // Guest drops at t=10s.
      lc.disconnect("guest", 10_000);
      expect(lc.canResume()).toBe(false);
      // Still within the window a minute later.
      expect(lc.withinGrace(10_000 + 60_000)).toBe(true);
      expect(lc.state(10_000 + 60_000)).toBe("grace");
      // Grace remaining shrinks toward zero.
      expect(lc.graceRemainingMs(10_000 + 60_000)).toBe(COOP_DISCONNECT_GRACE_MS - 60_000);
    });

    it("the run is abandoned once the grace window expires", () => {
      const lc = new CoopLifecycle({ guestPresent: true });
      lc.disconnect("guest", 0);
      expect(lc.graceExpired(COOP_DISCONNECT_GRACE_MS)).toBe(false); // exactly at the edge = still grace
      expect(lc.graceExpired(COOP_DISCONNECT_GRACE_MS + 1)).toBe(true);
      expect(lc.state(COOP_DISCONNECT_GRACE_MS + 1)).toBe("abandoned");
      expect(lc.graceRemainingMs(COOP_DISCONNECT_GRACE_MS + 1)).toBe(0);
    });

    it("a reconnect inside the grace window closes it and reactivates the run", () => {
      const lc = new CoopLifecycle({ guestPresent: true });
      lc.disconnect("guest", 0);
      expect(lc.withinGrace(30_000)).toBe(true);

      // Guest comes back at t=30s, inside the window.
      lc.connect("guest", 30_000);
      expect(lc.bothPresent()).toBe(true);
      expect(lc.canResume()).toBe(true);
      expect(lc.state(40_000)).toBe("active"); // window closed, no longer counting down
      expect(lc.graceRemainingMs(40_000)).toBe(0);
    });

    it("the FIRST drop starts the clock; a second drop does not restart it", () => {
      const lc = new CoopLifecycle({ guestPresent: true });
      lc.disconnect("guest", 0); // clock starts at 0
      lc.disconnect("host", 50_000); // host also drops later - clock NOT reset
      // Grace is measured from the first drop (t=0), so it expires at graceMs.
      expect(lc.graceExpired(COOP_DISCONNECT_GRACE_MS + 1)).toBe(true);
    });

    it("honours a custom grace window", () => {
      const lc = new CoopLifecycle({ guestPresent: true, graceMs: 5_000 });
      lc.disconnect("guest", 0);
      expect(lc.withinGrace(4_000)).toBe(true);
      expect(lc.graceExpired(6_000)).toBe(true);
    });
  });
});
