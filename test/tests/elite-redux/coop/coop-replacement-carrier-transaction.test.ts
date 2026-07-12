/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
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

function checkpoint(tick: number): CoopBattleCheckpoint {
  return {
    tick,
    field: [],
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
      partyIndex: 1,
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
    const hostMon = { coopOwner: "host", isActive: () => true };
    const guestMon = { coopOwner: "guest", isActive: () => true };
    initGlobalScene({
      gameMode: { isCoop: true, isShowdown: false },
      currentBattle: { waveIndex: 4, turn: 2, turnCommands: [{}, null] },
      getPlayerField: () => [hostMon, guestMon],
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

  it("bounds a missing retained host frame and routes retry exhaustion to an explicit terminal", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
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

    expect(checkpointApply, "an incomplete retained frame never reaches destructive apply").not.toHaveBeenCalled();
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
