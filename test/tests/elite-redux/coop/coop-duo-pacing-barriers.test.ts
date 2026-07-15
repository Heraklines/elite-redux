/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op RECIPROCAL PACING BARRIERS (#839). The missing reciprocal guard for the
// co-op advancement class: the FASTER player (incl. the interaction owner) can race arbitrarily
// ahead of the partner. The next-command barrier is a two-sided rendezvous at cmd:<wave>:<turn>:
// neither client opens its command UI until BOTH have reached the same command point with their
// mons materialized (the faint-replacement lock, the wave-12 "sync issue").
//
// The harness turn-drive plays the host's whole turn then replays on the guest (never concurrent
// command points), so this drives the barrier through the SAME production rendezvous instances the
// CommandPhase uses (getCoopRuntime().rendezvous, wired in coop-runtime.ts) over the real loopback,
// AND proves a real host CommandPhase invokes the barrier at its cmd point.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-pacing-barriers.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  forceItemRewards,
  installDuoLogCapture,
  reachQueuedRewardShop,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO pacing barriers (#839): reciprocal next-command rendezvous", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`pacing-barriers-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterAll(() => {
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
  });

  afterEach(() => {
    logs?.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  // ===========================================================================================
  // The LEADER (first to reach the command point) BLOCKS at the barrier until the FOLLOWER
  // arrives, then BOTH proceed - driven through the production rendezvous instances the two
  // runtimes carry (the exact objects CommandPhase.coopNextCommandBarrier awaits).
  // ===========================================================================================
  it("the leader BLOCKS at cmd:<wave>:<turn> until the follower arrives, then both proceed", async () => {
    setCoopRendezvousWaitMs(60_000); // generous: the follower arrives well within it (no timeout)
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const point = "cmd:1:3";
    // The HOST reaches its command point first (the leader): it arrives + AWAITs the partner.
    let hostCrossed = false;
    const hostBarrier = rig.hostRuntime.rendezvous.rendezvous(point).then(r => {
      hostCrossed = true;
      return r;
    });
    await drainLoopback();
    // The follower (guest) has NOT reached its command point yet, so the leader must still be BLOCKED
    // (pre-#839 the leader would race ahead here - a locked partner).
    expect(hostCrossed, "the leader is BLOCKED at the barrier while the follower has not arrived").toBe(false);
    expect(
      rig.hostRuntime.rendezvous.oldestNetworkWaitMs(),
      "the host is parked on a live barrier wait",
    ).toBeGreaterThanOrEqual(0);

    // The follower now reaches the SAME command point (its replacement is out / it is at command).
    rig.guestRuntime.rendezvous.arrive(point);
    await drainLoopback();
    const hr = await hostBarrier;
    expect(hostCrossed, "the leader proceeds once the follower arrived").toBe(true);
    expect(hr.timedOut, "both reached the barrier - no anti-hang timeout needed").toBe(false);

    logs.flush();
  }, 120_000);

  // ===========================================================================================
  // A forced local action (recharge / two-turn continuation) is still a REAL command boundary.
  // The production regression skipped the barrier because tryExecuteQueuedMove ran first: the guest
  // shipped MoveId.NONE and entered replay while the host stayed sealed waiting for its arrival.
  // ===========================================================================================
  it("an owned queued recharge crosses the command barrier before it auto-commits", async () => {
    setCoopRendezvousWaitMs(60_000);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const wave = rig.guestScene.currentBattle.waveIndex;
    const turn = rig.guestScene.currentBattle.turn;
    const point = `cmd:${wave}:${turn}`;
    await withClient(rig.hostCtx, () => {
      rig.hostRuntime.rendezvous.arrive(point);
    });
    await drainLoopback();

    const arriveSpy = vi.spyOn(rig.guestRuntime.rendezvous, "arrive");
    const broadcastSpy = vi.spyOn(rig.guestRuntime.battleSync, "broadcastLocalCommand");
    await withClient(rig.guestCtx, async () => {
      const owned = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      owned.summonData.moveQueue = [{ move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL }];
      rig.guestScene.currentBattle.turnCommands = {};
      new CommandPhase(COOP_GUEST_FIELD_INDEX).start();
      await Promise.resolve();
    });

    expect(
      arriveSpy.mock.calls.map(call => String(call[0])),
      "the forced-action owner still announced arrival at the reciprocal command point",
    ).toContain(point);
    expect(
      broadcastSpy.mock.calls.some(
        ([fieldIndex, sentTurn, command]) =>
          fieldIndex === COOP_GUEST_FIELD_INDEX
          && sentTurn === turn
          && command.command === Command.FIGHT
          && command.cursor === -1
          && command.moveId === MoveId.NONE,
      ),
      "the queued recharge committed only after the partner arrival was observed",
    ).toBe(true);

    logs.flush();
  }, 120_000);

  // ===========================================================================================
  // A real host CommandPhase INVOKES the next-command barrier at cmd:<wave>:<turn> (proves the
  // wiring in command-phase.ts is live). The guest pre-arrives so the host's barrier buffer-hits
  // (no block), then the host's real turn opens its command as usual.
  // ===========================================================================================
  it("a real host CommandPhase invokes the next-command barrier at its cmd point", async () => {
    setCoopRendezvousWaitMs(50);
    forceItemRewards(game.override, [{ name: "LURE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Spy the HOST runtime's rendezvous to capture the barrier point CommandPhase awaits.
    const rzSpy = vi.spyOn(rig.hostRuntime.rendezvous, "rendezvous");
    const arriveSpy = vi.spyOn(rig.hostRuntime.rendezvous, "arrive");

    // Play wave 1 to a win + guest replays + drive the (host-owned) reward shop, so the host crosses
    // into wave 2 and opens a co-op-gated CommandPhase (the wave-1 turn-1 command ran during
    // startBattle, BEFORE the runtime existed, so it is not gated - the barrier engages from wave 2).
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: true }));
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));

    await arriveGuestCommandBoundary(rig, 2);
    // Cross into wave 2's first CommandPhase - its start() invokes coopNextCommandBarrier(cmd:2:1).
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });
    expect(rig.hostScene.currentBattle.waveIndex, "host reached wave 2").toBe(2);
    await remirrorWave(rig);

    const barrierPoints = [...rzSpy.mock.calls, ...arriveSpy.mock.calls].map(c => String(c[0]));
    expect(
      barrierPoints.some(p => /^cmd:\d+:\d+$/.test(p)),
      `a real CommandPhase invoked the next-command barrier at a cmd point (saw: ${barrierPoints.join(", ")})`,
    ).toBe(true);

    logs.flush();
  }, 200_000);

  // ===========================================================================================
  // SHOP-PICK-COMMIT barrier: a real OWNER reward shop ARRIVES at shop:<wave>:<counter> and WAITS for
  // the partner before opening the pickable screen (the reciprocal reward-shop guard: pre-#839 the
  // owner could commit a pick while the watcher was still mid-replay of the previous fight).
  // ===========================================================================================
  it("a real owner reward shop arrives at the shop-pick-commit barrier and waits for the partner", async () => {
    setCoopRendezvousWaitMs(50); // fast anti-hang fallback (the harness drives owner-then-watcher, not concurrent)
    forceItemRewards(game.override, [{ name: "LURE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const arriveSpy = vi.spyOn(rig.hostRuntime.rendezvous, "arrive");
    const awaitSpy = vi.spyOn(rig.hostRuntime.rendezvous, "awaitPartner");

    // Play wave 1 to a win + guest replays -> the host reaches its (owner) reward shop at counter 0.
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    const counter = rig.hostRuntime.controller.interactionCounter();
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    // Driving the OWNER shop start() -> it arrives at shop:<wave>:<counter> + awaits the partner barrier.
    await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: true }));

    const shopPoint = `shop:1:${counter}`;
    const arrivedPoints = arriveSpy.mock.calls.map(c => String(c[0]));
    const awaitedPoints = awaitSpy.mock.calls.map(c => String(c[0]));
    expect(arrivedPoints, `the owner shop ARRIVED at ${shopPoint}`).toContain(shopPoint);
    expect(awaitedPoints, `the owner shop AWAITED the partner at ${shopPoint} before committing`).toContain(shopPoint);

    // The watcher then mirrors + the interaction still advances exactly once (barrier did not desync it).
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counter + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest lockstep with host").toBe(counter + 1);

    logs.flush();
  }, 200_000);
});
