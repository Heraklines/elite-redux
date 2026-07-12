/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, getCoopBattleStreamer, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import { CoopApplyResyncPhase } from "#phases/coop-replay-phases";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function state(tick: number): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick,
    wave: 4,
    turn: 2,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

const checkpoint = (tick: number): CoopBattleCheckpoint => ({
  tick,
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

const fullField = (): CoopFullMonSnapshot[] => [
  {
    bi: 1,
    partyIndex: 1,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

describe("held resync checkpoint wake (live wave-4 faint transition)", () => {
  let priorScene: BattleScene;
  let currentPhase: CoopApplyResyncPhase;

  beforeEach(() => {
    priorScene = globalScene;
    coopEngine.resetCoopStateTicks();
    initGlobalScene({
      currentBattle: { waveIndex: 4, turn: 2 },
      phaseManager: {
        getCurrentPhase: () => currentPhase,
        shiftPhase: () => {},
      },
      ui: {
        clearText: () => {},
        showText: () => {},
      },
    } as unknown as BattleScene);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    coopEngine.resetCoopStateTicks();
    clearCoopRuntime();
    initGlobalScene(priorScene);
  });

  it("retains a failed replacement and retries the same ticks idempotently before consuming it", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    const snapshot = {
      tick: 17,
      authoritativeState: state(18),
      sessionEpoch: runtime.controller.sessionEpoch,
    } as CoopFullBattleSnapshot;
    currentPhase = new CoopApplyResyncPhase(snapshot, 1, "old-checksum", undefined);
    const phaseInternals = currentPhase as unknown as {
      armSupersedingCheckpointWake: () => boolean;
      recoveryTickFloor: number;
    };

    // Keep the production phase->stream->engine call chain, but make the heavy scene mutations a precise
    // tick-admission probe. Attempt one admits both ticks yet reports a structured apply failure; attempt
    // two must classify those ticks as already-applied, reassert the authoritative half, and converge.
    const checkpointApply = vi
      .spyOn(coopEngine, "applyCoopCheckpoint")
      .mockImplementation(value => coopEngine.coopAcceptStateTick(value.tick, "test-replacement-checkpoint"));
    const authoritativeApply = vi
      .spyOn(coopEngine, "applyCoopAuthoritativeBattleState")
      .mockImplementation(value =>
        value == null ? false : coopEngine.coopAcceptStateTick(value.tick, "test-replacement-state"),
      );
    const authoritativeReapply = vi
      .spyOn(coopEngine, "reapplyAcceptedCoopAuthoritativeBattleState")
      .mockImplementation(value => value?.tick === coopEngine.coopAppliedStateTick());
    vi.spyOn(coopEngine, "drainCoopApplyFailures")
      .mockReturnValueOnce([{ section: "modifiers", error: "transient reconstruction failure" }])
      .mockReturnValueOnce([]);
    vi.spyOn(coopEngine, "captureCoopChecksum").mockReturnValue("deadbeefdeadbeef");

    expect(phaseInternals.armSupersedingCheckpointWake(), "no replacement is buffered yet").toBe(false);
    const replacement = {
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum: "deadbeefdeadbeef",
      fullField: fullField(),
      authoritativeState: state(20),
    } as const;
    runtime.partnerTransport?.send(replacement);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(checkpointApply).toHaveBeenCalledOnce();
    expect(authoritativeApply).toHaveBeenCalledOnce();
    expect(authoritativeReapply).not.toHaveBeenCalled();
    expect(
      getCoopBattleStreamer()?.peekCheckpoint()?.authoritativeState?.tick,
      "a structured failure preserves the exact retained carrier",
    ).toBe(20);
    expect(phaseInternals.recoveryTickFloor, "a failed attempt does not burn its tick pair").toBe(18);

    // A transport retransmission is a new envelope object with the SAME authoritative tick pair.
    runtime.partnerTransport?.send(replacement);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(checkpointApply, "the admitted checkpoint is not destructively re-run").toHaveBeenCalledOnce();
    expect(
      authoritativeApply,
      "the admitted authoritative tick uses the explicit reassert path",
    ).toHaveBeenCalledOnce();
    expect(authoritativeReapply).toHaveBeenCalledOnce();
    expect(
      getCoopBattleStreamer()?.peekCheckpoint(),
      "only the fully verified retry consumes the retained frame",
    ).toBeNull();
    expect(phaseInternals.recoveryTickFloor, "successful verification commits the recovery floor").toBe(20);
  });

  it("drops a newer-tick frame from another logical turn before it can enter the recovery inbox", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    currentPhase = new CoopApplyResyncPhase(
      {
        tick: 17,
        authoritativeState: state(18),
        sessionEpoch: runtime.controller.sessionEpoch,
      } as CoopFullBattleSnapshot,
      1,
      "old-checksum",
      undefined,
    );
    const phaseInternals = currentPhase as unknown as {
      armSupersedingCheckpointWake: () => boolean;
      applySupersedingCheckpoint: (envelope: { reason: string }) => boolean;
    };
    const applied = vi.fn((_envelope: { reason: string }) => true);
    phaseInternals.applySupersedingCheckpoint = applied;
    phaseInternals.armSupersedingCheckpointWake();

    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 3,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum: "deadbeefdeadbeef",
      fullField: fullField(),
      authoritativeState: { ...state(20), turn: 3 },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(applied).not.toHaveBeenCalled();
    expect(getCoopBattleStreamer()?.peekCheckpoint()).toBeNull();
  });
});
