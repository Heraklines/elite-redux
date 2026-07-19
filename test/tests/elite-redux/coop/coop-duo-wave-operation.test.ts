/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op POST-BATTLE WAVE-ADVANCE through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2f KEYSTONE; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §2.5 item 4,
// §8.7). One `it` per TRANSITION CLASS (wild win / trainer victory / biome boundary @10 / ME boundary /
// game-over), each proving the KEYSTONE contract over TWO REAL engines:
//
//   HOST states the complete transition  -> the committed WAVE_ADVANCE op's PAYLOAD (outcome, victoryKind,
//   nextLogicalPhase, biomeChange, meBoundary) is host-authoritative, built from the host's REAL resolving
//   battle context (battleType per #867, isNewBiome). The op is journaled over the REAL durability carrier.
//
//   GUEST adopts the SAME statement -> the journal carrier ROUTES the committed op into the guest's
//   live-mutation sink (the FIRST production sink), carrying the identical host-stated payload. This is the
//   two-engine proof that the guest constructs its tail FROM the op's statement, not a one-bit derivation.
//
// The battle OUTCOME is set at the host's real wave-end commit chokepoint (`broadcastCoopWaveResolved`, the
// exact production call site VictoryPhase / AttemptRunPhase / GameOverPhase use) rather than driven through a
// full battle to each outcome - the wave-advance SURFACE is under test here, not the engine's path to each
// outcome (that is the multiwave / soak suites' job). Both sides are REAL BattleScene engines over the
// loopback, and the commit -> journal -> guest-sink SEAM is fully real.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-wave-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopWaveAdvancePayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  awaitCoopSettledWaveAdvanceAtBattleEnd,
  broadcastCoopWaveEndState,
  broadcastCoopWaveResolved,
  clearCoopRuntime,
  coopRetainedGameOverSupersedesReplay,
  flushCoopWaveResolvedAfterTurnCommit,
  getCoopV2Shadow,
  getCoopWaveBoundaryStatus,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import * as waveOp from "#data/elite-redux/coop/coop-wave-operation";
