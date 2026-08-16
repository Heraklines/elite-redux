/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Node-pure contract for Authority V2 cutover surface 3. It pins the fail-closed switchboard and proves
// wave/terminal commits travel through the same ordered host/replica log without a legacy wave ledger.

import type { BattleScene } from "#app/battle-scene";
import {
  digestOfMaterial,
  type CoopTerminalMaterialV2,
  type CoopWaveTransitionMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  activeCoopWaveAuthorityModeV2,
  CoopV2WaveCutover,
  clearActiveCoopV2WaveCutover,
  getActiveCoopV2WaveCutover,
  isCoopV2WaveCutoverActive,
  isCoopV2WaveEnabled,
  resolveCoopWaveAuthorityModeV2,
  setActiveCoopV2WaveCutover,
  suppressesLegacyWaveCorrectnessCarrier,
  suppressesLegacyWaveOperationAuthority,
  suppressesLegacyWaveWatcherAdoption,
} from "#data/elite-redux/coop/authority-v2/cutover-wave";
import type { CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2LiveReplicaSeams,
  type CoopV2ShadowIdentity,
  type CoopV2ShadowWaveTap,
  clearCoopV2ShadowInbound,
  registerCoopV2ShadowInbound,
  routeCoopV2InboundFrame,
} from "#data/elite-redux/coop/authority-v2/shadow";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

class FakeClock implements CoopSchedulerClock {
  private readonly nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimer(callback: () => void, delayMs: number): CoopTimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.timers.delete(handle as number);
  }
}

const STUB_SCENE = {} as unknown as BattleScene;
const STUB_TRANSPORT = {} as unknown as CoopTransport;
const SESSION = {
  sessionId: "wave-cutover-session",
  runId: "wave-cutover-run",
  epoch: 11,
  authoritySeatId: 0,
  membershipRevision: 2,
  seatMapId: "wave-cutover-map",
};

function identity(localSeatId: number): CoopV2ShadowIdentity {
  return {
    runtimeId: `${SESSION.sessionId}:seat${localSeatId}`,
    sessionId: SESSION.sessionId,
    runId: SESSION.runId,
    epoch: SESSION.epoch,
    localSeatId,
    authoritySeatId: SESSION.authoritySeatId,
    membershipRevision: SESSION.membershipRevision,
    seatMapId: SESSION.seatMapId,
    connectionGeneration: 0,
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: 0 }],
  };
}

function routeInto(harness: CoopAuthorityV2Shadow, frame: CoopFrameV2): void {
  registerCoopV2ShadowInbound(valid => harness.handleInboundFrame(valid));
  try {
    routeCoopV2InboundFrame(encodeFrameV2(frame));
  } finally {
    clearCoopV2ShadowInbound();
  }
}

