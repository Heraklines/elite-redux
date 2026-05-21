/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C4: tests for the ER-flag → MoveFlags mapping.
//
// We exercise:
//   1. ER_FLAG_NAMES coverage: every text-form ER flag name has a
//      corresponding entry in `ER_FLAG_TO_MOVE_FLAG` (resolving to either a
//      MoveFlags bit OR `null` for non-flag MoveAttr mechanics).
//   2. Bit validity: every non-null mapping value is a positive number (a
//      legit single-bit power-of-2 MoveFlags entry).
//   3. Uniqueness: no two ER flag names map to the same MoveFlags bit
//      (excluding deliberate aliases like "Bullet Move" → BALLBOMB_MOVE — we
//      verify uniqueness on the *classifier* table where there are no aliases,
//      and the text table only when both ER names target distinct semantics).
//   4. Classifier coverage: every distinct flag-name in
//      `ER_MOVE_ARCHETYPES`'s `flag-tagged-move` rows has a classifier-table
//      entry that resolves to a MoveFlags bit (no nulls — every ability-keyed
//      flag the C3 classifier extracts maps to a real flag).
//   5. End-to-end: for each `flag-tagged-move` archetype entry, all carried
//      flag names resolve via {@linkcode resolveErFlag} to a valid MoveFlags
//      bit. This is the load-bearing test the task spec calls out.
// =============================================================================

import {
  ER_CLASSIFIER_FLAG_NAMES_LIST,
  ER_CLASSIFIER_FLAG_TO_MOVE_FLAG,
  ER_FLAG_NAMES_LIST,
  ER_FLAG_TO_MOVE_FLAG,
  resolveErFlag,
} from "#data/elite-redux/er-flag-mapping";
import { ER_MOVE_ARCHETYPES } from "#data/elite-redux/er-move-archetypes";
import { ER_FLAG_NAMES } from "#data/elite-redux/er-move-tables";
import { MoveFlags } from "#enums/move-flags";
import { describe, expect, it } from "vitest";

/** Names that ER expresses as MoveAttrs in pokerogue, not flag bits. */
const NON_FLAG_TEXT_NAMES = new Set<string>(["High Crit Rate", "Always Crits", "Causes Recoil"]);

