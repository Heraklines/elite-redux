/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER relic #130 - Stormglass weather PICKER. Drives the one-time, path-independent
// picker phase: a held Stormglass with NO chosen weather shows the 5-weather
// option select, the player's pick is recorded via the EXISTING setStormglassWeather
// (persisted on the relic instance), and the chosen weather is applied for 5 turns
// that same battle. A SECOND battle then reuses the recorded weather without ever
// re-prompting (the picker phase short-circuits straight to apply).
//
// Gated behind ER_SCENARIO=1, like the other combat relic tests.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { erStormglassApplyChosenWeather, getStormglassWeather } from "#data/elite-redux/er-relics";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { ErRelicModifier } from "#modifiers/modifier";
import { ErStormglassPickerPhase } from "#phases/er-stormglass-picker-phase";
import { GameManager } from "#test/framework/game-manager";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Stormglass picker (#130)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.GYARADOS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Grant the Stormglass relic to the player (the off-pool grant path), chosenWeather=null. */
  function grantStormglass(): ErRelicModifier {
    const mod = modifierTypes.ER_RELIC_STORMGLASS().newModifier() as ErRelicModifier | undefined;
    expect(mod).toBeInstanceOf(ErRelicModifier);
    expect(mod!.chosenWeather).toBeNull();
    globalScene.addModifier(mod!, true, false, false, true);
    return mod!;
  }

  /**
   * Run the picker phase and drive it through the REAL UI chain: the prompt text
   * (advanced with ACTION), then SELECT the weather at `optionIndex`. The phase
   * hands a labelled-options config to OPTION_SELECT; we assert the 5 labels render,
   * then invoke the chosen option's handler exactly as the OPTION_SELECT cursor would
   * (deterministic, no input-timing race). Resolves once the phase has ended.
   */
  async function runPickerAndChoose(optionIndex: number): Promise<void> {
    const phase = new ErStormglassPickerPhase();
    // Capture the option config the phase hands to OPTION_SELECT so we can assert on
    // the rendered weather labels and invoke the chosen handler deterministically.
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");

    phase.start();

    // The prompt's text (showText) opens the OPTION_SELECT from its callback. Headlessly
    // the prompt waits on an ACTION press, so nudge it ONCE while still in MESSAGE mode -
    // but never press once the select is up (that would confirm its cursor-0 row, Sun).
    await vi.waitFor(() => {
      if (globalScene.ui.getMode() === UiMode.MESSAGE) {
        (globalScene.ui.getHandler() as MessageUiHandler).processInput(Button.ACTION);
      }
      expect(setModeSpy.mock.calls.find(c => c[0] === UiMode.OPTION_SELECT)).toBeDefined();
    });
    const optionCall = setModeSpy.mock.calls.find(c => c[0] === UiMode.OPTION_SELECT);
    const config = optionCall![1] as { options: { label: string; handler: () => boolean }[] };
    expect(config.options.map(o => o.label)).toEqual(["Sun", "Rain", "Sandstorm", "Hail", "Fog"]);

    // Pick the weather (invoking the option's handler is exactly what confirming the
    // OPTION_SELECT cursor on that row does).
    config.options[optionIndex].handler();
  }

  it("first battle: a held Stormglass with no chosen weather PROMPTS, and the pick is recorded + applied", async () => {
    const mod = grantStormglass();
    expect(getStormglassWeather()).toBeNull();

    // Clear any ambient weather so the assertion reads the chosen weather only.
    globalScene.arena.trySetWeather(WeatherType.NONE);

    // Choose index 2 = Sandstorm (DOWN x2 from Sun).
    await runPickerAndChoose(2);

    // The pick was recorded through setStormglassWeather: persisted on the relic
    // instance (so it round-trips through the save) and readable via the getter.
    await vi.waitFor(() => expect(getStormglassWeather()).toBe(WeatherType.SANDSTORM));
    expect(mod.chosenWeather).toBe(WeatherType.SANDSTORM);

    // ...and applied for exactly 5 turns this same battle (chosen weather wins).
    await vi.waitFor(() => expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM));
    expect(globalScene.arena.weather?.turnsLeft).toBe(5);
    expect(globalScene.arena.weather?.maxDuration).toBe(5);
  });

  it("second battle: an already-chosen weather is REUSED without re-prompting", async () => {
    const mod = grantStormglass();

    // First battle: pick Rain (DOWN x1 from Sun).
    globalScene.arena.trySetWeather(WeatherType.NONE);
    await runPickerAndChoose(1);
    await vi.waitFor(() => expect(getStormglassWeather()).toBe(WeatherType.RAIN));
    expect(mod.chosenWeather).toBe(WeatherType.RAIN);

    // Simulate the next battle: ambient weather cleared, relic still held + already
    // chosen. The picker phase must NOT open an OPTION_SELECT this time - it goes
    // straight to applying the recorded weather and ending. Restore the first
    // picker's UI spies so the fresh ones below record ONLY phase2's calls.
    vi.restoreAllMocks();
    globalScene.arena.trySetWeather(WeatherType.NONE);
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");
    const showTextSpy = vi.spyOn(globalScene.ui, "showText");

    const phase2 = new ErStormglassPickerPhase();
    phase2.start();

    // No prompt, no option select - the recorded weather is simply reapplied.
    expect(showTextSpy).not.toHaveBeenCalled();
    expect(setModeSpy.mock.calls.find(c => c[0] === UiMode.OPTION_SELECT)).toBeUndefined();
    await vi.waitFor(() => expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.RAIN));
    expect(globalScene.arena.weather?.turnsLeft).toBe(5);
    expect(getStormglassWeather()).toBe(WeatherType.RAIN);
  });

  it("later battle: REFRESHES the chosen weather even when it carried over (the 'works once then stops' bug)", async () => {
    const mod = grantStormglass();

    // First battle: pick Rain, applied for 5 turns.
    globalScene.arena.trySetWeather(WeatherType.NONE);
    await runPickerAndChoose(1);
    await vi.waitFor(() => expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.RAIN));
    expect(mod.chosenWeather).toBe(WeatherType.RAIN);

    // Turns elapse during battle 1: the Rain is nearly spent but is STILL Rain.
    globalScene.arena.weather!.turnsLeft = 1;

    // Next battle in the SAME biome: the engine does NOT clear weather between waves,
    // so the arena is still Rain. The per-battle apply must REFRESH the duration back
    // to 5. Before the fix, trySetWeather is a no-op for the same weather type, so the
    // apply bailed and the Rain expired and never came back - the reported "Stormglass
    // only works the first battle."
    erStormglassApplyChosenWeather();

    expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.RAIN);
    expect(globalScene.arena.weather?.turnsLeft).toBe(5);
    expect(globalScene.arena.weather?.maxDuration).toBe(5);
  });
});
