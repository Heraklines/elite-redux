/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { GameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import {
  areShowdownTournamentsEnabled,
  isShowdown1v1Enabled,
  SHOWDOWN_NETCODE_MODE,
  showdownTournamentLaunchConfig,
  TitlePhase,
} from "#phases/title-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getCoopLobbyStageTitle } from "#ui/coop-lobby-stage";
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
    expect(modeOptions).toContainEqual(expect.objectContaining({ semanticId: "showdown" }));
    expect(modeOptions).toContainEqual(expect.objectContaining({ semanticId: "showdown-tournaments" }));
    expect(modeOptions).not.toContainEqual(expect.objectContaining({ semanticId: "showdown-sync" }));
    expect(modeOptions).not.toContainEqual(expect.objectContaining({ semanticId: "co-op" }));
  });

  it("keeps tournaments visible but returns disabled clicks to the modes", async () => {
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
    const teamMenuSpy = vi.spyOn(testablePhase, "openShowdownTeamMenu").mockImplementation(() => {});
    const tournamentSpy = vi.spyOn(testablePhase, "openShowdownTournaments");
    await testablePhase.showOptions(-1);
    titleOptions.find(option => option.semanticId === "new-game")?.handler();

    const semanticId = "showdown-tournaments";
    const disabledOption = modeOptions.find(option => option.semanticId === semanticId);
    expect(disabledOption, "tournaments remain visible").toBeDefined();
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

  it("routes Showdown 1v1 to lockstep without a duplicate Sync entry", async () => {
    let titleOptions: OptionSelectItem[] = [];
    let modeOptions: OptionSelectItem[] = [];
    const scene = {
      gameData: { isUnlocked: vi.fn().mockReturnValue(true) },
      ui: {
        setMode: vi.fn((_mode, config?: OptionSelectConfig) => {
          if (config != null) {
            titleOptions = config.options;
          }
        }),
        showText: vi.fn((_message, _delay, callback?: () => void) => callback?.()),
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
    };
    const teamMenuSpy = vi.spyOn(testablePhase, "openShowdownTeamMenu").mockImplementation(() => {});
    await testablePhase.showOptions(-1);
    titleOptions.find(option => option.semanticId === "new-game")?.handler();

    const showdownOption = modeOptions.find(option => option.semanticId === "showdown");
    expect(showdownOption?.label).toBe(GameMode.getModeName(GameModes.SHOWDOWN));
    expect(modeOptions).not.toContainEqual(expect.objectContaining({ semanticId: "showdown-sync" }));
    showdownOption?.handler();
    expect(teamMenuSpy).toHaveBeenCalledWith(expect.any(Function), SHOWDOWN_NETCODE_MODE);
  });

  it("supports explicit URL overrides for testing and emergency shutdown", () => {
    expect(isShowdown1v1Enabled("")).toBe(true);
    expect(areShowdownTournamentsEnabled("")).toBe(false);
    expect(areShowdownTournamentsEnabled("", true)).toBe(true);
    expect(areShowdownTournamentsEnabled("?enableShowdownTournaments=0", true)).toBe(false);
    expect(isShowdown1v1Enabled("?enableShowdown1v1=0")).toBe(false);
    expect(areShowdownTournamentsEnabled("?enableShowdownTournaments=1")).toBe(true);
    expect(isShowdown1v1Enabled("?enableShowdown=0")).toBe(false);
    expect(areShowdownTournamentsEnabled("?enableShowdown=1")).toBe(true);
  });

  it("launches tournament matches through the same lockstep Showdown runtime", () => {
    expect(showdownTournamentLaunchConfig()).toEqual({
      netcodeMode: "lockstep",
      sessionKind: "versus",
      launchMode: GameModes.SHOWDOWN,
    });
  });

  it("labels versus lobbies as Showdown without changing co-op lobbies", () => {
    expect(getCoopLobbyStageTitle("coop")).toBe("CO-OP LOBBY");
    expect(getCoopLobbyStageTitle("showdown")).toBe("SHOWDOWN LOBBY");
  });
});
