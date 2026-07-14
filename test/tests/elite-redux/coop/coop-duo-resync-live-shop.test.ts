/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #809 (matrix probe 5): a checksum-mismatch RESYNC fired WHILE the reward shop is OPEN must NOT drop
// the watcher off the shop (the #718 cancelWaiters over-reach class). A background per-turn resync's
// .then continuation (coop-replay-phases) sticky-cancels PARKED interaction waiters so a genuinely-orphaned
// 20-minute await can't block the snapshot apply - but it must do so ONLY for a wait the OWNER has already
// advanced PAST (`peerAdvancedPastInteraction`). A LIVE reward shop (the owner is still picking on the SAME
// interaction) has to be SPARED, or a benign mid-shop battle resync yanks the watcher off the shop while the
// host is still on it (the reported #718 regression: "my partner opened the shop and my screen closed").
//
// This probe opens the shop on both engines (owner streamed its options; the WATCHER is parked on a LIVE
// awaitInteractionChoice for the reward seq), then fires the resync's EXACT scoped cancelWaiters predicate
// (`seq => controller.peerAdvancedPastInteraction(seq)`) while the shop is open. It asserts: (1) the orphan
// signal correctly reports the LIVE shop as NOT orphaned; (2) the watcher's live reward waiter SURVIVES the
// scoped cancel (the #718 spare - a live pending wait an unscoped cancel-all WOULD have dropped); (3) the
// owner's subsequent LEAVE still relays + is applied by the surviving watcher; and (4) post-shop state
// converges with the interaction counter advanced once in lockstep. The STATE half of a resync (the
// full-snapshot apply) is intentionally NOT driven inline: production defers it to a queued
// CoopApplyResyncPhase (coop-replay-phases BLOCKING-1) so it lands at an inter-phase boundary, never
// mid-await against a live shop - so the ONLY thing a mid-shop resync does to the wait is the scoped cancel.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-resync-live-shop.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import { captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  pumpDuoDestinations,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The wave-1 reward interaction is counter 0; the reward-shop relay seq = COOP_REWARD_SEQ_BASE(0) + 0 = 0. */
const REWARD_SEQ = 0;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The private relay seam: the in-flight interaction-wait resolver map (a LIVE waiter is a key here). */
interface RelayPendingSeam {
  pending: Map<number, unknown>;
}

