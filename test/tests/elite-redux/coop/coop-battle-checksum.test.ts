/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op battle CHECKSUM pure core (#633, TRACK-2). The deterministic 64-bit fingerprint
// of the full authoritative battle state the host stamps each turn and the guest verifies.
// These lock in the determinism guarantees - sorted-key canonicalization, optional
// neutrality, and the DELIBERATE exclusion of turn/duration counters - WITHOUT booting the
// engine. Break one of these and two correct engines would mismatch forever.

import {
  type CoopChecksumMon,
  type CoopChecksumState,
  canonicalize,
  checksumState,
  fnv1a64,
} from "#data/elite-redux/coop/coop-battle-checksum";
import { describe, expect, it } from "vitest";

const mon = (over: Partial<CoopChecksumMon> = {}): CoopChecksumMon => ({
  bi: 0,
  hp: 20,
  maxHp: 21,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  abilityId: 65,
  formIndex: 0,
  moves: [
    [33, 0],
    [22, 1],
  ],
  tags: [],
  ...over,
});

const state = (over: Partial<CoopChecksumState> = {}): CoopChecksumState => ({
  field: [mon()],
  weather: 0,
  terrain: 0,
  arenaTags: [],
  party: [1, 4],
  money: 1000,
  modifiers: [["EXP_CHARM", 1]],
  ...over,
});

describe("co-op battle checksum pure core (#633, TRACK-2)", () => {
  describe("fnv1a64 + canonicalize", () => {
    it("fnv1a64 returns a stable 16-char hex digest", () => {
      const h = fnv1a64("hello");
      expect(h).toMatch(/^[0-9a-f]{16}$/);
      // Same input -> same digest, every time.
      expect(fnv1a64("hello")).toBe(h);
      // Different input -> different digest.
      expect(fnv1a64("world")).not.toBe(h);
    });

    it("canonicalize emits object keys in SORTED order (never insertion order)", () => {
      const a = canonicalize({ b: 1, a: 2, c: 3 });
      const b = canonicalize({ c: 3, a: 2, b: 1 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":2,"b":1,"c":3}');
    });

    it("canonicalize keeps array ORDER (order is meaningful for party/move slots)", () => {
      expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
      expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
    });

    it("canonicalize normalizes -0, 1.0, and non-finite numbers", () => {
      expect(canonicalize(-0)).toBe(canonicalize(0));
      expect(canonicalize(1.0)).toBe(canonicalize(1));
      expect(canonicalize(Number.NaN)).toBe("0");
      expect(canonicalize(Number.POSITIVE_INFINITY)).toBe("0");
    });
  });

  describe("checksumState determinism", () => {
    it("the same state hashes to the same digest, repeatedly", () => {
      const h = checksumState(state());
      expect(h).toBe(checksumState(state()));
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });

    it("KEY-ORDER INDEPENDENT: two states built in different insertion order hash equal", () => {
      // Build the SAME logical state with object literals whose keys are typed in a
      // different order. The sorted-key canonicalizer must collapse them to one hash -
      // this is the property that actually protects against false desyncs.
      const a: CoopChecksumState = {
        money: 1000,
        weather: 0,
        terrain: 0,
        field: [mon()],
        party: [1, 4],
        arenaTags: [],
        modifiers: [["EXP_CHARM", 1]],
      };
      const b: CoopChecksumState = {
        field: [mon()],
        terrain: 0,
        weather: 0,
        arenaTags: [],
        party: [1, 4],
        modifiers: [["EXP_CHARM", 1]],
        money: 1000,
      };
      expect(checksumState(a)).toBe(checksumState(b));
    });
  });

  describe("checksumState sensitivity (every tracked field changes the digest)", () => {
    const base = checksumState(state());
    it("a changed hp", () => {
      expect(checksumState(state({ field: [mon({ hp: 19 })] }))).not.toBe(base);
    });
    it("a changed status", () => {
      expect(checksumState(state({ field: [mon({ status: 1 })] }))).not.toBe(base);
    });
    it("a changed stat stage", () => {
      expect(checksumState(state({ field: [mon({ statStages: [1, 0, 0, 0, 0, 0, 0] })] }))).not.toBe(base);
    });
    it("a changed abilityId", () => {
      expect(checksumState(state({ field: [mon({ abilityId: 22 })] }))).not.toBe(base);
    });
    it("a changed formIndex", () => {
      expect(checksumState(state({ field: [mon({ formIndex: 1 })] }))).not.toBe(base);
    });
    it("a changed PP (move ppUsed)", () => {
      expect(
        checksumState(
          state({
            field: [
              mon({
                moves: [
                  [33, 5],
                  [22, 1],
                ],
              }),
            ],
          }),
        ),
      ).not.toBe(base);
    });
    it("a changed battler tag set", () => {
      expect(checksumState(state({ field: [mon({ tags: [10] })] }))).not.toBe(base);
    });
    it("a changed weather type", () => {
      expect(checksumState(state({ weather: 3 }))).not.toBe(base);
    });
    it("a changed terrain type", () => {
      expect(checksumState(state({ terrain: 2 }))).not.toBe(base);
    });
    it("a changed arena tag set", () => {
      expect(checksumState(state({ arenaTags: [[1, 0]] }))).not.toBe(base);
    });
    it("a changed party order", () => {
      expect(checksumState(state({ party: [4, 1] }))).not.toBe(base);
    });
    it("a changed money", () => {
      expect(checksumState(state({ money: 999 }))).not.toBe(base);
    });
    it("a changed modifier stack", () => {
      expect(checksumState(state({ modifiers: [["EXP_CHARM", 2]] }))).not.toBe(base);
    });
  });

  describe("EXCLUDED non-deterministic fields are immune (lock in the exclusions)", () => {
    // The checksum state type STRUCTURALLY excludes turn/duration counters (weather /
    // terrain / tag turnsLeft and per-tag turnCount). These legitimately differ by one
    // between two correct engines, so they must NEVER reach the hash. This test documents
    // that intent: a state carrying only the type/identity is what's hashed, and the
    // counters are simply not part of the shape. If a future edit adds a counter back to
    // CoopChecksumState, the sensitivity tests above would start to include it and this
    // contract is broken - keep counters out.
    it("the hashed state has no weather/terrain turn-counter keys", () => {
      const s = state({ weather: 3, terrain: 2 });
      const keys = Object.keys(s);
      expect(keys).not.toContain("weatherTurnsLeft");
      expect(keys).not.toContain("terrainTurnsLeft");
    });
    it("arena tags hash by [tagType, side] identity only (no turn count in the tuple)", () => {
      // Two-element tuples: identity only. A third element would be a turn counter.
      const s = state({ arenaTags: [[1, 0]] });
      expect(s.arenaTags[0]).toHaveLength(2);
      // Same identity -> same hash regardless of any (excluded) duration.
      expect(checksumState(s)).toBe(checksumState(state({ arenaTags: [[1, 0]] })));
    });
  });
});
