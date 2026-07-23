/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown - the player's own recorded WINNING sets (P3, the flagship's full-set half). The pure
// envelope mutator/sanitizer (dedupe + cap + newest-first) and the localStorage round-trip.
// =============================================================================

import {
  emptyWinningSets,
  listWinningSets,
  MAX_WINNING_SETS,
  recordWinningSet,
  SHOWDOWN_WINNING_SETS_PREFIX,
  sanitizeWinningSets,
  withWinningSet,
} from "#data/elite-redux/showdown/showdown-winning-sets";
import { afterEach, describe, expect, it } from "vitest";

describe("showdown winning sets - pure envelope", () => {
  it("withWinningSet prepends newest-first and de-duplicates (moves an existing set to the front)", () => {
    let env = emptyWinningSets();
    env = withWinningSet(env, "A");
    env = withWinningSet(env, "B");
    expect(env.sets).toEqual(["B", "A"]);
    // Re-recording "A" moves it back to the front (no duplicate).
    env = withWinningSet(env, "A");
    expect(env.sets).toEqual(["A", "B"]);
  });

  it("caps at MAX_WINNING_SETS, dropping the oldest", () => {
    let env = emptyWinningSets();
    for (let i = 0; i < MAX_WINNING_SETS + 3; i++) {
      env = withWinningSet(env, `set-${i}`);
    }
    expect(env.sets.length).toBe(MAX_WINNING_SETS);
    expect(env.sets[0]).toBe(`set-${MAX_WINNING_SETS + 2}`); // newest first
  });

  it("an empty text is a no-op copy", () => {
    const env = withWinningSet(emptyWinningSets(), "");
    expect(env.sets).toEqual([]);
  });

  it("sanitizeWinningSets drops non-string entries and caps, returning a well-formed envelope", () => {
    const env = sanitizeWinningSets({ version: 1, sets: ["ok", 42, "", "ok2", null] });
    expect(env.sets).toEqual(["ok", "ok2"]);
    expect(sanitizeWinningSets(null).sets).toEqual([]);
    expect(sanitizeWinningSets("nope").sets).toEqual([]);
  });
});

describe("showdown winning sets - localStorage round-trip", () => {
  afterEach(() => {
    localStorage.removeItem(`${SHOWDOWN_WINNING_SETS_PREFIX}443`);
  });

  it("recordWinningSet persists per species and listWinningSets reads it back newest-first", () => {
    recordWinningSet(443, "Garchomp @ Life Orb");
    recordWinningSet(443, "Garchomp @ Choice Scarf");
    expect(listWinningSets(443)).toEqual(["Garchomp @ Choice Scarf", "Garchomp @ Life Orb"]);
    // A different species is a separate bucket.
    expect(listWinningSets(999)).toEqual([]);
  });
});
