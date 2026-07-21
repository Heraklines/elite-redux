/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { getStormglassWeather } from "#data/elite-redux/er-relics";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { ErRelicModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, drainLoopback, withClient, withClientSync } from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO Stormglass: committed weather survives raw carrier loss", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("drops the raw choice, then both real engines persist and apply the host's committed Sandstorm", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    // This operation test used to start a detached picker after buildDuo had already installed an
    // actionable COMMAND_FRONTIER. Authority V2 correctly rejects that impossible
    // COMMAND -> STORMGLASS_PRESENT edge. Make the picker the real current phase before pairing, as
    // EncounterPhase does when a held unconfigured Stormglass opens at a battle boundary. buildDuo
    // therefore does not manufacture an unrelated initial command control, and V2 projects this
    // first retained interaction into the replica's real phase manager.
    game.scene.phaseManager.clearPhaseQueue();
    game.scene.phaseManager.unshiftNew("ErStormglassPickerPhase");
    game.scene.phaseManager.shiftPhase();
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "interactionChoice" && msg.kind === "stormglass" },
      { seed: 0x57026a56 },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    for (const ctx of [rig.hostCtx, rig.guestCtx]) {
      await withClient(ctx, async () => {
        const modifier = modifierTypes.ER_RELIC_STORMGLASS().newModifier();
        expect(modifier).toBeInstanceOf(ErRelicModifier);
        await Promise.resolve(globalScene.addModifier(modifier!, true, false, false, true));
        expect(getStormglassWeather()).toBeNull();
      });
    }

    await withClient(rig.hostCtx, async () => {
      let options: OptionSelectItem[] | undefined;
      const setMode = globalScene.ui.setMode.bind(globalScene.ui);
      vi.spyOn(globalScene.ui, "showText").mockImplementation((_text, _delay, callback) => callback?.());
      vi.spyOn(globalScene.ui, "setMode").mockImplementation((mode, config) => {
        if (mode === UiMode.OPTION_SELECT) {
          options = (config as { options: OptionSelectItem[] }).options;
        }
        // Observe the production transition instead of replacing it. Authority V2 must see the real active,
        // actionable OPTION_SELECT handler before the host is allowed to commit the decision successor.
        return setMode(mode, config);
      });
      const phase = globalScene.phaseManager.getCurrentPhase();
      expect(phase.phaseName).toBe("ErStormglassPickerPhase");
      phase.start();
      await Promise.resolve();
      await drainLoopback();
      expect(options?.map(option => option.label)).toEqual(["Sun", "Rain", "Sandstorm", "Hail", "Fog"]);
      options?.[2]?.handler();
      await drainLoopback();
      expect(getStormglassWeather()).toBe(WeatherType.SANDSTORM);
      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM);
    });

    expect(pair.faultsInjected(), "the low-latency stormglass choice was actually dropped").toBe(1);

    await withClient(rig.guestCtx, async () => {
      vi.spyOn(globalScene.ui, "showText").mockImplementation(() => undefined);
      vi.spyOn(globalScene.ui, "setMode").mockResolvedValue(true as never);
      await drainLoopback();
      expect(getStormglassWeather()).toBe(WeatherType.SANDSTORM);
      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM);
      expect(globalScene.arena.weather?.turnsLeft).toBe(5);
    });

    expect(
      withClientSync(rig.hostCtx, () => getStormglassWeather()),
      "host and guest persist the same one-time weather",
    ).toBe(withClientSync(rig.guestCtx, () => getStormglassWeather()));
  });
});
