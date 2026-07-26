/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as coopPresentation from "#data/elite-redux/coop/coop-presentation";
import { clearCoopRuntime, getCoopBattleStreamer, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopRecoveryAdmissionV1,
} from "#data/elite-redux/coop/coop-transport";
import { CoopApplyResyncPhase } from "#phases/coop-replay-phases";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function state(tick: number): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick,
    wave: 4,
    turn: 2,
    playerParty: [{ id: 101 }],
    enemyParty: [{ id: 202 }],
    field: [{ side: "player", bi: 1, partyIndex: 0, pokemonId: 101, presented: true }],
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
  field: [
    {
      bi: 1,
      partyIndex: 0,
      speciesId: 1,
      hp: 1,
      maxHp: 1,
      status: 0,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      fainted: false,
    },
  ],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

const fullField = (): CoopFullMonSnapshot[] => [
  {
    bi: 1,
    partyIndex: 0,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

function recoveryAdmission(epoch: number): CoopRecoveryAdmissionV1 {
  const guestBinding = {
    sessionId: `legacy-recovery:e${epoch}`,
    sessionEpoch: epoch,
    seatMapId: `legacy-seat-map:e${epoch}`,
    membershipRevision: 0,
    fromSeatId: 1,
    connectionGeneration: 0,
  };
  return {
    ticket: {
      version: 1,
      requestId: `test:${epoch}:1`,
      seq: 1,
      reason: "turn-checksum",
      policy: "exact",
      binding: guestBinding,
      frontier: { epoch, wave: 4, turn: 2 },
    },
    captured: {
      version: 1,
      binding: { ...guestBinding, fromSeatId: 0 },
      frontier: { epoch, wave: 4, turn: 2 },
      stateTick: 18,
      controlDigest: "test-digest",
    },
  };
}

describe("held resync checkpoint wake (live wave-4 faint transition)", () => {
  let priorScene: BattleScene;
  let currentPhase: CoopApplyResyncPhase;
  let phaseShifts: number;

  beforeEach(() => {
    priorScene = globalScene;
    phaseShifts = 0;
    coopEngine.resetCoopStateTicks();
    vi.spyOn(coopPresentation, "settleCoopAuthoritativeProjection").mockResolvedValue(true);
    initGlobalScene({
      currentBattle: { waveIndex: 4, turn: 2, turnCommands: [null, null] },
      getPlayerField: () => [
        { id: 100, coopOwner: "host", isActive: () => true },
        { id: 101, coopOwner: "guest", isActive: () => true },
      ],
      phaseManager: {
        getCurrentPhase: () => currentPhase,
        shiftPhase: () => phaseShifts++,
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
    currentPhase = new CoopApplyResyncPhase(snapshot, 1, "old-checksum", undefined, {
      kind: "legacy",
      ticket: recoveryAdmission(runtime.controller.sessionEpoch),
    });
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
    const streamer = getCoopBattleStreamer();
    expect(
      streamer?.retainedAuthorityDiagnostics(),
      "material/presentation proof moves the carrier into retained out-of-band storage while continuation waits",
    ).toMatchObject({ bufferedAuthority: 1, waiters: 1 });
    expect(streamer?.peekCheckpoint(), "the mechanically consumed inbox is no longer the retained owner").toBeNull();
    expect(streamer?.notifyContinuationSurface("command"), "the addressed wave-4 turn-2 command releases it").toBe(1);
    expect(
      streamer?.retainedAuthorityDiagnostics(),
      "continuationReady releases the waiter while the turn finalizer still owns out-of-band cleanup",
    ).toMatchObject({ bufferedAuthority: 1, waiters: 0 });
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
      { kind: "legacy", ticket: recoveryAdmission(runtime.controller.sessionEpoch) },
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

  it("destructive retirement cancels every held recovery wait without shifting a later authority successor", () => {
    currentPhase = new CoopApplyResyncPhase(
      { tick: 17, authoritativeState: state(18), sessionEpoch: 1 } as CoopFullBattleSnapshot,
      1,
      "old-checksum",
      undefined,
      { kind: "legacy", ticket: recoveryAdmission(1) },
    );
    const cleanup = {
      machineWait: 0,
      checkpointWake: 0,
      checkpointRetry: 0,
      authorityFailure: 0,
      presentationDeadline: 0,
    };
    Object.assign(currentPhase as unknown as Record<string, unknown>, {
      presentationPending: true,
      endHoldMachineWait: () => cleanup.machineWait++,
      stopCheckpointWake: () => cleanup.checkpointWake++,
      stopCheckpointRetry: () => cleanup.checkpointRetry++,
      stopAuthorityFailure: () => cleanup.authorityFailure++,
      stopPresentationDeadline: () => cleanup.presentationDeadline++,
    });

    currentPhase.retire();
    expect(cleanup).toEqual({
      machineWait: 1,
      checkpointWake: 1,
      checkpointRetry: 1,
      authorityFailure: 1,
      presentationDeadline: 1,
    });
    expect((currentPhase as unknown as { presentationPending: boolean }).presentationPending).toBe(false);

    // Detached recovery projection/deadline continuations can still call end/retire after replacement.
    // They must neither shift the authoritative successor nor invoke cleanup a second time.
    currentPhase.end();
    currentPhase.retire();
    expect(phaseShifts).toBe(0);
    expect(cleanup).toEqual({
      machineWait: 1,
      checkpointWake: 1,
      checkpointRetry: 1,
      authorityFailure: 1,
      presentationDeadline: 1,
    });
  });
});
