import {
  isRetiredStandaloneEndlessSave,
  RETIRED_STANDALONE_ENDLESS_MESSAGE,
} from "#data/elite-redux/er-legacy-endless-save";
import { GameModes } from "#enums/game-modes";
import { GameData } from "#system/game-data";
import type { SessionSaveData } from "#types/save-data";
import { describe, expect, it, vi } from "vitest";

describe("retired standalone Endless saves", () => {
  it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])("identifies retired mode %s", gameMode => {
    expect(isRetiredStandaloneEndlessSave({ gameMode })).toBe(true);
  });

  it.each([GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.FUN])("does not identify supported mode %s", gameMode => {
    expect(isRetiredStandaloneEndlessSave({ gameMode })).toBe(false);
  });

  it("refuses a legacy standalone Endless save without initializing or deleting it", async () => {
    const gameData = Object.create(GameData.prototype) as GameData;
    const legacySave = { gameMode: GameModes.ENDLESS } as SessionSaveData;
    const getSession = vi.spyOn(gameData, "getSession").mockResolvedValue(legacySave);
    const initSessionFromData = vi.fn();
    Object.defineProperty(gameData, "initSessionFromData", { value: initSessionFromData });

    await expect(gameData.loadSession(2)).resolves.toBe(false);

    expect(getSession).toHaveBeenCalledWith(2);
    expect(initSessionFromData).not.toHaveBeenCalled();
    expect(gameData.consumeSessionLoadRefusalMessage()).toBe(RETIRED_STANDALONE_ENDLESS_MESSAGE);
    expect(gameData.consumeSessionLoadRefusalMessage()).toBeNull();
  });

  it("continues a current postgame Endless save because its underlying mode remains Classic", async () => {
    const gameData = Object.create(GameData.prototype) as GameData;
    const postgameEndlessSave = {
      gameMode: GameModes.CLASSIC,
      erEndlessState: { active: true },
    } as unknown as SessionSaveData;
    vi.spyOn(gameData, "getSession").mockResolvedValue(postgameEndlessSave);
    const initSessionFromData = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(gameData, "initSessionFromData", { value: initSessionFromData });

    await expect(gameData.loadSession(0)).resolves.toBe(true);

    expect(initSessionFromData).toHaveBeenCalledWith(postgameEndlessSave);
    expect(gameData.consumeSessionLoadRefusalMessage()).toBeNull();
  });
});
