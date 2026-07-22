/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { GameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { areShowdownModesEnabled, TitlePhase } from "#phases/title-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("title mode selection", () => {
  let previousScene: BattleScene | undefined;

  beforeEach(() => {
    previousScene = globalScene;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (previousScene != null) {
      initGlobalScene(previousScene);
    }
  });

  it("hides daily and endless modes while keeping unlocked challenge mode", async () => {
    let titleOptions: OptionSelectItem[] = [];
    let modeOptions: OptionSelectItem[] = [];
    const scene = {
      gameData: {
        isUnlocked: vi.fn().mockReturnValue(true),
      },
      ui: {
        setMode: vi.fn((_mode, config?: OptionSelectConfig) => {
          titleOptions = config?.options ?? [];
        }),
        showText: vi.fn((_message, _delay, callback?: () => void) => callback?.()),
        setOverlayMode: vi.fn((_mode, config: OptionSelectConfig) => {
          modeOptions = config.options;
        }),
      },
    } as unknown as BattleScene;
    initGlobalScene(scene);

    const phase = new TitlePhase() as unknown as {
      showOptions(lastSessionSlot: number): Promise<void>;
    };
    await phase.showOptions(-1);

    const newGame = titleOptions.find(option => option.semanticId === "new-game");
    expect(newGame).toBeDefined();
    newGame?.handler();

    const labels = modeOptions.map(option => option.label);
    expect(labels).toContain(GameMode.getModeName(GameModes.CLASSIC));
    expect(labels).toContain(GameMode.getModeName(GameModes.CHALLENGE));
    expect(labels).not.toContain(GameMode.getModeName(GameModes.ENDLESS));
    expect(labels).not.toContain(GameMode.getModeName(GameModes.SPLICED_ENDLESS));
    expect(modeOptions).not.toContainEqual(expect.objectContaining({ semanticId: "daily-run" }));
  });

  it.each([
    "showdown",
    "showdown-tournaments",
  ])("keeps %s visible but returns disabled clicks to the modes", async semanticId => {
    vi.stubEnv("VITE_DEV_TOOLS", "1");
    let titleOptions: OptionSelectItem[] = [];
    let modeOptions: OptionSelectItem[] = [];
    const showText = vi.fn((_message, _delay, callback?: () => void) => callback?.());
    const scene = {
      gameData: {
        isUnlocked: vi.fn().mockReturnValue(true),
      },
      ui: {
        setMode: vi.fn((_mode, config?: OptionSelectConfig) => {
          if (config != null) {
            titleOptions = config.options;
          }
        }),
        resetModeChain: vi.fn(),
        showText,
        setOverlayMode: vi.fn((_mode, config: OptionSelectConfig) => {
          modeOptions = config.options;
        }),
      },
    } as unknown as BattleScene;
    initGlobalScene(scene);

    const phase = new TitlePhase();
    const testablePhase = phase as unknown as {
      showOptions(lastSessionSlot: number): Promise<void>;
      openShowdownTeamMenu: ReturnType<typeof vi.fn>;
      openShowdownTournaments: ReturnType<typeof vi.fn>;
    };
    const teamMenuSpy = vi.spyOn(testablePhase, "openShowdownTeamMenu");
    const tournamentSpy = vi.spyOn(testablePhase, "openShowdownTournaments");
    await testablePhase.showOptions(-1);
    titleOptions.find(option => option.semanticId === "new-game")?.handler();

    const disabledOption = modeOptions.find(option => option.semanticId === semanticId);
    expect(disabledOption, `${semanticId} remains visible`).toBeDefined();
    disabledOption?.handler();

    expect(showText).toHaveBeenCalledWith(
      "Temporarily disabled. It will be back soon.",
      null,
      expect.any(Function),
      null,
      true,
    );
    expect(
      modeOptions.find(option => option.semanticId === semanticId),
      "mode selection is shown again",
    ).toBeDefined();
    expect(teamMenuSpy).not.toHaveBeenCalled();
    expect(tournamentSpy).not.toHaveBeenCalled();
  });

  it("supports explicit URL overrides for testing and emergency shutdown", () => {
    expect(areShowdownModesEnabled("")).toBe(false);
    expect(areShowdownModesEnabled("?enableShowdown=1")).toBe(true);
    expect(areShowdownModesEnabled("?enableShowdown=0")).toBe(false);
  });
});
