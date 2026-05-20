import { Passive } from "#enums/passive";
import { GameData } from "#system/game-data";
import type { SystemSaveData } from "#types/save-data";
import { describe, expect, it } from "vitest";

/**
 * Phase A — Task A15: Save migration check for the widened `Passive` bitmask.
 *
 * A12 widened the `Passive` bitmask from 2 bits (`UNLOCKED=1`, `ENABLED=2`)
 * to 6 bits across 3 slots:
 *   - Slot 1: `UNLOCKED_1=1`, `ENABLED_1=2`  (legacy `UNLOCKED`/`ENABLED` alias)
 *   - Slot 2: `UNLOCKED_2=4`, `ENABLED_2=8`
 *   - Slot 3: `UNLOCKED_3=16`, `ENABLED_3=32`
 *
 * Because the literal values for slot 1 are preserved (1 and 2), legacy saves
 * storing `passiveAttr: 3` (the old `UNLOCKED | ENABLED` combo) still read
 * correctly under the new layout as "slot-1 unlocked + slot-1 enabled".
 * No data migration is required — the value 3 just gains a more specific
 * meaning.
 *
 * These tests prove the no-migration-needed property end-to-end:
 *   1. Pure bitmask read invariants (slot 1 lit, slot 2 + slot 3 dark).
 *   2. The actual load pipeline (`GameData.parseSystemData`) does not mutate
 *      `passiveAttr`, so the legacy on-disk value flows through unchanged
 *      and reads correctly under the new enum semantics.
 *   3. A maximally lit value (63 = all 6 bits) round-trips cleanly through
 *      the parser — important for Phase B, when players will be able to
 *      unlock all 3 slots.
 */
