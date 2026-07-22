/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE WON-WAVE replacement pivot (Track R depth lane, campaign run 29654429335).
//
// Sibling of coop-duo-double-faint.test.ts (cycle-8's checkpoint-deferral regression) and
// coop-duo-barrier-deadlock.test.ts (the replay->command pivot). This locks the DEPTH-lane
// mechanism those two did not cover: a player field slot that faints AND refills on a turn the
// wave is WON (a mutual KO - every enemy faints the same turn).
//
// THE BUG (host + guest browser traces): the host still auto-summons the surviving-owner's
// replacement into its fainted slot and ships the (cycle-8 deferred, complete-field) out-of-band
// replacement checkpoint, THEN commits WAVE_ADVANCE(outcome=win). The guest, seeing its OWN slot
// refilled, took the mid-wave pivot and opened a CommandPhase for a wave that has NO next turn ->
// parked in UiMode.COMMAND forever ("guest host-liveness pending turn commit") awaiting a turn the
// host (already advanced) never resolves. The host's WAVE_ADVANCE op continuation deadline then
// expired: "[coop:runtime] shared session terminal requested: Durable operation recovery exhausted
// for op:global at N (blocked N+1, 0 attempts, continuation-timeout)."
//
// THE FIX (two parts, both exercised here):
//   1. coop-replay-turn-phase.ts: at the replacement->command pivot, detect the WON wave (the host's
//      just-applied authoritative frame has every enemy fainted) and DO NOT open a CommandPhase -
//      ack the replacement continuation and hold the replay park instead.
//   2. coop-runtime.ts: a retained WIN WAVE_ADVANCE (not only gameOver) dissolves that held replay
//      park, so it drains into the authoritative CoopWaveAdvanceBoundaryPhase / victory tail.
//
// RED before the fix: driveClientPhaseQueueTo stalls at the phantom CommandPhase (never reaches the
// victory tail) and the guest logs "opening own CommandPhase" on the won wave. GREEN after: the
// guest suppresses the command, the WIN unpark drains it into VictoryPhase, no continuation-timeout.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-won-wave-replacement.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  clearCoopRuntime,
  coopWaveAdvanceEndsWave,
  enterCoopV2CommandControlBoundary,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveRewardShopOwnerLeaveViaUi,
  installDuoLogCapture,
  type ShopPhaseSeam,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// The wave-2 command-open chokepoint only exists when the Authority V2 CONTROL cutover is active,
