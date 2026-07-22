/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown telemetry - "popular sets" aggregation (P3). The HONEST feature: telemetry stores mon
// FINGERPRINTS (species/form/ITEM/shiny), so we aggregate the popular ITEM + FORM among recent
// WINNERS for a species. Pure worker-domain module (zero CF deps) - the D1 worker-test pattern.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  aggregateSpeciesSuggestions,
  parseSuggestionRow,
  type SuggestionMon,
  type SuggestionRow,
} from "../../../../workers/er-telemetry/src/species-suggestions";

const mon = (over: Partial<SuggestionMon> = {}): SuggestionMon => ({
  speciesId: 445,
  formIndex: 0,
  rootSpeciesId: 443, // Gible line
  item: "LIFE_ORB",
  shiny: false,
  variant: 0,
  ...over,
});

const row = (
  winner: "host" | "guest" | null,
  hostTeam: SuggestionMon[],
  guestTeam: SuggestionMon[],
): SuggestionRow => ({
  winner,
  hostTeam,
  guestTeam,
});

describe("aggregateSpeciesSuggestions - popular item+form among winners", () => {
  it("tallies only the WINNING side and only the requested line root", () => {
    const rows = [
      // host won with Garchomp @ Life Orb; the losing guest's Garchomp @ Leftovers must NOT count.
      row("host", [mon({ item: "LIFE_ORB" })], [mon({ item: "LEFTOVERS" })]),
      // guest won with Garchomp @ Life Orb.
      row("guest", [mon({ item: "LEFTOVERS" })], [mon({ item: "LIFE_ORB" })]),
      // host won with a DIFFERENT species (rootSpeciesId 6) - irrelevant to Gible.
      row("host", [mon({ rootSpeciesId: 6, speciesId: 6, item: "CHARIZARDITE_Y" })], []),
    ];
    const r = aggregateSpeciesSuggestions(rows, 443);
    expect(r.species).toBe(443);
    expect(r.totalWins).toBe(2); // two winning Garchomps
    expect(r.suggestions).toEqual([{ speciesId: 445, formIndex: 0, item: "LIFE_ORB", wins: 2 }]);
  });

  it("ranks combos most-wins-first and separates by form + item", () => {
    const rows = [
      row("host", [mon({ item: "LIFE_ORB" })], []),
      row("host", [mon({ item: "LIFE_ORB" })], []),
      row("host", [mon({ item: "LIFE_ORB" })], []),
      row("host", [mon({ item: "CHOICE_SCARF" })], []),
      row("guest", [], [mon({ formIndex: 1, item: "LIFE_ORB" })]), // Mega form - a distinct combo
    ];
    const r = aggregateSpeciesSuggestions(rows, 443);
    expect(r.suggestions[0]).toEqual({ speciesId: 445, formIndex: 0, item: "LIFE_ORB", wins: 3 });
    // The other two combos each have 1 win; tie-break is stable (formIndex then item).
    expect(r.suggestions.slice(1)).toEqual([
      { speciesId: 445, formIndex: 0, item: "CHOICE_SCARF", wins: 1 },
      { speciesId: 445, formIndex: 1, item: "LIFE_ORB", wins: 1 },
    ]);
  });

  it("a void row (winner null) contributes nothing", () => {
    const r = aggregateSpeciesSuggestions([row(null, [mon()], [mon()])], 443);
    expect(r.totalWins).toBe(0);
    expect(r.suggestions).toEqual([]);
  });

  it("respects the limit", () => {
    const rows = ["A", "B", "C", "D", "E"].map(item => row("host", [mon({ item })], []));
    expect(aggregateSpeciesSuggestions(rows, 443, 2).suggestions.length).toBe(2);
  });

  it("no data => an honest empty result (graceful degrade)", () => {
    const r = aggregateSpeciesSuggestions([], 443);
    expect(r).toEqual({ species: 443, totalWins: 0, suggestions: [] });
  });
});

describe("parseSuggestionRow", () => {
  it("parses a decisive-win summary_json into a row", () => {
    const summary = JSON.stringify({ hostTeam: [mon()], guestTeam: [mon({ item: "LEFTOVERS" })] });
    const parsed = parseSuggestionRow("host", summary);
    expect(parsed?.winner).toBe("host");
    expect(parsed?.hostTeam[0].item).toBe("LIFE_ORB");
  });

  it("rejects a void winner and malformed json", () => {
    expect(parseSuggestionRow(null, "{}")).toBeNull();
    expect(parseSuggestionRow("host", "not json")).toBeNull();
    expect(parseSuggestionRow("host", 42)).toBeNull();
  });
});