describe("Save migration — widened passiveAttr (Phase A A15)", () => {
  describe("legacy passiveAttr value 3 (UNLOCKED | ENABLED) — bitmask reads", () => {
    /**
     * Existing saves stored `passiveAttr = 3` to mean "passive unlocked AND
     * enabled" under the old single-slot layout. Verify each new slot's bits
     * read the way we expect against that same numeric value.
     */
    const legacyPassiveAttr = 3;

    it("legacy alias UNLOCKED bit is set (back-compat)", () => {
      expect(legacyPassiveAttr & Passive.UNLOCKED).not.toBe(0);
    });

    it("legacy alias ENABLED bit is set (back-compat)", () => {
      expect(legacyPassiveAttr & Passive.ENABLED).not.toBe(0);
    });

    it("slot 1 reads as unlocked + enabled (new semantics)", () => {
      expect(legacyPassiveAttr & Passive.UNLOCKED_1).not.toBe(0);
      expect(legacyPassiveAttr & Passive.ENABLED_1).not.toBe(0);
    });

    it("slot 2 is untouched (no false unlock)", () => {
      expect(legacyPassiveAttr & Passive.UNLOCKED_2).toBe(0);
      expect(legacyPassiveAttr & Passive.ENABLED_2).toBe(0);
    });

    it("slot 3 is untouched (no false unlock)", () => {
      expect(legacyPassiveAttr & Passive.UNLOCKED_3).toBe(0);
      expect(legacyPassiveAttr & Passive.ENABLED_3).toBe(0);
    });
  });

  describe("GameData.parseSystemData — load pipeline preserves passiveAttr", () => {
    /**
     * Construct a minimal SystemSaveData JSON string that mimics a real
     * legacy save: a single starter entry with `passiveAttr: 3`. Round-trip
     * it through the actual load pipeline and assert the deserialized value
     * is byte-identical (no migration, no widening, no BigInt coercion).
     *
     * Why we can call `parseSystemData` directly: it's a pure static method
     * that wraps `JSON.parse` with a reviver. No `globalScene`, no UI, no
     * `GameData` instance required.
     *
     * Notably, the reviver at game-data.ts:525 explicitly EXCLUDES
     * `passiveAttr` from the `*Attr -> BigInt` coercion, so it stays a
     * number. This is the property we depend on for no-migration to work.
     */
    function buildLegacySaveStr(passiveAttr: number): string {
      // Bulbasaur's species id is 1. Use it as our representative starter.
      // All other fields are populated with zero/null defaults that match
      // a freshly-initialized StarterDataEntry, so the reviver only has
      // `passiveAttr` to act on for the bit we care about.
      const save = {
        trainerId: 12345,
        secretId: 67890,
        gender: 0,
        dexData: {},
        starterData: {
          1: {
            moveset: null,
            eggMoves: 0,
            candyCount: 0,
            friendship: 0,
            abilityAttr: 1,
            passiveAttr,
            valueReduction: 0,
            classicWinCount: 0,
          },
        },
        gameStats: {},
        unlocks: {},
        achvUnlocks: {},
        voucherUnlocks: {},
        voucherCounts: {},
        eggs: [],
        gameVersion: "1.0.0",
        timestamp: 0,
        eggPity: [0, 0, 0, 0],
        unlockPity: [0, 0, 0, 0],
      };
      return JSON.stringify(save);
    }

    it("legacy passiveAttr=3 round-trips unchanged through parseSystemData", () => {
      const dataStr = buildLegacySaveStr(3);
      const parsed: SystemSaveData = GameData.parseSystemData(dataStr);

      const entry = parsed.starterData[1];
      expect(entry).toBeDefined();
      // It MUST stay a number — BigInt would break all the bitwise ops below.
      expect(typeof entry.passiveAttr).toBe("number");
      expect(entry.passiveAttr).toBe(3);

      // And under the new enum semantics, it MUST read as slot-1 unlocked + enabled.
      expect(entry.passiveAttr & Passive.UNLOCKED_1).not.toBe(0);
      expect(entry.passiveAttr & Passive.ENABLED_1).not.toBe(0);
      // Slots 2 and 3 stay dark.
      expect(entry.passiveAttr & Passive.UNLOCKED_2).toBe(0);
      expect(entry.passiveAttr & Passive.UNLOCKED_3).toBe(0);
    });

    it("passiveAttr=0 (never-unlocked starter) round-trips unchanged", () => {
      const dataStr = buildLegacySaveStr(0);
      const parsed: SystemSaveData = GameData.parseSystemData(dataStr);

      const entry = parsed.starterData[1];
      expect(entry).toBeDefined();
      expect(typeof entry.passiveAttr).toBe("number");
      expect(entry.passiveAttr).toBe(0);
    });

    it("passiveAttr=1 (legacy unlocked-but-disabled) reads as slot-1 unlocked only", () => {
      // A legacy save with `passiveAttr = UNLOCKED` (1) but no ENABLED bit
      // should read as slot 1 unlocked, slot 1 disabled, slots 2/3 dark.
      const dataStr = buildLegacySaveStr(1);
      const parsed: SystemSaveData = GameData.parseSystemData(dataStr);

      const entry = parsed.starterData[1];
      expect(entry.passiveAttr & Passive.UNLOCKED_1).not.toBe(0);
      expect(entry.passiveAttr & Passive.ENABLED_1).toBe(0);
      expect(entry.passiveAttr & Passive.UNLOCKED_2).toBe(0);
      expect(entry.passiveAttr & Passive.UNLOCKED_3).toBe(0);
    });

    it("passiveAttr=63 (all 6 bits — future Phase B max) round-trips unchanged", () => {
      // Phase B will allow `passiveAttr` to legitimately hit 63 once a player
      // unlocks AND enables all 3 slots. Sanity-check that the load pipeline
      // doesn't choke on values larger than the legacy 0..3 range.
      const dataStr = buildLegacySaveStr(63);
      const parsed: SystemSaveData = GameData.parseSystemData(dataStr);

      const entry = parsed.starterData[1];
      expect(typeof entry.passiveAttr).toBe("number");
      expect(entry.passiveAttr).toBe(63);
      // All 3 slots unlocked + enabled.
      expect(entry.passiveAttr & Passive.UNLOCKED_1).not.toBe(0);
      expect(entry.passiveAttr & Passive.ENABLED_1).not.toBe(0);
      expect(entry.passiveAttr & Passive.UNLOCKED_2).not.toBe(0);
      expect(entry.passiveAttr & Passive.ENABLED_2).not.toBe(0);
      expect(entry.passiveAttr & Passive.UNLOCKED_3).not.toBe(0);
      expect(entry.passiveAttr & Passive.ENABLED_3).not.toBe(0);
    });
  });
});