import {
  markCoopWaveAdvanceContinuationReady,
  markCoopWaveAdvanceDataApplied,
  resetCoopWaveAdvanceOperationFlag,
  resetCoopWaveAdvanceOperationState,
  setCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { CoopFinalizeTurnPhase, CoopWaveAdvanceBoundaryPhase } from "#phases/coop-replay-phases";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { GameOverPhase } from "#phases/game-over-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, type DuoRig, drainLoopback, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO wave-advance via the operation primitive - per transition class (Wave-2f)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  /** The decoded V2 WAVE_ADVANCE payloads admitted by the guest replica. */
  let routed: CoopWaveAdvancePayload[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`wave-op-${Date.now()}`);
    setCoopWaveAdvanceOperationEnabled(true);
    resetCoopWaveAdvanceOperationState();
    resetCoopOperationJournalLog();
    setCoopDurabilityEnabled(true);
    routed = [];
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
    registerCoopOperationLiveSink("op:wave", null);
    resetCoopOperationJournalLog();
    resetCoopWaveAdvanceOperationFlag();
    resetCoopWaveAdvanceOperationState();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host scene for the NEXT ER_SCENARIO file's GameManager.
    initGlobalScene(game.scene);
    vi.restoreAllMocks();
  });

  afterAll(() => {
    // best-effort
  });

  /** Boot the host into a live battle + stand up the duo rig. */
  async function bootDuo(options: { preserveProductionWaveSink?: boolean } = {}): Promise<DuoRig> {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    expect(rig.hostRuntime.waveOperationBinding.opState).toBe(rig.hostRuntime.opState);
    expect(rig.hostRuntime.waveOperationBinding.durability).toBe(rig.hostRuntime.durability);
    expect(Object.isFrozen(rig.hostRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).toBe(rig.guestRuntime.opState);
    expect(rig.guestRuntime.waveOperationBinding.durability).toBe(rig.guestRuntime.durability);
    expect(Object.isFrozen(rig.guestRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).not.toBe(rig.hostRuntime.waveOperationBinding.opState);
    if (!options.preserveProductionWaveSink) {
      // Runtime assembly installs the receiver-bound production sink. Override it only after assembly for
      // boundary-seam recording tests; production materialization is selected explicitly by regressions
      // that need to execute the real retained-transition bootstrap.
      registerCoopOperationLiveSink("op:wave", env => {
        const payload = env.pendingOperation?.payload as CoopWaveAdvancePayload;
        routed.push(payload);
        markCoopWaveAdvanceDataApplied(payload.wave, rig.guestRuntime.waveOperationBinding);
        markCoopWaveAdvanceContinuationReady(payload.wave, rig.guestRuntime.waveOperationBinding);
        return true;
      });
    }
    return rig;
  }

  /**
   * Drive the host's REAL wave-end commit chokepoint under a chosen battle context, then pump the loopback
   * so the guest admits the ordered V2 entry. Returns the host-committed payload (the authority statement).
   */
  async function commitAndDeliver(
    rig: DuoRig,
    outcome: "win" | "capture" | "flee" | "gameOver",
    ctx: { battleType?: BattleType; waveIndex?: number },
  ): Promise<CoopWaveAdvancePayload | undefined> {
    const committedBefore = getCoopV2Shadow(rig.hostRuntime)?.diagnostics().committed ?? 0;
    let hostOperationId: string | undefined;
    let hostPayload: CoopWaveAdvancePayload | undefined;
    await withClient(rig.hostCtx, () => {
      if (ctx.battleType !== undefined) {
        rig.hostScene.currentBattle.battleType = ctx.battleType;
      }
      if (ctx.waveIndex !== undefined) {
        rig.hostScene.currentBattle.waveIndex = ctx.waveIndex;
      }
      broadcastCoopWaveResolved(outcome);
      if (outcome !== "gameOver") {
        broadcastCoopWaveEndState(outcome === "win" || outcome === "capture");
      }
      const status = getCoopWaveBoundaryStatus(ctx.waveIndex ?? rig.hostScene.currentBattle.waveIndex, rig.hostRuntime);
      expect(status?.authority, "the host boundary is owned by Authority V2").toBe("v2");
      expect(status?.entryRevision, "the V2 authority committed an ordered log revision").toBeGreaterThan(0);
      hostOperationId = status?.operationId;
      hostPayload = status?.transition;
    });
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().committed,
      "the host committed exactly one ordered V2 boundary",
    ).toBe(committedBefore + 1);
    // Pump delivery under the GUEST ctx so the decoded entry is admitted by that replica, never by
    // whichever process-global scene happened to commit it.
    await withClient(rig.guestCtx, () => {
      return drainLoopback().then(() => {
        const status = getCoopWaveBoundaryStatus(
          ctx.waveIndex ?? rig.guestScene.currentBattle.waveIndex,
          rig.guestRuntime,
        );
        expect(status?.authority, "the guest observed the decoded Authority V2 boundary").toBe("v2");
        expect(status?.operationId, "both replicas address the same immutable operation").toBe(hostOperationId);
        expect(status?.transition, "the guest admitted the host's exact transition statement").toEqual(hostPayload);
        if (status != null) {
          routed.push(status.transition);
        }
      });
    });
    return hostPayload;
  }

  it("still commits and routes the complete transaction when both raw wave carriers are dropped", async () => {
    const rig = await bootDuo();
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved").mockImplementation(() => {
      throw new Error("drop raw waveResolved");
    });
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveEndState").mockImplementation(() => {
      throw new Error("drop raw waveEndState");
    });

    const committed = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 2 });

    expect(committed?.settledStateTick, "the raw drop cannot suppress the retained state image").toBeGreaterThan(0);
    expect(
      routed.map(payload => payload.wave),
      "the guest advances from the envelope alone",
    ).toContain(2);
    logs.flush();
  }, 300_000);

  it("withholds the raw victory hint until the material final-turn commit boundary", async () => {
    const rig = await bootDuo();
    const raw = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");

    await withClient(rig.hostCtx, () => {
      rig.hostScene.currentBattle.waveIndex = 3;
      beginCoopRecording(rig.hostScene.currentBattle.turn);
      broadcastCoopWaveResolved("win");
      expect(raw, "Victory may stage its transition but cannot publish ahead of turn authority").not.toHaveBeenCalled();
      endCoopRecording();
      expect(flushCoopWaveResolvedAfterTurnCommit(3)).toBe(true);
    });

    expect(raw, "the compatibility hint publishes exactly once after successful turn retention").toHaveBeenCalledOnce();
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 1 - WILD WIN: VictoryPhase tail, NO trainer, next phase WAVE_VICTORY.
  // ===========================================================================================
  it("WILD win: the committed WAVE_ADVANCE states outcome=win victoryKind=wild next=WAVE_VICTORY, adopted by the guest", async () => {
    const rig = await bootDuo();
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 3 });

    expect(payload, "the host committed a WAVE_ADVANCE op").toBeDefined();
    expect(payload!.outcome).toBe("win");
    expect(payload!.victoryKind, "a WILD win states victoryKind=wild (no TrainerVictoryPhase)").toBe("wild");
    expect(payload!.nextLogicalPhase, "logicalPhase is host-authoritative for the transition").toBe("WAVE_VICTORY");
    expect(payload!.settledStateTick, "the committed destination is bound to the settled DATA tick").toBeGreaterThan(0);

    // Two-engine: the guest routed the SAME host-stated op into its live materializer.
    expect(routed.length, "the guest routed the committed op into its live-mutation sink").toBeGreaterThan(0);
    expect(routed.at(-1)!.outcome).toBe("win");
    expect(routed.at(-1)!.victoryKind).toBe("wild");
    // The op sanctions the wild-win boundary tails (NO TrainerVictoryPhase).
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).toContain("VictoryPhase");
    expect(tails).not.toContain("TrainerVictoryPhase");
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 2 - TRAINER VICTORY: VictoryPhase cascade PLUS TrainerVictoryPhase, next phase WAVE_VICTORY.
  // ===========================================================================================
  it("TRAINER victory: the committed WAVE_ADVANCE states victoryKind=trainer, sanctioning TrainerVictoryPhase", async () => {
    const rig = await bootDuo();
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.TRAINER, waveIndex: 5 });

    expect(payload!.outcome).toBe("win");
    expect(payload!.victoryKind, "a TRAINER win states victoryKind=trainer (#867 battleType verdict)").toBe("trainer");
    expect(payload!.nextLogicalPhase).toBe("WAVE_VICTORY");

    expect(routed.at(-1)!.victoryKind, "the guest received the trainer verdict").toBe("trainer");
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).toContain("VictoryPhase");
    expect(tails).toContain("TrainerVictoryPhase");
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 3 - BIOME BOUNDARY @ wave 10: the transition crosses a biome boundary; biomeChange is host-stated.
  // ===========================================================================================
  it("BIOME boundary @10: the committed WAVE_ADVANCE states biomeChange faithfully, and the guest receives the SAME verdict", async () => {
    const rig = await bootDuo();
    vi.spyOn(rig.hostScene, "isNewBiome").mockReturnValue(true);
    const guestDerive = vi.spyOn(rig.guestScene, "isNewBiome").mockReturnValue(false);
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 10 });

    // The host states its OWN biome verdict; assert the payload carries exactly what the host computed
    // (hasRandomBiomes || isNewBiome) at the wave-10 boundary - the host-authoritative biome-change bit.
    const hostVerdict = rig.hostScene.gameMode.hasRandomBiomes || rig.hostScene.isNewBiome();
    expect(payload!.biomeChange, "the payload carries the host's biome-boundary verdict at wave 10").toBe(hostVerdict);
    expect(routed.at(-1)!.biomeChange, "the guest received the SAME host-stated biome verdict").toBe(
      payload!.biomeChange,
    );
    expect(
      guestDerive,
      "the retained transaction never consulted the contradictory guest biome verdict",
    ).not.toHaveBeenCalled();
    if (payload!.biomeChange) {
      const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
      expect(tails, "WAVE_ADVANCE sanctions entry into the addressed choice boundary").toContain("SelectBiomePhase");
      expect(tails, "the later BIOME_PICK must authorize the concrete destination").not.toContain("SwitchBiomePhase");
      expect(tails).not.toContain("NewBiomeEncounterPhase");
    }
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 4 - ME BOUNDARY: a standard wave-advance states meBoundary="none". An ME-spawned battle victory
  // routes its OWN tail via the Wave-2c ME_TERMINAL op (queueCoopMeBattleVictoryTail), NOT WAVE_ADVANCE
  // (§8.7 residual) - so WAVE_ADVANCE must NEVER claim an ME boundary for an ordinary wave.
  // ===========================================================================================
  it("ME boundary: a standard wave-advance states meBoundary='none' (ME-battle victory stays on the Wave-2c op)", async () => {
    const rig = await bootDuo();
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 12 });

    expect(payload!.meBoundary, "a standard wave-advance never claims an ME boundary (that is the ME op's job)").toBe(
      "none",
    );
    expect(routed.at(-1)!.meBoundary).toBe("none");
    // The sanctioned tails for a non-ME win do NOT include the ME reward/battle companions.
    const tails = waveOp.coopWaveAdvanceSanctionedTails(payload!);
    expect(tails).not.toContain("MysteryEncounterRewardsPhase");
    expect(tails).not.toContain("MysteryEncounterBattlePhase");
    logs.flush();
  }, 300_000);

  it("ME BattleEnd never synthesizes a normal WAVE_ADVANCE when the ME transaction owns the terminal", async () => {
    const rig = await bootDuo();
    const commitSpy = vi.spyOn(waveOp, "commitWaveAdvanceOwnerIntent");
    vi.spyOn(rig.hostScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);

    await withClient(rig.hostCtx, () => broadcastCoopWaveEndState(true));
    await withClient(rig.guestCtx, () => drainLoopback());

    expect(
      commitSpy,
      "an ME-spawned battle has its own retained terminal and must not be reclassified as an ordinary win",
    ).not.toHaveBeenCalled();
    expect(routed).toEqual([]);

    const release = vi.fn();
    vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
    let heldByWaveTransaction = true;
    await withClient(rig.guestCtx, () => {
      heldByWaveTransaction = awaitCoopSettledWaveAdvanceAtBattleEnd(release);
    });
    expect(
      heldByWaveTransaction,
      "the guest ME BattleEnd remains owned by the retained ME terminal instead of waiting for WAVE_ADVANCE",
    ).toBe(false);
    expect(
      release,
      "the wave boundary did not steal or prematurely execute the ME continuation",
    ).not.toHaveBeenCalled();
    logs.flush();
  }, 300_000);

  it("retained ordinary BattleEnd ignores a speculative next-wave Mystery battle and skips local settlement", async () => {
    const rig = await bootDuo();
    // Keep DATA unresolved until the real BattleEnd boundary. This mirrors production and ensures the
    // phase constructor captures the exact wave-11 transaction instead of mutable ambient battle state.
    registerCoopOperationLiveSink("op:wave", envelope => {
      routed.push(envelope.pendingOperation?.payload as CoopWaveAdvancePayload);
      return true;
    });
    await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 11 });

    await withClient(rig.guestCtx, () => {
      const phase = new BattleEndPhase(true);
      // This fixture deliberately keeps the live sink unresolved so BattleEnd captures the durable
      // wave-11 identity before ambient state speculates ahead. Mark the already-delivered retained
      // image applied at that exact identity; otherwise the fixture would ask the guest applier to
      // rewind an unrelated, manually-mutated wave-12 scene and correctly enter shared recovery.
      markCoopWaveAdvanceDataApplied(11, rig.guestRuntime.waveOperationBinding);
      // The next battle has speculated ahead to an ME. The addressed retained source is still wave 11.
      rig.guestScene.currentBattle.waveIndex = 12;
      rig.guestScene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
      vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
      const addBattleScoreSpy = vi.spyOn(rig.guestScene.currentBattle, "addBattleScore");
      const clearEnemyHeldItemsSpy = vi.spyOn(rig.guestScene, "clearEnemyHeldItemModifiers");
      const rawPublisherSpy = vi.spyOn(rig.guestRuntime.battleStream, "sendWaveEndState");
      const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
      phase.start();

      expect(endSpy, "the exact retained wave-11 image releases BattleEnd").toHaveBeenCalledOnce();
      expect(addBattleScoreSpy, "the guest does not dual-run victory settlement").not.toHaveBeenCalled();
      expect(clearEnemyHeldItemsSpy, "the guest does not dual-run shared BattleEnd cleanup").not.toHaveBeenCalled();
      expect(rawPublisherSpy, "the guest does not fall back to the raw wave-end carrier").not.toHaveBeenCalled();
    });
    logs.flush();
  }, 300_000);

  it("retained ordinary Victory ignores speculative Mystery classification with no encounter payload", async () => {
    const rig = await bootDuo({ preserveProductionWaveSink: true });
    // The retained journal's production sink bootstraps only at its addressed source wave. Mirror that exact
    // pre-delivery boundary first, then let the renderer speculate to wave 12 after the immutable operation
    // has landed. Starting this fixture at the boot wave (1) would correctly reject a wave-11 transaction.
    rig.guestScene.currentBattle.waveIndex = 11;
    await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 11 });

    await withClient(rig.guestCtx, () => {
      rig.guestScene.currentBattle.waveIndex = 12;
      rig.guestScene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
      rig.guestScene.currentBattle.mysteryEncounter = undefined;
      vi.spyOn(rig.guestScene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
      const pushNewSpy = vi.spyOn(rig.guestScene.phaseManager, "pushNew");

      // Enter the actual production tail in its real order. The retained materializer first consumes the
      // operation and sanctions Victory/BattleEnd, then Victory creates the source-addressed BattleEnd.
      // Constructing BattleEnd before that consume is deliberately rejected by strict tails and would test
      // an impossible production order rather than the retained DATA-admission seam.
      rig.guestScene.phaseManager.clearPhaseQueue();
      expect(
        () => CoopFinalizeTurnPhase.runPendingWaveAdvanceTail(),
        "the retained operation must materialize without reading speculative Mystery state",
      ).not.toThrow();
      expect(
        pushNewSpy.mock.calls.find(call => call[0] === "VictoryPhase")?.slice(2),
        "the retained materializer queues the ordinary wave-11 Victory tail",
      ).toEqual([false, 11]);

      // PhaseInterceptor disables automatic starts. Shift into the manager-created Victory and start it
      // exactly once; its normal end() shifts to the sanctioned, source-addressed BattleEnd boundary.
      rig.guestScene.phaseManager.shiftPhase();
      const retainedVictory = rig.guestScene.phaseManager.getCurrentPhase();
      expect(retainedVictory.phaseName).toBe("VictoryPhase");
      retainedVictory.start();
      const retainedBoundary = rig.guestScene.phaseManager.getCurrentPhase();
      expect(retainedBoundary, "the exact production BattleEnd boundary is current").toBeInstanceOf(BattleEndPhase);
      expect(
        () => retainedBoundary.start(),
        "the real retained BattleEnd bootstrap must admit DATA without dereferencing wave-12 Mystery state",
      ).not.toThrow();
    });
    logs.flush();
  }, 300_000);

  it("FINAL VICTORY: retains Victory -> BattleEnd -> GameOver and suppresses the later duplicate terminal echo", async () => {
    const rig = await bootDuo();
    vi.spyOn(rig.hostScene.gameMode, "isWaveFinal").mockReturnValue(true);
    const payload = await commitAndDeliver(rig, "win", { battleType: BattleType.WILD, waveIndex: 200 });

    expect(payload?.nextWave, "a final victory cannot invent wave 201").toBe(200);
    expect(payload?.biomeChange).toBe(false);
    expect(payload?.eggLapse).toBe(false);
    expect(waveOp.coopWaveAdvanceSanctionedTails(payload!)).toEqual([
      "VictoryPhase",
      "BattleEndPhase",
      "CoopVictorySealPhase",
      "GameOverPhase",
    ]);

    const routedBeforeGameOverEcho = routed.length;
    await withClient(rig.hostCtx, () => broadcastCoopWaveResolved("gameOver"));
    await withClient(rig.guestCtx, () => drainLoopback());
    expect(
      routed,
      "GameOverPhase cannot commit a conflicting second WAVE_ADVANCE for the already-settled final win",
    ).toHaveLength(routedBeforeGameOverEcho);
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CLASS 5 - GAME OVER: the run ended; next phase GAME_OVER, next wave == wave (no advance), only GameOverPhase.
  // ===========================================================================================
  it("GAME OVER: the committed WAVE_ADVANCE states outcome=gameOver next=GAME_OVER, sanctioning only GameOverPhase", async () => {
    const rig = await bootDuo();
    const payload = await commitAndDeliver(rig, "gameOver", { battleType: BattleType.WILD, waveIndex: 7 });

    expect(payload!.outcome).toBe("gameOver");
    expect(payload!.nextLogicalPhase, "a lost run transitions to GAME_OVER").toBe("GAME_OVER");
    expect(payload!.nextWave, "game-over does NOT advance the wave").toBe(7);
    expect(payload!.victoryKind, "game-over has no victory kind").toBeUndefined();

    expect(routed.at(-1)!.outcome, "the guest received the game-over statement").toBe("gameOver");
    expect(waveOp.coopWaveAdvanceSanctionedTails(payload!), "game-over sanctions only GameOverPhase").toEqual([
      "GameOverPhase",
    ]);
    logs.flush();
  }, 300_000);

  it("GAME OVER: a retained terminal dissolves a phantom next-turn replay and both peers reach GameOver", async () => {
    const rig = await bootDuo({ preserveProductionWaveSink: true });
    const hostTerminal = new GameOverPhase(false);
    const hostTerminalHandler = vi.spyOn(hostTerminal, "handleGameOver").mockImplementation(() => {});
    const retainedBefore = getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained ?? 0;
    vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved").mockImplementation(() => {
      throw new Error("drop raw game-over carrier; retained WAVE_ADVANCE must recover");
    });

    await withClient(rig.guestCtx, async () => {
      rig.guestScene.currentBattle.waveIndex = 7;
      rig.guestScene.currentBattle.turn = 1;
      const replay = new CoopReplayTurnPhase(1);
      rig.guestScene.phaseManager.clearPhaseQueue();
      rig.guestScene.phaseManager.unshiftPhase(replay);
      rig.guestScene.phaseManager.shiftPhase();
      expect(rig.guestScene.phaseManager.getCurrentPhase()).toBe(replay);
      replay.start();
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(replay.isAwaitingAuthority(), "the guest has opened the phantom next-turn waiter").toBe(true);
      expect(
        replay.abortIfRetainedTerminalSuperseded(2, "a future terminal must not abort an earlier replay (test)"),
        "a terminal from a later settled turn cannot truncate this replay",
      ).toBe(false);
      expect(replay.isAwaitingAuthority()).toBe(true);
    });

    await withClient(rig.hostCtx, () => {
      rig.hostScene.currentBattle.waveIndex = 7;
      rig.hostScene.currentBattle.turn = 1;
      hostTerminal.start();
    });
    expect(hostTerminalHandler, "the authority opened its real GameOver continuation").toHaveBeenCalledOnce();
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained,
      "host V2 terminal remains retained until the guest opens its terminal",
    ).toBe(retainedBefore + 1);

    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      await new Promise(resolve => setTimeout(resolve, 10));
      const boundary = rig.guestScene.phaseManager.getCurrentPhase();
      expect(boundary, "the retained terminal unparks replay into the appended safe boundary").toBeInstanceOf(
        CoopWaveAdvanceBoundaryPhase,
      );
      expect(
        coopRetainedGameOverSupersedesReplay(7, 1),
        "the same-turn replay is terminal-superseded once ordered live events have drained",
      ).toBe(true);
      expect(coopRetainedGameOverSupersedesReplay(7, 2), "a queued phantom next turn is also superseded").toBe(true);
      expect(coopRetainedGameOverSupersedesReplay(6, 1), "a replay from another wave is unrelated").toBe(false);
      expect(coopRetainedGameOverSupersedesReplay(7, 0), "a replay before the settled turn is unrelated").toBe(false);
      boundary.start();
      const guestTerminal = rig.guestScene.phaseManager.getCurrentPhase();
      expect(guestTerminal, "terminal DATA application exposes the guest GameOver continuation").toBeInstanceOf(
        GameOverPhase,
      );
      vi.spyOn(guestTerminal as GameOverPhase, "handleGameOver").mockImplementation(() => {});
      guestTerminal.start();
      expect(
        getCoopWaveBoundaryStatus(7, rig.guestRuntime),
        "the guest terminal proves V2 DATA applied plus continuation ready",
      ).toMatchObject({ authority: "v2", dataApplied: true, continuationReady: true });
    });

    await withClient(rig.hostCtx, () => drainLoopback());
    expect(
      getCoopV2Shadow(rig.hostRuntime)?.diagnostics().retained,
      "the shared terminal proof releases retained V2 authority",
    ).toBe(retainedBefore);
    logs.flush();
  }, 300_000);
});
