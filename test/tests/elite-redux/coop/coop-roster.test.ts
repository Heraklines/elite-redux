/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op starter-select roster rules (#633, P1): per-player 5-point budget +
// 3-mon cap + merged launch-party assembly. Pure logic, no game engine.

import { COOP_STARTER_COST_BUDGET, CoopRoster } from "#data/elite-redux/coop/coop-roster";
import { describe, expect, it } from "vitest";

describe("co-op roster (#633, P1)", () => {
  it("exposes a 5-point per-player budget", () => {
    expect(COOP_STARTER_COST_BUDGET).toBe(5);
  });

  describe("budget", () => {
    it("tracks spent / remaining per player independently", () => {
      const r = new CoopRoster();
      expect(r.add("host", { speciesId: 1, cost: 3 }).ok).toBe(true);
      expect(r.spent("host")).toBe(3);
      expect(r.remaining("host")).toBe(2);
      // guest budget is untouched by host's spend
      expect(r.spent("guest")).toBe(0);
      expect(r.remaining("guest")).toBe(COOP_STARTER_COST_BUDGET);
    });

    it("rejects a pick that would exceed the budget, without mutating", () => {
      const r = new CoopRoster();
      r.add("host", { speciesId: 1, cost: 4 });
      const res = r.add("host", { speciesId: 2, cost: 2 }); // 4 + 2 = 6 > 5
      expect(res).toEqual({ ok: false, reason: "budget" });
      expect(r.count("host")).toBe(1);
      expect(r.spent("host")).toBe(4);
    });

    it("allows spending exactly to the budget, then rejects any further cost", () => {
      const r = new CoopRoster();
      expect(r.add("host", { speciesId: 1, cost: 5 }).ok).toBe(true);
      expect(r.remaining("host")).toBe(0);
      // not full (1 of 3 slots), but no points left -> budget rejection, not "full"
      expect(r.canAdd("host", 1)).toEqual({ ok: false, reason: "budget" });
    });
  });

  describe("cap", () => {
    it("rejects a 4th pick (3-mon cap) even with budget to spare", () => {
      const r = new CoopRoster();
      r.add("guest", { speciesId: 1, cost: 1 });
      r.add("guest", { speciesId: 2, cost: 1 });
      r.add("guest", { speciesId: 3, cost: 1 });
      expect(r.isFull("guest")).toBe(true);
      expect(r.remaining("guest")).toBe(2); // budget left, but...
      expect(r.add("guest", { speciesId: 4, cost: 1 })).toEqual({ ok: false, reason: "full" });
      expect(r.count("guest")).toBe(3);
    });

    it("isFull is the shared catch-gate predicate", () => {
      const r = new CoopRoster();
      expect(r.isFull("host")).toBe(false);
      r.add("host", { speciesId: 1, cost: 1 });
      r.add("host", { speciesId: 2, cost: 1 });
      expect(r.isFull("host")).toBe(false);
      r.add("host", { speciesId: 3, cost: 1 });
      expect(r.isFull("host")).toBe(true);
    });
  });

  describe("duplicates", () => {
    it("rejects the same species twice for one player", () => {
      const r = new CoopRoster();
      r.add("host", { speciesId: 25, cost: 2 });
      expect(r.add("host", { speciesId: 25, cost: 2 })).toEqual({ ok: false, reason: "duplicate" });
      expect(r.count("host")).toBe(1);
    });

    it("allows host and guest to each bring the same species", () => {
      const r = new CoopRoster();
      expect(r.add("host", { speciesId: 25, cost: 2 }).ok).toBe(true);
      expect(r.add("guest", { speciesId: 25, cost: 2 }).ok).toBe(true);
    });
  });

  describe("remove", () => {
    it("frees budget and a slot", () => {
      const r = new CoopRoster();
      r.add("host", { speciesId: 1, cost: 4 });
      expect(r.remove("host", 1)).toBe(true);
      expect(r.count("host")).toBe(0);
      expect(r.remaining("host")).toBe(COOP_STARTER_COST_BUDGET);
      expect(r.remove("host", 999)).toBe(false); // not present
    });
  });

  describe("launch readiness + merged party", () => {
    it("bothReady requires each player to have at least one pick", () => {
      const r = new CoopRoster();
      expect(r.bothReady()).toBe(false);
      r.add("host", { speciesId: 1, cost: 1 });
      expect(r.bothReady()).toBe(false);
      r.add("guest", { speciesId: 2, cost: 1 });
      expect(r.bothReady()).toBe(true);
    });

    it("partitions the merged party: host 0..2, guest 3..5, in pick order", () => {
      const r = new CoopRoster();
      r.add("host", { speciesId: 10, cost: 1 });
      r.add("host", { speciesId: 11, cost: 1 });
      r.add("guest", { speciesId: 20, cost: 1 });
      const party = r.toMergedParty();
      expect(party).toHaveLength(6);
      expect(party[0]?.speciesId).toBe(10);
      expect(party[1]?.speciesId).toBe(11);
      expect(party[2]).toBeNull(); // host's 3rd slot empty
      expect(party[3]?.speciesId).toBe(20);
      expect(party[4]).toBeNull();
      expect(party[5]).toBeNull();
    });
  });
});
