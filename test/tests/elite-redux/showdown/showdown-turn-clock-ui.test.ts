/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 host turn-clock COUNTDOWN (P3 cosmetic). The CommandUiHandler shows a subtle
// countdown while the versus 60s command clock ticks; startShowdownClock reveals it (mm:ss, red
// under 10s), stopShowdownClock hides it. Drives the real handler (GameManager for the registered
// handler + text objects).
// =============================================================================

import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

type ClockInternals = {
  // The headless MockText tracks `.text` + `.color` (setVisible is a no-op there), so assertions read those.
  showdownClockLabel: { text: string; color: string };
  showdownClockDeadline: number;
  showdownClockTick: unknown | null;
  startShowdownClock(totalMs: number): void;
  stopShowdownClock(): void;
  refreshShowdownClock(): void;
};

describe.runIf(RUN)("showdown host turn-clock countdown UI", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });
  afterAll(() => phaserGame?.destroy(true));

  const buildHandler = (): ClockInternals => {
    const registered = game.scene.ui.handlers[UiMode.COMMAND];
    const handler = new (registered.constructor as new () => unknown)() as { setup(): void };
    handler.setup();
    return handler as unknown as ClockInternals;
  };

  it("startShowdownClock arms the countdown (mm:ss text); stopShowdownClock disarms it", () => {
    const h = buildHandler();
    expect(h.showdownClockDeadline).toBe(0); // disarmed by default (non-showdown battles)
    expect(h.showdownClockTick).toBeNull();

    h.startShowdownClock(60_000);
    expect(h.showdownClockDeadline).toBeGreaterThan(0);
    expect(h.showdownClockTick).not.toBeNull(); // a per-second tick is running
    expect(h.showdownClockLabel.text).toMatch(/^\d:\d\d$/); // e.g. "1:00" (rounding may show 0:59)

    h.stopShowdownClock();
    expect(h.showdownClockDeadline).toBe(0);
    expect(h.showdownClockTick).toBeNull();
  });

  it("turns the countdown RED under 10 seconds remaining", () => {
    const h = buildHandler();
    h.startShowdownClock(60_000);
    expect(h.showdownClockLabel.color).toBe("#f8f8f8"); // normal tint at 60s

    // Simulate the deadline 8s out and refresh: the label recolors red.
    h.showdownClockDeadline = Date.now() + 8_000;
    h.refreshShowdownClock();
    expect(h.showdownClockLabel.text).toBe("0:08");
    expect(h.showdownClockLabel.color).toBe("#e8646a");
    h.stopShowdownClock();
  });
});
