/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isDevEncounterPersistenceBypassActive, loadDevTools } from "#app/dev-tools/registry";
import Overrides from "#app/overrides";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SCENARIO_LABELS = Array.from({ length: 5 }, (_, index) => `Roster: new Pokemon ${index + 1}/5`);

type DevHarnessWindow = Window & {
  __erLaunchDevScenarioByLabel?: (label: string) => boolean;
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
      Object.defineProperty(overrides, key, { value, writable: true, configurable: true, enumerable: true });
    } catch {
      // Non-configurable framework fields do not need scenario overrides.
    }
  }
}

describe.skipIf(!RUN)("fakemon roster dev scenarios", () => {
  let phaserGame: Phaser.Game;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    await loadDevTools();
  });

  for (const label of SCENARIO_LABELS) {
    it(`${label} launches through the in-game dev picker rail`, async () => {
      const game = new GameManager(phaserGame);
      unlockOverrides();
      await game.runToTitle();

      const launch = (window as DevHarnessWindow).__erLaunchDevScenarioByLabel;
      expect(launch, "the title menu must expose the staging scenario harness").toBeTypeOf("function");
      expect(launch?.(label)).toBe(true);
      expect(isDevEncounterPersistenceBypassActive()).toBe(true);

      await game.phaseInterceptor.to("EncounterPhase");
      await game.phaseInterceptor.to("CommandPhase");

      expect(game.scene.ui.getMode()).toBe(UiMode.COMMAND);
      expect(game.scene.currentBattle.waveIndex).toBe(145);
      expect(game.scene.currentBattle.isClassicFinalBoss).toBe(false);
      expect(game.scene.getPlayerParty()).toHaveLength(6);
      expect(game.scene.getPlayerParty().every(pokemon => pokemon.level === 100)).toBe(true);
      expect(game.scene.getPlayerParty().every(pokemon => pokemon.getMoveset().length > 0)).toBe(true);
      expect(game.scene.getEnemyParty().length).toBeGreaterThan(0);
    }, 180_000);
  }
});
