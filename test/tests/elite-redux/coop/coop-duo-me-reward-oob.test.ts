/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE repro for #854 (live P0 "stuck after a mystery event"). A Town-Raffle-class ME's
// post-ME reward shop hands off to the GUEST's REAL watcher SelectModifierPhase (#821 settleForWatcherShop
// -> startCoopWatch), which replays the OWNER's relayed reward picks against its adopted option pool.
//
// THE BUG: the reward-channel inbox for the shop's seq held a STALE/superseded pick whose cursor was OUT
// OF RANGE of the watcher's (correctly adopted, small) option pool - the capture's `inbox[8]` carried a
// phantom `choice=4 data=[0]` while the adopted pool held 2 options. applyRelayedRewardAction fed that
// cursor to selectRewardModifierOption, which read `typeOptions[cursor].type` of undefined and threw
// (unhandledrejection). That crash killed the watcher shop phase FOREVER:
//   (a) the reward-cursor uiMirror never reached coopEndMirror, so it stayed OPEN and overlaid the
//       continuing game (symptom a: "the ME screen never dismisses"), and
//   (b) the watcher never consumed the owner's REAL terminal, so it stranded a wave behind while the
//       counter machinery marched on (symptom b: "the post-ME reward: the watcher is stuck").
//
// THE FIX (#854, select-modifier-phase.ts): the WATCHER treats an OUT-OF-RANGE relayed reward/shop cursor
// as a wire anomaly - it IGNORES it (returns non-terminal) and keeps waiting for the authoritative terminal
// (the owner's LEAVE), which the cosmetic mirror is subordinate to. So the watcher skips the phantom,
// applies the real LEAVE, closes its mirror, and advances in lockstep.
//
// The crash lives in SelectModifierPhase.startCoopWatch - the IDENTICAL path a post-ME embedded shop and a
// normal-wave reward shop both take (openGuestMeEmbeddedShop -> SelectModifierPhase). This repro drives that
// exact watcher over two REAL engines with the phantom faithfully buffered on the reward seq ahead of the
// owner's LEAVE (FIFO [phantom, LEAVE]), so the watcher buffer-hits the phantom first - exactly as live.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-reward-oob.test.ts --reporter=dot
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, getCoopUiMirror, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_REWARD_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
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
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveRewardShopOwnerLeaveViaUi,
  installDuoLogCapture,
  pumpDuoDestinations,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

function wireGuestCommand(rig: DuoRig): void {
  rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
    command: Command.FIGHT,
    cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
    moveId: MoveId.TACKLE,
    targets: [BattlerIndex.ENEMY_2],
  }));
}

async function playOneAuthoritativeWave(game: GameManager, rig: DuoRig): Promise<void> {
  const turn = rig.hostScene.currentBattle.turn;
  await withClient(rig.hostCtx, async () => {
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
    game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
    await game.phaseInterceptor.to("TurnEndPhase");
  });
  await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
}