function buildDuo(
  options: {
    readonly hostLiveReplica?: CoopV2LiveReplicaSeams;
    readonly guestLiveReplica?: CoopV2LiveReplicaSeams;
  } = {},
): { host: CoopAuthorityV2Shadow; guest: CoopAuthorityV2Shadow; dispose(): void } {
  const scheduler = createCoopScheduler(new FakeClock());
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    scheduler,
    send: frame => routeInto(guest, frame),
    ...(options.hostLiveReplica == null ? {} : { liveReplica: options.hostLiveReplica }),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    scheduler,
    send: frame => routeInto(host, frame),
    ...(options.guestLiveReplica == null ? {} : { liveReplica: options.guestLiveReplica }),
  });
  return {
    host,
    guest,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

const transition = {
  outcome: "win",
  wave: 8,
  nextWave: 9,
  nextLogicalPhase: "reward",
  biomeChange: false,
  eggLapse: true,
  meBoundary: "none",
  victoryKind: "trainer",
  settledStateTick: 90,
};

const WAVE_MATERIAL: CoopWaveTransitionMaterialV2 = {
  kind: "wave-advance",
  wave: 8,
  turn: 5,
  outcome: "win",
  nextWave: 9,
  biomeChange: false,
  eggLapse: true,
  meBoundary: "none",
  victoryKind: "trainer",
  authorityCarrier: {
    authoritativeState: { version: 1, tick: 90, wave: 8, turn: 5 },
    transition,
  },
};

const TERMINAL_MATERIAL: CoopTerminalMaterialV2 = {
  kind: "terminal",
  terminalId: "V2/TERMINAL/e11/w8/tick90",
  reason: "game-over",
  wave: 8,
  turn: 5,
  authorityCarrier: {
    authoritativeState: { version: 1, tick: 90, wave: 8, turn: 5 },
    transition: { ...transition, outcome: "gameOver", nextWave: 8, nextLogicalPhase: "terminal" },
  },
};

function awaitInteraction(afterOperationId: string) {
  return {
    kind: "AWAIT_SUCCESSOR" as const,
    afterOperationId,
    epoch: SESSION.epoch,
    wave: WAVE_MATERIAL.wave,
    turn: WAVE_MATERIAL.turn,
    allowedKinds: ["INTERACTION_COMMIT" as const],
    allowNextWaveStart: true,
    expectedOperationId: null,
  };
}

function boundaryCommand(): Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> {
  return {
    kind: "COMMAND_FRONTIER",
    epoch: SESSION.epoch,
    wave: WAVE_MATERIAL.nextWave,
    turn: 1,
    commands: [{ ownerSeatId: 0, pokemonId: 25, fieldIndex: 0 }],
  };
}

function retainedTurnPredecessor(context: CoopFrameContextV2): Omit<CoopAuthorityEntry, "revision"> {
  return {
    context,
    operationId: "retained-turn-before-boundary",
    kind: "TURN_COMMIT",
    material: {
      digest: "digest-retained-turn-before-boundary",
      payload: { epoch: SESSION.epoch, wave: WAVE_MATERIAL.wave, turn: WAVE_MATERIAL.turn },
    },
    nextControl: {
      kind: "COMMAND_FRONTIER",
      epoch: SESSION.epoch,
      wave: WAVE_MATERIAL.wave,
      turn: WAVE_MATERIAL.turn,
      commands: [{ ownerSeatId: 0, pokemonId: 25, fieldIndex: 0 }],
    },
    subsumes: [],
  };
}

afterEach(() => {
  clearActiveCoopV2WaveCutover();
  clearCoopV2ShadowInbound();
});

describe("authority-v2 wave/terminal cutover mode", () => {
  it("fails closed unless every prerequisite is present", () => {
    expect(resolveCoopWaveAuthorityModeV2({ buildEnabled: true, negotiated: true, harnessPresent: true })).toBe("v2");
    for (const inputs of [
      { buildEnabled: false, negotiated: true, harnessPresent: true },
      { buildEnabled: true, negotiated: false, harnessPresent: true },
      { buildEnabled: true, negotiated: true, harnessPresent: false },
    ]) {
      expect(resolveCoopWaveAuthorityModeV2(inputs)).toBe("legacy");
    }
    expect(isCoopV2WaveEnabled()).toBe(false);
  });

  it("suppresses all three legacy authorities only in v2 mode", () => {
    for (const suppress of [
      suppressesLegacyWaveOperationAuthority,
      suppressesLegacyWaveCorrectnessCarrier,
      suppressesLegacyWaveWatcherAdoption,
    ]) {
      expect(suppress("v2")).toBe(true);
      expect(suppress("legacy")).toBe(false);
    }
  });

  it("keeps the active selector match-scoped", () => {
    const duo = buildDuo();
    const active = new CoopV2WaveCutover(duo.host);
    const other = new CoopV2WaveCutover(duo.guest);
    setActiveCoopV2WaveCutover(active);
    expect(getActiveCoopV2WaveCutover()).toBe(active);
    expect(isCoopV2WaveCutoverActive()).toBe(true);
    expect(activeCoopWaveAuthorityModeV2()).toBe("v2");
    clearActiveCoopV2WaveCutover(other);
    expect(getActiveCoopV2WaveCutover()).toBe(active);
    clearActiveCoopV2WaveCutover(active);
    expect(activeCoopWaveAuthorityModeV2()).toBe("legacy");
    active.dispose();
    other.dispose();
    duo.dispose();
  });
});

describe("authority-v2 wave/terminal host commits", () => {
  it("commits the full wave carrier and an explicit ordered wait for the typed interaction entry", () => {
    const duo = buildDuo();
    const cutover = new CoopV2WaveCutover(duo.host);
    const operationId = "V2/WAVE/e11/w8/tick90";
    const entry = cutover.commitHostWave({
      operationId,
      transition: WAVE_MATERIAL,
      destination: awaitInteraction(operationId),
      legacyImage: WAVE_MATERIAL,
      legacyDigest: "unused-when-image-present",
    });
    expect(entry?.kind).toBe("WAVE_ADVANCE");
    expect(entry?.material.payload).toEqual(WAVE_MATERIAL);
    expect(entry?.nextControl).toEqual(awaitInteraction(operationId));
    expect(duo.host.diagnostics().retained).toBe(0);
    expect(duo.guest.diagnostics().applied).toBe(1);
    cutover.dispose();
    expect(
      cutover.commitHostWave({
        operationId: "after-dispose",
        transition: WAVE_MATERIAL,
        destination: awaitInteraction("after-dispose"),
        legacyDigest: "after-dispose",
      }),
    ).toBeNull();
    duo.dispose();
  });

  it("commits a terminal that states the same full carrier and exact terminal control", () => {
    const duo = buildDuo();
    const cutover = new CoopV2WaveCutover(duo.host);
    const entry = cutover.commitHostTerminal({
      operationId: TERMINAL_MATERIAL.terminalId,
      terminal: TERMINAL_MATERIAL,
      legacyImage: TERMINAL_MATERIAL,
      legacyDigest: "unused-when-image-present",
    });
    expect(entry?.kind).toBe("TERMINAL_COMMIT");
    expect(entry?.material.payload).toEqual(TERMINAL_MATERIAL);
    expect(entry?.nextControl).toEqual({ kind: "TERMINAL", terminalId: TERMINAL_MATERIAL.terminalId });
    expect(duo.host.diagnostics().retained).toBe(0);
    expect(duo.guest.diagnostics().applied).toBe(1);
    cutover.dispose();
    duo.dispose();
  });

  it("retries one deferred wave boundary after an older lease retires, preserving the exact body and one callback/parity proof", () => {
    let boundaryReservationReady = false;
    let predecessorMaterialReady = false;
    const committedBoundaries: CoopAuthorityEntry[] = [];
    const hostLiveReplica: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "WAVE_ADVANCE",
      ownsControl: () => false,
      prepareAuthorityEntry: (_ctx, entry) => {
        if (entry.kind === "WAVE_ADVANCE") {
          return boundaryReservationReady ? () => {} : null;
        }
        return () => {};
      },
      authorityEntryCommitted: (_ctx, entry) => {
        if (entry.kind === "WAVE_ADVANCE") {
          committedBoundaries.push(entry);
        }
      },
      applyMaterial: () => true,
      projectControl: () => null,
    };
    const guestLiveReplica: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: () => false,
      applyMaterial: () => predecessorMaterialReady ? true : "deferred",
      projectControl: () => null,
    };
    const duo = buildDuo({ hostLiveReplica, guestLiveReplica });
    const cutover = new CoopV2WaveCutover(duo.host);
    try {
      const predecessorDisposition = duo.host.commitAuthorityEntryDetailed(
        retainedTurnPredecessor(duo.host.authenticatedFrameContext),
      );
      expect(predecessorDisposition.kind).toBe("committed");
      if (predecessorDisposition.kind !== "committed") {
        return;
      }

      const boundaryInput: CoopV2ShadowWaveTap = {
        operationId: "deferred-wave-boundary",
        transition: WAVE_MATERIAL,
        destination: boundaryCommand(),
        legacyDigest: digestOfMaterial(WAVE_MATERIAL),
        legacyImage: WAVE_MATERIAL,
        subsumes: [predecessorDisposition.entry.revision],
      };
      const deferredDisposition = cutover.commitHostWaveDetailed(boundaryInput);
      expect(deferredDisposition.kind).toBe("deferred");
      if (deferredDisposition.kind !== "deferred") {
        return;
      }
      const deferred = deferredDisposition.entry;
      expect(deferred).toMatchObject({
        revision: predecessorDisposition.entry.revision + 1,
        operationId: boundaryInput.operationId,
        kind: "WAVE_ADVANCE",
      });
      expect(duo.host.diagnostics()).toMatchObject({ committed: 1, parityChecks: 0, parityMatches: 0 });

      // Complete only the unrelated older retained lease. The boundary remains the one exact deferred tap.
      predecessorMaterialReady = true;
      expect(duo.guest.retryPendingReplicaEntries()).toBe(1);
      expect(duo.host.diagnostics()).toMatchObject({ retained: 0, pendingTimers: 0 });

      boundaryReservationReady = true;
      const committedDisposition = cutover.commitHostWaveDetailed(boundaryInput);
      expect(committedDisposition.kind).toBe("committed");
      if (committedDisposition.kind !== "committed") {
        return;
      }
      expect(committedDisposition.entry).toEqual(deferred);
      expect(committedDisposition.entry.material).toEqual(deferred.material);
      expect(committedDisposition.entry.revision).toBe(deferred.revision);
      expect(committedDisposition.entry.operationId).toBe(deferred.operationId);
      expect(committedBoundaries).toHaveLength(1);
      expect(committedBoundaries[0]).toEqual(deferred);
      expect(duo.host.diagnostics()).toMatchObject({
        committed: 2,
        parityChecks: 1,
        parityMatches: 1,
        retained: 0,
        pendingTimers: 0,
      });
      expect(duo.host.authorityFrontier()).toMatchObject({
        revision: deferred.revision,
        operationId: deferred.operationId,
      });
    } finally {
      cutover.dispose();
      duo.dispose();
    }
  });
});
