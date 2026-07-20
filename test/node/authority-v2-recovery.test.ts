/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - RECOVERY TRANSACTION (Lane 4) node-pure tests.
//
// Engine-free: the whole import graph is contract TYPES + the Lane-4 modules
// (fence / bundle / transaction). The log, projector, requester, applier, and
// acker are all mocked here, exactly as the integration owner injects the real
// Lane-2/3 implementations. Runs in the node-pure project (millisecond boot).
//
// Proven here:
//   - happy path reaches "recovered" with the frozen phases in order;
//   - progression is frozen while the fence is held (all four predicates);
//   - a stale bundle (frontier advanced elsewhere) terminalizes, never applies;
//   - abort mid-request (explicit + scheduler deadline) terminalizes + freezes;
//   - a second concurrent transaction is rejected without disturbing the live one.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type {
  CoopAuthorityEntry,
  CoopAuthorityLog,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRecoveryPhase,
  CoopRuntimeContext,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  type CoopRecoveryTransactionDeps,
  createRecoveryTransaction,
} from "#data/elite-redux/coop/authority-v2/recovery";
import type {
  CoopRecoveryAppliedProofV2,
  CoopRecoveryBundle,
} from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import { validateRecoveryBundle } from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import { createRecoveryFence } from "#data/elite-redux/coop/authority-v2/recovery-fence";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it, vi } from "vitest";

// --- fakes -----------------------------------------------------------------

/** An engine-free scheduler that never fires on its own; the test drives it. */
class FakeScheduler implements CoopScheduler {
  private seq = 0;
  private readonly timers = new Map<number, { owner: CoopTimerOwner; cb: () => void }>();

  now(_timeClass: CoopTimeClass): number {
    return 0;
  }

  schedule(owner: CoopTimerOwner, _delayMs: number, _timeClass: CoopTimeClass, callback: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { owner, cb: callback });
    return () => {
      this.timers.delete(id);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.owner.ownerId === ownerId) {
        this.timers.delete(id);
      }
    }
  }

  /** Test helper: fire every armed timer (simulate the deadline elapsing). */
  fireAll(): void {
    for (const timer of [...this.timers.values()]) {
      timer.cb();
    }
  }

  get armed(): number {
    return this.timers.size;
  }
}

interface FakeLog extends CoopAuthorityLog {
  setFrontier(revision: number): void;
  readonly adopted: number[];
}

function makeLog(frontier: number): FakeLog {
  let current = frontier;
  const adopted: number[] = [];
  return {
    commit(pending) {
      current += 1;
      return { ...pending, revision: current };
    },
    acceptReceipt() {
      return false;
    },
    retained() {
      return [];
    },
    admit() {
      return { kind: "admitted" };
    },
    recordReplicaStage() {
      return true;
    },
    receivedThrough() {
      return current;
    },
    appliedThrough() {
      return current;
    },
    controlInstalledThrough() {
      return current;
    },
    adoptFrontier(revision) {
      adopted.push(revision);
      current = revision;
    },
    dispose() {
      /* no-op */
    },
    setFrontier(revision) {
      current = revision;
    },
    adopted,
  };
}

const FRAME: CoopFrameContextV2 = {
  sessionId: "s1",
  runId: "r1",
  sessionEpoch: 3,
  seatMapId: "map-1",
  membershipRevision: 2,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};
const REPLICA_FRAME: CoopFrameContextV2 = {
  ...FRAME,
  senderSeatId: 1,
};

const COMMAND_CONTROL: NonNullable<CoopNextControl> = {
  kind: "COMMAND_FRONTIER",
  epoch: 3,
  wave: 4,
  turn: 1,
  commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 0 }],
};

function entry(revision: number, nextControl: CoopNextControl = COMMAND_CONTROL): CoopAuthorityEntry {
  return {
    context: FRAME,
    revision,
    operationId: `op-${revision}`,
    kind: "TURN_COMMIT",
    material: { digest: `d-${revision}`, payload: null },
    nextControl,
    subsumes: [],
  };
}

function makeBundle(overrides: Partial<CoopRecoveryBundle> = {}): CoopRecoveryBundle {
  return {
    requestId: "recovery-1",
    context: FRAME,
    material: { digest: "material-digest", payload: { hp: 42 } },
    frontier: 12,
    frontierOperationId: "op-12",
    membershipRevision: 2,
    nextControl: COMMAND_CONTROL,
    requiredTail: [entry(11), entry(12, COMMAND_CONTROL)],
    ...overrides,
  };
}

