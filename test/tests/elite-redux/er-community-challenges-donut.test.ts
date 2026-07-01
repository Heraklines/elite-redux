/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Community Challenges - the COMMUNITY STATS donut is a REAL proportional
// ring, not a flat placeholder. buildStats() draws one Graphics with pie slices
// for the cleared / in-progress / failed split, each a fraction of total
// attempts, starting at the top (-90 deg) and sweeping clockwise in the legend
// order (cleared green -> in-progress blue -> failed red). This asserts the arc
// GEOMETRY + colors directly (environment-independent - no pixels), because the
// full-page render harness confirms the pixels but its golden text baseline is
// generated in a different font environment. See render-ui-page.test.ts for the
// visual (before/after PNG) verification.
// =============================================================================

import type { CommunityChallengeEntry, CommunityChallengeStats } from "#data/elite-redux/er-community-challenges";
import { GameManager } from "#test/framework/game-manager";
import { CommunityChallengesUiHandler } from "#ui/community-challenges-ui-handler";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// The exact colors the legend uses (#5fd38a / #5aa0e8 / #e06a6a), which the
// donut arcs MUST match. Same order as the slices: cleared, in-progress, failed.
const CLEARED = 0x5fd38a;
const IN_PROGRESS = 0x5aa0e8;
const FAILED = 0xe06a6a;
const RING_RADIUS = 14;
const TOP = -Math.PI / 2;
const TWO_PI = Math.PI * 2;

/** buildStats() only reads `e.stats`; a typed double-cast keeps the rest minimal. */
function makeEntry(stats: CommunityChallengeStats): CommunityChallengeEntry {
  return { stats } as unknown as CommunityChallengeEntry;
}

/** Private-member view of the handler under test (typed double-cast, not `as any`). */
type DonutHandler = {
  setup(): void;
  dynamic: { list: unknown[] };
  buildStats(e: CommunityChallengeEntry): void;
};

describe.skipIf(!RUN)("ER Community Challenges - proportional stats donut", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    phaserGame.destroy(true);
  });

  /**
   * Build a fresh handler, spy on the graphics factory to capture every Graphics
   * buildStats() creates (with slice/fillStyle/fillCircle spied), run buildStats
   * for the given stats, and return the captured graphics + the dynamic container.
   */
  function drawDonut(stats: Partial<CommunityChallengeStats>) {
    const handler = new CommunityChallengesUiHandler();
    const h = handler as unknown as DonutHandler;
    h.setup();

    // game.scene IS the globalScene singleton the handler renders against; spy on
    // its graphics factory to capture the Graphics buildStats() builds.
    const add = game.scene.add;
    const created: Phaser.GameObjects.Graphics[] = [];
    const realGraphics = add.graphics.bind(add);
    vi.spyOn(add, "graphics").mockImplementation((config?: Phaser.Types.GameObjects.Graphics.Options) => {
      const g = realGraphics(config);
      vi.spyOn(g, "slice");
      vi.spyOn(g, "fillStyle");
      vi.spyOn(g, "fillCircle");
      created.push(g);
      return g;
    });

    const full: CommunityChallengeStats = {
      attempts: 0,
      cleared: 0,
      inProgress: 0,
      failed: 0,
      recent: [],
      ...stats,
    };
    h.buildStats(makeEntry(full));
    return { created, dynamic: h.dynamic };
  }

  it("draws proportional cleared/in-progress/failed arcs from the top, clockwise", () => {
    // 25% cleared, 50% in progress, 10% failed, 15% unattempted remainder.
    const { created, dynamic } = drawDonut({ attempts: 100, cleared: 25, inProgress: 50, failed: 10 });

    expect(created).toHaveLength(1);
    const g = created[0];
    // The donut graphic is added to `dynamic`, like the surrounding code.
    expect(dynamic.list).toContain(g);

    // Colors match the legend exactly, in slice order (cleared -> in prog -> failed).
    expect(g.fillStyle).toHaveBeenNthCalledWith(1, CLEARED, 1);
    expect(g.fillStyle).toHaveBeenNthCalledWith(2, IN_PROGRESS, 1);
    expect(g.fillStyle).toHaveBeenNthCalledWith(3, FAILED, 1);

    // Three proportional slices, each at the ring radius, contiguous from the top.
    const calls = (g.slice as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c[2]).toBe(RING_RADIUS); // radius
    }
    // cleared: top -> +25%
    expect(calls[0][3]).toBeCloseTo(TOP);
    expect(calls[0][4]).toBeCloseTo(TOP + 0.25 * TWO_PI);
    // in progress: continues -> +50%
    expect(calls[1][3]).toBeCloseTo(TOP + 0.25 * TWO_PI);
    expect(calls[1][4]).toBeCloseTo(TOP + 0.75 * TWO_PI);
    // failed: continues -> +10% (leaving a 15% dark remainder)
    expect(calls[2][3]).toBeCloseTo(TOP + 0.75 * TWO_PI);
    expect(calls[2][4]).toBeCloseTo(TOP + 0.85 * TWO_PI);

    expect(g.fillCircle).not.toHaveBeenCalled();
  });

  it("skips zero-count segments (only the non-zero ones get a slice)", () => {
    // Inferno-like: a tiny cleared sliver, nothing in progress/failed.
    const { created } = drawDonut({ attempts: 963, cleared: 3, inProgress: 0, failed: 0 });

    expect(created).toHaveLength(1);
    const g = created[0];
    // Only the cleared color is used; the two empty segments are skipped.
    expect(g.fillStyle).toHaveBeenCalledTimes(1);
    expect(g.fillStyle).toHaveBeenNthCalledWith(1, CLEARED, 1);
    const calls = (g.slice as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toBeCloseTo(TOP);
    expect(calls[0][4]).toBeCloseTo(TOP + (3 / 963) * TWO_PI);
    expect(g.fillCircle).not.toHaveBeenCalled();
  });

  it("closes the full ring cleanly when a single segment is 100%", () => {
    const { created } = drawDonut({ attempts: 50, cleared: 50, inProgress: 0, failed: 0 });

    expect(created).toHaveLength(1);
    const g = created[0];
    expect(g.fillStyle).toHaveBeenNthCalledWith(1, CLEARED, 1);
    // A single full segment is a filled circle (no partial slice seam).
    expect(g.fillCircle).toHaveBeenCalledTimes(1);
    expect(g.fillCircle).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), RING_RADIUS);
    expect(g.slice).not.toHaveBeenCalled();
  });

  it("draws no arcs (no divide-by-zero) when there are zero attempts", () => {
    const { created } = drawDonut({ attempts: 0, cleared: 0, inProgress: 0, failed: 0 });
    // The guarded block never runs, so no arc graphics object is created at all.
    expect(created).toHaveLength(0);
  });

  it("draws no arcs when attempts exist but every segment is zero", () => {
    const { created } = drawDonut({ attempts: 40, cleared: 0, inProgress: 0, failed: 0 });
    expect(created).toHaveLength(0);
  });
});
