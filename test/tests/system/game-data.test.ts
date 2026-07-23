import { pokerogueApi } from "#api/api";
import * as account from "#app/account";
import * as appConstants from "#constants/app-constants";
import { AbilityId } from "#enums/ability-id";
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
  });

  describe("local save account import", () => {
    beforeEach(async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
        {
          accountId: "1",
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
          accountId: "1",
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

    it("accepts a timed-out combined save only when exact cloud readback proves the commit", async () => {
      // GameManager's reload helper stubs saveAll; this test exercises the real persistence path.
      vi.mocked(game.scene.gameData.saveAll).mockRestore();
      const sessionData = { timestamp: Date.now(), gameMode: 0 } as SessionSaveData;
      const systemData = { timestamp: Date.now() } as SystemSaveData;
      vi.mocked(game.scene.gameData.getSessionSaveData).mockReturnValue(sessionData);
      vi.mocked(game.scene.gameData.getSystemSaveData).mockReturnValue(systemData);
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("Combined cloud save timed out.");
      vi.spyOn(pokerogueApi.savedata.system, "get").mockResolvedValue(JSON.stringify(systemData));
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        rawSavedata: JSON.stringify(sessionData),
      });

      const success = await game.scene.gameData.saveAll(true, true, false, false, true);

      expect(success).toBe(true);
      expect(game.scene.gameData.lastCloudSyncFailed).toBe(false);
      expect(pokerogueApi.savedata.system.get).toHaveBeenCalledOnce();
      expect(pokerogueApi.savedata.session.getCoopCas).toHaveBeenCalledOnce();
    });

    it("keeps the cloud warning when a timed-out save does not match cloud readback", async () => {
      vi.mocked(game.scene.gameData.saveAll).mockRestore();
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("Combined cloud save timed out.");
      vi.spyOn(pokerogueApi.savedata.system, "get").mockResolvedValue(JSON.stringify({ timestamp: 1 }));
      vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
        ok: true,
        status: 200,
        rawSavedata: JSON.stringify({ timestamp: 1 }),
      });

      const success = await game.scene.gameData.saveAll(true, true, false, false, true);

      expect(success).toBe(true);
      expect(game.scene.gameData.lastCloudSyncFailed).toBe(true);
    });
  });

  describe("initSystem - local session preservation (save-loss fix)", () => {
    beforeEach(async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
        { accountId: "1", username: "cloud", lastSessionSlot: -1, discordId: "", googleId: "", hasAdminRole: false },
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
