/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { AuthorityLog } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopRuntimeContext,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import { COOP_FRAME_PROTOCOL_VERSION, type CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import {
  CoopRecoveryChannelV2,
  type CoopRecoveryChannelV2Deps,
} from "#data/elite-redux/coop/authority-v2/recovery-channel";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it, vi } from "vitest";

interface TimerRecord {
  readonly owner: CoopTimerOwner;
  readonly timeClass: CoopTimeClass;
  readonly callback: () => void;
}

class FakeScheduler implements CoopScheduler {
  private sequence = 0;
  private readonly timers = new Map<number, TimerRecord>();

  now(_timeClass: CoopTimeClass): number {
    return 0;
  }

  schedule(owner: CoopTimerOwner, _delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void {
    const id = ++this.sequence;
    this.timers.set(id, { owner, timeClass, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const [id, timer] of this.timers) {
      if (timer.owner.ownerId === ownerId) {
        this.timers.delete(id);
      }
    }
  }

  fireFirst(addressPart: string): boolean {
    const found = [...this.timers].find(([, candidate]) => candidate.owner.address.includes(addressPart));
    if (found == null) {
      return false;
    }
    const [id, timer] = found;
    this.timers.delete(id);
    timer.callback();
    return true;
  }

  get liveCount(): number {
    return this.timers.size;
  }
}

const AUTHORITY_FRAME: CoopFrameContextV2 = {
  sessionId: "recovery-session",
  runId: "recovery-run",
  sessionEpoch: 4,
  seatMapId: "seats-0-1",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 0,
};

const REPLICA_FRAME: CoopFrameContextV2 = {
  ...AUTHORITY_FRAME,
  senderSeatId: 1,
};

const NEXT_COMMAND = {
  kind: "COMMAND_FRONTIER" as const,
  epoch: 4,
  wave: 8,
  turn: 3,
  commands: [{ ownerSeatId: 1, pokemonId: 42, fieldIndex: 0 }],
};

function runtimeContext(frame: CoopFrameContextV2, scheduler: CoopScheduler): CoopRuntimeContext {
  return {
    runtimeId: `runtime-seat-${frame.senderSeatId}`,
    sessionId: frame.sessionId,
    runId: frame.runId,
    epoch: frame.sessionEpoch,
    localSeatId: frame.senderSeatId,
    authoritySeatId: frame.authoritySeatId,
    membershipRevision: frame.membershipRevision,
    scene: {} as BattleScene,
    transport: {} as CoopTransport,
    scheduler,
    cancellation: new AbortController().signal,
  };
}

function pendingEntry(): Omit<CoopAuthorityEntry, "revision"> {
  return {
    context: AUTHORITY_FRAME,
    operationId: "TURN/recovery-source",
    kind: "TURN_COMMIT",
    material: { digest: "turn-source-digest", payload: { hp: 21 } },
    nextControl: NEXT_COMMAND,
    subsumes: [],
  };
}

interface PairOptions {
  readonly dropFirstRequest?: boolean;
  readonly dropFirstApplied?: boolean;
  readonly captureReady?: () => boolean;
}

function makePair(options: PairOptions = {}) {
  const authorityScheduler = new FakeScheduler();
  const replicaScheduler = new FakeScheduler();
  const authorityContext = runtimeContext(AUTHORITY_FRAME, authorityScheduler);
  const replicaContext = runtimeContext(REPLICA_FRAME, replicaScheduler);
  const authorityLog = new AuthorityLog({
    localContext: AUTHORITY_FRAME,
    scheduler: authorityScheduler,
    send: () => {},
    peerBindings: [{ seatId: 1, connectionGeneration: 0 }],
  });
  const replicaLog = new AuthorityLog({
    localContext: REPLICA_FRAME,
    scheduler: replicaScheduler,
    send: () => {},
    peerBindings: [{ seatId: 0, connectionGeneration: 0 }],
  });
  const retained = authorityLog.commit(pendingEntry());
  const applyMaterial = vi.fn(async () => true);
  const project = vi.fn(() => ({ kind: "installed" as const, controlId: controlIdOf(NEXT_COMMAND) }));
  const terminalReasons: string[] = [];
  const replicaFrames: CoopFrameV2[] = [];
  const authorityFrames: CoopFrameV2[] = [];
  let requestDrops = options.dropFirstRequest ? 1 : 0;
  let appliedDrops = options.dropFirstApplied ? 1 : 0;
  let authorityChannel!: CoopRecoveryChannelV2;
  let replicaChannel!: CoopRecoveryChannelV2;

  const authorityDeps: CoopRecoveryChannelV2Deps = {
    frame: () => AUTHORITY_FRAME,
    peerBindings: () => [{ seatId: 1, connectionGeneration: 0 }],
    context: () => authorityContext,
    log: authorityLog,
    projector: { project } satisfies CoopControlProjector,
    send: frame => {
      authorityFrames.push(frame);
      replicaChannel.handleFrame(frame);
    },
    captureMaterial: () =>
      options.captureReady?.() === false ? null : { digest: "snapshot-digest", payload: { wave: 8, hp: [21, 30] } },
    applyMaterial,
    onTerminal: reason => terminalReasons.push(`authority:${reason}`),
  };
  const replicaDeps: CoopRecoveryChannelV2Deps = {
    frame: () => REPLICA_FRAME,
    peerBindings: () => [{ seatId: 0, connectionGeneration: 0 }],
    context: () => replicaContext,
    log: replicaLog,
    projector: { project } satisfies CoopControlProjector,
    send: frame => {
      replicaFrames.push(frame);
      if (frame.t === "recoveryRequest" && requestDrops > 0) {
        requestDrops -= 1;
        return;
      }
      if (frame.t === "recoveryApplied" && appliedDrops > 0) {
        appliedDrops -= 1;
        return;
      }
      authorityChannel.handleFrame(frame);
    },
    captureMaterial: () => null,
    applyMaterial,
    onTerminal: reason => terminalReasons.push(`replica:${reason}`),
  };
  authorityChannel = new CoopRecoveryChannelV2(authorityDeps);
  replicaChannel = new CoopRecoveryChannelV2(replicaDeps);

  return {
    authorityChannel,
    replicaChannel,
    authorityLog,
    replicaLog,
    authorityScheduler,
    replicaScheduler,
    authorityFrames,
    replicaFrames,
    applyMaterial,
    project,
    terminalReasons,
    retained,
    dispose() {
      authorityChannel.dispose();
      replicaChannel.dispose();
      authorityLog.dispose("test");
      replicaLog.dispose("test");
    },
  };
}

describe("authority-v2 correlated recovery channel", () => {
  it("retries a lost request, applies once, and never converts recoveryApplied into log retirement", async () => {
    const pair = makePair({ dropFirstRequest: true });

    const running = pair.replicaChannel.recover("missing-authority-entry");
    expect(pair.replicaFrames.filter(frame => frame.t === "recoveryRequest")).toHaveLength(1);
    expect(pair.replicaScheduler.fireFirst("/recovery/request/")).toBe(true);

    await expect(running).resolves.toBe("recovered");
    expect(pair.applyMaterial).toHaveBeenCalledTimes(1);
    expect(pair.project).toHaveBeenCalledTimes(1);
    expect(pair.authorityChannel.diagnostics().activeAuthorityResponses).toBe(0);
    expect(pair.authorityLog.retained()).toEqual([pair.retained]);
    expect(pair.terminalReasons).toEqual([]);

    pair.dispose();
    expect(pair.authorityScheduler.liveCount).toBe(0);
    expect(pair.replicaScheduler.liveCount).toBe(0);
  });

  it("redelivers a bundle after a lost completion proof and the replica re-proves without reapplying", async () => {
    const pair = makePair({ dropFirstApplied: true });

    await expect(pair.replicaChannel.recover("lost-recovery-proof")).resolves.toBe("recovered");
    expect(pair.authorityChannel.diagnostics().activeAuthorityResponses).toBe(1);
    expect(pair.replicaFrames.filter(frame => frame.t === "recoveryApplied")).toHaveLength(1);

    expect(pair.authorityScheduler.fireFirst("/recovery/response/")).toBe(true);
    expect(pair.replicaFrames.filter(frame => frame.t === "recoveryApplied")).toHaveLength(2);
    expect(pair.authorityChannel.diagnostics().activeAuthorityResponses).toBe(0);
    expect(pair.applyMaterial).toHaveBeenCalledTimes(1);
    expect(pair.project).toHaveBeenCalledTimes(1);
    expect(pair.authorityLog.retained()).toEqual([pair.retained]);
    expect(pair.terminalReasons).toEqual([]);

    pair.dispose();
  });

  it("keeps retrying while the authority is between safe snapshot boundaries", async () => {
    let captureReady = false;
    const pair = makePair({ captureReady: () => captureReady });

    const running = pair.replicaChannel.recover("unsafe-capture-boundary");
    expect(pair.authorityFrames.filter(frame => frame.t === "recoveryBundle")).toHaveLength(0);
    captureReady = true;
    expect(pair.replicaScheduler.fireFirst("/recovery/request/")).toBe(true);

    await expect(running).resolves.toBe("recovered");
    expect(pair.authorityFrames.filter(frame => frame.t === "recoveryBundle")).toHaveLength(1);
    expect(pair.terminalReasons).toEqual([]);
    pair.dispose();
  });

  it("terminalizes a recovery frame from an unbound connection generation", () => {
    const pair = makePair();
    pair.authorityChannel.handleFrame({
      v: COOP_FRAME_PROTOCOL_VERSION,
      t: "recoveryRequest",
      ctx: { ...REPLICA_FRAME, connectionGeneration: 99 },
      body: { requestId: "REC/forged", capturedFrontier: 0, reason: "forged-generation" },
    });

    expect(pair.authorityChannel.diagnostics().fenceState).toBe("terminal");
    expect(pair.terminalReasons).toEqual([expect.stringContaining("unbound peer connection generation")]);
    pair.dispose();
  });
});
