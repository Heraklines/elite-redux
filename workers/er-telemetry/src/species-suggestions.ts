/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown telemetry - PURE "popular sets" aggregation (P3). Zero Cloudflare deps so it imports
// into a plain vitest (the telemetry-ingest test pattern).
//
// 🔴 THE HONEST FINDING (read before extending): the telemetry `summary_json` row stores each mon as
// a FINGERPRINT only - speciesId / formIndex / rootSpeciesId / ITEM / shiny / variant. It does NOT
// store movesets, abilities, or natures (those live only inside the gzipped per-row `trace_gz`
// ReplayTrace, host-roster-only + recording-gated - unsuitable for a lightweight aggregate route). So
// the honest thing telemetry can answer is "what ITEMS / FORMS do winning <species> run", NOT full
// movesets. This module aggregates exactly that: the popular ITEM + fielded FORM among recent WINNERS.
//
// PRIVACY: only `winner` + `summary_json` (the teams) are consumed here - never `host_uid`/`guest_uid`.
// The output is sets-shaped counts, no usernames.
// =============================================================================

/** One mon fingerprint as stored in `summary_json` (mirrors the ingest `TelemetryMon`). */
export interface SuggestionMon {
  speciesId: number;
  formIndex: number;
  rootSpeciesId: number;
  item: string;
  shiny: boolean;
  variant: number;
}

/** One winning-match row's queryable projection (what the route SELECTs). */
export interface SuggestionRow {
  winner: "host" | "guest" | null;
  /** The parsed `summary_json` - both teams as fingerprints. */
  hostTeam: SuggestionMon[];
  guestTeam: SuggestionMon[];
}

/** One aggregated suggestion: a fielded FORM + ITEM combo and how many recent wins ran it. */
export interface SpeciesSuggestion {
  speciesId: number;
  formIndex: number;
  item: string;
  wins: number;
}

/** The aggregate answer for one species. */
export interface SpeciesSuggestionResult {
  /** The queried line root. */
  species: number;
  /** Total winning appearances of this line across the surveyed rows (the denominator). */
  totalWins: number;
  /** Top form+item combos among winners, most-wins-first. */
  suggestions: SpeciesSuggestion[];
}

function validMon(v: unknown): v is SuggestionMon {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const m = v as Record<string, unknown>;
  return (
    typeof m.speciesId === "number"
    && typeof m.formIndex === "number"
    && typeof m.rootSpeciesId === "number"
    && typeof m.item === "string"
  );
}

/** The WINNING team of a row (or [] for a void / malformed row). */
function winningTeam(row: SuggestionRow): SuggestionMon[] {
  const team = row.winner === "host" ? row.hostTeam : row.winner === "guest" ? row.guestTeam : null;
  return Array.isArray(team) ? team.filter(validMon) : [];
}

/**
 * Aggregate the popular form+item combos for one line ROOT across recent WINNING rows. A row's winning
 * team is scanned; every mon whose `rootSpeciesId` matches is tallied by `(speciesId, formIndex, item)`.
 * Sorted most-wins-first (ties: lower speciesId, then formIndex, then item name) and capped at `limit`.
 */
export function aggregateSpeciesSuggestions(
  rows: SuggestionRow[],
  rootSpeciesId: number,
  limit = 6,
): SpeciesSuggestionResult {
  const counts = new Map<string, SpeciesSuggestion>();
  let totalWins = 0;
  for (const row of rows) {
    for (const mon of winningTeam(row)) {
      if (mon.rootSpeciesId !== rootSpeciesId) {
        continue;
      }
      totalWins += 1;
      const key = `${mon.speciesId}:${mon.formIndex}:${mon.item}`;
      const existing = counts.get(key);
      if (existing) {
        existing.wins += 1;
      } else {
        counts.set(key, { speciesId: mon.speciesId, formIndex: mon.formIndex, item: mon.item, wins: 1 });
      }
    }
  }
  const suggestions = [...counts.values()].sort(
    (a, b) => b.wins - a.wins || a.speciesId - b.speciesId || a.formIndex - b.formIndex || a.item.localeCompare(b.item),
  );
  return {
    species: rootSpeciesId,
    totalWins,
    suggestions: suggestions.slice(0, Math.max(0, limit)),
  };
}

/** Parse one D1 row (`winner` + raw `summary_json` string) into a {@linkcode SuggestionRow}, or null. */
export function parseSuggestionRow(winner: unknown, summaryJson: unknown): SuggestionRow | null {
  if (winner !== "host" && winner !== "guest") {
    return null; // only decisive wins contribute
  }
  if (typeof summaryJson !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(summaryJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const s = parsed as Record<string, unknown>;
  const hostTeam = Array.isArray(s.hostTeam) ? (s.hostTeam as SuggestionMon[]) : [];
  const guestTeam = Array.isArray(s.guestTeam) ? (s.guestTeam as SuggestionMon[]) : [];
  return { winner, hostTeam, guestTeam };
}
