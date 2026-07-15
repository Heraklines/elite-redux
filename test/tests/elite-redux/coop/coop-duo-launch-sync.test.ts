/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op LAUNCH-HANDSHAKE / seed-pin (#633 bounded-scope #1, #658). The duo harness used to
// MIRROR the guest battle (a PokemonData round-trip of the host's field) but SKIP the launch seed-pin, so
// the per-wave checksum's `seed` field diverged EVERY wave and the run self-healed via a benign
// `requestStateSync`. That masked REAL divergences behind a tolerated "up to 1 resync/wave" budget (see
// coop-duo-multiwave.test.ts, which asserts `resyncs <= WAVES`).
//
// mirrorHostBattleToGuest now runs adoptCoopHostRunConfig (the #658 launch pin - setSeed + host-authoritative
// money + ball inventory + player-wide persistent modifiers, adopted via the SAME reconcile the resync uses),
// so the guest's WAVE-START full-state checksum now EQUALS the host's EXACTLY (seed/money/balls/modifiers/
// field/party all pinned - previously the `seed` field alone diverged every wave). This file asserts that:
//   1. WAVE-START PARITY: after the seed-pinned mirror, the guest's full-state checksum EQUALS the host's,
//      wave by wave across a >=3-wave run. (The launch-handshake artifact is CLOSED.)
//   2. RESIDUAL ISOLATION (a REAL bug surfaced by the higher fidelity, NOT papered over): the ONLY per-turn
//      divergence that REMAINED was per-mon move PP (`ppUsed`) - now FIXED (the checkpoint
//      carries PP) and the pin below is flipped to assert full convergence. Historically: the
//      pure-renderer guest runs no MovePhase, so
//      it never decrements PP, and the per-turn CHECKPOINT reconciles hp/status/stat-stages/tags/weather/
//      terrain/arena-tags/MONEY but NOT moveset PP - so the guest's `ppUsed` lags the host's every turn a
//      move is used, and the checksum (readMoves hashes ppUsed) mismatches -> a full-state resync EVERY such
//      turn. This is the SAME "guest never runs the host-side mutation" class the checkpoint already fixes
//      for MONEY (coop-battle-engine.ts applyCoopCheckpoint), just not yet extended to PP. It is a genuine
//      host-vs-guest divergence, reported (not tolerated); this test PINS it precisely: strip move PP and the
//      two engines' post-turn states are byte-identical, and the ONLY difference is the host's higher ppUsed.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-launch-sync.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum, captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  awaitRewardShopPhaseExit,
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveRewardShopOwnerLeaveViaUi,
  installDuoLogCapture,
  installHeadlessPlayerAtlasCompletionModel,
  pumpDuoDestinations,
  reachQueuedRewardShop,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

type ChecksumState = ReturnType<typeof captureCoopChecksumState>;

/** A canonical JSON of a full checksum state with each field mon's `moves` (PP) REMOVED. */
function stateWithoutMovePp(state: ChecksumState): string {
  return JSON.stringify({
    ...state,
    field: state.field.map(m => {
      const { moves: _moves, ...rest } = m;
      return rest;
    }),
  });
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO launch-sync: seed-pinned mirror => wave-start parity (#633/#658)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows
    // (spoof / out-of-order duo drives never broadcast in time) proceed fast via the
    // gate's own timeout fallback instead of sitting through the 60s live default.
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`launch-sync-${Date.now()}`);
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
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Drive ONE host wave to a win after the guest submitted its own command through public UI. */
  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  /** LEAVE the reward shop on both engines (no reward taken -> modifiers stay pinned) + advance in lockstep. */
  async function leaveRewardShop(rig: DuoRig): Promise<void> {
    // A real browser cannot resume one client's async watcher while the other client's global scene is
    // installed. Queue the complete reward transaction by destination for this surface, then pump each
    // retained result/ACK leg under its owning ClientCtx. The legacy launch test keeps ordinary delivery
    // outside this boundary so its command-relay fixture remains intentionally narrow.
    rig.pair.setDestinationContextDelivery?.(true);
    try {
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const hostOwns = counterBefore % 2 === 0;
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
      const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
      if (hostOwns) {
        const watcherPinned = await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
        expect(watcherPinned, "guest watcher parked at the same interaction").toBe(counterBefore);
        await withClient(rig.hostCtx, () => driveRewardShopOwnerLeaveViaUi(hostShop));
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
        await withClient(rig.hostCtx, () => drainLoopback());
      } else {
        const watcherPinned = await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop));
        expect(watcherPinned, "host watcher parked at the same interaction").toBe(counterBefore);
        await withClient(rig.guestCtx, () => driveRewardShopOwnerLeaveViaUi(guestShop));
        await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
        // The host materializes the guest-owned retained result, then the guest owner receives the result
        // and emits its completed interaction counter back to the host. Pump both explicit loopback legs.
        await withClient(rig.guestCtx, () => drainLoopback());
        await withClient(rig.hostCtx, () => drainLoopback());
      }
      await pumpDuoDestinations(rig);
      await withClient(rig.hostCtx, () => awaitRewardShopPhaseExit(hostShop));
      await withClient(rig.guestCtx, () => awaitRewardShopPhaseExit(guestShop));
      expect(
        rig.hostScene.phaseManager.getCurrentPhase(),
        "host opened the continuation instead of remaining on a mechanically-complete reward phase",
      ).not.toBe(hostShop);
      expect(
        rig.guestScene.phaseManager.getCurrentPhase(),
        "guest opened the continuation instead of remaining on a mechanically-complete reward phase",
      ).not.toBe(guestShop);
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counterBefore + 1);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the counter once").toBe(
        counterBefore + 1,
      );
    } finally {
      rig.pair.setDestinationContextDelivery?.(false);
    }
  }

  it("seed-pinned mirror: per-wave WAVE-START checksum MATCHES; the ONLY residual is the move-PP bug", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    installHeadlessPlayerAtlasCompletionModel(rig.guestScene);
    // The directly constructed guest starts at TitlePhase. Align it to the same real TurnInit/Command
    // queue a second browser would own, then make every packet destination-context scheduled.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);

    const WAVES = 3;
    for (let w = 1; w <= WAVES; w++) {
      if (w > 1) {
        await remirrorWave(rig);
      }

      // (1) WAVE-START PARITY: the launch seed-pin (adoptCoopHostRunConfig) makes the guest's full-state
      // checksum EQUAL the host's at the wave-start boundary. Before the pin, the `seed` field diverged
      // every wave (the guest kept its own fresh-scene seed); now seed/money/balls/modifiers/field/party
      // all match, so this is an EXACT digest equality - the launch-handshake artifact is CLOSED.
      const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
      const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
      expect(guestStart, `wave ${w}: guest wave-start checksum matches host (seed-pinned launch handshake)`).toBe(
        hostStart,
      );

      // Host plays the wave to a win; the guest replays + applies the checkpoint.
      await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: w === 1 });
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      expect(
        rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
        `wave ${w}: guest converged to the host-KOd state`,
      ).toBe(true);

      // (2) FULL CONVERGENCE - including move PP. This block originally PINNED the surfaced
      // move-PP desync (the per-turn checkpoint carried money but not ppUsed, so the
      // pure-renderer guest's PP lagged every turn). The netcode rewrite carries PP now, so
      // the pin is FLIPPED: the two engines' post-turn checksum states must be
      // BYTE-IDENTICAL with NOTHING stripped - hp/status/stat-stages/tags/field/party/
      // money/balls/seed/biome AND per-move ppUsed. A regression of the PP carry fails here.
      const hostPost = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestPost = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(stateWithoutMovePp(guestPost), `wave ${w}: post-turn states are identical once move PP is stripped`).toBe(
        stateWithoutMovePp(hostPost),
      );
      const hostPpUsed = hostPost.field.flatMap(m => m.moves.map(([, ppUsed]) => ppUsed));
      const guestPpUsed = guestPost.field.flatMap(m => m.moves.map(([, ppUsed]) => ppUsed));
      expect(
        guestPpUsed,
        `wave ${w}: the guest's per-move ppUsed matches the host's (the old PP-desync pin, flipped after the fix)`,
      ).toEqual(hostPpUsed);

      await leaveRewardShop(rig);

      if (w < WAVES) {
        await arriveGuestCommandBoundary(rig, w + 1);
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase");
        });
        expect(rig.hostScene.currentBattle.waveIndex, `wave ${w}: host advanced to wave ${w + 1}`).toBe(w + 1);
      }
    }
    logs.flush();
  }, 300_000);
});
