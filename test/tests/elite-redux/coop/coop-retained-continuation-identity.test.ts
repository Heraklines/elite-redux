/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_CAP_OP_WAVE,
  clearNegotiatedCoopCapabilities,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  resolveCoopRetainedWaveContinuationIdentity,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  applyCoopWaveAdvanceEnvelopeForBinding,
  registerCoopWaveAdvanceBoundaryDataApplier,
  resetCoopWaveAdvanceOperationFlag,
  setCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function retainedEnvelope(wave: number, turn: number, revision: number): CoopAuthoritativeEnvelopeV1 {
  const authoritativeState: CoopAuthoritativeBattleStateV1 = {
    version: 1,
    tick: wave * 100 + turn,
    wave,
    turn,
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
  const payload: CoopWaveAdvancePayload = {
    wave,
    outcome: "win",
    nextLogicalPhase: "WAVE_VICTORY",
    nextWave: wave + 1,
    biomeChange: false,
    eggLapse: false,
    meBoundary: "none",
    victoryKind: "wild",
    settledStateTick: authoritativeState.tick,
  };
  return {
    version: 1,
    sessionEpoch: 1,
    revision,
    wave,
    turn,
    logicalPhase: payload.nextLogicalPhase,
    pendingOperation: {
      id: `1:0:WAVE_ADVANCE:${wave}`,
      kind: "WAVE_ADVANCE",
      owner: 0,
      status: "applied",
      payload,
    },
    authoritativeState,
  };
}

function installRuntime(role: "host" | "guest") {
  const pair = createLoopbackPair();
  const runtime = assembleCoopRuntime(role === "host" ? pair.host : pair.guest, {
    username: role,
    netcodeMode: "authoritative",
  });
  runtime.controller.role = role;
  setCoopRuntime(runtime);
  setNegotiatedCoopCapabilities([COOP_CAP_OP_WAVE], [COOP_CAP_OP_WAVE]);
  return runtime;
}

type SelectModifierIdentitySeam = {
  coopContinuationIdentityFailure: string | null;
  coopRewardTurn(): number;
  coopRewardWave(): number;
  coopSourceAddress: { wave: number; turn: number } | null;
};

describe("co-op retained continuation identity", () => {
  beforeEach(() => {
    setCoopDurabilityEnabled(true);
    setCoopWaveAdvanceOperationEnabled(true);
    clearNegotiatedCoopCapabilities();
  });

  afterEach(() => {
    clearCoopRuntime();
    clearNegotiatedCoopCapabilities();
    resetCoopWaveAdvanceOperationFlag();
  });

  it("preserves ambient behavior for solo, host and an explicitly non-wave guest surface", () => {
    expect(resolveCoopRetainedWaveContinuationIdentity(true)).toEqual({ kind: "ambient" });

    installRuntime("host");
    expect(resolveCoopRetainedWaveContinuationIdentity(true)).toEqual({ kind: "ambient" });
    clearCoopRuntime();

    installRuntime("guest");
    expect(resolveCoopRetainedWaveContinuationIdentity(false)).toEqual({ kind: "ambient" });
  });

  it("fails closed deterministically when a retained guest continuation has no candidate", () => {
    installRuntime("guest");

    const identity = resolveCoopRetainedWaveContinuationIdentity(true);
    expect(identity.kind).toBe("invalid");
    if (identity.kind === "invalid") {
      expect(identity.reason).toBe(
        "[coop-op] retained wave continuation identity missing: candidateCount=0 candidates=[] stagedWaves=[] stagedOperationIds=[]",
      );
    }

    const phase = new SelectModifierPhase() as unknown as SelectModifierIdentitySeam;
    expect(phase.coopSourceAddress, "the caller did not silently capture ambient currentBattle").toBeNull();
    expect(phase.coopContinuationIdentityFailure).toBe(identity.kind === "invalid" ? identity.reason : null);
  });

  it("captures exact source wave and turn and carries both into continuation copies", () => {
    const runtime = installRuntime("guest");
    registerCoopWaveAdvanceBoundaryDataApplier(() => "deferred", runtime.waveOperationBinding);
    expect(
      applyCoopWaveAdvanceEnvelopeForBinding(retainedEnvelope(18, 7, 1), runtime.waveOperationBinding),
    ).toBe("applied");

    expect(resolveCoopRetainedWaveContinuationIdentity(true)).toEqual({
      kind: "retained",
      address: { wave: 18, turn: 7 },
    });
    const phase = new SelectModifierPhase() as unknown as SelectModifierIdentitySeam;
    expect(phase.coopRewardWave()).toBe(18);
    expect(phase.coopRewardTurn()).toBe(7);

    const inherited = new SelectModifierPhase(1, undefined, undefined, false, {
      wave: 18,
      turn: 7,
    }) as unknown as SelectModifierIdentitySeam;
    expect(inherited.coopSourceAddress).toEqual({ wave: 18, turn: 7 });
    expect(inherited.coopRewardTurn()).toBe(7);
  });

  it("fails closed with sorted evidence when more than one retained continuation is unresolved", () => {
    const runtime = installRuntime("guest");
    registerCoopWaveAdvanceBoundaryDataApplier(() => "deferred", runtime.waveOperationBinding);
    expect(applyCoopWaveAdvanceEnvelopeForBinding(retainedEnvelope(9, 4, 1), runtime.waveOperationBinding)).toBe(
      "applied",
    );
    expect(applyCoopWaveAdvanceEnvelopeForBinding(retainedEnvelope(10, 2, 2), runtime.waveOperationBinding)).toBe(
      "applied",
    );

    const identity = resolveCoopRetainedWaveContinuationIdentity(true);
    expect(identity.kind).toBe("invalid");
    if (identity.kind === "invalid") {
      expect(identity.reason).toBe(
        "[coop-op] retained wave continuation identity ambiguous: candidateCount=2 "
          + "candidates=[1:0:WAVE_ADVANCE:9@9:4,1:0:WAVE_ADVANCE:10@10:2] "
          + "stagedWaves=[9,10] stagedOperationIds=[1:0:WAVE_ADVANCE:10,1:0:WAVE_ADVANCE:9]",
      );
    }
  });
});
