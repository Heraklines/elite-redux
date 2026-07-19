import { pokerogueApi } from "#api/api";
import * as account from "#app/account";
import { getGameMode } from "#app/game-mode";
import * as appConstants from "#constants/app-constants";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import type { SessionSaveData, SystemSaveData } from "#types/save-data";
import { decrypt, encrypt } from "#utils/data";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("System - Game Data", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame, false);
    game.override
      .moveset([MoveId.SPLASH])
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  describe("tryClearSession", () => {
    beforeEach(() => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(account, "updateUserInfo").mockImplementation(async () => [true, 1]);
    });

    it("should return [true, true] if bypassLogin is true", async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(true);

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
    });

    it("should return [true, true] if successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: true,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [true, false] if not successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: false,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [false, false] session is out of date", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        error: "session out of date",
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([false, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("does not serialize a torn-down co-op runtime while deleting its finished run", async () => {
      game.scene.gameMode = getGameMode(GameModes.COOP);
      const serialize = vi.spyOn(game.scene.gameData, "getSessionSaveData").mockImplementation(() => {
        throw new Error("co-op identity/control plane already cleared");
      });
      const deleteCloud = vi
        .spyOn(
          game.scene.gameData as unknown as {
            deleteSessionCloudSafely: (
              slot: number,
              localRaw: string | null,
              accountIdentity: string,
            ) => Promise<{ error: string | null; deletedCoopRunId?: string }>;
          },
          "deleteSessionCloudSafely",
        )
        .mockResolvedValue({ error: null });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
      expect(deleteCloud).toHaveBeenCalledOnce();
      expect(serialize).not.toHaveBeenCalled();
    });
  });

  describe("local save account import", () => {
    beforeEach(async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
        {
          accountId: "er-account:cloud",
          username: "cloud",
          lastSessionSlot: -1,
          discordId: "",
          googleId: "",
          hasAdminRole: false,
        },
        200,
      ]);
      await account.updateUserInfo();
    });

    it("finds Guest system and session saves as one import bundle", () => {
      const system = JSON.stringify({ trainerId: 123, secretId: 456 });
      const session0 = JSON.stringify({ slot: 0, party: [], enemyParty: [], timestamp: 1 });
      const session1 = JSON.stringify({ slot: 1, party: [], enemyParty: [], timestamp: 2 });
      localStorage.setItem("data_Guest", encrypt(system, true));
      localStorage.setItem("sessionData_Guest", encrypt(session0, true));
      localStorage.setItem("sessionData1_Guest", encrypt(session1, true));
      localStorage.setItem("data_cloud", encrypt(JSON.stringify({ trainerId: 999 }), false));

      const bundle = game.scene.gameData.findImportableLocalSaveBundle();

      expect(bundle).toEqual({
        system,
        sessions: [
          { slot: 0, data: session0 },
          { slot: 1, data: session1 },
        ],
      });
    });

    it("imports local sessions into the account cache after uploading them", async () => {
      const system = JSON.stringify({ trainerId: 123, secretId: 456 });
      const session0 = JSON.stringify({ slot: 0, party: [], enemyParty: [], timestamp: 1 });
      const session2 = JSON.stringify({ slot: 2, party: [], enemyParty: [], timestamp: 2 });
      vi.spyOn(game.scene.gameData, "initSystem").mockResolvedValue(true);
      vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
      vi.spyOn(pokerogueApi.savedata.session, "update").mockResolvedValue("");

      const success = await game.scene.gameData.importLocalSaveBundle({
        system,
        sessions: [
          { slot: 0, data: session0 },
          { slot: 2, data: session2 },
        ],
      });

      expect(success).toBe(true);
      expect(pokerogueApi.savedata.session.update).toHaveBeenCalledTimes(2);
      expect(decrypt(localStorage.getItem("sessionData_cloud")!, false)).toBe(session0);
      expect(decrypt(localStorage.getItem("sessionData2_cloud")!, false)).toBe(session2);
      expect(account.loggedInUser?.lastSessionSlot).toBe(2);
    });
  });

  describe("cloud sync throttle", () => {
    beforeEach(async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
        {
          accountId: "er-account:cloud",
          username: "cloud",
          lastSessionSlot: -1,
          discordId: "",
          googleId: "",
          hasAdminRole: false,
        },
        200,
      ]);
      await account.updateUserInfo();
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({ timestamp: Date.now() } as SessionSaveData);
      vi.spyOn(game.scene.gameData, "getSystemSaveData").mockReturnValue({ timestamp: Date.now() } as SystemSaveData);
    });

    it("keeps non-sync checkpoints local-only", async () => {
      const verifySpy = vi.spyOn(game.scene.gameData, "verify");
      const updateAllSpy = vi.spyOn(pokerogueApi.savedata, "updateAll");

      const success = await game.scene.gameData.saveAll(true, false);

      expect(success).toBe(true);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(updateAllSpy).not.toHaveBeenCalled();
    });
  });

  describe("initSystem - local session preservation (save-loss fix)", () => {
    beforeEach(async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
        {
          accountId: "er-account:cloud",
          username: "cloud",
          lastSessionSlot: -1,
          discordId: "",
          googleId: "",
          hasAdminRole: false,
        },
        200,
      ]);
      await account.updateUserInfo();
    });

    it("keeps local session slots when the server system save is newer-or-equal (no clearLocalData wipe)", async () => {
      // initParsedSystem applies the system blob to the live scene; this test only
      // exercises the localStorage branch, so stub it (private -> typed cast, not `any`).
      vi.spyOn(
        game.scene.gameData as unknown as { initParsedSystem: (d: SystemSaveData) => void },
        "initParsedSystem",
      ).mockImplementation(() => {});

      const localSystem = JSON.stringify({ trainerId: 1, secretId: 2, timestamp: 100 });
      // Server timestamp >= local: the OLD code hit `else { clearLocalData() }` and
      // deleted every session slot. A not-yet-synced local run must now survive.
      const serverSystem = JSON.stringify({ trainerId: 1, secretId: 2, timestamp: 200 });
      const session0 = JSON.stringify({ slot: 0, party: [], enemyParty: [], timestamp: 999 });
      const session1 = JSON.stringify({ slot: 1, party: [], enemyParty: [], timestamp: 999 });
      localStorage.setItem("sessionData_cloud", encrypt(session0, false));
      localStorage.setItem("sessionData1_cloud", encrypt(session1, false));

      const ok = await game.scene.gameData.initSystem(serverSystem, localSystem);

      expect(ok).toBe(true);
      expect(localStorage.getItem("sessionData_cloud")).not.toBeNull();
      expect(localStorage.getItem("sessionData1_cloud")).not.toBeNull();
      expect(decrypt(localStorage.getItem("sessionData_cloud")!, false)).toBe(session0);
    });
  });
});