describe.skipIf(!RUN)(
  "co-op DUO post-ME reward shop: an out-of-range relayed reward cursor never crashes the watcher (#854)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`me-reward-oob-${Date.now()}`);
      game.override
        .battleStyle("double")
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.TACKLE])
        .disableTrainerWaves();
    });

    afterEach(() => {
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: buildDuo()/buildGuestScene() steals globalScene via the guest ctor.
      // Restore the host GameManager scene so the NEXT ER_SCENARIO file's GameManager reuses a valid scene.
      initGlobalScene(game.scene);
    });

    it("WATCHER skips a STALE out-of-range relayed reward cursor, applies the owner's LEAVE, leaves in lockstep, mirror closed", async () => {
      // ===== Stand up the two-engine rig (host = sole authoritative engine, guest = renderer) over one
      // loopback pair. The reward interaction opens on counter 0 -> host owns (even), guest WATCHES. =====
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the reward shop opens on interaction counter 0 (host owns even -> guest watches)").toBe(0);
      const rewardSeq = COOP_REWARD_SEQ_BASE + counterBefore; // reward channel = base 0 + interaction counter

      // ===== Reach both REAL queued production shops. Detached phases are no longer a valid authority
      // fixture: their terminal callback correctly detects that they do not own the live phase boundary. =====
      await playOneAuthoritativeWave(game, rig);
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));

      // ===== FAULT INJECTION (the live #854 phantom): a stale reward-channel pick with an OUT-OF-RANGE
      // cursor sits buffered on the reward seq BEFORE the owner's real terminal. In the capture, inbox[8]
      // held a phantom `choice=4 data=[0]` when the post-ME shop watch armed (the adopted pool had 2
      // options). We use a deliberately huge cursor so it is out of range of ANY rolled pool. `data=[0]`
      // is [COOP_ACT_REWARD] - a free-reward pick, exactly the shape the capture carried. Sent FIRST so it
      // FIFO-precedes the owner's LEAVE on the reward seq: guest inbox[rewardSeq] = [phantom, LEAVE]. =====
      const OOB_CURSOR = 99;
      withClientSync(rig.hostCtx, () =>
        rig.hostRuntime.interactionRelay.sendInteractionChoice(rewardSeq, "reward", OOB_CURSOR, [0]),
      );
      await drainLoopback();

      // Production opens the reciprocal watcher before the owner can cross the retained terminal. Park the
      // guest now so the phantom remains first in its FIFO, then let the owner publish the real option pool
      // and LEAVE. This preserves the original #854 fault while exercising the continuation-ready barrier.
      await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));

      // ===== Host OWNS + drives the shop: rolls + STREAMS its options, then LEAVEs (no reward taken). The
      // LEAVE is relayed on the reward seq AFTER the phantom (FIFO). The owner remains parked until the
      // watcher materializes that terminal and returns the retained acknowledgement. =====
      await withClient(rig.hostCtx, () => driveRewardShopOwnerLeaveViaUi(hostShop));

      // ===== Guest WATCHES: startCoopWatch adopts the host's streamed options, then drains the relayed
      // picks. It BUFFER-HITs the phantom FIRST.
      //   PRE-FIX: applyRelayedRewardAction -> selectRewardModifierOption(99) reads typeOptions[99].type of
      //            undefined -> TypeError (unhandledrejection). The watcher never leaves nor advances, so
      //            driveGuestRewardWatch's no-progress detector THROWS (WATCH HANG) - fails-before.
      //   POST-FIX: the out-of-range cursor is IGNORED (kept waiting); the watcher then consumes the owner's
      //            LEAVE, ends its mirror, leaves, and advances once - passes-after. =====
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
      for (
        let attempt = 0;
        attempt < 16
        && (rig.hostRuntime.controller.interactionCounter() !== counterBefore + 1
          || rig.guestRuntime.controller.interactionCounter() !== counterBefore + 1);
        attempt++
      ) {
        await pumpDuoDestinations(rig);
      }

      // ===== PASSES-AFTER assertions. =====
      // (b) The watcher left cleanly and the counters are LOCKSTEP (both advanced exactly once).
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest advanced the interaction counter once (lockstep with host - watcher not stranded) (#854)",
      ).toBe(counterBefore + 1);
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host + guest counters lockstep after the post-ME reward shop",
      ).toBe(rig.guestRuntime.controller.interactionCounter());

      // (a) The reward-cursor uiMirror is CLOSED at the watcher's terminal (no lingering overlay on the
      //     continuing game - the crash used to skip coopEndMirror and leave the mirror open forever).
      const mirror = getCoopUiMirror();
      expect(
        mirror?.isActive(UiMode.MODIFIER_SELECT) ?? false,
        "reward-cursor uiMirror CLOSED at the watcher terminal (symptom a: no overlay leak) (#854)",
      ).toBe(false);

      logs.flush();
    }, 300_000);
  },
);
