/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op FAULT-INJECTION (#633, Layer-A robustness). Proves the netcode property that LIVE
// WebRTC play depends on: CUE LOSS CANNOT DESYNC A CO-OP SESSION. A real WebRTC datachannel configured
// unordered/unreliable DROPs, REORDERs, and DELAYs frames; the co-op design marks the PRESENTATION cue
// class (`battleEvent` / `uiInput` / `meMessage` / `meCursor`) as the drop/reorder/delay-SAFE class (see
// the protocol comments in coop-transport.ts) because the AUTHORITATIVE per-turn checkpoint reconciles all
// state regardless of which cue was lost. This test wraps the loopback pair with a SEEDED faulting
// transport (test/tools/coop-fault-transport.ts) that injects all three fault classes on the live cue
// stream, drives several real battle waves through BOTH real engines, and asserts the guest CONVERGES to
// byte-identical checksum state despite the faults - vs a CONTROL run with faults OFF.
//
// The faults are seeded (mulberry32, never Math.random), so a failing run is REPLAYABLE bit-for-bit from
// the printed seed + profile. A REAL cue-loss desync the checkpoint/resync could not heal would fail the
// convergence assert here with the seed in the message - that would be a FINDING, not tolerated noise.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-fault.test.ts
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { captureCoopChecksum, captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  installDuoLogCapture,
  remirrorWave,
  type ShopPhaseSeam,
  setCoopHarnessLiveEvents,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import {
  COOP_NO_FAULT_PROFILE,
  type CoopFaultPair,
  type CoopFaultProfile,
  wrapCoopFaultPair,
} from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/**
 * The replay phases a guest turn drains PLUS the #782 instant-streaming CONTINUATION `CoopReplayTurnPhase`.
 * The shared {@linkcode driveGuestReplayTurn} intentionally OMITS the continuation from its drain set, so
 * when the host's live cue stream is split across arrivals (which fault injection makes the common case -
 * a dropped/delayed cue means the batch fills the rest LATER), the pump unshifts a continuation
 * CoopReplayTurnPhase and the shared driver returns BEFORE the finalize/checkpoint. In PRODUCTION the phase
 * pump auto-runs that continuation to the RESOLVE + CoopFinalizeTurnPhase; the manual harness driver does
 * not. So this file drives the continuation itself (a test-local enhanced driver - the shared harness is
 * untouched). This is EXACTLY the cue-loss heal we assert: the dropped live cues are batch-filled by the
 * unfaulted `turnResolution` (mergeLiveAndBatch) + the authoritative checkpoint.
 */
const REPLAY_PHASES_WITH_CONTINUATION = new Set([
  "MessagePhase",
  "CoopPartnerSyncPhase",
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
  "CoopGuestFaintSwitchPhase",
  "CoopReplayTurnPhase",
  "CoopFinalizeTurnPhase",
]);

/** Minimal phase-manager surface the enhanced replay driver needs (the guest scene satisfies it). */
interface ReplayPumpScene {
  phaseManager: { create: (n: "CoopReplayTurnPhase", t: number) => Phase; getCurrentPhase(): Phase };
}

/**
 * Drive the guest's full replay for `turn` INCLUDING the #782 continuation CoopReplayTurnPhase, so the turn
 * always reaches its CoopFinalizeTurnPhase (checkpoint apply) even when a faulted cue stream splits the
 * turn's events across live increments + the batch. MUST be called inside withClient(guestCtx). Throws on a
 * genuine no-progress stall (same phase OBJECT repeated) so a real desync/hang still surfaces loudly.
 */
async function driveGuestReplayFull(guestScene: ReplayPumpScene, turn: number): Promise<void> {
  const replay = guestScene.phaseManager.create("CoopReplayTurnPhase", turn);
  replay.start();
  await drainLoopback();
  let lastPhase: Phase | null = null;
  let stall = 0;
  for (let i = 0; i < 256; i++) {
    const cur = guestScene.phaseManager.getCurrentPhase();
    if (cur == null || !REPLAY_PHASES_WITH_CONTINUATION.has(cur.phaseName)) {
      return;
    }
    // Stall detection by phase IDENTITY (a re-entered continuation is a NEW object each increment, so a
    // real advance resets the counter; the same object stuck is a genuine hang).
    if (cur === lastPhase) {
      if (++stall > 24) {
        throw new Error(`guest replay HANG: stuck on ${cur.phaseName} - see dev-logs/coop-duo/`);
      }
    } else {
      stall = 0;
    }
    lastPhase = cur;
    const wasFinalize = cur.phaseName === "CoopFinalizeTurnPhase";
    cur.start();
    await drainLoopback();
    if (wasFinalize) {
      return;
    }
  }
}

/** The convergence metrics one run yields (asserted by the caller + printed for the coverage report). */
interface FaultRunResult {
  waves: number;
  /** Guest wave-start checksum == host, every wave. */
  waveStartMatches: number;
  /** Guest post-turn checksum == host, every wave (the byte-identical convergence proof). */
  postTurnMatches: number;
  /** Guest full-state (with move PP) JSON == host, every wave. */
  postTurnStateMatches: number;
  /** Guest requestStateSync count over the whole run (bounded => no resync storm). */
  resyncs: number;
  /** Faults injected across both directions (drop + reorder + delay). */
  faultsInjected: number;
}

describe.skipIf(!RUN)(
  "co-op DUO fault-injection: cue loss cannot desync (converges under drop/reorder/delay) (#633)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows proceed fast via the
      // gate's own timeout fallback instead of the 60s live default.
      setCoopWaveBarrierMs(50);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`fault-${Date.now()}`);
      // Turn ON the LIVE per-event stream so `battleEvent` cues actually flow over the transport (the wrapper
      // faults exactly those). Default OFF; restored in afterEach so it never leaks into other coop/ files.
      setCoopHarnessLiveEvents(true);
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
      setCoopHarnessLiveEvents(false);
      setCoopWaveBarrierMs(60_000);
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

    /** LEAVE the reward shop on both engines (no reward taken) + advance the interaction in lockstep. */
    async function leaveRewardShop(rig: DuoRig, w: number): Promise<void> {
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const hostOwns = counterBefore % 2 === 0;
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      expect(hostShop.phaseName, `wave ${w}: host reached SelectModifierPhase`).toBe("SelectModifierPhase");
      const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;
      if (hostOwns) {
        await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: false }));
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
      } else {
        await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: false }));
        await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
      }
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        `wave ${w}: guest advanced the interaction counter in lockstep with host`,
      ).toBe(rig.hostRuntime.controller.interactionCounter());
    }

    /**
     * Drive a full `WAVES`-wave co-op run through `faultPair` and assert CONVERGENCE every wave:
     *  - wave-start checksum parity (guest == host; the seed-pinned mirror),
     *  - the host plays the wave to a win + the guest replays through the (faulted) cue stream,
     *  - POST-TURN byte-identical checksum + full-state parity (the cue-loss-can't-desync proof),
     *  - interaction-counter lockstep across the reward shop.
     * Returns the run metrics. THROWS (via the harness stall detectors / the expects) on a real divergence.
     */
    async function driveFaultRun(faultPair: CoopFaultPair, WAVES: number): Promise<FaultRunResult> {
      const rig = await buildDuo(game, faultPair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Count the guest's auto-resyncs: a converged run under CUE-ONLY faults should force NONE (the
      // authoritative checkpoint is never faulted), so any storm is a real regression.
      const resyncSpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

      const result: FaultRunResult = {
        waves: WAVES,
        waveStartMatches: 0,
        postTurnMatches: 0,
        postTurnStateMatches: 0,
        resyncs: 0,
        faultsInjected: 0,
      };

      for (let w = 1; w <= WAVES; w++) {
        if (w > 1) {
          await remirrorWave(rig);
        }

        // (1) WAVE-START PARITY: the seed-pinned mirror makes the guest's full-state checksum equal the host's.
        const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
        const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
        expect(guestStart, `wave ${w}: guest wave-start checksum matches host`).toBe(hostStart);
        if (guestStart === hostStart) {
          result.waveStartMatches += 1;
        }

        // (2) Host plays the wave to a win (emits its turnResolution/checkpoint + streams LIVE cues, which the
        // faulting transport drops/reorders/delays); the guest replays through whatever cues survived.
        const turn = rig.hostScene.currentBattle.turn;
        await hostPlayWave(rig);
        await withClient(rig.guestCtx, async () => {
          await driveGuestReplayFull(rig.guestScene, turn);
        });
        expect(
          rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
          `wave ${w}: guest converged to the host-KOd state despite faulted cues`,
        ).toBe(true);

        // (3) POST-TURN BYTE-IDENTICAL CONVERGENCE (the cue-loss-can't-desync proof): the authoritative
        // per-turn checkpoint reconciled the full session state, so the two engines' normalized
        // getSessionSaveData DIGESTs (`saveDataDigest`, the Layer-C convergence comparator - PP-insensitive
        // by construction since `ppUsed` already lives in the save) are byte-identical, even though the LIVE
        // cue stream was heavily faulted. (We compare the save-data digest, NOT the raw checksum fingerprint,
        // because the fingerprint hashes the live moveset `ppUsed` which the pure-renderer guest lags under
        // the LIVE-EVENT consume path even with faults OFF - a live-events/PP quirk orthogonal to cue loss;
        // see the coverage report. The save digest is exactly the "byte-identical getSessionSaveData" the
        // netcode rewrite defines correctness as.)
        const hostPostState = await withClient(rig.hostCtx, () => captureCoopChecksumState());
        const guestPostState = await withClient(rig.guestCtx, () => captureCoopChecksumState());
        expect(
          guestPostState.saveDataDigest,
          `wave ${w}: guest post-turn getSessionSaveData digest is byte-identical to host (cue loss healed)`,
        ).toBe(hostPostState.saveDataDigest);
        if (guestPostState.saveDataDigest === hostPostState.saveDataDigest) {
          result.postTurnMatches += 1;
        }
        // STRONGER byte-identical proof: the ENTIRE checksum state (field hp/status/stat-stages/tags + per-move
        // ppUsed + party/money/balls/modifiers/biome/seed) is identical, not just the save digest. This holds
        // because the guest reaches CoopFinalizeTurnPhase (the checkpoint apply) via driveGuestReplayFull, and
        // the checkpoint carries every field the faulted cues would have animated.
        expect(
          JSON.stringify(guestPostState),
          `wave ${w}: guest post-turn FULL checksum state is byte-identical to host despite faulted cues`,
        ).toBe(JSON.stringify(hostPostState));
        if (JSON.stringify(guestPostState) === JSON.stringify(hostPostState)) {
          result.postTurnStateMatches += 1;
        }

        // (4) Reward shop: interaction alternation stays lockstep (counters advance together).
        await leaveRewardShop(rig, w);

        if (w < WAVES) {
          await withClient(rig.hostCtx, async () => {
            await game.phaseInterceptor.to("CommandPhase");
          });
          expect(rig.hostScene.currentBattle.waveIndex, `wave ${w}: host advanced to wave ${w + 1}`).toBe(w + 1);
        }
      }

      result.resyncs = resyncSpy.mock.calls.length;
      result.faultsInjected = faultPair.faultsInjected();
      resyncSpy.mockRestore();
      return result;
    }

    // ===========================================================================================
    // CONTROL: faults OFF. The exact same run through the wrapper with a NO-FAULT profile converges
    // byte-identically with zero injected faults and zero resyncs - the baseline the faults-ON run is
    // measured against.
    // ===========================================================================================
    it("CONTROL (faults OFF): a 3-wave run converges byte-identically with zero injected faults", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const faultPair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 1 });

      const res = await driveFaultRun(faultPair, 3);

      expect(res.waveStartMatches, "control: every wave-start checksum matched").toBe(res.waves);
      expect(res.postTurnMatches, "control: every post-turn getSessionSaveData digest matched").toBe(res.waves);
      expect(res.postTurnStateMatches, "control: every post-turn FULL checksum state matched").toBe(res.waves);
      expect(res.faultsInjected, "control: NO faults injected (no-fault profile)").toBe(0);
      expect(res.resyncs, "control: no resyncs (backbone + cues both intact)").toBe(0);
      // eslint-disable-next-line no-console
      console.log(`[coop-fault] CONTROL metrics: ${JSON.stringify(res)}`);
      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // FAULTS ON: a lossy-but-live cue stream. The seeded wrapper DROPs 35% / REORDERs 15% / DELAYs 10%
    // of the live cue messages (battleEvent / uiInput). The run must still converge byte-identically each
    // wave - the authoritative checkpoint heals every lost cue. Faults MUST actually have been injected
    // (>0) so the green is not vacuous, and resyncs stay BOUNDED (no storm).
    // ===========================================================================================
    it("FAULTS ON (drop 35% / reorder 15% / delay 10% of cues): converges byte-identically, bounded resyncs", async () => {
      const seed = 0xc0ffee;
      const profile: CoopFaultProfile = { drop: 0.35, reorder: 0.15, delay: 0.1, maxDelay: 4 };
      // eslint-disable-next-line no-console
      console.log(`[coop-fault] FAULTS-ON seed=${seed} profile=${JSON.stringify(profile)} (replay: same seed+profile)`);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const faultPair = wrapCoopFaultPair(createLoopbackPair(), profile, { seed });

      const res = await driveFaultRun(faultPair, 3);

      // The cue-loss-cannot-desync proof: byte-identical convergence EVERY wave despite the faults.
      expect(res.waveStartMatches, "faults-on: every wave-start checksum matched").toBe(res.waves);
      expect(
        res.postTurnMatches,
        "faults-on: every post-turn getSessionSaveData digest matched despite dropped/reordered/delayed cues",
      ).toBe(res.waves);
      expect(
        res.postTurnStateMatches,
        "faults-on: every post-turn FULL checksum state matched despite faulted cues",
      ).toBe(res.waves);
      // The faults were REAL (not a vacuous green): the wrapper dropped/reordered/delayed live cues.
      expect(
        res.faultsInjected,
        `faults-on: the wrapper actually injected faults (got ${res.faultsInjected})`,
      ).toBeGreaterThan(0);
      // BOUNDED PROGRESS: no resync storm (cue faults never touch the authoritative backbone, so a converged
      // run forces at most a handful; a per-turn storm would be a real regression).
      expect(res.resyncs, `faults-on: resyncs stayed bounded, no storm (got ${res.resyncs})`).toBeLessThanOrEqual(
        res.waves,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[coop-fault] FAULTS-ON metrics: ${JSON.stringify(res)} counters=${JSON.stringify(faultPair.counters)}`,
      );
      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // BURST then RECOVER: wave 1 suffers a near-total cue BLACKOUT (drop 90% + reorder/delay the rest),
    // then the channel RECOVERS (faults OFF) for the remaining waves. The guest must converge THROUGH the
    // burst (the checkpoint heals the blackout) and stay converged after recovery - the "a burst of cue
    // loss cannot leave a permanent desync" property, distinct from the steady lossy stream above.
    // ===========================================================================================
    it("BURST then RECOVER: a wave-1 cue blackout heals; the run stays converged after recovery", async () => {
      const seed = 0xbadbeef;
      const burst: CoopFaultProfile = { drop: 0.9, reorder: 0.05, delay: 0.05, maxDelay: 6 };
      // eslint-disable-next-line no-console
      console.log(`[coop-fault] BURST seed=${seed} burst=${JSON.stringify(burst)} then RECOVER (faults off)`);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const faultPair = wrapCoopFaultPair(createLoopbackPair(), burst, { seed });

      const rig = await buildDuo(game, faultPair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);
      const resyncSpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

      const WAVES = 3;
      let burstFaults = 0;
      for (let w = 1; w <= WAVES; w++) {
        if (w > 1) {
          await remirrorWave(rig);
        }
        // RECOVER after the wave-1 burst: flip both directions to the no-fault profile.
        if (w === 2) {
          burstFaults = faultPair.faultsInjected();
          faultPair.setProfile(COOP_NO_FAULT_PROFILE);
        }

        const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
        const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
        expect(guestStart, `burst wave ${w}: guest wave-start checksum matches host`).toBe(hostStart);

        const turn = rig.hostScene.currentBattle.turn;
        await hostPlayWave(rig);
        await withClient(rig.guestCtx, async () => {
          await driveGuestReplayFull(rig.guestScene, turn);
        });
        expect(
          rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted()),
          `burst wave ${w}: guest converged to the host-KOd state`,
        ).toBe(true);

        const hostPost = await withClient(rig.hostCtx, () => captureCoopChecksumState());
        const guestPost = await withClient(rig.guestCtx, () => captureCoopChecksumState());
        expect(
          guestPost.saveDataDigest,
          `burst wave ${w}: guest post-turn getSessionSaveData digest matches host (blackout healed / stays converged)`,
        ).toBe(hostPost.saveDataDigest);

        await leaveRewardShop(rig, w);
        if (w < WAVES) {
          await withClient(rig.hostCtx, async () => {
            await game.phaseInterceptor.to("CommandPhase");
          });
        }
      }

      // The wave-1 burst actually blacked out cues (proof the recovery test wasn't a no-op), and the run
      // still converged through it + after recovery with a bounded resync count.
      expect(burstFaults, `burst: the wave-1 blackout injected faults (got ${burstFaults})`).toBeGreaterThan(0);
      expect(
        resyncSpy.mock.calls.length,
        `burst: resyncs stayed bounded (got ${resyncSpy.mock.calls.length})`,
      ).toBeLessThanOrEqual(WAVES);
      // eslint-disable-next-line no-console
      console.log(
        `[coop-fault] BURST metrics: burstFaults=${burstFaults} resyncs=${resyncSpy.mock.calls.length} counters=${JSON.stringify(faultPair.counters)}`,
      );
      resyncSpy.mockRestore();
      logs.flush();
    }, 300_000);
  },
);
