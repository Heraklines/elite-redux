/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopNetcodeMode,
  isShowdownGuestFlip,
  isShowdownSyncSession,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  beginShowdownBattle,
  endShowdownBattle,
  getShowdownFieldOpponentManifest,
  getShowdownFieldOpponentName,
  getShowdownFieldOpponentProfile,
  getShowdownOpponentManifest,
  getShowdownOpponentProfile,
  getShowdownOwnManifest,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { type ShowdownUnlockGameData, starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import { localShowdownResult } from "#data/elite-redux/showdown/showdown-sync-command";
import {
  shouldAwaitShowdownLaunchSnapshot,
  showdownLaunchSides,
  showdownSyncBattleSeed,
} from "#data/elite-redux/showdown/showdown-sync-launch";
import type { Starter } from "#types/save-data";
import { afterEach, describe, expect, it } from "vitest";

describe("Showdown Sync mode routing", () => {
  afterEach(() => {
    endShowdownBattle();
    clearCoopRuntime();
  });

  const gameData: ShowdownUnlockGameData = { dexData: {}, starterData: {} };
  const manifest = (speciesId: number) =>
    starterToManifest(
      {
        speciesId,
        shiny: false,
        variant: 0,
        formIndex: 0,
        abilityIndex: 0,
        nature: 0,
        moveset: [1, 2, 3, 4],
        pokerus: false,
        ivs: [31, 31, 31, 31, 31, 31],
      } as Starter,
      gameData,
    );

  it("honors the explicitly selected lockstep mode without enabling authoritative ingress swapping", () => {
    const { guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { kind: "versus", netcodeMode: "lockstep" });

    setCoopRuntime(runtime);

    expect(runtime.controller.role).toBe("guest");
    expect(getCoopNetcodeMode()).toBe("lockstep");
    expect(isShowdownSyncSession()).toBe(true);
    expect(isShowdownGuestFlip()).toBe(false);
    expect(localShowdownResult(true)).toBe(true);
  });

  it("leaves authoritative Showdown's guest perspective flip unchanged", () => {
    const { guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { kind: "versus", netcodeMode: "authoritative" });

    setCoopRuntime(runtime);

    expect(getCoopNetcodeMode()).toBe("authoritative");
    expect(isShowdownSyncSession()).toBe(false);
    expect(isShowdownGuestFlip()).toBe(true);
    expect(localShowdownResult(true)).toBe(true);
  });

  it("boots only an authoritative guest from the host launch snapshot", () => {
    expect(shouldAwaitShowdownLaunchSnapshot("guest", "authoritative")).toBe(true);
    expect(shouldAwaitShowdownLaunchSnapshot("guest", "lockstep")).toBe(false);
    expect(shouldAwaitShowdownLaunchSnapshot("host", "authoritative")).toBe(false);
    expect(shouldAwaitShowdownLaunchSnapshot("host", "lockstep")).toBe(false);
  });

  it("gives both Sync engines their own player side and the same deterministic seed", () => {
    const host = [manifest(4)];
    const guest = [manifest(7)];

    expect(showdownLaunchSides("host", "lockstep", host, guest)).toEqual({
      playerManifest: host,
      enemyManifest: guest,
    });
    expect(showdownLaunchSides("guest", "lockstep", guest, host)).toEqual({
      playerManifest: guest,
      enemyManifest: host,
    });
    expect(showdownSyncBattleSeed("host", host, guest)).toBe(showdownSyncBattleSeed("guest", guest, host));
  });

  it("keeps the opponent team and trainer on the guest's enemy side", () => {
    const host = [manifest(4)];
    const guest = [manifest(7)];
    const hostProfile = { displayName: "Host" } as never;

    beginShowdownBattle(guest, host, null, hostProfile);

    expect(getShowdownOwnManifest()).toBe(guest);
    expect(getShowdownOpponentManifest()).toBe(host);
    expect(getShowdownOpponentProfile()).toBe(hostProfile);
    expect(getShowdownFieldOpponentManifest()).toBe(host);
    expect(getShowdownFieldOpponentProfile()).toBe(hostProfile);
    expect(getShowdownFieldOpponentName()).toBeNull();
  });
});
