/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown per-species saved-sets envelope - the PURE mutators + defensive sanitizer (P2). No game
// boot: these operate on the plain versioned envelope (the codec text is opaque to them).
// =============================================================================

import {
  emptySpeciesSets,
  MAX_NAMED_SPECIES_SETS,
  normalizeSetName,
  SHOWDOWN_SPECIES_SETS_VERSION,
  sanitizeSpeciesSets,
  withLastUsed,
  withNamedSet,
  withoutNamedSet,
} from "#data/elite-redux/showdown/showdown-species-sets";
import { describe, expect, it } from "vitest";

describe("showdown per-species sets envelope", () => {
  it("sanitizes a corrupt / hostile blob to a well-formed envelope", () => {
    expect(sanitizeSpeciesSets(null)).toEqual(emptySpeciesSets());
    expect(sanitizeSpeciesSets("garbage")).toEqual(emptySpeciesSets());
    const cleaned = sanitizeSpeciesSets({
      version: "nope",
      lastUsed: 42,
      named: [{ name: "A", text: "x" }, { name: 5, text: "" }, "bad", { text: "y" }],
    });
    expect(cleaned.version).toBe(SHOWDOWN_SPECIES_SETS_VERSION);
    expect(cleaned.lastUsed).toBeNull(); // non-string dropped
    // Only the two entries with a non-empty text survive; a missing name defaults.
    expect(cleaned.named).toEqual([
      { name: "A", text: "x" },
      { name: "Set", text: "y" },
    ]);
  });

  it("auto-remember stamps lastUsed without mutating the input", () => {
    const base = emptySpeciesSets();
    const next = withLastUsed(base, "Garchomp @ Leftovers");
    expect(next.lastUsed).toBe("Garchomp @ Leftovers");
    expect(base.lastUsed).toBeNull(); // immutability
  });

  it("upserts a named set (same name replaces, new appends) and caps the list", () => {
    let sets = emptySpeciesSets();
    sets = withNamedSet(sets, "Offense", "textA");
    sets = withNamedSet(sets, "Defense", "textB");
    expect(sets.named).toHaveLength(2);
    // Same name (case-insensitive) REPLACES in place (the new casing wins).
    sets = withNamedSet(sets, "offense", "textA2");
    expect(sets.named).toHaveLength(2);
    expect(sets.named.find(s => s.name.toLowerCase() === "offense")!.text).toBe("textA2");
    // Cap: adding past the max drops the oldest.
    for (let i = 0; i < MAX_NAMED_SPECIES_SETS + 5; i++) {
      sets = withNamedSet(sets, `Set${i}`, `t${i}`);
    }
    expect(sets.named.length).toBe(MAX_NAMED_SPECIES_SETS);
  });

  it("removes a named set by index", () => {
    let sets = withNamedSet(withNamedSet(emptySpeciesSets(), "A", "a"), "B", "b");
    sets = withoutNamedSet(sets, 0);
    expect(sets.named).toEqual([{ name: "B", text: "b" }]);
    expect(withoutNamedSet(sets, 9).named).toEqual([{ name: "B", text: "b" }]); // bad index = no-op copy
  });

  it("normalizes set names (trim, non-empty default, length cap)", () => {
    expect(normalizeSetName("  ")).toBe("Set");
    expect(normalizeSetName("  Rain  ")).toBe("Rain");
    expect(normalizeSetName("x".repeat(40))).toHaveLength(24);
  });
});