// which requires all four V2 surfaces enabled at process start (module-level flags, read at import).
// The gate lane B / the public journey build supply these; a bare ER_SCENARIO run skips that case.
const V2_CONTROL_ENABLED = ["TURN", "WAVE", "REPLACEMENT", "INTERACTION"].every(
  surface => process.env[`COOP_AUTHORITY_V2_${surface}`] === "on",
);

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO won-wave replacement: guest never opens a phantom CommandPhase for a slot refilled on a WON wave (Track R depth)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`won-wave-replacement-${Date.now()}`);
      // Bounded host faint-switch wait so a regression that stops the guest's pick surfaces fast.
      setCoopFaintSwitchWaitMs(4000);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // FRAIL enemies: the host lead's spread EARTHQUAKE KOs BOTH the same turn it KOs the 1-HP guest
        // ally -> the wave is WON on the exact turn the guest-owned field slot faints and refills.
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(3)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** The guest's TURN-1 own-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
    }

    it("suppresses the won-wave phantom command and drains the held replay into the wave-advance victory tail", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Guest-owned bench (LAPRAS + CHARIZARD), so the guest's faint has an own bench to replace from and
      // the host lead (SNORLAX, slot 0) is the sole host mon - it survives, so no host faint/auto-pick.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[2].coopOwner = "guest";
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 (host): SNORLAX EARTHQUAKE (spread) faints BOTH lv3 Magikarp AND the 1-HP guest Gengar the
      // same turn = a WON wave with a guest-owned faint. The guest slot's relayed SPLASH is moot.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      expect(
        rig.hostScene.getEnemyParty().every(e => e == null || e.isFainted()),
        "the wave is WON: EARTHQUAKE fainted the whole enemy party the same turn",
      ).toBe(true);
      const hostGuestSlot = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostGuestSlot == null || hostGuestSlot.isFainted(),
        "the guest-owned field slot was vacated by the faint on the host",
      ).toBe(true);

      // GUEST renders turn 1: the faint opens the guest's OWN picker (CoopGuestFaintSwitchPhase). Stub the
      // ONE PARTY open to pick CHARIZARD (slot 3); the relay send + seq keying stay fully real.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            const opened = realSetMode(...args);
            // Model a public keypress, not a callback injected before PARTY exists (mirrors the faithful
            // double-faint sibling). The phase attaches its actionability proof to this same completion
            // promise after setMode returns; nesting the pick one microtask later guarantees the real
            // handler is active and the exact V2 REPLACEMENT control is proven+installed before the pick.
            Promise.resolve(opened).then(
              () => {
                queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0));
              },
              () => undefined,
            );
            return opened;
          }
          if (args[0] === UiMode.MESSAGE) {
            return; // the picker's close transition - a no-op headlessly
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // HOST: summon the guest's pick into the fainted slot, push the out-of-band replacement checkpoint,
      // then WIN - run THROUGH BattleEndPhase (which commits + sends the retained WAVE_ADVANCE(win) op) and
      // stop at the post-battle reward shop. Stopping only at BattleEndPhase left the op uncommitted, so the
      // guest (which correctly ignores the raw waveResolved and awaits the retained transaction) never got it.
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("SelectModifierPhase", false);
        await drainLoopback();
      });
      expect(hostAdvance, "the host win crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "won-wave replacement host crossing");
      await withClient(rig.hostCtx, () => drainLoopback());
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostReplacement?.species.speciesId,
        "the HOST summoned the guest's replacement (CHARIZARD) before winning",
      ).toBe(SpeciesId.CHARIZARD);

      // GUEST: drive the turn-2 replay through the WON-WAVE replacement pivot. Pre-fix the guest opens a
      // phantom CommandPhase and STALLS (host-liveness pending turn commit -> continuation-timeout). Post-fix
      // it suppresses the command and the WIN unpark drains the held replay into the authoritative victory
      // tail - driveClientPhaseQueueTo reaches VictoryPhase / BattleEndPhase / the reward shop.
      await withClient(rig.guestCtx, async () => {
        rig.guestScene.currentBattle.turn = turn + 1;
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
        await driveClientPhaseQueueTo(rig.guestScene, "guest wave-advance victory tail", {
          matches: phase =>
            phase.phaseName === "VictoryPhase"
            || phase.phaseName === "BattleEndPhase"
            || phase.phaseName === "SelectModifierPhase",
          perPhaseTimeoutMs: 8_000,
        });
      });

      const allLogs = [...logs.host, ...logs.guest];
      // The exact defect: no phantom CommandPhase was opened for the refilled slot on the won wave.
      expect(
        allLogs.some(l => /replacement filled OUR slot .* -> opening own CommandPhase/.test(l)),
        "no phantom CommandPhase was opened for the refilled slot on the WON wave (the depth deadlock trigger)",
      ).toBe(false);
      // The guest took the won-wave suppression branch (positive proof the fix path ran).
      expect(
        allLogs.some(l => /on a WON wave .*-> ack continuation/.test(l)),
        "the guest took the won-wave replacement suppression path",
      ).toBe(true);
      // No durable-op continuation-timeout terminal (the host's WAVE_ADVANCE continuation ACKed).
      expect(
        allLogs.some(l => /continuation-timeout|Durable operation recovery exhausted/.test(l)),
        "no WAVE_ADVANCE op continuation-timeout terminal fired",
      ).toBe(false);
      // The guest is not parked in a phantom CommandPhase.
      const current = withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.getCurrentPhase()?.phaseName);
      expect(current, "the guest is NOT parked in a phantom CommandPhase on the won wave").not.toBe("CommandPhase");

      logs.flush();
    }, 240_000);

    // ---------------------------------------------------------------------------------------------
    // WAVE-2 LAUNCH (public journey run 29895009334 "Layer 4"). The `dissolved` backstop below stops the
    // doomed 1:2 phantom from PARKING, but dissolving alone is NOT a launch: it ends the phantom into a
    // queue that (on the won-by-faint variant) has NO wave-advance boundary queued - the guest's pending
    // WIN advance was never consumed - so Phaser re-manufactures TurnInit->Command->dissolve forever and
    // the guest's OWN wave-2 CommandPhase is never opened (the frontier stays WATCHER-only; rev-7 loops
    // "awaiting 1/1 local-seat real CommandPhase proofs"). The GREEN paths (host + coop-duo-multiwave)
    // launch wave 2 by running the wave-advance victory tail (VictoryPhase -> reward -> NewBattle ->
    // NextEncounter -> real wave-2 CommandPhase). This test drives the won-by-faint guest through the
    // reward LEAVE and asserts it CONSTRUCTS THAT SAME LAUNCH: it re-bases to wave 2 and opens its OWN
    // wave-2 command surface, exactly like multiwave's non-faint crossing.
    //
    // RED before the fix: driveClientPhaseQueueTo(guest, "CommandPhase") stalls - the guest never leaves
    // wave 1 (pending advance orphaned, dissolve loop). GREEN after: the guest re-bases to wave 2 and its
    // own CommandPhase opens.
    it.skipIf(!V2_CONTROL_ENABLED)(
      "constructs its own wave-2 launch after the won-by-faint reward LEAVE (opens its OWN wave-2 CommandPhase, not a WATCHER-only frontier)",
      async () => {
        await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
        const pair = createLoopbackPair();
        const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
        wireGuestCommand(rig);

        for (const scene of [rig.hostScene, rig.guestScene]) {
          scene.getPlayerParty()[2].coopOwner = "guest";
          scene.getPlayerParty()[3].coopOwner = "guest";
        }
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
        withClientSync(rig.guestCtx, () => {
          rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
        });

        const turn = rig.hostScene.currentBattle.turn;

        // TURN 1 (host): the spread EARTHQUAKE wins the wave the same turn the guest-owned slot faints.
        await withClient(rig.hostCtx, async () => {
          game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
          game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
          await game.phaseInterceptor.to("CoopTurnCommitPhase");
        });

        // GUEST renders turn 1: the faint opens the guest's OWN picker; pick CHARIZARD (slot 3).
        await withClient(rig.guestCtx, async () => {
          const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
          const realSetMode = ui.setMode.bind(ui);
          ui.setMode = (...args: unknown[]): unknown => {
            if (args[0] === UiMode.PARTY) {
              ui.setMode = realSetMode;
              const opened = realSetMode(...args);
              Promise.resolve(opened).then(
                () => {
                  queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0));
                },
                () => undefined,
              );
              return opened;
            }
            if (args[0] === UiMode.MESSAGE) {
              return;
            }
            return realSetMode(...args);
          };
          try {
            await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
          } finally {
            ui.setMode = realSetMode;
          }
        });

        // HOST: summon the replacement + WIN, crossing THROUGH BattleEnd into the reward shop.
        let hostAdvance: Promise<void> | undefined;
        await withClient(rig.hostCtx, async () => {
          hostAdvance = game.phaseInterceptor.to("SelectModifierPhase", false);
          await drainLoopback();
        });
        await settleDuoPromise(rig, hostAdvance!, "wave-2-launch won-wave host crossing");
        await withClient(rig.hostCtx, () => drainLoopback());
        const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the wave-1 reward shop").toBe("SelectModifierPhase");

        // GUEST: drive the replay through the WON-WAVE replacement pivot, THEN its OWN victory tail to the
        // reward shop. CRITICAL (Layer 4 fidelity): the replacement replay holds on the FAINT'S turn (turn 1),
        // while the host's won-wave WAVE_ADVANCE settled on turn 2 (the post-win turn cursor advanced). This
        // held-turn < settled-turn mismatch is exactly the live journey ordering (run 29895009334): the
        // bootstrap unpark refuses to dissolve a held replay whose turn is behind the settled turn, so the
        // boundary wake is stranded behind the parked replay. Driving on `turn` (not `turn + 1`) reproduces it.
        const guestShop = (await withClient(rig.guestCtx, async () => {
          await driveGuestReplayTurn(rig.guestScene, turn);
          return (await driveClientPhaseQueueTo(rig.guestScene, "SelectModifierPhase")) as unknown as ShopPhaseSeam;
        })) as ShopPhaseSeam;
        expect(guestShop.phaseName, "guest reached its OWN wave-1 reward shop via the victory tail").toBe(
          "SelectModifierPhase",
        );

        // Reward shop: host owns (even counter after the guest-owned faint interaction), skip-leave; guest
        // watches. This is the exact reward-LEAVE boundary the live guest crossed via a stall-resync.
        const counterBefore = rig.hostRuntime.controller.interactionCounter();
        expect(counterBefore % 2, "wave-1 reward is host-owned (even interaction counter)").toBe(0);
        const watcherPinned = await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
        expect(watcherPinned, "watcher parked on the owner's reward interaction").toBe(counterBefore);
        const ownerPinned = await withClient(rig.hostCtx, () => driveRewardShopOwnerLeaveViaUi(hostShop));
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
        await withClient(rig.hostCtx, () => drainLoopback());
        expect(ownerPinned, "the owner pinned the reward shop to the shared counter").toBe(counterBefore);
        expect(
          rig.guestRuntime.controller.interactionCounter(),
          "guest advanced the reward interaction counter once (lockstep)",
        ).toBe(counterBefore + 1);

        // HOST crosses into wave 2 (NewBattle -> NextEncounter rolls wave 2 + publishes the carrier).
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase", false);
        });
        expect(rig.hostScene.currentBattle.waveIndex, "host launched wave 2").toBe(2);

        // GUEST: the whole point. After the reward LEAVE it must run its OWN NewBattle -> NextEncounter ->
        // wave-2 CommandPhase, re-basing to wave 2 - NOT loop dissolving a stale wave-1 command.
        const guestCommand = await withClient(rig.guestCtx, () =>
          driveClientPhaseQueueTo(rig.guestScene, "CommandPhase"),
        );

        expect(rig.guestScene.currentBattle.waveIndex, "guest re-based to wave 2 (constructed its own launch)").toBe(2);
        expect(guestCommand.phaseName, "guest opened its OWN wave-2 command surface").toBe("CommandPhase");
        const allLogs = [...logs.host, ...logs.guest];
        expect(
          allLogs.some(l => /command-open dissolved: wave 2 is ending/.test(l)),
          "the genuine wave-2 command is NEVER dissolved (only the stale wave-1 phantom may be)",
        ).toBe(false);

        logs.flush();
      },
      240_000,
    );

    // ---------------------------------------------------------------------------------------------
    // WAVE-2 LAUNCH CHOKEPOINT (public journey run 29886905322). The waveWon fix above keeps the guest
    // on the replay path, but a SECOND source still deadlocked wave-2 launch live: a queue-empty
    // finalize can make Phaser MANUFACTURE a TurnInit -> CommandPhase for the OLD (already-won) wave
    // before the local battle re-bases to wave 2. As a replica that stale command parks on
    // v2DeferredCommandStarts at a wave-1-turn-2 address the wave-2 COMMAND_FRONTIER never equals ->
    // it never un-parks -> the wave-2 command proof is never recorded -> the deferred control
    // deadlocks into the "material could not be applied exactly" terminal. The fix backstops the
    // single chokepoint every stale-wave command funnels through (enterCoopV2CommandControlBoundary):
    // a command for an already-advance-signaled wave DISSOLVES instead of parking.
    //
    // Proxy: after the WIN is consumed (wave 1 signaled: lastResolvedWave >= 1) but BEFORE the battle
    // re-bases to wave 2 (waveIndex still 1), a command boundary for the guest slot must return
    // "dissolved" (pre-fix: "deferred" -> parks a doomed 1:2:* key).
    it.skipIf(!V2_CONTROL_ENABLED)(
      "dissolves a command-open for an already-advance-signaled wave instead of parking a doomed 1:2 phantom",
      async () => {
        await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
        const pair = createLoopbackPair();
        const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
        wireGuestCommand(rig);

        for (const scene of [rig.hostScene, rig.guestScene]) {
          scene.getPlayerParty()[2].coopOwner = "guest";
          scene.getPlayerParty()[3].coopOwner = "guest";
        }
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
        withClientSync(rig.guestCtx, () => {
          rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
        });

        const turn = rig.hostScene.currentBattle.turn;

        await withClient(rig.hostCtx, async () => {
          game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
          game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
          await game.phaseInterceptor.to("CoopTurnCommitPhase");
        });

        await withClient(rig.guestCtx, async () => {
          const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
          const realSetMode = ui.setMode.bind(ui);
          ui.setMode = (...args: unknown[]): unknown => {
            if (args[0] === UiMode.PARTY) {
              ui.setMode = realSetMode;
              const opened = realSetMode(...args);
              Promise.resolve(opened).then(
                () => {
                  queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0));
                },
                () => undefined,
              );
              return opened;
            }
            if (args[0] === UiMode.MESSAGE) {
              return;
            }
            return realSetMode(...args);
          };
          try {
            await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
          } finally {
            ui.setMode = realSetMode;
          }
        });

        let hostAdvance: Promise<void> | undefined;
        await withClient(rig.hostCtx, async () => {
          hostAdvance = game.phaseInterceptor.to("SelectModifierPhase", false);
          await drainLoopback();
        });
        await settleDuoPromise(rig, hostAdvance!, "chokepoint won-wave host crossing");
        await withClient(rig.hostCtx, () => drainLoopback());

        // Force the exact hazard window on the guest: the WIN wave-advance is ENDING wave 1 (pending
        // consumption on the WATCHER, or already signaled) while the battle has NOT yet re-based to
        // wave 2, then evaluate the command boundary for the guest's own slot.
        const verdict = await withClient(rig.guestCtx, async () => {
          await driveGuestReplayTurn(rig.guestScene, turn + 1).catch(() => undefined);
          rig.guestScene.currentBattle.waveIndex = 1;
          rig.guestScene.currentBattle.turn = turn + 1;
          expect(
            coopWaveAdvanceEndsWave(1),
            "wave 1 is ending on the guest (its WIN advance is pending for wave 1 or already signaled)",
          ).toBe(true);
          expect(coopWaveAdvanceEndsWave(2), "the genuine next wave (2) is NOT ending - never dissolved").toBe(false);
          const mon = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
          return enterCoopV2CommandControlBoundary(COOP_GUEST_FIELD_INDEX, mon.id, () => undefined);
        });

        expect(
          verdict,
          "a command-open for an already-advance-signaled wave dissolves (never parks a doomed 1:2 phantom)",
        ).toBe("dissolved");

        logs.flush();
      },
      240_000,
    );
  },
);
