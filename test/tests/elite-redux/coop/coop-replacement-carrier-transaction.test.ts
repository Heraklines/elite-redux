/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as coopPresentation from "#data/elite-redux/coop/coop-presentation";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
  CoopMessage,
} from "#data/elite-redux/coop/coop-transport";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checksum = "deadbeefdeadbeef";

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

function checkpoint(tick: number): CoopBattleCheckpoint {
  return {
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
  };
}

function fullField(): CoopFullMonSnapshot[] {
  return [
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
}

async function flushWire(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("production replacement carrier transaction", () => {
  let priorScene: BattleScene;
  let phase: CoopReplayTurnPhase;
  let unshiftNew: ReturnType<typeof vi.fn>;
  let clearPhaseQueue: ReturnType<typeof vi.fn>;
  let showText: ReturnType<typeof vi.fn>;
  let resetScene: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    priorScene = globalScene;
    coopEngine.resetCoopStateTicks();
    unshiftNew = vi.fn();
    clearPhaseQueue = vi.fn();
    showText = vi.fn();
    resetScene = vi.fn();
    vi.spyOn(coopPresentation, "settleCoopAuthoritativeProjection").mockResolvedValue(true);
    const hostMon = { coopOwner: "host", isActive: () => true };
    const guestMon = { coopOwner: "guest", isActive: () => true };
    initGlobalScene({
      gameMode: { isCoop: true, isShowdown: false },
      currentBattle: { waveIndex: 4, turn: 2, turnCommands: [{}, null] },
      getPlayerField: () => [hostMon, guestMon],
      // The replacement->command pivot inspects the applied authoritative enemy party to detect a WON wave
      // (all enemies fainted) before opening a command. This mid-turn replacement lands on a LIVE wave, so
      // the materialized enemy (state().enemyParty = [{ id: 202 }]) is still up -> not a won wave.
      getEnemyParty: () => [{ isFainted: () => false }],
      phaseManager: {
        getCurrentPhase: () => phase,
        unshiftNew,
        clearPhaseQueue,
        shiftPhase: () => {},
      },
      ui: { clearText: () => {}, showText },
      reset: resetScene,
    } as unknown as BattleScene);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    coopEngine.resetCoopStateTicks();
    clearCoopRuntime();
    initGlobalScene(priorScene);
  });

  it("retains an exact pre-encounter replacement while the new wave has no enemy party yet", async () => {
    const runtime = startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    runtime.controller.role = "host";
    const outbound: CoopMessage[] = [];
    runtime.partnerTransport?.onMessage(message => outbound.push(message));
    const preEncounterState: CoopAuthoritativeBattleStateV1 = {
      ...state(55),
      wave: 8,
      turn: 1,
      enemyParty: [],
    };

    expect(() =>
      runtime.battleStream.sendCheckpoint(
        "replacement",
        runtime.controller.sessionEpoch,
        8,
        1,
        checkpoint(54),
        checksum,
        fullField(),
        preEncounterState,
      ),
    ).not.toThrow();
    await flushWire();

    expect(
      outbound.some(
        message =>
          message.t === "battleCheckpoint"
          && message.reason === "replacement"
          && message.wave === 8
          && message.turn === 1
          && message.revision === 55,
      ),
      "the exact retained replacement is published before EncounterPhase creates the enemy party",
    ).toBe(true);
    expect(() =>
      runtime.battleStream.emitTurn(
        runtime.controller.sessionEpoch,
        8,
        1,
        [],
        checkpoint(56),
        checksum,
        "complete-turn-preimage",
        fullField(),
        { ...preEncounterState, tick: 57 },
      ),
    ).toThrow(/refusing malformed turn commit/);
  });

  it("keeps CommandPhase closed until the complete retransmitted frame applies and checksum-verifies", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";

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
    const fieldApply = vi.spyOn(coopEngine, "applyCoopFieldSnapshot").mockImplementation(() => {});
    vi.spyOn(coopEngine, "drainCoopApplyFailures")
      .mockReturnValueOnce([{ section: "heldItems", error: "transient reconstruction failure" }])
      .mockReturnValueOnce([]);
    vi.spyOn(coopEngine, "captureCoopChecksum").mockReturnValue(checksum);

    phase = new CoopReplayTurnPhase(2);
    phase.start();

    // A legacy/partial replacement must not be consumed and must not expose a commandable mon.
    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      checkpoint: checkpoint(19),
      checksum,
      authoritativeState: state(20),
    } as unknown as CoopMessage);
    await flushWire();
    expect(checkpointApply, "partial frame never enters the engine appliers").not.toHaveBeenCalled();
    expect(unshiftNew.mock.calls.some(([name]) => name === "CommandPhase")).toBe(false);
    expect(runtime.battleStream.peekCheckpoint(), "runtime decoder drops the partial frame").toBeNull();

    const complete = {
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum,
      fullField: fullField(),
      authoritativeState: state(20),
    } as const;

    // First complete attempt admits both ticks but reports a structured rich-state failure. It remains
    // retained and control stays closed instead of continuing on the numeric half.
    runtime.partnerTransport?.send(complete);
    await flushWire();
    expect(checkpointApply).toHaveBeenCalledOnce();
    expect(authoritativeApply).toHaveBeenCalledOnce();
    expect(fieldApply).toHaveBeenCalledOnce();
    expect(unshiftNew.mock.calls.some(([name]) => name === "CommandPhase")).toBe(false);
    expect(runtime.battleStream.peekCheckpoint()?.authoritativeState?.tick).toBe(20);

    // The transport retransmits the same authoritative tick pair. The production pump reuses the admitted
    // checkpoint, reasserts the state/fullField, proves the exact checksum, consumes, and only then opens UI.
    runtime.partnerTransport?.send(complete);
    await flushWire();
    expect(checkpointApply, "same admitted checkpoint is not destructively re-run").toHaveBeenCalledOnce();
    expect(authoritativeApply, "same admitted state takes the explicit reassert path").toHaveBeenCalledOnce();
    expect(authoritativeReapply).toHaveBeenCalledOnce();
    expect(fieldApply).toHaveBeenCalledTimes(2);
    expect(runtime.battleStream.peekCheckpoint(), "verified frame is transactionally consumed").toBeNull();
    expect(unshiftNew.mock.calls.some(([name, slot]) => name === "CommandPhase" && slot === 1)).toBe(true);
  });

  it("applies and ACKs the exact turn-N+1 replacement while turn N remains delayed, then opens its owner UI", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    const outbound: CoopMessage[] = [];
    runtime.partnerTransport?.onMessage(message => outbound.push(message));
    const checkpointApply = vi
      .spyOn(coopEngine, "applyCoopCheckpoint")
      .mockImplementation(value => coopEngine.coopAcceptStateTick(value.tick, "test-n-plus-one-checkpoint"));
    const authoritativeApply = vi
      .spyOn(coopEngine, "applyCoopAuthoritativeBattleState")
      .mockImplementation(value =>
        value == null ? false : coopEngine.coopAcceptStateTick(value.tick, "test-n-plus-one-state"),
      );
    vi.spyOn(coopEngine, "applyCoopFieldSnapshot").mockImplementation(() => {});
    vi.spyOn(coopEngine, "drainCoopApplyFailures").mockReturnValue([]);
    vi.spyOn(coopEngine, "captureCoopChecksum").mockReturnValue(checksum);

    // The replay is still waiting for turn N=1 while the host has already opened turn N+1=2 to capture
    // the replacement that makes the guest-owned slot commandable.
    phase = new CoopReplayTurnPhase(1);
    phase.start();
    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum,
      fullField: fullField(),
      authoritativeState: state(20),
    });
    await flushWire();
    await flushWire();

    expect(checkpointApply).toHaveBeenCalledOnce();
    expect(authoritativeApply).toHaveBeenCalledOnce();
    expect(
      outbound.some(
        message =>
          message.t === "battleCheckpointAck"
          && message.epoch === runtime.controller.sessionEpoch
          && message.wave === 4
          && message.turn === 2
          && message.revision === 20,
      ),
      "the exact N+1 replacement is ACKed only after apply+checksum convergence",
    ).toBe(true);
    expect(unshiftNew.mock.calls.some(([name, slot]) => name === "CommandPhase" && slot === 1)).toBe(true);
    expect(
      unshiftNew.mock.calls.some(([name, turn]) => name === "CoopReplayTurnPhase" && turn === 1),
      "the delayed turn-N resolution remains the continuation after the replacement UI",
    ).toBe(true);
    expect(unshiftNew.mock.calls.some(([name]) => name === "CoopFinalizeTurnPhase")).toBe(false);
  });

  it("keeps turn N parked for wrong epoch, wrong wave, N+2, and non-replacement N+1 checkpoints", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    const checkpointApply = vi.spyOn(coopEngine, "applyCoopCheckpoint");
    const messages: CoopMessage[] = [
      {
        t: "battleCheckpoint",
        reason: "replacement",
        epoch: runtime.controller.sessionEpoch + 1,
        wave: 4,
        turn: 2,
        revision: 20,
        checkpoint: checkpoint(19),
        checksum,
        fullField: fullField(),
        authoritativeState: state(20),
      },
      {
        t: "battleCheckpoint",
        reason: "replacement",
        epoch: runtime.controller.sessionEpoch,
        wave: 5,
        turn: 2,
        revision: 20,
        checkpoint: checkpoint(19),
        checksum,
        fullField: fullField(),
        authoritativeState: { ...state(20), wave: 5 },
      },
      {
        t: "battleCheckpoint",
        reason: "replacement",
        epoch: runtime.controller.sessionEpoch,
        wave: 4,
        turn: 3,
        revision: 20,
        checkpoint: checkpoint(19),
        checksum,
        fullField: fullField(),
        authoritativeState: { ...state(20), turn: 3 },
      },
      {
        t: "battleCheckpoint",
        reason: "switch",
        epoch: runtime.controller.sessionEpoch,
        wave: 4,
        turn: 2,
        revision: 20,
        checkpoint: checkpoint(19),
        checksum,
        fullField: fullField(),
        authoritativeState: state(20),
      },
    ];

    phase = new CoopReplayTurnPhase(1);
    phase.start();
    for (const message of messages) {
      runtime.partnerTransport?.send(message);
    }
    await flushWire();

    expect(checkpointApply).not.toHaveBeenCalled();
    expect(unshiftNew.mock.calls.some(([name]) => name === "CommandPhase")).toBe(false);
    phase.abortPhantom("mismatch coverage cleanup");
    await flushWire();
  });

  it("bounds a missing retained host frame and routes retry exhaustion to an explicit terminal", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    let authorityFailures = 0;
    runtime.partnerTransport?.onMessage(message => {
      if (message.t !== "authorityFailure") {
        return;
      }
      authorityFailures++;
      runtime.partnerTransport?.send({
        t: "authorityFailureAck",
        failureId: message.failureId,
        epoch: message.epoch,
        wave: message.wave,
        turn: message.turn,
        revision: message.revision,
        boundary: message.boundary,
      });
    });
    const scheduled: (() => void)[] = [];
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      scheduled.push(callback);
      return () => {};
    });
    const terminate = vi.spyOn(runtime.membership, "terminate");
    const checkpointApply = vi.spyOn(coopEngine, "applyCoopCheckpoint");

    phase = new CoopReplayTurnPhase(2);
    phase.start();
    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum,
      fullField: fullField(),
      authoritativeState: state(20),
    });
    await flushWire();

    expect(scheduled).toHaveLength(1);
    for (let attempt = 0; attempt < 3; attempt++) {
      const fire = scheduled.shift();
      expect(fire, `retry timer ${attempt + 1} was scheduled`).toBeDefined();
      fire?.();
      await flushWire();
    }
    await flushWire();

    expect(
      checkpointApply,
      "the failed complete frame is attempted once but never re-applied without a retained host response",
    ).toHaveBeenCalledOnce();
    expect(authorityFailures, "the peer receives the terminal failure before local teardown").toBe(1);
    expect(terminate).toHaveBeenCalledOnce();
    expect(clearPhaseQueue).toHaveBeenCalledOnce();
    expect(resetScene).toHaveBeenCalledOnce();
    expect(showText).toHaveBeenCalledWith(
      expect.stringContaining("could not be synchronized safely"),
      null,
      undefined,
      6000,
    );
    expect(unshiftNew.mock.calls.some(([name]) => name === "TitlePhase")).toBe(true);
    expect(unshiftNew.mock.calls.some(([name]) => name === "CommandPhase")).toBe(false);
  });

  it("drops a stale scheduled retry after session teardown without touching the next scene", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    const scheduled: (() => void)[] = [];
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      scheduled.push(callback);
      return () => {};
    });

    phase = new CoopReplayTurnPhase(2);
    phase.start();
    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      epoch: runtime.controller.sessionEpoch,
      wave: 4,
      turn: 2,
      revision: 20,
      checkpoint: checkpoint(19),
      checksum,
      fullField: fullField(),
      authoritativeState: state(20),
    });
    await flushWire();
    expect(scheduled).toHaveLength(1);

    clearCoopRuntime();
    scheduled[0]?.();

    expect(resetScene, "old-session timer cannot reset the newly active scene").not.toHaveBeenCalled();
    expect(showText).not.toHaveBeenCalled();
    expect(unshiftNew.mock.calls.some(([name]) => name === "TitlePhase")).toBe(false);
    phase.abortPhantom("test teardown after stale retry");
  });
});
