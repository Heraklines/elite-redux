/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, getCoopBattleStreamer, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullBattleSnapshot,
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

describe("held resync checkpoint wake (live wave-4 faint transition)", () => {
  let priorScene: BattleScene;
  let currentPhase: CoopApplyResyncPhase;

  beforeEach(() => {
    priorScene = globalScene;
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
    clearCoopRuntime();
    initGlobalScene(priorScene);
  });

  it("consumes and routes a strictly-newer replacement envelope even though the normal replay pump is blocked", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    const snapshot = {
      tick: 17,
      authoritativeState: state(18),
    } as CoopFullBattleSnapshot;
    currentPhase = new CoopApplyResyncPhase(snapshot, 1, "old-checksum", undefined);
    const phaseInternals = currentPhase as unknown as {
      armSupersedingCheckpointWake: () => boolean;
      applySupersedingCheckpoint: (envelope: { reason: string }) => boolean;
    };
    const applied = vi.fn((_envelope: { reason: string }) => true);
    phaseInternals.applySupersedingCheckpoint = applied;

    expect(phaseInternals.armSupersedingCheckpointWake(), "no replacement is buffered yet").toBe(false);
    runtime.partnerTransport?.send({
      t: "battleCheckpoint",
      reason: "replacement",
      checkpoint: checkpoint(19),
      checksum: "deadbeefdeadbeef",
      authoritativeState: state(20),
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(applied).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledWith(expect.objectContaining({ reason: "replacement" }));
    expect(
      getCoopBattleStreamer()?.peekCheckpoint(),
      "the held boundary, not a blocked replay, consumed it",
    ).toBeNull();
  });

  it("does not consume a newer-tick frame from another logical turn", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    runtime.controller.role = "guest";
    currentPhase = new CoopApplyResyncPhase(
      { tick: 17, authoritativeState: state(18) } as CoopFullBattleSnapshot,
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
      checkpoint: checkpoint(19),
      checksum: "deadbeefdeadbeef",
      authoritativeState: { ...state(20), turn: 3 },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(applied).not.toHaveBeenCalled();
    expect(getCoopBattleStreamer()?.peekCheckpoint()?.reason).toBe("replacement");
  });
});
