/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { GameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { TitlePhase } from "#phases/title-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("title mode selection", () => {
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
});