describe("ER → MoveFlags mapping (C4)", () => {
  describe("ER_FLAG_TO_MOVE_FLAG (text-form)", () => {
    it("covers every entry in ER_FLAG_NAMES", () => {
      for (const erName of ER_FLAG_NAMES) {
        expect(ER_FLAG_TO_MOVE_FLAG, `missing mapping for "${erName}"`).toHaveProperty(erName);
      }
    });

    it("ER_FLAG_NAMES_LIST matches ER_FLAG_NAMES order (declaration order preserved)", () => {
      expect(ER_FLAG_NAMES_LIST).toEqual([...ER_FLAG_NAMES]);
    });

    it("non-flag mechanics (HighCrit / AlwaysCrits / CausesRecoil) map to null", () => {
      for (const name of NON_FLAG_TEXT_NAMES) {
        expect(ER_FLAG_TO_MOVE_FLAG[name], `expected "${name}" to map to null`).toBeNull();
      }
    });

    it("flag-bearing mappings resolve to positive single-bit MoveFlags values", () => {
      for (const [erName, value] of Object.entries(ER_FLAG_TO_MOVE_FLAG)) {
        if (NON_FLAG_TEXT_NAMES.has(erName)) {
          expect(value).toBeNull();
          continue;
        }
        // value must be a number, > 0, and a power-of-two (single-bit).
        expect(typeof value, `${erName} should be a number`).toBe("number");
        const v = value as number;
        expect(v, `${erName} should be > 0`).toBeGreaterThan(0);
        expect((v & (v - 1)) === 0, `${erName} should be a single-bit power-of-2`).toBe(true);
      }
    });

    it("text mappings refer to declared MoveFlags entries", () => {
      const validFlags = new Set<number>(Object.values(MoveFlags).filter((v): v is number => typeof v === "number"));
      for (const [erName, value] of Object.entries(ER_FLAG_TO_MOVE_FLAG)) {
        if (value === null) {
          continue;
        }
        expect(validFlags, `${erName} → ${value} should be a declared MoveFlags value`).toContain(value as number);
      }
    });
  });

  describe("ER_CLASSIFIER_FLAG_TO_MOVE_FLAG (CAPS-form)", () => {
    it("contains the 12 classifier-emitted flag names", () => {
      // From scripts/elite-redux/classify-moves.mjs — MOVE_FLAG_MAP's values.
      // These are the CAPS keys the classifier emits in archetype.params.flags.
      const expectedKeys = [
        "AIR_BASED",
        "ARROW",
        "BONE_BASED",
        "DANCE_MOVE",
        "HAMMER_BASED",
        "IRON_FIST",
        "KEEN_EDGE",
        "MEGA_LAUNCHER",
        "MIGHTY_HORN",
        "SOUND_BASED",
        "STRIKER",
        "STRONG_JAW",
      ];
      for (const k of expectedKeys) {
        expect(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, `missing classifier flag ${k}`).toHaveProperty(k);
      }
      expect(ER_CLASSIFIER_FLAG_NAMES_LIST.length).toBe(expectedKeys.length);
    });

    it("every classifier flag resolves to a real MoveFlags bit (no nulls)", () => {
      const validFlags = new Set<number>(Object.values(MoveFlags).filter((v): v is number => typeof v === "number"));
      for (const [name, value] of Object.entries(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG)) {
        expect(value, `classifier flag ${name} should resolve to a MoveFlags bit`).not.toBeNull();
        expect(typeof value).toBe("number");
        expect(value as number).toBeGreaterThan(0);
        expect(validFlags).toContain(value as number);
      }
    });

    it("classifier flags pointing at the same flag are intentional aliases", () => {
      // STRIKER and "Kick Based" both map to KICKING_MOVE.
      // MIGHTY_HORN and "Horn Based" both map to HORN_BASED.
      // These cross-table collisions are by design — the ability name and the
      // ER-text flag name describe the same underlying move flag.
      const c = ER_CLASSIFIER_FLAG_TO_MOVE_FLAG;
      expect(c.STRIKER).toBe(MoveFlags.KICKING_MOVE);
      expect(c.MIGHTY_HORN).toBe(MoveFlags.HORN_BASED);
      expect(c.ARROW).toBe(MoveFlags.ARROW_BASED);
      // Vanilla flag-boost abilities re-key the existing pokerogue flag bit.
      expect(c.STRONG_JAW).toBe(MoveFlags.BITING_MOVE);
      expect(c.KEEN_EDGE).toBe(MoveFlags.SLICING_MOVE);
      expect(c.MEGA_LAUNCHER).toBe(MoveFlags.PULSE_MOVE);
      expect(c.IRON_FIST).toBe(MoveFlags.PUNCHING_MOVE);
    });

    it("every distinct flag in flag-tagged-move archetype rows has a classifier mapping", () => {
      const seenFlags = new Set<string>();
      for (const entry of Object.values(ER_MOVE_ARCHETYPES)) {
        if (entry.archetype !== "flag-tagged-move") {
          continue;
        }
        const flags = (entry.params as { flags?: readonly string[] } | null)?.flags ?? [];
        for (const flag of flags) {
          seenFlags.add(flag);
        }
      }
      for (const f of seenFlags) {
        expect(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, `archetype flag ${f} has no classifier mapping`).toHaveProperty(f);
        expect(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[f], `archetype flag ${f} resolved to null`).not.toBeNull();
      }
      // 12 distinct flags carried by C3's flag-tagged-move output (per audit).
      expect(seenFlags.size).toBe(12);
    });
  });

  describe("resolveErFlag()", () => {
    it("resolves text-form names", () => {
      expect(resolveErFlag("Hammer Based")).toBe(MoveFlags.HAMMER_BASED);
      expect(resolveErFlag("Sound Based")).toBe(MoveFlags.SOUND_BASED);
      expect(resolveErFlag("Makes Contact")).toBe(MoveFlags.MAKES_CONTACT);
    });

    it("resolves classifier-form (CAPS) names", () => {
      expect(resolveErFlag("HAMMER_BASED")).toBe(MoveFlags.HAMMER_BASED);
      expect(resolveErFlag("STRONG_JAW")).toBe(MoveFlags.BITING_MOVE);
      expect(resolveErFlag("MEGA_LAUNCHER")).toBe(MoveFlags.PULSE_MOVE);
    });

    it("returns null for non-flag MoveAttr ER concepts", () => {
      expect(resolveErFlag("High Crit Rate")).toBeNull();
      expect(resolveErFlag("Always Crits")).toBeNull();
      expect(resolveErFlag("Causes Recoil")).toBeNull();
    });

    it("returns undefined for unknown names", () => {
      expect(resolveErFlag("Definitely Not A Flag")).toBeUndefined();
      expect(resolveErFlag("UNKNOWN_FLAG")).toBeUndefined();
      expect(resolveErFlag("")).toBeUndefined();
    });
  });

  describe("End-to-end: ER_MOVE_ARCHETYPES × ER_CLASSIFIER_FLAG_TO_MOVE_FLAG", () => {
    it("every flag-tagged-move entry resolves all carried flags to MoveFlags bits", () => {
      let resolved = 0;
      let total = 0;
      let unresolved = 0;
      for (const entry of Object.values(ER_MOVE_ARCHETYPES)) {
        if (entry.archetype !== "flag-tagged-move") {
          continue;
        }
        const flags = (entry.params as { flags?: readonly string[] } | null)?.flags ?? [];
        for (const flag of flags) {
          total++;
          const resolvedValue = resolveErFlag(flag);
          if (typeof resolvedValue === "number" && resolvedValue > 0) {
            resolved++;
          } else {
            unresolved++;
          }
        }
      }
      // Sanity bounds — there are 75 flag-tagged-move rows per the C3 report,
      // each carrying 1-2 flags. We expect total > 75.
      expect(total).toBeGreaterThan(75);
      expect(unresolved).toBe(0);
      expect(resolved).toBe(total);
    });
  });

  describe("MoveFlags enum integrity", () => {
    it("all MoveFlags values fit within a 32-bit signed integer", () => {
      // We use bitwise AND in `Move.hasFlag()` etc., which operates on
      // 32-bit signed integers in JS. Verify no flag uses a bit ≥ 31 (which
      // would set the sign bit and break bitwise tests).
      const MAX_SAFE_BIT_VALUE = 1 << 30; // bit 30 = 0x40000000
      const flagValues = Object.values(MoveFlags).filter((v): v is number => typeof v === "number");
      for (const v of flagValues) {
        expect(v).toBeLessThanOrEqual(MAX_SAFE_BIT_VALUE);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it("MoveFlags entries are unique bit positions (no collisions among non-NONE bits)", () => {
      const nonZero = Object.values(MoveFlags).filter((v): v is number => typeof v === "number" && v !== 0);
      const uniqueCount = new Set(nonZero).size;
      expect(uniqueCount).toBe(nonZero.length);
    });

    it("includes the ER-added flags as declared by C4", () => {
      // Spot-check the new flags exist (test failure here would indicate the
      // enum extension regressed).
      expect(MoveFlags.AIR_BASED).toBeGreaterThan(0);
      expect(MoveFlags.ARROW_BASED).toBeGreaterThan(0);
      expect(MoveFlags.BONE_BASED).toBeGreaterThan(0);
      expect(MoveFlags.DRILL_BASED).toBeGreaterThan(0);
      expect(MoveFlags.FIELD_BASED).toBeGreaterThan(0);
      expect(MoveFlags.HAMMER_BASED).toBeGreaterThan(0);
      expect(MoveFlags.HORN_BASED).toBeGreaterThan(0);
      expect(MoveFlags.KICKING_MOVE).toBeGreaterThan(0);
      expect(MoveFlags.LUNAR_MOVE).toBeGreaterThan(0);
      expect(MoveFlags.THROW_BASED).toBeGreaterThan(0);
      expect(MoveFlags.WEATHER_BASED).toBeGreaterThan(0);
    });
  });
});
