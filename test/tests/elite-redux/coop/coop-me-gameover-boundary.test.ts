/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopRuntime from "#data/elite-redux/coop/coop-runtime";
import { GameModes } from "#enums/game-modes";
import { GameOverPhase } from "#phases/game-over-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("co-op Mystery Event game-over authority boundary", () => {
  let previousScene: BattleScene;
  let shiftPhase: ReturnType<typeof vi.fn>;
  let hideAbilityBar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousScene = globalScene;
    shiftPhase = vi.fn();
    hideAbilityBar = vi.fn();
  });

  afterEach(() => {
    initGlobalScene(previousScene);
    vi.restoreAllMocks();
  });

  function installScene(onGameOver: () => boolean): void {
    initGlobalScene({
      gameMode: {
        isCoop: true,
        isShowdown: false,
        isClassic: false,
        isEndless: false,
        modeId: GameModes.COOP,
      },
      currentBattle: {
        waveIndex: 7,
        mysteryEncounter: { onGameOver },
      },
      phaseManager: { hideAbilityBar, shiftPhase },
      enableRetries: false,
    } as unknown as BattleScene);
  }

  it("does not publish WAVE_ADVANCE(gameOver) when the ME converts the loss into a continuation", () => {
    const onGameOver = vi.fn(() => false);
    installScene(onGameOver);
    const broadcast = vi.spyOn(coopRuntime, "broadcastCoopWaveResolved");
    const notifyContinuationSurface = vi.fn();
    vi.spyOn(coopRuntime, "isCoopAuthoritativeGuest").mockReturnValue(true);
    vi.spyOn(coopRuntime, "getCoopBattleStreamer").mockReturnValue({
      notifyContinuationSurface,
    } as unknown as ReturnType<typeof coopRuntime.getCoopBattleStreamer>);

    new GameOverPhase(false).start();

    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(broadcast, "the guest must remain on the live ME boundary").not.toHaveBeenCalled();
    expect(notifyContinuationSurface, "a resumed ME is not a terminal continuation").not.toHaveBeenCalled();
    expect(shiftPhase, "the non-terminal GameOverPhase ends back into the ME-authored continuation").toHaveBeenCalled();
  });

  it("publishes game-over only after the ME hook authorizes a true terminal", () => {
    const onGameOver = vi.fn(() => true);
    installScene(onGameOver);
    const broadcast = vi.spyOn(coopRuntime, "broadcastCoopWaveResolved").mockImplementation(() => {});
    const notifyContinuationSurface = vi.fn();
    vi.spyOn(coopRuntime, "isCoopAuthoritativeGuest").mockReturnValue(true);
    vi.spyOn(coopRuntime, "getCoopBattleStreamer").mockReturnValue({
      notifyContinuationSurface,
    } as unknown as ReturnType<typeof coopRuntime.getCoopBattleStreamer>);
    const phase = new GameOverPhase(false);
    vi.spyOn(phase, "handleGameOver").mockImplementation(() => {});

    phase.start();

    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith("gameOver");
    expect(notifyContinuationSurface).toHaveBeenCalledOnce();
    expect(notifyContinuationSurface).toHaveBeenCalledWith("terminal");
  });
});
