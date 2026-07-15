/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { TitlePhase } from "#phases/title-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("co-op title save refusal", () => {
  let previousScene: BattleScene | undefined;

  beforeEach(() => {
    previousScene = globalScene;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousScene != null) {
      initGlobalScene(previousScene);
    }
  });

  it("returns to safe title options instead of starting an undefined game mode", async () => {
    let acknowledgeFailure: (() => void) | undefined;
    const originalGameMode = { isCoop: false };
    const scene = {
      gameData: {
        loadSession: vi.fn().mockResolvedValue(false),
      },
      gameMode: originalGameMode,
      sessionSlotId: -1,
      ui: {
        resetModeChain: vi.fn(),
        setMode: vi.fn(),
        showText: vi.fn(
          (
            _message: string,
            _delay: number | null,
            callback: (() => void) | undefined,
            _callbackDelay: number | null,
            _prompt: boolean,
          ) => {
            acknowledgeFailure = callback;
          },
        ),
      },
    } as unknown as BattleScene;
    initGlobalScene(scene);

    const phase = new TitlePhase();
    const testablePhase = phase as unknown as {
      loadSaveSlot(slotId: number): Promise<void>;
      showOptions(lastSessionSlot: number): Promise<void>;
    };
    const endSpy = vi.spyOn(phase, "end");
    const showOptionsSpy = vi.spyOn(testablePhase, "showOptions").mockResolvedValue();

    await testablePhase.loadSaveSlot(2);

    expect(scene.gameData.loadSession).toHaveBeenCalledWith(2);
    expect(scene.sessionSlotId).toBe(2);
    expect(scene.gameMode, "a refused co-op save cannot install or clear the current game mode").toBe(originalGameMode);
    expect(endSpy).not.toHaveBeenCalled();
    expect(scene.ui.showText).toHaveBeenCalledWith(
      expect.stringMatching(/New Game > Co-op.*exact saved partner/u),
      null,
      expect.any(Function),
      null,
      true,
    );

    expect(acknowledgeFailure).toBeTypeOf("function");
    acknowledgeFailure?.();
    expect(showOptionsSpy).toHaveBeenCalledWith(-1);
  });

  it("preserves the normal completion path for a successful solo save load", async () => {
    let acknowledgeSuccess: (() => void) | undefined;
    const scene = {
      gameData: {
        loadSession: vi.fn().mockResolvedValue(true),
      },
      sessionSlotId: -1,
      ui: {
        resetModeChain: vi.fn(),
        setMode: vi.fn(),
        showText: vi.fn((_message: string, _delay: number | null, callback: (() => void) | undefined) => {
          acknowledgeSuccess = callback;
        }),
      },
    } as unknown as BattleScene;
    initGlobalScene(scene);

    const phase = new TitlePhase();
    const testablePhase = phase as unknown as {
      loadSaveSlot(slotId: number): Promise<void>;
    };
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => undefined);

    await testablePhase.loadSaveSlot(1);

    expect(scene.gameData.loadSession).toHaveBeenCalledWith(1);
    expect(scene.sessionSlotId).toBe(1);
    expect(scene.ui.showText).toHaveBeenCalledWith(expect.any(String), null, expect.any(Function));
    expect(endSpy).not.toHaveBeenCalled();

    expect(acknowledgeSuccess).toBeTypeOf("function");
    acknowledgeSuccess?.();
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("returns to the same safe title surface when save loading throws", async () => {
    const loadError = new Error("saved session could not be decoded");
    const originalGameMode = { isCoop: false };
    let acknowledgeFailure: (() => void) | undefined;
    const scene = {
      gameData: {
        loadSession: vi.fn().mockRejectedValue(loadError),
      },
      gameMode: originalGameMode,
      sessionSlotId: -1,
      ui: {
        resetModeChain: vi.fn(),
        setMode: vi.fn(),
        showText: vi.fn(
          (
            _message: string,
            _delay: number | null,
            callback: (() => void) | undefined,
            _callbackDelay: number | null,
            _prompt: boolean,
          ) => {
            acknowledgeFailure = callback;
          },
        ),
      },
    } as unknown as BattleScene;
    initGlobalScene(scene);

    const phase = new TitlePhase();
    const testablePhase = phase as unknown as {
      loadSaveSlot(slotId: number): Promise<void>;
      showOptions(lastSessionSlot: number): Promise<void>;
    };
    const endSpy = vi.spyOn(phase, "end");
    const showOptionsSpy = vi.spyOn(testablePhase, "showOptions").mockResolvedValue();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await testablePhase.loadSaveSlot(3);

    expect(consoleErrorSpy).toHaveBeenCalledWith(loadError);
    expect(scene.sessionSlotId).toBe(3);
    expect(scene.gameMode, "an exceptional load cannot install or clear the current game mode").toBe(originalGameMode);
    expect(endSpy).not.toHaveBeenCalled();
    expect(scene.ui.showText).toHaveBeenCalledWith(
      expect.stringMatching(/New Game > Co-op.*exact saved partner/u),
      null,
      expect.any(Function),
      null,
      true,
    );

    expect(acknowledgeFailure).toBeTypeOf("function");
    acknowledgeFailure?.();
    expect(showOptionsSpy).toHaveBeenCalledWith(-1);
  });
});