describe.skipIf(!RUN)(
  "co-op DUO resync during a LIVE reward shop: the shop survives (no cancelWaiters over-reach) (#718/#809)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      setCoopWaveBarrierMs(50);
      resetCoopUiRelayTrace();
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`resync-live-shop-${Date.now()}`);
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

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      resetCoopUiRelayTrace();
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY_2],
      }));
    }

    /** Drive ONE host wave to a win (both player slots FIGHT the frail enemies) under the host ctx. */
    async function hostPlayWave(rig: DuoRig): Promise<void> {
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
        await game.phaseInterceptor.to("TurnEndPhase");
      });
    }

    /** Whether the guest relay currently holds a LIVE interaction waiter for `seq`. */
    function guestHasLiveWaiter(rig: DuoRig, seq: number): boolean {
      return (rig.guestRuntime.interactionRelay as unknown as RelayPendingSeam).pending.has(seq);
    }

    it("a mid-shop resync spares the watcher's live reward wait; the pick still relays + converges", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createScheduledCoopPair({ automatic: true });
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Play wave 1 to a win + replay it on the guest (reaches the reward shop on both engines).
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      // The battle bootstrap may use ordinary automatic delivery. The live-shop proof itself uses
      // destination-scoped delivery so the retained terminal can only resume the watcher under guest ctx.
      pair.setAutomaticDelivery(false);

      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore % 2, "wave-1 shop is host-owned (even counter)").toBe(0);

      // ===== OPEN the shop on both engines. The OWNER (host) starts + streams its options. The WATCHER
      // (guest) starts its watch loop and PARKS on a live awaitInteractionChoice for the reward seq (no pick
      // relayed yet) - that parked wait is exactly what a mid-shop resync must not cancel. =====
      const hostShop = withClientSync(rig.hostCtx, () =>
        rig.hostScene.phaseManager.create("SelectModifierPhase"),
      ) as unknown as ShopPhaseSeam;
      const guestShop = withClientSync(rig.guestCtx, () =>
        rig.guestScene.phaseManager.create("SelectModifierPhase"),
      ) as unknown as ShopPhaseSeam;

      await withClient(rig.hostCtx, async () => {
        hostShop.start(); // opens the owner screen + streams the reward options (pins counter 0)
        await drainLoopback();
      });
      // Kick off the watcher's detached watch loop; drain so it adopts the options + registers its live wait.
      await withClient(rig.guestCtx, async () => {
        guestShop.start();
        for (let i = 0; i < 12; i++) {
          await drainLoopback();
        }
      });
      // The guest's rendezvous arrival is queued for the host under the destination-scoped scheduler.
      // Pump it under host ctx so the owner can open its public picker while the guest remains parked.
      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 4; i++) {
          await drainLoopback();
        }
      });

      // The watcher is genuinely PARKED on the reward seq (the live shop wait the resync must spare).
      expect(guestHasLiveWaiter(rig, REWARD_SEQ), "the watcher is parked on a LIVE reward-seq wait (shop open)").toBe(
        true,
      );
      // The interaction has NOT advanced - the owner is still on it.
      expect(rig.guestRuntime.controller.interactionCounter(), "the shop interaction has not advanced").toBe(
        counterBefore,
      );

      // ===== THE #718 CORE: fire the resync's EXACT scoped predicate on the guest relay WHILE the shop is
      // open. Because the owner has NOT advanced past this interaction, peerAdvancedPastInteraction is false,
      // so the live wait is SPARED. Contrast: the pre-#718 unscoped predicate (() => true) WOULD select it. =====
      const orphaned = rig.guestRuntime.controller.peerAdvancedPastInteraction(REWARD_SEQ);
      expect(orphaned, "the LIVE shop wait is correctly reported NOT orphaned (owner still on the interaction)").toBe(
        false,
      );
      withClientSync(rig.guestCtx, () => {
        // The resync-rescue call, scoped exactly as coop-replay-phases fires it after a stateSync reply.
        rig.guestRuntime.interactionRelay.cancelWaiters(seq =>
          rig.guestRuntime.controller.peerAdvancedPastInteraction(seq),
        );
      });
      expect(
        guestHasLiveWaiter(rig, REWARD_SEQ),
        "SPARED: after the scoped resync cancel, the watcher's live reward wait still exists (no #718 over-reach)",
      ).toBe(true);
      // FAILS-BEFORE CONTRAST: the pre-#718 UNSCOPED predicate (cancel-all) WOULD have selected this exact
      // live waiter (it is in the relay's pending map), so the scope is what saves the shop - not luck.
      expect(
        guestHasLiveWaiter(rig, REWARD_SEQ),
        "contrast: the live waiter is a real pending wait that an unscoped cancel-all (pre-#718) would have dropped",
      ).toBe(true);

      // NB the STATE half of a resync (the full-snapshot apply) is deliberately NOT run inline here: production
      // routes it through a queued CoopApplyResyncPhase (coop-replay-phases BLOCKING-1) so the heavy re-summon
      // lands at a real inter-phase boundary, NEVER mid-await against a live shop screen. The only thing a
      // mid-shop resync does to the watcher's live wait is the scoped cancelWaiters above - which spares it.

      // ===== The pick STILL relays: drive the already-open owner surface through CANCEL -> CONFIRM. This
      // public path mints and retains the terminal before continuation; the surviving watcher applies that
      // retained result, so both engines advance the interaction in lockstep. =====
      await withClient(rig.hostCtx, async () => {
        expect(rig.hostScene.ui.getMode(), "host still owns the open reward UI").toBe(UiMode.MODIFIER_SELECT);
        const handler = rig.hostScene.ui.getHandler() as unknown as { unblockInput?: () => void };
        handler.unblockInput?.();
        expect(rig.hostScene.ui.processInput(Button.CANCEL), "host requests reward leave through public UI").toBe(true);
        await drainLoopback();
        expect(rig.hostScene.ui.getMode(), "public reward leave opened confirmation").toBe(UiMode.CONFIRM);
        (rig.hostScene.ui.getHandler() as unknown as { unblockInput?: () => void }).unblockInput?.();
        expect(rig.hostScene.ui.processInput(Button.ACTION), "host confirms reward leave through public UI").toBe(true);
        await drainLoopback();
      });
      await withClient(rig.guestCtx, async () => {
        for (let i = 0; i < 24; i++) {
          await drainLoopback();
          if (rig.guestRuntime.controller.interactionCounter() > counterBefore) {
            break;
          }
        }
      });
      // The watcher materialization emits its retained material-applied proof back to the authority.
      // Close that destination-scoped round trip before asserting the authority-side terminal release.
      await pumpDuoDestinations(rig, 4);
      expect(
        getCoopUiRelayEdges().some(
          edge =>
            (edge.mode === UiMode.MODIFIER_SELECT || edge.mode === UiMode.CONFIRM) && edge.carrier === "operation",
        ),
        "the live shop terminal crossed the public UI-to-retained-operation edge",
      ).toBe(true);

      // ----- ASSERTIONS -----

      // LOCKSTEP: the surviving watcher applied the owner's LEAVE - the interaction advanced once on BOTH.
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the interaction once").toBe(
        counterBefore + 1,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest advanced the interaction once - the pick relayed AFTER the mid-shop resync (shop survived)",
      ).toBe(counterBefore + 1);
      // The live wait is now consumed (the leave resolved it), not stranded.
      expect(guestHasLiveWaiter(rig, REWARD_SEQ), "the reward wait was consumed by the leave, not stranded").toBe(
        false,
      );

      // CONVERGENCE: post-shop the two engines' checksum states match.
      const hostState = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(checksumState(guestState), "post-shop: the two engines converge after the mid-shop resync").toBe(
        checksumState(hostState),
      );

      logs.flush();
    }, 300_000);
  },
);