function makeCtx(scheduler: CoopScheduler, cancellation: AbortSignal): CoopRuntimeContext {
  return {
    runtimeId: "rt-1",
    sessionId: "s1",
    runId: "r1",
    epoch: 3,
    localSeatId: 1,
    authoritySeatId: 0,
    membershipRevision: 2,
    // The transaction never dereferences scene/transport; the injected surfaces
    // carry every capability it uses. Typed stubs keep this node-pure.
    scene: {} as unknown as BattleScene,
    transport: {} as unknown as CoopTransport,
    scheduler,
    cancellation,
  };
}

const INSTALLED: CoopControlInstallResult = { kind: "installed", controlId: "ctrl-1" };

interface Harness {
  deps: CoopRecoveryTransactionDeps;
  scheduler: FakeScheduler;
  log: FakeLog;
  phases: CoopRecoveryPhase[];
  applyMaterial: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
  ctx: CoopRuntimeContext;
}

function makeHarness(
  request: CoopRecoveryTransactionDeps["request"],
  opts: {
    fence?: ReturnType<typeof createRecoveryFence>;
    frontier?: number;
    projectResult?: CoopControlInstallResult;
    project?: () => CoopControlInstallResult;
    applyResult?: boolean;
    applyMaterial?: CoopRecoveryTransactionDeps["applyMaterial"];
    frame?: () => CoopFrameContextV2;
  } = {},
): Harness {
  const scheduler = new FakeScheduler();
  const log = makeLog(opts.frontier ?? 10);
  const ctx = makeCtx(scheduler, new AbortController().signal);
  const phases: CoopRecoveryPhase[] = [];
  const applyMaterial = vi.fn(opts.applyMaterial ?? (async () => opts.applyResult ?? true));
  const acknowledge = vi.fn((_ctx: CoopRuntimeContext, _proof: CoopRecoveryAppliedProofV2) => {});
  const project = vi.fn(opts.project ?? ((): CoopControlInstallResult => opts.projectResult ?? INSTALLED));
  const projector: CoopControlProjector = { project };
  const fence = opts.fence ?? createRecoveryFence();
  const deps: CoopRecoveryTransactionDeps = {
    log,
    projector,
    fence,
    frame: opts.frame ?? (() => REPLICA_FRAME),
    requestId: "recovery-1",
    reason: "unit-test",
    request,
    applyMaterial,
    acknowledge,
    requestTimeoutMs: 1_000,
    onPhase: p => phases.push(p),
  };
  return { deps, scheduler, log, phases, applyMaterial, acknowledge, project, ctx };
}

// A controllable deferred for "hold the request open, then act" scenarios.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- tests -----------------------------------------------------------------

describe("authority-v2 recovery bundle validation", () => {
  it("classifies a frame mismatch as mismatch", () => {
    const bundle = makeBundle({ context: { ...FRAME, sessionEpoch: 99 } });
    const verdict = validateRecoveryBundle(bundle, REPLICA_FRAME, 10, "recovery-1");
    expect(verdict.kind).toBe("mismatch");
  });

  it("classifies a frontier behind the captured one as stale, never valid", () => {
    const bundle = makeBundle({ frontier: 8, requiredTail: [] });
    const verdict = validateRecoveryBundle(bundle, REPLICA_FRAME, 10, "recovery-1");
    expect(verdict.kind).toBe("stale");
  });

  it("accepts a contiguous forward bundle", () => {
    expect(validateRecoveryBundle(makeBundle(), REPLICA_FRAME, 10, "recovery-1").kind).toBe("valid");
  });

  it("rejects a non-contiguous required tail", () => {
    const bundle = makeBundle({ requiredTail: [entry(11), entry(14)] });
    expect(validateRecoveryBundle(bundle, REPLICA_FRAME, 10, "recovery-1").kind).toBe("mismatch");
  });

  it("rejects a frontier operation identity that does not match the proven tail", () => {
    const bundle = makeBundle({ frontierOperationId: "another-operation" });
    expect(validateRecoveryBundle(bundle, REPLICA_FRAME, 10, "recovery-1")).toMatchObject({
      kind: "mismatch",
      reason: expect.stringContaining("frontier operation"),
    });
  });

  it("rejects a delayed bundle from another request before applying material", () => {
    const bundle = makeBundle({ requestId: "older-request" });
    expect(validateRecoveryBundle(bundle, REPLICA_FRAME, 10, "recovery-1")).toMatchObject({
      kind: "mismatch",
      reason: expect.stringContaining("older-request"),
    });
  });

  it("requires every recovery bundle and tail entry to be authority-signed", () => {
    const replicaSigned = { ...FRAME, senderSeatId: 1 };
    expect(
      validateRecoveryBundle(makeBundle({ context: replicaSigned }), REPLICA_FRAME, 10, "recovery-1"),
    ).toMatchObject({
      kind: "mismatch",
      reason: expect.stringContaining("not authority"),
    });
    expect(
      validateRecoveryBundle(
        makeBundle({ requiredTail: [entry(11), { ...entry(12), context: replicaSigned }] }),
        REPLICA_FRAME,
        10,
        "recovery-1",
      ),
    ).toMatchObject({
      kind: "mismatch",
      reason: expect.stringContaining("different authority frame context"),
    });
  });
});

