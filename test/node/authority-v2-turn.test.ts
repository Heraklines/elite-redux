/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Migration A node-pure tests (authority-v2-turn).
//
// The turn/command adapter's import graph is engine/DOM-free (TYPE-only contract
// imports + the engine-free foundation helpers), so it runs in the node-pure
// project in milliseconds. These pin the migration's load-bearing invariants:
//   - the TURN_COMMIT entry shape + a deterministic material digest.
//   - the stated nextControl addresses the NEXT turn (N+1) with the right owner seat.
//   - the mutation barrier gates the build (barred while tokens outstanding).
//   - the command-request lease is scheduler-owned + bounded, and cancellation on
//     retire / abort / supersede / last-consumer leaves ZERO armed timers (asserted
//     against the FOUNDATION scheduler + authority log).
//   - the replica pipeline emits admitted -> materialApplied -> controlInstalled in
//     order via replica.ts, with digest verification on the applier seam.
//   - the shadow-parity seam compares a legacy digest to the v2 entry digest.
// =============================================================================

import {
  buildTurnCommitEntry,
  buildTurnCommitMaterial,
  CommandRequestLeaseBook,
  computeShadowParity,
  computeTurnCommitDigest,
  type MutationBarrier,
  type TurnResolutionImage,
  turnCommandControlId,
  turnMaterialApplier,
} from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { applyEntry, type ReplicaReceiptSink } from "#data/elite-redux/coop/authority-v2/replica";
import { type CoopSchedulerClock, createCoopScheduler } from "#data/elite-redux/coop/authority-v2/scheduler";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRAME: CoopFrameContextV2 = {
  sessionId: "session-A",
  runId: "run-A",
  sessionEpoch: 1,
  seatMapId: "seatmap-A",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

const CAPTURE: TurnResolutionImage = {
  turnResolution: [
    { seq: 0, kind: "move", moveId: 33, targetBi: 2 },
    { seq: 1, kind: "damage", bi: 2, hp: 118 },
  ],
  checkpoint: { field: [{ bi: 0, hp: 200 }], weather: 0, checksum: "abc123" },
};

/**
 * A cutover capture: the same bare image PLUS the legacy `CoopTurnResolution` companions the guest's real
 * progression (CoopReplayTurnPhase -> CoopFinalizeTurnPhase) reconstructs from. Every companion is an opaque
 * JSON-shaped value here (the adapter never inspects them); the streamer re-validates them strictly on apply.
 */
const CAPTURE_WITH_COMPANIONS: TurnResolutionImage = {
  ...CAPTURE,
  checksum: "0123456789abcdef",
  preimage: "canonical-state-preimage",
  fullField: [{ bi: 0, partyIndex: 0, speciesId: 1, hp: 200, maxHp: 200 }],
  authoritativeState: { tick: 7, wave: 3, turn: 5, terrain: 2, arenaTags: ["stealth-rock"] },
  epoch: 1,
  wave: 3,
  turn: 5,
  revision: 7,
};

/** A fresh CoopScheduler over a NEVER-firing fake clock, so armed timers stay pending for assertions. */
function fakeClockScheduler() {
  let seq = 0;
  const armed = new Map<number, () => void>();
  const clock: CoopSchedulerClock = {
    now: () => 0,
    setTimer: cb => {
      const id = ++seq;
      armed.set(id, cb);
      return id;
    },
    clearTimer: handle => {
      armed.delete(handle as number);
    },
  };
  return createCoopScheduler(clock);
}

function barrier(tokens: number): MutationBarrier {
  return { pendingTokens: () => tokens };
}

function buildCommitted(over: Partial<Parameters<typeof buildTurnCommitEntry>[0]> = {}) {
  const result = buildTurnCommitEntry({
    context: FRAME,
    operationId: "turn-op-1",
    capture: CAPTURE,
    nextCommand: { epoch: 1, wave: 3, resolvedTurn: 5, ownerSeatId: 1, pokemonId: 42 },
    barrier: barrier(0),
    ...over,
  });
  if (result.kind !== "committed") {
    throw new Error(`expected committed, got ${result.kind}`);
  }
  return result.entry;
}

function fullEntry(revision = 1, over: Partial<Parameters<typeof buildTurnCommitEntry>[0]> = {}): CoopAuthorityEntry {
  return { ...buildCommitted(over), revision };
}

function fixedProjector(result: CoopControlInstallResult): CoopControlProjector {
  return { project: () => result };
}

function recordingSink(): { sink: ReplicaReceiptSink; stages: () => string[]; receipts: CoopAuthorityReceipt[] } {
  const receipts: CoopAuthorityReceipt[] = [];
  return { sink: { emit: r => receipts.push(r) }, stages: () => receipts.map(r => r.stage), receipts };
}

const CTX = { localSeatId: 1 } as unknown as CoopRuntimeContext;
const PIPELINE_BOOKKEEPING = {
  receiptContext: { ...FRAME, senderSeatId: 1 },
  recordStage: () => true,
};

// ---------------------------------------------------------------------------
// (1) AUTHORITY: entry shape + digest
// ---------------------------------------------------------------------------

describe("buildTurnCommitEntry - shape + digest", () => {
  it("assembles a TURN_COMMIT entry carrying the frame context, operationId, and material image", () => {
    const entry = buildCommitted();
    expect(entry.kind).toBe("TURN_COMMIT");
    expect(entry.context).toBe(FRAME);
    expect(entry.operationId).toBe("turn-op-1");
    expect(entry.subsumes).toEqual([]);
    expect(entry.material.payload).toEqual({
      turnResolution: CAPTURE.turnResolution,
      checkpoint: CAPTURE.checkpoint,
    });
  });

  it("fingerprints the capture with a deterministic digest (same image -> same digest)", () => {
    const a = buildCommitted().material.digest;
    const b = buildCommitted().material.digest;
    expect(a).toBe(b);
    expect(a).toBe(computeTurnCommitDigest(CAPTURE));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes the digest when the turn resolution or checkpoint changes", () => {
    const base = computeTurnCommitDigest(CAPTURE);
    expect(
      computeTurnCommitDigest({ ...CAPTURE, turnResolution: [{ seq: 0, kind: "move", moveId: 99, targetBi: 2 }] }),
    ).not.toBe(base);
    expect(computeTurnCommitDigest({ ...CAPTURE, checkpoint: { field: [], weather: 1 } })).not.toBe(base);
  });

  it("carries an explicit subsumes list through to the entry", () => {
    expect(buildCommitted({ subsumes: [7, 9] }).subsumes).toEqual([7, 9]);
  });
});

// ---------------------------------------------------------------------------
// (1) AUTHORITY: cutover companions round-trip through material + digest
// ---------------------------------------------------------------------------

describe("TurnResolutionImage cutover companions", () => {
  it("carries every present companion into the material payload (round-trip)", () => {
    const material = buildTurnCommitMaterial(CAPTURE_WITH_COMPANIONS);
    expect(material.payload).toEqual({
      turnResolution: CAPTURE_WITH_COMPANIONS.turnResolution,
      checkpoint: CAPTURE_WITH_COMPANIONS.checkpoint,
      checksum: CAPTURE_WITH_COMPANIONS.checksum,
      preimage: CAPTURE_WITH_COMPANIONS.preimage,
      fullField: CAPTURE_WITH_COMPANIONS.fullField,
      authoritativeState: CAPTURE_WITH_COMPANIONS.authoritativeState,
      epoch: CAPTURE_WITH_COMPANIONS.epoch,
      wave: CAPTURE_WITH_COMPANIONS.wave,
      turn: CAPTURE_WITH_COMPANIONS.turn,
      revision: CAPTURE_WITH_COMPANIONS.revision,
    });
  });

  it("omits absent companions so a bare image keeps its exact pre-enrichment payload + digest", () => {
    // A bare shadow image (no companions) round-trips to just { turnResolution, checkpoint }: byte-identical
    // to the pre-enrichment scheme, so a shadow-only / capability-off session is unchanged.
    const bare = buildTurnCommitMaterial(CAPTURE);
    expect(bare.payload).toEqual({ turnResolution: CAPTURE.turnResolution, checkpoint: CAPTURE.checkpoint });
    expect(bare.digest).toBe(
      computeTurnCommitDigest({ turnResolution: CAPTURE.turnResolution, checkpoint: CAPTURE.checkpoint }),
    );
  });

  it("fingerprints the companions into the digest (enriched != bare, and each companion is load-bearing)", () => {
    const bareDigest = computeTurnCommitDigest(CAPTURE);
    const enrichedDigest = computeTurnCommitDigest(CAPTURE_WITH_COMPANIONS);
    expect(enrichedDigest).not.toBe(bareDigest);
    expect(enrichedDigest).toMatch(/^[0-9a-f]{16}$/);
    // A divergent authoritativeState (terrain/arenaTags live here) must change the digest, so a redelivery
    // can never smuggle a divergent state under a matching digest.
    expect(
      computeTurnCommitDigest({
        ...CAPTURE_WITH_COMPANIONS,
        authoritativeState: { tick: 7, wave: 3, turn: 5, terrain: 3, arenaTags: [] },
      }),
    ).not.toBe(enrichedDigest);
    // A divergent checksum likewise.
    expect(computeTurnCommitDigest({ ...CAPTURE_WITH_COMPANIONS, checksum: "ffffffffffffffff" })).not.toBe(
      enrichedDigest,
    );
  });

  it("is deterministic under key-order differences in the companions", () => {
    const reordered: TurnResolutionImage = {
      revision: 7,
      turn: 5,
      wave: 3,
      epoch: 1,
      authoritativeState: { arenaTags: ["stealth-rock"], terrain: 2, turn: 5, wave: 3, tick: 7 },
      fullField: [{ maxHp: 200, hp: 200, speciesId: 1, partyIndex: 0, bi: 0 }],
      preimage: "canonical-state-preimage",
      checksum: "0123456789abcdef",
      checkpoint: CAPTURE.checkpoint,
      turnResolution: CAPTURE.turnResolution,
    };
    expect(computeTurnCommitDigest(reordered)).toBe(computeTurnCommitDigest(CAPTURE_WITH_COMPANIONS));
  });

  it("survives the applier digest gate with the enriched payload and hands back the full image", () => {
    const entry: CoopAuthorityEntry = { ...buildCommitted({ capture: CAPTURE_WITH_COMPANIONS }), revision: 1 };
    const rec = recordingSink();
    let handed: TurnResolutionImage | null = null;
    const out = applyEntry(CTX, entry, {
      applyMaterial: turnMaterialApplier((_ctx, material) => {
        handed = material.payload;
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId: turnCommandControlId(entry) as string }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(rec.stages()).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(out.kind).toBe("applied");
    // The applier receives the WHOLE enriched image (the companions the guest's real progression needs).
    expect(handed).toEqual(entry.material.payload);
    expect((handed as unknown as TurnResolutionImage).authoritativeState).toEqual(
      CAPTURE_WITH_COMPANIONS.authoritativeState,
    );
    expect((handed as unknown as TurnResolutionImage).fullField).toEqual(CAPTURE_WITH_COMPANIONS.fullField);
  });
});

// ---------------------------------------------------------------------------
// (2) REPLICA: the material FEED runs (and signs materialApplied) BEFORE controlInstalled
// ---------------------------------------------------------------------------

describe("replica pipeline - material feed precedes controlInstalled", () => {
  it("feeds the guest progression (materialApplied) strictly before the control is installed", () => {
    const entry = fullEntry(1, { capture: CAPTURE_WITH_COMPANIONS });
    const controlId = turnCommandControlId(entry) as string;
    const order: string[] = [];
    const rec = recordingSink();

    const out = applyEntry(CTX, entry, {
      // The applier stands in for the live seam that feeds the guest's real progression (the streamer
      // ingest). It must run - and sign materialApplied - BEFORE the projector installs the control.
      applyMaterial: turnMaterialApplier(() => {
        order.push("feed");
        return true;
      }),
      projector: {
        project: () => {
          order.push("install");
          return { kind: "installed", controlId };
        },
      },
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });

    expect(order).toEqual(["feed", "install"]);
    expect(rec.stages()).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(out).toEqual({ kind: "applied", controlId, presentationSettled: false });
  });

  it("never installs the control when the feed refuses (materialRejected halts before projection)", () => {
    const entry = fullEntry(1, { capture: CAPTURE_WITH_COMPANIONS });
    const order: string[] = [];
    const rec = recordingSink();
    const out = applyEntry(CTX, entry, {
      applyMaterial: turnMaterialApplier(() => {
        order.push("feed");
        return false; // the guest could not accept the material -> stop before controlInstalled
      }),
      projector: {
        project: () => {
          order.push("install");
          return { kind: "installed", controlId: "x" };
        },
      },
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(order).toEqual(["feed"]);
    expect(rec.stages()).toEqual(["admitted"]);
    expect(out.kind).toBe("materialRejected");
  });
});

// ---------------------------------------------------------------------------
// (2) REPLICA: redelivery equivalence (first delivery == every redelivery)
// ---------------------------------------------------------------------------

describe("replica pipeline - redelivery equivalence", () => {
  it("hands an identical enriched payload to the feed on first delivery and every redelivery", () => {
    const entry = fullEntry(1, { capture: CAPTURE_WITH_COMPANIONS });
    const controlId = turnCommandControlId(entry) as string;
    const handed: TurnResolutionImage[] = [];
    const deps = {
      applyMaterial: turnMaterialApplier((_ctx, material) => {
        handed.push(material.payload);
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId } as CoopControlInstallResult),
      receipts: recordingSink().sink,
      ...PIPELINE_BOOKKEEPING,
    };

    const first = applyEntry(CTX, entry, deps);
    const second = applyEntry(CTX, entry, deps); // redelivery of the SAME immutable entry
    const third = applyEntry(CTX, entry, deps);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(handed).toHaveLength(3);
    // Every delivery hands the byte-identical image (the digest gate proves the payload is the same), so a
    // downstream idempotent consumer (the streamer's turnResolution admission) classifies redeliveries as
    // identical and never double-applies.
    expect(handed[0]).toEqual(handed[1]);
    expect(handed[1]).toEqual(handed[2]);
    expect(handed[0]).toEqual(entry.material.payload);
  });

  it("keeps rejecting a redelivered entry whose digest was tampered (no smuggled state on retry)", () => {
    const tampered: CoopAuthorityEntry = {
      ...fullEntry(1, { capture: CAPTURE_WITH_COMPANIONS }),
      material: { digest: "deadbeefdeadbeef", payload: CAPTURE_WITH_COMPANIONS },
    };
    let feeds = 0;
    const deps = {
      applyMaterial: turnMaterialApplier(() => {
        feeds += 1;
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId: "x" }),
      receipts: recordingSink().sink,
      ...PIPELINE_BOOKKEEPING,
    };
    expect(applyEntry(CTX, tampered, deps).kind).toBe("materialRejected");
    expect(applyEntry(CTX, tampered, deps).kind).toBe("materialRejected");
    expect(feeds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (1) AUTHORITY: stated nextControl addresses turn N+1
// ---------------------------------------------------------------------------

describe("buildTurnCommitEntry - stated successor COMMAND", () => {
  it("states the COMMAND for the NEXT turn (N+1) with the authority-stated owner seat", () => {
    const entry = buildCommitted({
      nextCommand: { epoch: 2, wave: 4, resolvedTurn: 5, ownerSeatId: 1, pokemonId: 77 },
    });
    expect(entry.nextControl).toEqual({
      kind: "COMMAND",
      epoch: 2,
      wave: 4,
      turn: 6, // resolvedTurn 5 -> successor 6, NEVER guest-derived
      ownerSeatId: 1,
      pokemonId: 77,
    });
  });

  it("never leaves the successor turn equal to the resolved turn", () => {
    const entry = buildCommitted({
      nextCommand: { epoch: 1, wave: 1, resolvedTurn: 12, ownerSeatId: 0, pokemonId: 5 },
    });
    expect(entry.nextControl?.kind).toBe("COMMAND");
    if (entry.nextControl?.kind === "COMMAND") {
      expect(entry.nextControl.turn).toBe(13);
    }
  });
});

// ---------------------------------------------------------------------------
// (1) AUTHORITY: the mutation barrier gates the build
// ---------------------------------------------------------------------------

describe("buildTurnCommitEntry - mutation barrier", () => {
  it("is barred while any settle token is outstanding (mechanical replacement of the phase blacklist)", () => {
    const result = buildTurnCommitEntry({
      context: FRAME,
      operationId: "turn-op-1",
      capture: CAPTURE,
      nextCommand: { epoch: 1, wave: 3, resolvedTurn: 5, ownerSeatId: 1, pokemonId: 42 },
      barrier: barrier(2),
    });
    expect(result).toEqual({ kind: "barred", pendingTokens: 2 });
  });

  it("builds once the barrier reads zero", () => {
    const result = buildTurnCommitEntry({
      context: FRAME,
      operationId: "turn-op-1",
      capture: CAPTURE,
      nextCommand: { epoch: 1, wave: 3, resolvedTurn: 5, ownerSeatId: 1, pokemonId: 42 },
      barrier: barrier(0),
    });
    expect(result.kind).toBe("committed");
  });
});

// ---------------------------------------------------------------------------
// (2) REPLICA: command-request lease cancellation leaves zero timers
// ---------------------------------------------------------------------------

describe("CommandRequestLeaseBook - scheduler-owned, bounded, zero-leak", () => {
  let scheduler: ReturnType<typeof fakeClockScheduler>;
  let requested: string[];

  beforeEach(() => {
    scheduler = fakeClockScheduler();
    requested = [];
  });

  function makeBook(signal: AbortSignal) {
    return new CommandRequestLeaseBook({
      scheduler,
      signal,
      request: id => requested.push(id),
      intervalMs: 500,
    });
  }

  it("arms exactly one scheduler timer per acquired control address", () => {
    const controller = new AbortController();
    const book = makeBook(controller.signal);
    const entry = fullEntry();
    const controlId = turnCommandControlId(entry);
    expect(controlId).toBe(controlIdOf(entry.nextControl as never));

    book.acquire(controlId as string);
    expect(book.leaseCount).toBe(1);
    expect(scheduler.pendingTimerCount).toBe(1);
    expect(book.isArmed(controlId as string)).toBe(true);

    // A second consumer of the SAME address does not create a second lease/timer.
    book.acquire(controlId as string);
    expect(book.leaseCount).toBe(1);
    expect(scheduler.pendingTimerCount).toBe(1);
  });

  it("retiring the entry cancels the lease and leaves zero timers", () => {
    const controller = new AbortController();
    const book = makeBook(controller.signal);
    const entry = fullEntry();
    book.acquireForEntry(entry);
    expect(scheduler.pendingTimerCount).toBe(1);

    book.retireEntry(entry);
    expect(book.leaseCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("aborting the cancellation signal disposes every lease (zero timers)", () => {
    const controller = new AbortController();
    const book = makeBook(controller.signal);
    book.acquire("COMMAND/e1/w1/t1/s0/p1");
    book.acquire("COMMAND/e1/w1/t2/s1/p9");
    expect(book.leaseCount).toBe(2);
    expect(scheduler.pendingTimerCount).toBe(2);

    controller.abort("teardown");
    expect(book.leaseCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("supersession retires the superseded address' lease independently", () => {
    const controller = new AbortController();
    const book = makeBook(controller.signal);
    const superseded = fullEntry(1);
    const successor = fullEntry(2, {
      operationId: "turn-op-2",
      nextCommand: { epoch: 1, wave: 3, resolvedTurn: 6, ownerSeatId: 1, pokemonId: 42 },
    });
    book.acquireForEntry(superseded);
    book.acquireForEntry(successor);
    expect(scheduler.pendingTimerCount).toBe(2);

    // A later revision supersedes the earlier: retire ONLY the superseded address.
    book.retireEntry(superseded);
    expect(book.leaseCount).toBe(1);
    expect(scheduler.pendingTimerCount).toBe(1);
    expect(book.isArmed(turnCommandControlId(successor) as string)).toBe(true);
  });

  it("releasing the final consumer cancels the lease (zero timers)", () => {
    const controller = new AbortController();
    const book = makeBook(controller.signal);
    const controlId = "COMMAND/e1/w1/t1/s0/p1";
    const a = book.acquire(controlId);
    const b = book.acquire(controlId);
    expect(scheduler.pendingTimerCount).toBe(1);

    a.release();
    expect(book.leaseCount).toBe(1); // one consumer left
    expect(scheduler.pendingTimerCount).toBe(1);
    a.release(); // idempotent - no double-decrement
    expect(scheduler.pendingTimerCount).toBe(1);

    b.release();
    expect(book.leaseCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("full retirement over the FOUNDATION log + scheduler leaves zero timers (delivery + request)", () => {
    const controller = new AbortController();
    const sent: CoopAuthorityWire[] = [];
    const log = new AuthorityLog({
      localContext: FRAME,
      scheduler,
      send: w => sent.push(w),
      peerBindings: [{ seatId: 1, connectionGeneration: FRAME.connectionGeneration }],
    });
    const book = makeBook(controller.signal);

    const committed = log.commit(buildCommitted());
    book.acquireForEntry(committed);
    // One delivery-retry timer (log) + one request timer (lease).
    expect(scheduler.pendingTimerCount).toBe(2);

    // Drive the entry to its required stage; delivery retries stop + the entry retires.
    const receipt = (stage: CoopAuthorityReceipt["stage"]): CoopAuthorityReceipt => ({
      context: { ...committed.context, senderSeatId: 1 },
      revision: committed.revision,
      operationId: committed.operationId,
      stage,
      ...(stage === "controlInstalled" ? { controlId: turnCommandControlId(committed) as string } : {}),
    });
    log.acceptReceipt(receipt("admitted"));
    log.acceptReceipt(receipt("materialApplied"));
    expect(log.acceptReceipt(receipt("controlInstalled"))).toBe(true);
    // The integration retires the lease when the entry retires.
    book.retireEntry(committed);

    expect(log.retained()).toHaveLength(0);
    expect(book.leaseCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("a disposed book returns a no-op handle and never tracks a lease", () => {
    const controller = new AbortController();
    controller.abort("already-down");
    const book = makeBook(controller.signal);
    const handle = book.acquire("COMMAND/e1/w1/t1/s0/p1");
    handle.release();
    expect(book.leaseCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (2) REPLICA: pipeline emits admitted -> materialApplied -> controlInstalled
// ---------------------------------------------------------------------------

describe("turnMaterialApplier + applyEntry (replica pipeline)", () => {
  it("signs admitted -> materialApplied -> controlInstalled in order via replica.ts", () => {
    const entry = fullEntry();
    const controlId = turnCommandControlId(entry) as string;
    const rec = recordingSink();
    let appliedImage: TurnResolutionImage | null = null;

    const out = applyEntry(CTX, entry, {
      applyMaterial: turnMaterialApplier((_ctx, material) => {
        appliedImage = material.payload;
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });

    expect(rec.stages()).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(rec.receipts[2].controlId).toBe(controlId);
    expect(out).toEqual({ kind: "applied", controlId, presentationSettled: false });
    expect(appliedImage).toEqual(entry.material.payload);
  });

  it("refuses to apply (materialRejected) when the material digest does not match its payload", () => {
    const tampered: CoopAuthorityEntry = {
      ...fullEntry(),
      material: { digest: "deadbeefdeadbeef", payload: CAPTURE },
    };
    const rec = recordingSink();
    let applierCalls = 0;

    const out = applyEntry(CTX, tampered, {
      applyMaterial: turnMaterialApplier(() => {
        applierCalls += 1;
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId: "x" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });

    expect(applierCalls).toBe(0);
    expect(rec.stages()).toEqual(["admitted"]);
    expect(out.kind).toBe("materialRejected");
  });

  it("refuses a malformed (non-image) payload without calling the injected applier", () => {
    const malformed: CoopAuthorityEntry = {
      ...fullEntry(),
      material: { digest: "whatever", payload: { notAnImage: true } },
    };
    const rec = recordingSink();
    let applierCalls = 0;
    const out = applyEntry(CTX, malformed, {
      applyMaterial: turnMaterialApplier(() => {
        applierCalls += 1;
        return true;
      }),
      projector: fixedProjector({ kind: "installed", controlId: "x" }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    expect(applierCalls).toBe(0);
    expect(rec.stages()).toEqual(["admitted"]);
    expect(out.kind).toBe("materialRejected");
  });
});

// ---------------------------------------------------------------------------
// (3) SHADOW: parity record
// ---------------------------------------------------------------------------

describe("computeShadowParity", () => {
  it("matches when the legacy digest equals the v2 committed digest", () => {
    const entry = fullEntry();
    const parity = computeShadowParity(entry.material.digest, entry);
    expect(parity).toEqual({
      revision: entry.revision,
      operationId: entry.operationId,
      kind: "TURN_COMMIT",
      legacyDigest: entry.material.digest,
      v2Digest: entry.material.digest,
      digestsMatch: true,
    });
  });

  it("flags a divergence when the legacy digest differs (v2 computes, legacy controls)", () => {
    const entry = fullEntry();
    const parity = computeShadowParity("0000000000000000", entry);
    expect(parity.digestsMatch).toBe(false);
    expect(parity.v2Digest).toBe(entry.material.digest);
    expect(parity.legacyDigest).toBe("0000000000000000");
  });
});
