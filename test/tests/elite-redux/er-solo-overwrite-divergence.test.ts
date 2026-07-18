/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P0 (deploy-14): "i cant create new games, i can only overwrite coop saves".
//
// Starting a new run over an OCCUPIED solo slot routes through
// GameData.deleteSession -> deleteSessionCloudSafely, which compares the decrypted
// LOCAL plaintext against the cloud plaintext and DEAD-ENDS on any divergence
// ("Local/cloud checkpoint bytes differ; refusing ambiguous delete."). After the
// deploy-13 broken build + rollback churn the two copies diverged for basically
// every tester, so every SOLO overwrite was refused and the new-run flow booted
// straight back to the title. Co-op slots take the commitment-keyed branch and
// were unaffected - hence the symptom inversion.
//
// The guard's protective intent (never silently destroy the newer of two diverged
// copies on an AUTOMATIC delete) is correct and stays. But when the user has
// EXPLICITLY confirmed destroying the slot (overwrite / delete-run) AND both sides
// are plain solo checkpoints, the divergence no longer matters - both copies are
// being discarded on purpose - so the delete must proceed instead of dead-ending.
// A co-op / legacy / opaque cloud side stays protected (frozen co-op scope).
// =============================================================================

import { pokerogueApi } from "#api/api";
import * as account from "#app/account";
import * as appConstants from "#constants/app-constants";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import { encrypt } from "#utils/data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** A structurally-solo session (gameMode 0 = CLASSIC, no co-op keys). */
function soloJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ gameMode: 0, waveIndex: 12, party: [], enemyParty: [], timestamp: 1, ...overrides });
}

type PrivateCloudDelete = {
  deleteSessionCloudSafely: (
    slot: number,
    localRaw: string | null,
    accountIdentity: string,
    explicitUserDeletion?: boolean,
  ) => Promise<{ error: string | null; deletedCoopRunId?: string }>;
};

describe("ER save-integrity: solo overwrite over a diverged local/cloud slot (P0)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame, false);
    game.override
      .moveset([MoveId.SPLASH])
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);

    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([
      {
        accountId: "cloud-id",
        username: "cloud",
        lastSessionSlot: -1,
        discordId: "",
        googleId: "",
        hasAdminRole: false,
      },
      200,
    ]);
    await account.updateUserInfo();
    // The account has been established, so account-changed guards inside deleteSession pass.
    vi.spyOn(account, "updateUserInfo").mockResolvedValue([true, 200]);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("proceeds and clears both copies when the user overwrites a solo slot whose bytes diverged", async () => {
    const localRaw = encrypt(soloJson({ timestamp: 111 }), false);
    const cloudRaw = soloJson({ timestamp: 222 }); // cloud plaintext differs from local
    localStorage.setItem("sessionData_cloud", localRaw);

    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
      ok: true,
      status: 200,
      rawSavedata: cloudRaw,
    });
    const deleteSpy = vi.spyOn(pokerogueApi.savedata.session, "delete").mockResolvedValue(null);

    const result = await game.scene.gameData.deleteSession(0, true);

    expect(result).toBe(true);
    // The cloud slot is cleared and the local replica is retired - the new run can now save here.
    expect(deleteSpy).toHaveBeenCalled();
    expect(localStorage.getItem("sessionData_cloud")).toBeNull();
  });

  it("still deletes a solo slot whose local and cloud bytes agree (unchanged happy path)", async () => {
    const json = soloJson({ timestamp: 333 });
    localStorage.setItem("sessionData_cloud", encrypt(json, false));

    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
      ok: true,
      status: 200,
      rawSavedata: json,
    });
    const deleteSpy = vi.spyOn(pokerogueApi.savedata.session, "delete").mockResolvedValue(null);

    const result = await game.scene.gameData.deleteSession(0, true);

    expect(result).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
    expect(localStorage.getItem("sessionData_cloud")).toBeNull();
  });

  it("still refuses an AUTOMATIC (non-explicit) delete when solo bytes diverge - guard intact", async () => {
    const localRaw = encrypt(soloJson({ timestamp: 111 }), false);
    const cloudRaw = soloJson({ timestamp: 222 });

    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
      ok: true,
      status: 200,
      rawSavedata: cloudRaw,
    });

    const gd = game.scene.gameData as unknown as PrivateCloudDelete;
    const nonExplicit = await gd.deleteSessionCloudSafely(0, localRaw, "cloud", false);

    expect(nonExplicit.error).toBe("Local/cloud checkpoint bytes differ; refusing ambiguous delete.");
  });

  it("keeps an OPAQUE cloud side protected even on an explicit delete (frozen co-op scope)", async () => {
    const localRaw = encrypt(soloJson({ timestamp: 111 }), false);
    const cloudRaw = "not-parseable-json {{{"; // opaque cloud checkpoint

    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
      ok: true,
      status: 200,
      rawSavedata: cloudRaw,
    });

    const gd = game.scene.gameData as unknown as PrivateCloudDelete;
    const explicit = await gd.deleteSessionCloudSafely(0, localRaw, "cloud", true);

    expect(explicit.error).toBe("Local/cloud checkpoint bytes differ; refusing ambiguous delete.");
  });

  it("sanity: a brand-new GameData with no local bytes and a missing cloud row deletes cleanly", async () => {
    vi.spyOn(pokerogueApi.savedata.session, "getCoopCas").mockResolvedValue({
      ok: false,
      status: 404,
      error: "not found",
      failureKind: "missing",
    });

    const gd = new GameData() as unknown as PrivateCloudDelete;
    const result = await gd.deleteSessionCloudSafely(0, null, "cloud", true);

    expect(result.error).toBeNull();
  });
});
