/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op GHOST-STATE isolation + sync (#633 bounded-scope #2). The duo harness used to be UNSAFE
// for ghost-bearing MEs (colosseum-gauntlet, graves-of-the-fallen) and ghost WAVES for two reasons, both now
// closed:
//   A. The er-ghost per-run cache quartet (prefetched pool + prefetchStarted + usedGhostIds + ghostByWave +
//      the lastGhostUploader cursor) was RESET per client (placeholder), NOT save/restored - so one engine's
//      ghost picks bled into the other. It is now SAVE+RESTORED per client via snapshotErGhostRunState /
//      restoreErGhostRunState, carried in ClientCtx.ghost across the swap.
//   B. The ghost co-op hooks (coopGhostFetchSuppressed / onGhostPoolPublished + the onGhostPool adopt) are
//      LAST-WRITE-WINS process-globals the guest owned for BOTH engines, so a host pump would find the
//      GUEST'S suppression predicate (wrongly suppressing the host's own fetch) + the guest's publisher
//      (never broadcasting). installCoopRuntimeGhostHooks now re-points them at the ACTIVE runtime's
//      role-gated closures on every swap.
//
// This proves all three:
//   1. PER-CLIENT CACHE SAVE/RESTORE: each engine retains its OWN ghost cache across its own pumps (the old
//      reset-placeholder would wipe it - this asserts the fix, not the placeholder).
//   2. ROLE-GATED SUPPRESSION: during a GUEST pump the guest suppresses its own server fetch (adopts the
//      host's pool); during a HOST pump it does NOT (the host is the authoritative fetcher).
//   3. HOST->GUEST POOL SYNC: the host broadcasts its pool over the REAL loopback and the guest ADOPTS it
//      verbatim, so both engines converge on the SAME pool (=> takeGhostForWave's seeded pick is identical).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-ghost-sync.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  type GhostTeamSnapshot,
  maybePrefetchGhostTeams,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
  snapshotErGhostRunState,
} from "#data/elite-redux/er-ghost-teams";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, drainLoopback, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** A minimal, pool-LEGAL ghost snapshot (not a banned/legendary-egg species). */
function makeGhost(id: string, species: number): GhostTeamSnapshot {
  return {
    id,
    trainerName: `Tester-${id}`,
    difficulty: "hell",
    waveReached: 100,
    isVictory: true,
    timestamp: 0,
    party: [
      {
        speciesId: species,
        formIndex: 0,
        abilityIndex: 0,
        ivs: [31, 31, 31, 31, 31, 31],
        nature: 0,
        level: 50,
        gender: -1,
        shiny: false,
        variant: 0,
        passive: false,
        moves: [],
      },
    ],
  };
}

const POOL_A = [makeGhost("A1", SpeciesId.SNORLAX), makeGhost("A2", SpeciesId.LAPRAS)];
const POOL_B = [makeGhost("B1", SpeciesId.GENGAR)];

describe.skipIf(!RUN)("co-op DUO ghost-state: per-client cache isolation + role-gated pool sync (#633)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`ghost-sync-${Date.now()}`);
    game.override.battleStyle("double").startingWave(1).startingLevel(50).disableTrainerWaves();
  });

  afterEach(() => {
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it("each engine keeps its own ghost cache; guest suppresses fetch; guest adopts the host's broadcast pool", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // ===== (1) PER-CLIENT CACHE SAVE/RESTORE. Give the HOST cache POOL_A and the GUEST cache POOL_B, then
    // re-enter each pump and assert each engine still sees ITS OWN pool (not the other's, not wiped). The
    // OLD reset-placeholder would have wiped both to null on every swap-in. =====
    await withClient(rig.hostCtx, () => {
      setPrefetchedGhostTeamsForTests(POOL_A);
    });
    await withClient(rig.guestCtx, () => {
      setPrefetchedGhostTeamsForTests(POOL_B);
    });
    const hostPoolAfter = await withClient(rig.hostCtx, () => snapshotErGhostRunState().prefetched);
    const guestPoolAfter = await withClient(rig.guestCtx, () => snapshotErGhostRunState().prefetched);
    expect(
      hostPoolAfter?.map(s => s.id),
      "host retained ITS OWN ghost cache across the swap",
    ).toEqual(["A1", "A2"]);
    expect(
      guestPoolAfter?.map(s => s.id),
      "guest retained ITS OWN ghost cache (not the host's, not wiped)",
    ).toEqual(["B1"]);

    // ===== (2) ROLE-GATED FETCH SUPPRESSION. During a GUEST pump the guest's coopGhostFetchSuppressed
    // predicate is live (role=guest -> true), so maybePrefetchGhostTeams marks prefetch STARTED without
    // fetching (it awaits the host's broadcast). During a HOST pump the host's predicate (role=host ->
    // false) is live, so it is NOT suppressed - and with no scheduled ghost wave near wave 1 it returns
    // early WITHOUT marking started. The OLD last-write-wins hook would have suppressed the HOST too. =====
    const guest = await withClient(rig.guestCtx, () => {
      resetErGhostRunState();
      maybePrefetchGhostTeams(1);
      const s = snapshotErGhostRunState();
      return { started: s.prefetchStarted, pool: s.prefetched };
    });
    expect(guest.started, "guest SUPPRESSED its own fetch (marked started, awaits the host's pool)").toBe(true);
    expect(guest.pool, "guest did NOT fetch a pool itself (it adopts the host's)").toBeNull();

    const hostStarted = await withClient(rig.hostCtx, () => {
      resetErGhostRunState();
      maybePrefetchGhostTeams(1);
      return snapshotErGhostRunState().prefetchStarted;
    });
    expect(hostStarted, "host was NOT suppressed (the authoritative fetcher; no ghost wave near wave 1)").toBe(false);

    // ===== (3) HOST -> GUEST POOL SYNC. Clean both caches, have the HOST broadcast POOL_A over the REAL
    // loopback (the exact wire send the host publisher makes), then DRAIN under the GUEST ctx so the guest's
    // role-gated onGhostPool handler ADOPTS it into the GUEST cache. Both engines converge on the same pool,
    // so takeGhostForWave's seeded pick is deterministic across the two clients (no ghost-trainer desync). =====
    await withClient(rig.hostCtx, () => resetErGhostRunState());
    await withClient(rig.guestCtx, () => resetErGhostRunState());
    // Loopback microtask-flush gotcha (#5): the host's send is ctx-INDEPENDENT (just host transport.send),
    // but the guest's onGhostPool RECEIVE (setCoopGhostPool) writes the PROCESS-GLOBAL ghost cache - so it
    // must fire while the GUEST ctx is active, or it lands in the wrong client's cache. Send + drain both
    // under the guest ctx so the delivery microtask resolves under the guest scene (writes the guest cache).
    const guestAdopted = await withClient(rig.guestCtx, async () => {
      rig.hostRuntime.battleStream.sendGhostPool(POOL_A);
      await drainLoopback();
      return snapshotErGhostRunState().prefetched;
    });
    expect(
      guestAdopted?.map(s => s.id),
      "guest adopted the host's broadcast pool verbatim (both engines converge => deterministic ghost pick)",
    ).toEqual(["A1", "A2"]);

    logs.flush();
  }, 240_000);
});
