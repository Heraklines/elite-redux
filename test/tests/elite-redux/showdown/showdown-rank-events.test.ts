import {
  _clearRankedEventSubscribers,
  emitRankedMatchWin,
  emitRankedSeasonEnd,
  emitRankedTierFirstReached,
  onRankedMatchWin,
  onRankedSeasonEnd,
  onRankedTierFirstReached,
} from "#data/elite-redux/showdown/showdown-rank-events";
import { SHOWDOWN_RANK_TIER } from "#data/elite-redux/showdown/showdown-rank-types";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => _clearRankedEventSubscribers());

describe("showdown ranked event registry", () => {
  it("delivers tier-first-reached events with the tier arg", () => {
    const seen: number[] = [];
    onRankedTierFirstReached(t => seen.push(t));
    emitRankedTierFirstReached(SHOWDOWN_RANK_TIER.masterball);
    expect(seen).toEqual([SHOWDOWN_RANK_TIER.masterball]);
  });

  it("delivers season-end events with the final tier", () => {
    const seen: number[] = [];
    onRankedSeasonEnd(t => seen.push(t));
    emitRankedSeasonEnd(SHOWDOWN_RANK_TIER.ultraball);
    expect(seen).toEqual([SHOWDOWN_RANK_TIER.ultraball]);
  });

  it("delivers match-win events and supports multiple subscribers", () => {
    let a = 0;
    let b = 0;
    onRankedMatchWin(() => a++);
    onRankedMatchWin(() => b++);
    emitRankedMatchWin();
    emitRankedMatchWin();
    expect(a).toBe(2);
    expect(b).toBe(2);
  });

  it("unsubscribe stops delivery", () => {
    const seen: number[] = [];
    const off = onRankedTierFirstReached(t => seen.push(t));
    emitRankedTierFirstReached(SHOWDOWN_RANK_TIER.greatball);
    off();
    emitRankedTierFirstReached(SHOWDOWN_RANK_TIER.champion);
    expect(seen).toEqual([SHOWDOWN_RANK_TIER.greatball]);
  });

  it("a throwing subscriber never blocks the others or the emit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let reached = false;
    onRankedMatchWin(() => {
      throw new Error("boom");
    });
    onRankedMatchWin(() => {
      reached = true;
    });
    expect(() => emitRankedMatchWin()).not.toThrow();
    expect(reached).toBe(true);
    warn.mockRestore();
  });
});