describe("authority-v2 recovery transaction", () => {
  it("happy path reaches 'recovered' with the frozen phases in order", async () => {
    const requestSeen = vi.fn();
    const h = makeHarness(async (_ctx, request) => {
      requestSeen(request);
      return makeBundle();
    });
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    const result = await txn.run();

    expect(result).toBe("recovered");
    expect(txn.phase).toBe("released");
    expect(h.phases).toEqual([
      "fence-acquired",
      "frontier-captured",
      "requested",
      "validated",
      "material-applied",
      "frontier-installed",
      "control-installed",
      "acked",
      "released",
    ]);
    expect(h.deps.fence.state).toBe("open");
    expect(h.applyMaterial).toHaveBeenCalledTimes(1);
    expect(h.log.adopted).toEqual([12]);
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(requestSeen).toHaveBeenCalledWith({
      requestId: "recovery-1",
      capturedFrontier: 10,
      reason: "unit-test",
    });
    const proof = h.acknowledge.mock.calls[0][1] as CoopRecoveryAppliedProofV2;
    expect(proof).toEqual({
      requestId: "recovery-1",
      frontier: 12,
      materialDigest: "material-digest",
      controlId: "ctrl-1",
    });
  });

  it("terminalizes a non-empty recovery frontier with no successor control", async () => {
    const h = makeHarness(async () =>
      makeBundle({
        nextControl: null,
        requiredTail: [entry(11), entry(12)],
      }),
    );
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    expect(await txn.run()).toBe("terminalized");
    expect(h.phases).toContain("terminalized");
    expect(h.applyMaterial).not.toHaveBeenCalled();
    expect(h.project).not.toHaveBeenCalled();
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it("freezes every progression surface while the fence is held, then releases", async () => {
    const gate = deferred<CoopRecoveryBundle>();
    const h = makeHarness(() => gate.promise);
    const fence = h.deps.fence;

    // Before the transaction: nothing frozen.
    expect(fence.isProgressionFrozen()).toBe(false);

    const txn = createRecoveryTransaction(h.ctx, h.deps);
    const running = txn.run();

    // Fence acquired synchronously before the request awaits: all four frozen.
    expect(fence.state).toBe("held");
    expect(fence.isCommandAdmissionFrozen()).toBe(true);
    expect(fence.isProgressionFrozen()).toBe(true);
    expect(fence.isMaterializationFrozen()).toBe(true);
    expect(fence.isAuthorityWaitCreationFrozen()).toBe(true);
    expect(txn.capturedFrontier).toBe(10);
    // Material must NOT be applied while the snapshot is still in flight.
    expect(h.applyMaterial).not.toHaveBeenCalled();

    gate.resolve(makeBundle());
    expect(await running).toBe("recovered");

    // Released open: progression resumes.
    expect(fence.state).toBe("open");
    expect(fence.isProgressionFrozen()).toBe(false);
  });

  it("keeps the fence held and withholds recoveryApplied until a deferred real control becomes actionable", async () => {
    let actionable = false;
    const h = makeHarness(async () => makeBundle(), {
      project: () =>
        actionable
          ? { kind: "installed", controlId: "ctrl-1" }
          : { kind: "deferred", reason: "real CommandPhase handler not started" },
    });
    const txn = createRecoveryTransaction(h.ctx, h.deps);
    const running = txn.run();

    for (let i = 0; i < 8 && h.project.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.acknowledge).not.toHaveBeenCalled();
    expect(h.deps.fence.state).toBe("held");
    expect(h.deps.fence.isCommandAdmissionFrozen()).toBe(true);
    expect(h.deps.fence.isControlSurfaceStartFrozen()).toBe(false);

    actionable = true;
    h.scheduler.fireAll();
    expect(await running).toBe("recovered");
    expect(h.project).toHaveBeenCalledTimes(2);
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
    expect(h.deps.fence.state).toBe("open");
  });

  it("terminalizes (never applies) when the frontier advances elsewhere mid-request", async () => {
    // captured = 10; the world advances to 20 while the snapshot is in flight.
    const h = makeHarness(async () => {
      h.log.setFrontier(20);
      return makeBundle({ frontier: 12 });
    });
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    const result = await txn.run();

    expect(result).toBe("terminalized");
    expect(txn.phase).toBe("terminalized");
    expect(h.deps.fence.state).toBe("terminal");
    expect(h.deps.fence.terminalReason).toContain("frontier advanced under the fence");
    // The stale snapshot was refused BEFORE any material/adopt/project.
    expect(h.applyMaterial).not.toHaveBeenCalled();
    expect(h.log.adopted).toEqual([]);
    expect(h.project).not.toHaveBeenCalled();
    expect(h.phases).not.toContain("validated");
  });

  it("revalidates after async material apply and refuses a membership that changed underneath it", async () => {
    let liveFrame = REPLICA_FRAME;
    const h = makeHarness(async () => makeBundle(), {
      frame: () => liveFrame,
      applyMaterial: async () => {
        liveFrame = { ...REPLICA_FRAME, membershipRevision: 3, connectionGeneration: 2 };
        return true;
      },
    });
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    expect(await txn.run()).toBe("terminalized");
    expect(h.deps.fence.terminalReason).toContain("post-apply recovery bundle mismatch");
    expect(h.applyMaterial).toHaveBeenCalledTimes(1);
    expect(h.log.adopted).toEqual([]);
    expect(h.project).not.toHaveBeenCalled();
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it("terminalizes on a bundle whose frontier is behind the captured frontier", async () => {
    const h = makeHarness(async () => makeBundle({ frontier: 8, requiredTail: [] }), { frontier: 10 });
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    expect(await txn.run()).toBe("terminalized");
    expect(h.deps.fence.state).toBe("terminal");
    expect(h.applyMaterial).not.toHaveBeenCalled();
  });

  it("terminalizes and freezes when aborted mid-request", async () => {
    const gate = deferred<CoopRecoveryBundle>();
    const h = makeHarness(() => gate.promise);
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    const running = txn.run();
    expect(h.deps.fence.state).toBe("held");

    txn.abort("operator aborted");
    const result = await running;

    expect(result).toBe("terminalized");
    expect(h.deps.fence.state).toBe("terminal");
    expect(h.deps.fence.terminalReason).toContain("operator aborted");
    expect(h.applyMaterial).not.toHaveBeenCalled();
  });

  it("terminalizes when the scheduler recovery deadline elapses (recovery time class)", async () => {
    const gate = deferred<CoopRecoveryBundle>();
    const h = makeHarness(() => gate.promise);
    const txn = createRecoveryTransaction(h.ctx, h.deps);

    const running = txn.run();
    expect(h.scheduler.armed).toBe(1);

    // Fire the scheduler-owned deadline: it aborts the in-flight request.
    h.scheduler.fireAll();
    const result = await running;

    expect(result).toBe("terminalized");
    expect(h.deps.fence.state).toBe("terminal");
    expect(h.applyMaterial).not.toHaveBeenCalled();
  });

  it("rejects a second concurrent transaction without disturbing the live one", async () => {
    const fence = createRecoveryFence();
    const gate = deferred<CoopRecoveryBundle>();
    const first = makeHarness(() => gate.promise, { fence });
    const second = makeHarness(async () => makeBundle(), { fence });

    const firstTxn = createRecoveryTransaction(first.ctx, first.deps);
    const secondTxn = createRecoveryTransaction(second.ctx, second.deps);

    const firstRunning = firstTxn.run();
    expect(fence.state).toBe("held");

    // The duplicate cannot acquire the held fence: rejected, no work done.
    const secondResult = await secondTxn.run();
    expect(secondResult).toBe("terminalized");
    expect(second.applyMaterial).not.toHaveBeenCalled();
    // Crucially, the live transaction's fence is untouched (still held, not terminal).
    expect(fence.state).toBe("held");

    // The live transaction still completes normally.
    gate.resolve(makeBundle());
    expect(await firstRunning).toBe("recovered");
    expect(fence.state).toBe("open");
    expect(first.applyMaterial).toHaveBeenCalledTimes(1);
  });

  it("run() is idempotent per instance", async () => {
    const h = makeHarness(async () => makeBundle());
    const txn = createRecoveryTransaction(h.ctx, h.deps);
    const a = txn.run();
    const b = txn.run();
    expect(a).toBe(b);
    expect(await a).toBe("recovered");
    expect(h.applyMaterial).toHaveBeenCalledTimes(1);
  });
});
