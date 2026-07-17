/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Production-shaped proof for the post-victory authority boundary. Trainer money and automatic modifier
// rewards used to land after BattleEnd had already retained DATA, leaving the guest behind until a harness
// heal hid the drift. This journey drives ten real waves, including trainer boundaries 5/8 and the x0
// reward/market/biome boundary, and inspects the exact retained evidence without invoking recovery.

import { initGlobalScene } from "#app/global-scene";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { BattleType } from "#enums/battle-type";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { installDuoLogCapture } from "#test/tools/coop-duo-harness";
import { prepareCoopSoakContent, runCoopSoak, SOAK_PROFILES } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op automatic post-victory retained seal", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let accuracySpy: MockInstance | undefined;
  let recoverySpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4_000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`automatic-victory-seal-${Date.now()}`);
    game.override
      .battleStyle("double")
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DOUBLE })
      .startingWave(1)
      .startingLevel(SOAK_PROFILES.god.startingLevel)
      .moveset([...SOAK_PROFILES.god.moveset])
      .startingHeldItems([...(SOAK_PROFILES.god.heldItems ?? [])])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    accuracySpy?.mockRestore();
    recoverySpy?.mockRestore();
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("seals trainer money, automatic modifiers and x0 state before continuation without heal/resync", async () => {
    const seed = 0xa07051;
    prepareCoopSoakContent(game, seed);
    await game.classicMode.startBattle(...SOAK_PROFILES.god.species);
    recoverySpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

    const result = await runCoopSoak(game, {
      seed,
      waves: 10,
      logs,
      profile: "god",
      fidelity: "production",
      rewardPolicy: "leave",
      capturePostWaveState: true,
    });

    expect(result.wavesCompleted, "the real journey crossed the wave-10 continuation").toBe(10);
    expect(result.runEnded, "the run did not terminal or degrade").toBeUndefined();
    expect(result.findings, "no state divergence survived a boundary").toEqual([]);
    expect(result.preHealMismatches, "no money/modifier mismatch was hidden by boundary recovery").toEqual([]);
    expect(result.resyncHeals, "the harness did not invoke its one-heal path").toBe(0);
    expect(result.assertions, "the production checksum never requested recovery").toBe(0);
    expect(recoverySpy, "the guest never requested full-state recovery").not.toHaveBeenCalled();
    expect(result.postWaveStates.map(state => state.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    for (const state of result.postWaveStates) {
      for (const [client, topology] of [
        ["host", state.preCommandTopology.host],
        ["guest", state.preCommandTopology.guest],
      ] as const) {
        expect(topology.doubleBattle, `wave ${state.wave}: ${client} retained the co-op double`).toBe(true);
        expect(topology.enemyFieldSize, `wave ${state.wave}: ${client} rendered an enemy field`).toBeGreaterThan(0);
        expect(topology.partyOwnersPresent.host, `wave ${state.wave}: ${client} retained the host party half`).toBe(
          true,
        );
        expect(topology.partyOwnersPresent.guest, `wave ${state.wave}: ${client} retained the guest party half`).toBe(
          true,
        );
        expect(
          topology.activeSlotOwners,
          `wave ${state.wave}: ${client} retained active host/guest lead seating`,
        ).toEqual(["host", "guest"]);
      }
    }

    for (const wave of [5, 8, 10]) {
      const state = result.postWaveStates.find(candidate => candidate.wave === wave);
      expect(state, `wave ${wave}: retained evidence exists`).toBeDefined();
      expect(state?.victoryKind, `wave ${wave}: the forced trainer boundary was preserved`).toBe("trainer");
      expect(state?.retainedWaveTransaction?.dataApplied, `wave ${wave}: exact DATA applied`).toBe(true);
      expect(state?.retainedWaveTransaction?.continuationReady, `wave ${wave}: continuation opened`).toBe(true);
      expect(state?.hostMoney, `wave ${wave}: trainer money is exact before continuation`).toBe(state?.guestMoney);
      expect(state?.hostPlayerModifiers, `wave ${wave}: automatic modifiers are exact before continuation`).toEqual(
        state?.guestPlayerModifiers,
      );
      expect(state?.resyncHeals, `wave ${wave}: no earlier boundary recovered`).toBe(0);
    }

    logs.flush();
  }, 600_000);
});
