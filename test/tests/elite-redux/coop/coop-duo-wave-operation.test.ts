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
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
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
  /** The committed WAVE_ADVANCE payloads the GUEST routed into its live-mutation sink (the two-engine proxy). */
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
  async function bootDuo(): Promise<DuoRig> {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    expect(rig.hostRuntime.waveOperationBinding.opState).toBe(rig.hostRuntime.opState);
    expect(rig.hostRuntime.waveOperationBinding.durability).toBe(rig.hostRuntime.durability);
    expect(Object.isFrozen(rig.hostRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).toBe(rig.guestRuntime.opState);
    expect(rig.guestRuntime.waveOperationBinding.durability).toBe(rig.guestRuntime.durability);
    expect(Object.isFrozen(rig.guestRuntime.waveOperationBinding)).toBe(true);
    expect(rig.guestRuntime.waveOperationBinding.opState).not.toBe(rig.hostRuntime.waveOperationBinding.opState);
    // Runtime assembly installs the receiver-bound production sink. Override it only after assembly for
    // this boundary-seam recording test; production materialization is covered by the runtime/soak suites.
    registerCoopOperationLiveSink("op:wave", env => {
      const payload = env.pendingOperation?.payload as CoopWaveAdvancePayload;
      routed.push(payload);
      markCoopWaveAdvanceDataApplied(payload.wave, rig.guestRuntime.waveOperationBinding);
      markCoopWaveAdvanceContinuationReady(payload.wave, rig.guestRuntime.waveOperationBinding);
      return true;
    });
    return rig;
  }

  /**
   * Drive the host's REAL wave-end commit chokepoint under a chosen battle context, then pump the loopback
   * so the guest receives + routes the journaled op. Returns the host-committed payload (the op statement).
   */
  async function commitAndDeliver(
    rig: DuoRig,
    outcome: "win" | "capture" | "flee" | "gameOver",
    ctx: { battleType?: BattleType; waveIndex?: number },
  ): Promise<CoopWaveAdvancePayload | undefined> {
    const commitSpy = vi.spyOn(waveOp, "commitWaveAdvanceOwnerIntent");
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
    });
    expect(
      commitSpy.mock.calls.at(-1)?.[1],
      "the host commit retains against the host runtime even while a second engine exists",
    ).toBe(rig.hostRuntime.waveOperationBinding);
    // Pump delivery under the GUEST ctx so its durability manager + live sink run as the guest.
    await withClient(rig.guestCtx, () => drainLoopback());
    return commitSpy.mock.calls.at(-1)?.[0].payload;
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
});
