/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Import the tracked staging suite directly: Vitest intentionally does not expose
// Vite's DEV build flag, while the deployed staging bundle loads this same module
// through the gated registry glob.
import "#app/dev-tools/test-suite/index";
import Overrides from "#app/overrides";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const PASSED_KEY = "er-dev-passed-scenarios";
const FINAL_BOSS_LABEL = "Endless: final boss auto-KO";

type InspectableOptionHandler = {
  config: null | {
    options: Array<{ label: string }>;
  };
  processInput: (button: Button) => boolean;
};

function unlockOverrides(): void {
  const overrides = Overrides as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (
    let current: object | null = overrides;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    for (const key of Object.getOwnPropertyNames(current)) {
      keys.add(key);
    }
  }
  for (const key of keys) {
    if (key === "constructor") {
      continue;
    }
    let value: unknown;
    try {
      value = overrides[key];
    } catch {
      continue;
    }
    if (typeof value === "function") {
      continue;
    }
    try {
      Object.defineProperty(overrides, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      // Unrelated non-configurable framework fields do not need scenario overrides.
    }
  }
}

describe.skipIf(!RUN)("dev scenario picker navigation harness", () => {
  let phaserGame: Phaser.Game;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterAll(() => {
    localStorage.removeItem(PASSED_KEY);
    phaserGame.destroy(true);
  });

  it("keeps the reusable Endless fixture visible and returns to a live title", async () => {
    localStorage.setItem(PASSED_KEY, JSON.stringify([FINAL_BOSS_LABEL]));
    const game = new GameManager(phaserGame);
    unlockOverrides();
    await game.runToTitle();
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.TITLE));

    const titlePhase = game.scene.phaseManager.getCurrentPhase();
    const titleHandler = game.scene.ui.getHandler() as unknown as InspectableOptionHandler;
    const devIndex = titleHandler.config?.options.findIndex(option => option.label.includes("Dev Scenarios")) ?? -1;
    expect(devIndex, JSON.stringify(titleHandler.config?.options.map(option => option.label))).toBeGreaterThanOrEqual(
      0,
    );

    for (let index = 0; index < devIndex; index++) {
      titleHandler.processInput(Button.DOWN);
    }
    expect(titleHandler.processInput(Button.ACTION)).toBe(true);

    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT));
    const pickerHandler = game.scene.ui.getHandler() as unknown as InspectableOptionHandler;
    expect(pickerHandler.config?.options.map(option => option.label)).toContain(FINAL_BOSS_LABEL);

    expect(pickerHandler.processInput(Button.CANCEL)).toBe(true);
    expect(game.scene.phaseManager.getCurrentPhase()).not.toBe(titlePhase);
    expect(game.scene.phaseManager.getCurrentPhase().phaseName).toBe("TitlePhase");

    // GameManager deliberately parks every newly shifted phase until its
    // interceptor is asked to run it. Advance the fresh TitlePhase exactly as
    // production's PhaseManager would do synchronously.
    await game.phaseInterceptor.to("TitlePhase");
    expect(game.scene.ui.getMode()).toBe(UiMode.TITLE);
  }, 60_000);
});
