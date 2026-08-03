/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { applyIvChartOutline, buildIvChartData } from "#ui/containers/stats-container";
import type Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

describe("IV radar chart isolated-axis visibility", () => {
  it("outlines the IV polygon so a zero-area 31 spike remains visible", () => {
    const setStrokeStyle = vi.fn();
    const chart = { setStrokeStyle } as unknown as Phaser.GameObjects.Polygon;

    applyIvChartOutline(chart);

    expect(setStrokeStyle).toHaveBeenCalledWith(1, 0x98d8a0, 1);
  });

  it("retains the full isolated Attack coordinate between zero HP and Defense axes", () => {
    const points = buildIvChartData([0, 31, 0, 20, 21, 10]);

    expect(points.slice(0, 2)).toEqual([0, -0]);
    expect(points[2]).toBeGreaterThan(0);
    expect(points[3]).toBeLessThan(0);
    expect(points.slice(4, 6)).toEqual([0, 0]);
  });
});
