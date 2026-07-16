/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER N-type display strip geometry (Pass B, maintainer paired-column layout).
//
// Verifies the layout the static preview screens (starter-select, pokedex,
// pokedex-page) use for N-type mons:
//   - 1-3 types: the ORIGINAL single horizontal row (unchanged for the common case).
//   - 4+ types: VERTICAL PAIRS advancing horizontally (types 1-2 in column 0, 3-4
//     column 1, 5-6 column 2, a lone 7th in column 3). This halves the row length
//     so 6/7-type mons (Primal Regigigas) fit without covering the sprite / name.
//
// Pure-geometry test (no sprites / no game boot) - fast and exact.
// =============================================================================

import { computeTypeIconStripLayout, type TypeIconStripOptions } from "#ui/type-icon-strip";
import { describe, expect, it } from "vitest";

const OPTS: TypeIconStripOptions = { x0: 8, y0: 98, baseScale: 0.5, baseStride: 18, maxWidth: 104 };
const { x0, y0, baseStride: STRIDE } = OPTS;

describe("ER type-icon strip geometry (paired-column N-type layout)", () => {
  it("2 types: single row, original placement (unchanged)", () => {
    const { scale, placements } = computeTypeIconStripLayout(2, OPTS);
    expect(placements.length).toBe(2);
    expect(placements[0]).toEqual({ x: x0, y: y0 });
    expect(placements[1]).toEqual({ x: x0 + STRIDE, y: y0 });
    expect(scale).toBe(0.5);
  });

  it("3 types (Tentalect): still a single row", () => {
    const { placements } = computeTypeIconStripLayout(3, OPTS);
    expect(placements.length).toBe(3);
    placements.forEach((p, i) => {
      expect(p.y).toBe(y0);
      expect(p.x).toBe(x0 + i * STRIDE);
    });
  });

  it("4 types: switches to two vertical pairs (2 columns)", () => {
    const { placements } = computeTypeIconStripLayout(4, OPTS);
    expect(placements.length).toBe(4);
    // Column 0: index 0 (row 0) + 1 (row 1) at x0, stacked.
    expect(placements[0].x).toBe(x0);
    expect(placements[1].x).toBe(x0);
    expect(placements[1].y).toBeGreaterThan(placements[0].y);
    // Column 1: index 2 + 3 at x0 + STRIDE, same rows.
    expect(placements[2].x).toBe(x0 + STRIDE);
    expect(placements[3].x).toBe(x0 + STRIDE);
    expect(placements[2].y).toBe(placements[0].y);
    expect(placements[3].y).toBe(placements[1].y);
  });

  it("6 types (Primal Regigigas class): three vertical pairs, half the row length", () => {
    const { placements } = computeTypeIconStripLayout(6, OPTS);
    expect(placements.length).toBe(6);
    const cols = [...new Set(placements.map(p => Math.round(p.x)))];
    const rows = [...new Set(placements.map(p => Math.round(p.y)))];
    expect(cols.length).toBe(3);
    expect(rows.length).toBe(2);
    // Rightmost column is x0 + 2*STRIDE (half of a flat 6-wide strip's 5*STRIDE).
    expect(Math.max(...cols)).toBe(x0 + 2 * STRIDE);
  });

  it("7 types (Primal Regigigas final): four columns, a lone 7th in the last column", () => {
    const { scale, placements } = computeTypeIconStripLayout(7, OPTS);
    expect(placements.length).toBe(7);
    const cols = [...new Set(placements.map(p => Math.round(p.x)))].sort((a, b) => a - b);
    expect(cols.length).toBe(4);
    // The 7th badge (index 6) is alone in column 3, top row.
    expect(Math.round(placements[6].x)).toBe(cols[3]);
    expect(placements[6].y).toBe(placements[0].y);
    // The whole grid stays within the width budget (no overflow past x0 + maxWidth).
    expect(Math.max(...cols) + 32 * scale).toBeLessThanOrEqual(x0 + OPTS.maxWidth + 1);
  });

  it("degrades sanely past 7 (theoretical 12): shrinks to fit, still paired", () => {
    const { scale, placements } = computeTypeIconStripLayout(12, OPTS);
    expect(placements.length).toBe(12);
    // 6 columns of 2.
    const cols = [...new Set(placements.map(p => Math.round(p.x)))];
    expect(cols.length).toBe(6);
    // Shrunk below base scale to fit the budget.
    expect(scale).toBeLessThan(0.5);
    expect(Math.max(...cols) + 32 * scale).toBeLessThanOrEqual(x0 + OPTS.maxWidth + 1);
  });
});
