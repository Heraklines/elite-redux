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
  sortCoopChecksumArenaTags,
  sortCoopChecksumTagIds,
} from "#data/elite-redux/coop/coop-battle-checksum";
import { describe, expect, it } from "vitest";

const mon = (over: Partial<CoopChecksumMon> = {}): CoopChecksumMon => ({
  bi: 0,
  partyIndex: 0,
  speciesId: 1,
  hp: 20,
  maxHp: 21,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  abilityId: 65,
  formIndex: 0,
  isTerastallized: false,
  teraType: 0,
  bossSegments: 0,
  bossSegmentIndex: 0,
  moves: [
    [33, 0],
    [22, 1],
  ],
  tags: [],
  transformSpeciesId: 0,
  transformFormIndex: 0,
  ...over,
});

const state = (over: Partial<CoopChecksumState> = {}): CoopChecksumState => ({
  field: [mon()],
  weather: 0,
  terrain: 0,
  arenaTags: [],
  party: [1, 4],
  partyLevels: [50, 48],
  benchHp: [[1, 120, 0]],
  benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
  money: 1000,
  lockModifierTiers: false,
  modifiers: [["EXP_CHARM", 1]],
  heldItems: [[0, "LEFTOVERS", 1]],
  pokeballCounts: [
    [0, 5],
    [1, 2],
  ],
  biomeId: 0,
  seed: "SEED",
  saveDataDigest: "0000000000000000",
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

    it("string-enum tag sets canonicalize independently of engine insertion order", () => {
      expect(sortCoopChecksumTagIds(["SEEDED", "ENCORE"])).toEqual(["ENCORE", "SEEDED"]);
      const host = sortCoopChecksumArenaTags([
        ["INVERSE_ROOM", 0],
        ["GRAVITY", 0],
      ]);
      const guest = sortCoopChecksumArenaTags([
        ["GRAVITY", 0],
        ["INVERSE_ROOM", 0],
      ]);
      expect(host).toEqual(guest);
      expect(checksumState(state({ arenaTags: host }))).toBe(checksumState(state({ arenaTags: guest })));
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
        partyLevels: [50, 48],
        benchHp: [[1, 120, 0]],
        benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
        arenaTags: [],
        lockModifierTiers: false,
        modifiers: [["EXP_CHARM", 1]],
        heldItems: [[0, "LEFTOVERS", 1]],
        pokeballCounts: [
          [0, 5],
          [1, 2],
        ],
        seed: "SEED",
        biomeId: 0,
        saveDataDigest: "0000000000000000",
      };
      const b: CoopChecksumState = {
        field: [mon()],
        terrain: 0,
        weather: 0,
        arenaTags: [],
        biomeId: 0,
        saveDataDigest: "0000000000000000",
        party: [1, 4],
        partyLevels: [50, 48],
        benchHp: [[1, 120, 0]],
        benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
        lockModifierTiers: false,
        modifiers: [["EXP_CHARM", 1]],
        pokeballCounts: [
          [0, 5],
          [1, 2],
        ],
        heldItems: [[0, "LEFTOVERS", 1]],
        money: 1000,
        seed: "SEED",
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
    it("a changed modifier-tier lock", () => {
      expect(checksumState(state({ lockModifierTiers: true }))).not.toBe(base);
    });
    it("a changed battler tag set", () => {
      expect(checksumState(state({ field: [mon({ tags: ["ENCORE"] })] }))).not.toBe(base);
    });
    it("a changed Terastallized flag (#633 GAP 7)", () => {
      expect(checksumState(state({ field: [mon({ isTerastallized: true })] }))).not.toBe(base);
    });
    it("a changed tera type (#633 GAP 7)", () => {
      expect(checksumState(state({ field: [mon({ teraType: 5 })] }))).not.toBe(base);
    });
    it("a changed boss segment count (#633 A/BLOCKING-2 - a missing-boss guest is now detectable)", () => {
      expect(checksumState(state({ field: [mon({ bossSegments: 2 })] }))).not.toBe(base);
    });
    it("a changed boss segment index (#633 A/BLOCKING-2 - a frozen-divider guest is now detectable)", () => {
      expect(checksumState(state({ field: [mon({ bossSegments: 3, bossSegmentIndex: 1 })] }))).not.toBe(base);
    });
    it("a changed weather type", () => {
      expect(checksumState(state({ weather: 3 }))).not.toBe(base);
    });
    it("a changed terrain type", () => {
      expect(checksumState(state({ terrain: 2 }))).not.toBe(base);
    });
    it("a changed arena tag set", () => {
      expect(checksumState(state({ arenaTags: [["GRAVITY", 0]] }))).not.toBe(base);
    });
    it("a changed party order", () => {
      expect(checksumState(state({ party: [4, 1] }))).not.toBe(base);
    });
    it("a changed party LEVEL (#633 B4 - a bench-mon level/revive drift the speciesId list misses)", () => {
      // The live revive-in-shop desync: same species at every slot (so `party` is unchanged) but a
      // bench mon's LEVEL differs between host + guest. partyLevels makes that detectable -> resync.
      expect(checksumState(state({ partyLevels: [51, 48] }))).not.toBe(base);
    });
    it("a changed BENCH-mon hp/fainted (#719 - a Revive on a fainted bench mon whose relay was DROPPED)", () => {
      // The dropped-relay revive desync: same species + level at every slot (so `party` + `partyLevels`
      // are unchanged), but a fainted BENCH mon revived on one client only. benchHp makes that hp/fainted
      // divergence detectable -> the resync's benchParty heal revives it (backstop for a lost revive relay).
      expect(checksumState(state({ benchHp: [[1, 0, 1]] }))).not.toBe(base);
    });
    it("a changed BENCH-mon moveset (#875 - a TM/Shroom learned on a HOST-owned bench mon the guest mirror dropped)", () => {
      // The #875 latent gap: the base field checksum hashes ON-FIELD movesets only, so a reward-shop TM /
      // Learner's Shroom learned onto a BENCH mon changes no species (party unchanged), no level (partyLevels
      // unchanged), no hp/fainted (benchHp unchanged), and no on-field move - it was INVISIBLE. benchMoves
      // folds each bench mon's moveset, so the divergence now trips the checksum -> the resync that heals it.
      expect(checksumState(state({ benchMoves: [[1, "bbbbbbbbbbbbbbbb"]] }))).not.toBe(base);
    });
    it("a changed money", () => {
      expect(checksumState(state({ money: 999 }))).not.toBe(base);
    });
    it("a changed modifier stack", () => {
      expect(checksumState(state({ modifiers: [["EXP_CHARM", 2]] }))).not.toBe(base);
    });
    it("a changed on-field held-item STACK (#633 RISKY #2 - Bug-Bite/Knock-Off)", () => {
      expect(checksumState(state({ heldItems: [[0, "LEFTOVERS", 2]] }))).not.toBe(base);
    });
    it("an on-field held-item REBIND to a different battler index (#633 RISKY #3 - same global total)", () => {
      // Same item, same count, moved from bi 0 to bi 1: the aggregate `modifiers` digest can't see it,
      // but the per-bi held-item digest does -> detectable -> the snapshot held-item heal closes it.
      expect(checksumState(state({ heldItems: [[1, "LEFTOVERS", 1]] }))).not.toBe(base);
    });
    it("a changed ball inventory count (#633 RISKY #4 - host-only AttemptCapturePhase decrement)", () => {
      expect(
        checksumState(
          state({
            pokeballCounts: [
              [0, 4],
              [1, 2],
            ],
          }),
        ),
      ).not.toBe(base);
    });
    it("a changed full session save-data digest (#837 - the systemic blind-spot closer)", () => {
      // The saveDataDigest folds money-streak / ward-stone charges / relic-battle-state / biome overstay
      // anchor / modifier-internal args into the per-turn checksum, so a drift in ANY of them now moves
      // the field checksum -> a resync heal. This locks in that the digest is part of the hashed state.
      expect(checksumState(state({ saveDataDigest: "deadbeefdeadbeef" }))).not.toBe(base);
    });
    it("a changed transform species id (#836/#837 - a host Ditto/Imposter transform is now detectable)", () => {
      // A Transform copies the target's identity into summonData while `species` (speciesId) stays the
      // original, so without this a host transform is invisible to the checksum. Hashing it makes a
      // host-transformed-but-guest-not divergence detectable + re-convergeable.
      expect(checksumState(state({ field: [mon({ transformSpeciesId: 132 })] }))).not.toBe(base);
    });
    it("a changed transform form index (#836/#837)", () => {
      expect(checksumState(state({ field: [mon({ transformSpeciesId: 132, transformFormIndex: 1 })] }))).not.toBe(base);
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
      const s = state({ arenaTags: [["GRAVITY", 0]] });
      expect(s.arenaTags[0]).toHaveLength(2);
      // Same identity -> same hash regardless of any (excluded) duration.
      expect(checksumState(s)).toBe(checksumState(state({ arenaTags: [["GRAVITY", 0]] })));
    });
  });
});
