import { getGameMode } from "#app/game-mode";
import { GameModes } from "#enums/game-modes";
import { describe, expect, it } from "vitest";

/**
 * Task B1 - the SHOWDOWN game mode.
 *
 * Engine-free: `getGameMode` just constructs a plain `GameMode` config object
 * (no `globalScene` / Phaser needed at construction time), so this suite does
 * not boot a `GameManager`.
 */
describe("showdown game mode", () => {
  it("appends SHOWDOWN after COOP without renumbering existing modes (persisted modeId invariant)", () => {
    // Enum ids are append-only (saved as `modeId`). Guard the invariant.
    expect(GameModes.COOP).toBe(6);
    expect(GameModes.SHOWDOWN).toBe(7);
  });

  it("constructs a showdown mode flagged isShowdown, not isCoop", () => {
    const mode = getGameMode(GameModes.SHOWDOWN);
    expect(mode.modeId).toBe(GameModes.SHOWDOWN);
    expect(mode.isShowdown).toBe(true);
    expect(mode.isCoop).toBeFalsy();
  });

  it("starts at level 100", () => {
    const mode = getGameMode(GameModes.SHOWDOWN);
    expect(mode.getStartingLevel()).toBe(100);
  });

  it("has no shop (single ephemeral 1v1, no economy)", () => {
    // `getShopStatus()` routes through the challenge pipeline (needs a scene);
    // assert the underlying config flag, which is what disables the shop.
    const mode = getGameMode(GameModes.SHOWDOWN);
    expect(mode.hasNoShop).toBe(true);
  });
});
