/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 2 node-pure tests (authority-v2-log).
//
// The authority log's import graph is engine/DOM-free (TYPE-only contract
// import), so it runs in the node-pure project in milliseconds. These pin the
// contract's load-bearing invariants:
//   - commit -> deliver -> apply -> retire happy path (retirement rule).
//   - admission never claims material application; failed material and deferred
//     control are retried at their exact unfinished stage.
//   - a mechanically-complete duplicate never re-applies (no double-mutate).
//   - a gap requests the tail (no local retry loop).
//   - a stale epoch is rejected (staleEpoch), membership/session mismatch too.
//   - supersession retires subsumed entries AND cancels their timers.
//   - presentationSettled is NEVER required for retirement.
//   - dispose leaves ZERO timers/leases (no orphans).
// =============================================================================

import {
  AuthorityLog,
  type AuthorityLogOptions,
  AuthorityRetentionOverflowError,
  type CoopAuthorityWire,
} from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopNextControl,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test doubles (engine-free)
// ---------------------------------------------------------------------------

interface FakeTimer {
  readonly id: number;
  readonly ownerId: string;
  readonly delayMs: number;
  readonly timeClass: CoopTimeClass;
  readonly callback: () => void;
}

/** A deterministic CoopScheduler: timers are inspectable + fireable; cancellation is exact. */
class FakeScheduler implements CoopScheduler {
  private seq = 0;
  private readonly clock = 0;
  readonly timers = new Map<number, FakeTimer>();

  now(_timeClass: CoopTimeClass): number {
    return this.clock;
  }

  schedule(owner: CoopTimerOwner, delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { id, ownerId: owner.ownerId, delayMs, timeClass, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const [id, timer] of this.timers) {
      if (timer.ownerId === ownerId) {
        this.timers.delete(id);
      }
    }
  }

  // --- test helpers ---

  liveCount(): number {
    return this.timers.size;
  }

  ownerCount(ownerId: string): number {
    return [...this.timers.values()].filter(t => t.ownerId === ownerId).length;
  }

  /** Fire every currently-scheduled timer once (a snapshot, so re-arm rescheduling does not loop forever). */
  fireAll(): void {
    for (const timer of [...this.timers.values()]) {
      if (this.timers.delete(timer.id)) {
        timer.callback();
      }
    }
  }
}

function frameContext(overrides: Partial<CoopFrameContextV2> = {}): CoopFrameContextV2 {
  return {
    sessionId: "session-A",
    runId: "run-A",
    sessionEpoch: 1,
    seatMapId: "seatmap-A",
    membershipRevision: 1,
    senderSeatId: 0,
    authoritySeatId: 0,
    connectionGeneration: 1,
    ...overrides,
  };
}

function commandControl(): CoopNextControl {
  return {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave: 1,
    turn: 1,
    commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
  };
}

function successorWait(afterOperationId: string, allowedKinds: readonly CoopAuthorityEntry["kind"][]): CoopNextControl {
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId,
    epoch: 1,
    wave: 1,
    turn: 1,
    allowedKinds,
    expectedOperationId: null,
  };
}

function entryInput(
  operationId: string,
  opts: {
    kind?: CoopAuthorityEntry["kind"];
    nextControl?: CoopNextControl;
    subsumes?: number[];
    context?: CoopFrameContextV2;
  } = {},
): Omit<CoopAuthorityEntry, "revision"> {
  const kind = opts.kind ?? "TURN_COMMIT";
  const payload = (() => {
    switch (kind) {
      case "TURN_COMMIT":
        return { epoch: 1, wave: 1, turn: 1 };
      case "REPLACEMENT_COMMIT":
        return { sourceAddress: { epoch: 1, wave: 1, turn: 1 } };
      case "INTERACTION_COMMIT":
        return {
          envelope: {
            sessionEpoch: 1,
            wave: 1,
            turn: 1,
            pendingOperation: { kind: "REWARD" },
          },
        };
      case "CONTROL_COMMIT":
      case "WAVE_ADVANCE":
      case "TERMINAL_COMMIT":
        return { wave: 1, turn: 1 };
    }
  })();
  return {
    context: opts.context ?? frameContext(),
    operationId,
    kind,
    material: { digest: `digest-${operationId}`, payload },
    nextControl: opts.nextControl ?? commandControl(),
    subsumes: opts.subsumes ?? [],
  };
}

function fullEntry(
  revision: number,
  operationId: string,
  opts: {
    kind?: CoopAuthorityEntry["kind"];
    context?: CoopFrameContextV2;
    nextControl?: CoopNextControl;
  } = {},
): CoopAuthorityEntry {
  return { ...entryInput(operationId, opts), revision };
}

function receipt(
  entry: CoopAuthorityEntry,
  stage: CoopAuthorityReceipt["stage"],
  overrides: Partial<CoopAuthorityReceipt> = {},
): CoopAuthorityReceipt {
  return {
    context: { ...entry.context, senderSeatId: 1 },
    revision: entry.revision,
    operationId: entry.operationId,
    stage,
    ...(stage === "controlInstalled" && entry.nextControl != null ? { controlId: controlIdOf(entry.nextControl) } : {}),
    ...overrides,
  };
}

function makeLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return new AuthorityLog({
    localContext: frameContext(),
    scheduler,
    send: wire => sent.push(wire),
    peerBindings: [{ seatId: 1, connectionGeneration: frameContext().connectionGeneration }],
    ...over,
  });
}

function makeReplicaLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return makeLog(scheduler, sent, {
    localContext: frameContext({ senderSeatId: 1 }),
    peerBindings: [{ seatId: 0, connectionGeneration: frameContext().connectionGeneration }],
    ...over,
  });
}

function delivered(sent: CoopAuthorityWire[]): CoopAuthorityEntry[] {
  return sent
    .filter((w): w is Extract<CoopAuthorityWire, { kind: "deliver" }> => w.kind === "deliver")
    .map(w => w.entry);
}

// ---------------------------------------------------------------------------

describe("authority-v2 log", () => {
  let scheduler: FakeScheduler;
  let sent: CoopAuthorityWire[];

  beforeEach(() => {
    scheduler = new FakeScheduler();
    sent = [];
  });

  it("commit -> deliver -> apply -> retire happy path", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-1", { nextControl: commandControl() }));

    // Committed under the next global revision, delivered once, retained, one redelivery timer armed.
    expect(committed.revision).toBe(1);
    expect(delivered(sent)).toHaveLength(1);
    expect(delivered(sent)[0].revision).toBe(1);
    expect(log.retained().map(e => e.revision)).toEqual([1]);
    let diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(1);
    expect(diag.activeDeliveryTimers).toBe(1);

    // Redelivery re-sends while unadmitted.
    scheduler.fireAll();
    expect(delivered(sent).length).toBeGreaterThan(1);

    // admitted does NOT stop delivery: a later material/control receipt may be lost, and redelivery is the
    // replica's retry trigger. The entry remains retained with one owned timer.
    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    diag = log.diagnostics();
    expect(diag.activeDeliveryTimers).toBe(1);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(1);
    expect(log.retained().map(e => e.revision)).toEqual([1]);

    // materialApplied alone does not retire an entry that states a nextControl.
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.peerStageQuorum(committed.operationId, "materialApplied")).toBe(true);
    expect(log.peerStageQuorum(committed.operationId, "controlInstalled")).toBe(false);
    expect(log.retained()).toHaveLength(1);

    // controlInstalled reaches the required stage -> NEWLY retired.
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
    // A continuation registered after synchronous loopback retirement still sees the authenticated quorum.
    expect(log.peerStageQuorum(committed.operationId, "materialApplied")).toBe(true);
    expect(log.peerStageQuorum(committed.operationId, "controlInstalled")).toBe(true);
    expect(log.retained()).toHaveLength(0);
    expect(log.diagnostics().retainedEntries).toBe(0);
    expect(scheduler.liveCount()).toBe(0);
  });

  it("rejects self-signed and address-mismatched control receipts", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-auth", { nextControl: commandControl() }));

    expect(
      log.acceptReceipt(
        receipt(committed, "admitted", {
          context: committed.context,
        }),
      ),
    ).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled", { controlId: "wrong-control" }))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
  });

  it("classifies receipt progress and every authentication failure without changing boolean retirement", () => {
    const log = makeLog(scheduler, sent, {
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    const committed = log.commit(entryInput("op-verdict", { nextControl: commandControl() }));

    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 4 },
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "connection-generation-mismatch" });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "duplicate", highestStage: 0 });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
          controlId: "wrong-control",
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "control-id-mismatch" });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: true, waitingForSeatIds: [] });
  });

  it("never lets presentation proof replace missing mechanical proof", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-presentation", { nextControl: commandControl() }));

    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "presentationSettled"))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "presentationSettled"))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
  });

  it("retires only after every frozen peer seat proves the exact connection generation", () => {
    const log = makeLog(scheduler, sent, {
      peerBindings: [
        { seatId: 1, connectionGeneration: 4 },
        { seatId: 2, connectionGeneration: 9 },
      ],
    });
    const committed = log.commit(entryInput("op-quorum"));

    for (const stage of ["admitted", "materialApplied", "controlInstalled"] as const) {
      expect(
        log.acceptReceipt(
          receipt(committed, stage, {
            context: { ...committed.context, senderSeatId: 1, connectionGeneration: 4 },
          }),
        ),
      ).toBe(false);
    }
    expect(log.retained()).toHaveLength(1);

    // Right seat, stale generation: cannot satisfy the frozen quorum.
    expect(
      log.acceptReceipt(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 8 },
        }),
      ),
    ).toBe(false);
    expect(log.retained()).toHaveLength(1);

    expect(
      log.acceptReceipt(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(false);
    expect(
      log.acceptReceipt(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(false);
    expect(
      log.acceptReceipt(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(true);
    expect(log.retained()).toHaveLength(0);
  });

  it("rebinds a retained authority lease across hot rejoin without resetting revision or receipt progress", () => {
    const initialContext = frameContext({ membershipRevision: 7, connectionGeneration: 3 });
    const log = makeLog(scheduler, sent, {
      localContext: initialContext,
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    const committed = log.commit(
      entryInput("op-rejoin", {
        context: initialContext,
        nextControl: commandControl(),
      }),
    );
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    const deliveriesBeforeRebind = delivered(sent).length;

    expect(
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toBe(1);
    const rebound = log.retained()[0];
    expect(rebound).toMatchObject({
      revision: 1,
      operationId: "op-rejoin",
      context: {
        membershipRevision: 8,
        connectionGeneration: 4,
      },
    });
    expect(delivered(sent)).toHaveLength(deliveriesBeforeRebind + 1);
    expect(delivered(sent).at(-1)).toEqual(rebound);

    // A delayed receipt flushed from the replaced channel cannot advance the rebound lease.
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "membership-mismatch" });

    // The admitted stage survived the channel replacement; the new generation resumes at material/control.
    expect(
      log.acceptReceiptDetailed(
        receipt(rebound, "materialApplied", {
          context: { ...rebound.context, senderSeatId: 1, connectionGeneration: 6 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    expect(
      log.acceptReceiptDetailed(
        receipt(rebound, "controlInstalled", {
          context: { ...rebound.context, senderSeatId: 1, connectionGeneration: 6 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: true, waitingForSeatIds: [] });
    expect(log.diagnostics()).toMatchObject({ headRevision: 1, retainedEntries: 0 });
  });

  it("rebinds an unfinished replica entry to the new authority generation without re-applying old frames", () => {
    const initialLocal = frameContext({ senderSeatId: 1, membershipRevision: 7, connectionGeneration: 5 });
    const log = makeReplicaLog(scheduler, sent, {
      localContext: initialLocal,
      peerBindings: [{ seatId: 0, connectionGeneration: 3 }],
    });
    const oldEntry = fullEntry(1, "op-rejoin-replica", {
      context: frameContext({ membershipRevision: 7, connectionGeneration: 3 }),
      nextControl: commandControl(),
    });
    expect(log.admit(oldEntry)).toEqual({ kind: "admitted" });

    expect(
      log.rebindConnection(frameContext({ senderSeatId: 1, membershipRevision: 8, connectionGeneration: 6 }), [
        { seatId: 0, connectionGeneration: 4 },
      ]),
    ).toBe(0);
    expect(log.admit(oldEntry)).toEqual({ kind: "rejected", reason: "membership-mismatch" });

    const reboundEntry: CoopAuthorityEntry = {
      ...oldEntry,
      context: { ...oldEntry.context, membershipRevision: 8, connectionGeneration: 4 },
    };
    expect(log.admit(reboundEntry)).toEqual({ kind: "duplicate-pending-material" });
    expect(log.recordReplicaStage(reboundEntry, "materialApplied")).toBe(true);
    expect(log.recordReplicaStage(reboundEntry, "controlInstalled")).toBe(true);
    expect(log.controlInstalledThrough()).toBe(1);
  });

  it("refuses a hot-rejoin rebind that changes a stable session axis or rolls a generation back", () => {
    const log = makeLog(scheduler, sent, {
      localContext: frameContext({ membershipRevision: 7, connectionGeneration: 3 }),
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    expect(() =>
      log.rebindConnection(frameContext({ runId: "other-run", membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toThrow(/stable authenticated axis/u);
    expect(() =>
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 2 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toThrow(/stable authenticated axis/u);
    expect(() =>
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 4 },
      ]),
    ).toThrow(/peer seat or rolled back/u);
  });

  it("keeps receipt, material, and control truth separate and retries only the unfinished stage", () => {
    const log = makeReplicaLog(scheduler, sent);
    const entry = fullEntry(1, "op-1", { nextControl: commandControl() });

    expect(log.admit(entry)).toEqual({ kind: "admitted" });
    expect(log.receivedThrough()).toBe(1);
    expect(log.appliedThrough()).toBe(0);
    expect(log.controlInstalledThrough()).toBe(0);

    // A failed material apply leaves the entry retryable instead of turning admission into a false green.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-pending-material" });
    expect(log.appliedThrough()).toBe(0);
    expect(log.recordReplicaStage(entry, "materialApplied")).toBe(true);
    expect(log.appliedThrough()).toBe(1);
    expect(log.controlInstalledThrough()).toBe(0);

    // Material is not re-applied while only control remains unfinished.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-pending-control" });
    expect(log.recordReplicaStage(entry, "controlInstalled")).toBe(true);
    expect(log.controlInstalledThrough()).toBe(1);

    // Once mechanically complete, redelivery only republishes proof.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-complete" });
    expect(log.recordReplicaStage(entry, "materialApplied")).toBe(false);
  });

  it("a gap requests the tail via send (no local retry loop)", () => {
    const log = makeReplicaLog(scheduler, sent);
    const result = log.admit(fullEntry(3, "op-3"));

    expect(result).toEqual({ kind: "gap", missingFrom: 1 });
    const tails = sent.filter(w => w.kind === "requestTail");
    expect(tails).toHaveLength(1);
    expect(tails[0]).toMatchObject({ kind: "requestTail", missingFrom: 1 });
    // The replica arms NO timer of its own - the authority's redelivery is the only retry.
    expect(scheduler.liveCount()).toBe(0);
    expect(log.appliedThrough()).toBe(0);
  });

  it("admits an explicit CONTROL_COMMIT only from its ordered wait and closes on the stated command", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("interaction-result", {
        kind: "INTERACTION_COMMIT",
        nextControl: successorWait("interaction-result", ["CONTROL_COMMIT"]),
      }),
    );

    const opened = log.commit(
      entryInput("command-open", {
        kind: "CONTROL_COMMIT",
        nextControl: commandControl(),
      }),
    );
    expect(opened).toMatchObject({
      revision: 2,
      kind: "CONTROL_COMMIT",
      nextControl: { kind: "COMMAND_FRONTIER" },
    });

    expect(() =>
      log.commit(
        entryInput("unrelated-interaction", {
          kind: "INTERACTION_COMMIT",
          nextControl: successorWait("unrelated-interaction", ["CONTROL_COMMIT"]),
        }),
      ),
    ).toThrow(/not authorized by predecessor control/u);
  });

  it("rejects CONTROL_COMMIT when the predecessor wait did not explicitly permit it", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("interaction-result", {
        kind: "INTERACTION_COMMIT",
        nextControl: successorWait("interaction-result", ["WAVE_ADVANCE"]),
      }),
    );
    expect(() =>
      log.commit(
        entryInput("command-open", {
          kind: "CONTROL_COMMIT",
          nextControl: commandControl(),
        }),
      ),
    ).toThrow(/not authorized by predecessor control/u);
  });

  it("coalesces repeated later revisions into one tail request until the missing frontier completes", () => {
    const log = makeReplicaLog(scheduler, sent);

    // A full authority tail may replay several later retained entries while revision 1 is still missing.
    // Every one classifies as the same gap, but exactly one tail request may leave the replica.
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(log.admit(fullEntry(4, "op-4"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(sent.filter(wire => wire.kind === "requestTail")).toHaveLength(1);

    // Merely admitting the predecessor does not re-arm the request: a later entry is still a gap until the
    // predecessor's real material/control terminal stage completes.
    const first = fullEntry(1, "op-1");
    expect(log.admit(first)).toEqual({ kind: "admitted" });
    expect(log.admit(fullEntry(2, "op-2"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(sent.filter(wire => wire.kind === "requestTail")).toHaveLength(1);
    expect(log.recordReplicaStage(first, "materialApplied")).toBe(true);

    // A committed entry always has an explicit successor, so its frontier completes only after the exact
    // control-install proof. A new, genuinely different gap can then request from revision 2 once.
    expect(log.recordReplicaStage(first, "controlInstalled")).toBe(true);
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(log.admit(fullEntry(4, "op-4"))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(
      sent
        .filter(wire => wire.kind === "requestTail")
        .map(wire => (wire.kind === "requestTail" ? wire.missingFrom : 0)),
    ).toEqual([1, 2]);
  });

  it("a stale epoch is rejected as staleEpoch; membership/session mismatch reject", () => {
    const log = new AuthorityLog({
      localContext: frameContext({ sessionEpoch: 2, membershipRevision: 5, senderSeatId: 1 }),
      scheduler,
      send: wire => sent.push(wire),
      peerBindings: [{ seatId: 0, connectionGeneration: frameContext().connectionGeneration }],
    });

    // Same session identity, older epoch generation -> staleEpoch (never rejected/duplicate).
    expect(
      log.admit(fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 1, membershipRevision: 5 }) })),
    ).toEqual({ kind: "staleEpoch" });

    // Right epoch, wrong membership generation -> rejected.
    expect(
      log.admit(fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 2, membershipRevision: 4 }) })).kind,
    ).toBe("rejected");

    // Different seat map (session identity) -> rejected, not staleEpoch.
    expect(
      log.admit(
        fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 2, membershipRevision: 5, seatMapId: "other" }) }),
      ).kind,
    ).toBe("rejected");

    // Right authority seat, stale authenticated channel generation -> rejected.
    expect(
      log.admit(
        fullEntry(1, "op-1", {
          context: frameContext({ sessionEpoch: 2, membershipRevision: 5, connectionGeneration: 0 }),
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "authority-sender-mismatch" });

    // Nothing was applied through any rejection/stale path.
    expect(log.appliedThrough()).toBe(0);
  });

  it("supersession retires subsumed entries and cancels their timers", () => {
    const log = makeLog(scheduler, sent);
    const a = log.commit(entryInput("op-1")); // revision 1, no nextControl
    const b = log.commit(entryInput("op-2", { subsumes: [1] })); // revision 2 subsumes 1
    expect(a.revision).toBe(1);
    expect(b.revision).toBe(2);
    expect(log.retained().map(e => e.revision)).toEqual([1, 2]);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(1);

    // b admitted -> supersession retires revision 1 (subsumed) and cancels its lease timers.
    log.acceptReceipt(receipt(b, "admitted"));
    expect(log.retained().map(e => e.revision)).toEqual([2]);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(0);
    // b itself is only admitted (required = materialApplied since no nextControl), so its retry remains live.
    expect(log.diagnostics().activeDeliveryTimers).toBe(1);
  });

  it("presentationSettled is NEVER required for retirement", () => {
    // Entry WITH a nextControl: required stage is controlInstalled - retire there, no presentationSettled.
    const withControl = makeLog(scheduler, sent);
    const a = withControl.commit(entryInput("op-1", { nextControl: commandControl() }));
    withControl.acceptReceipt(receipt(a, "admitted"));
    withControl.acceptReceipt(receipt(a, "materialApplied"));
    expect(withControl.acceptReceipt(receipt(a, "controlInstalled"))).toBe(true);
    expect(withControl.retained()).toHaveLength(0);

    // An explicit ordered wait is also a real installed control, but presentation proof is still irrelevant.
    const withOrderedWait = makeLog(scheduler, []);
    const b = withOrderedWait.commit(
      entryInput("op-2", { nextControl: successorWait("op-2", ["INTERACTION_COMMIT"]) }),
    );
    withOrderedWait.acceptReceipt(receipt(b, "admitted"));
    expect(withOrderedWait.acceptReceipt(receipt(b, "materialApplied"))).toBe(false);
    expect(withOrderedWait.acceptReceipt(receipt(b, "controlInstalled"))).toBe(true);
    expect(withOrderedWait.retained()).toHaveLength(0);
  });

  it("builds a contiguous recovery slice and retains the last stated control after retirement", () => {
    const log = makeLog(scheduler, sent);
    const first = log.commit(entryInput("op-recovery-1"));
    const second = log.commit(entryInput("op-recovery-2", { nextControl: commandControl() }));

    expect(log.recoverySlice(0)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [first, second],
    });
    expect(log.recoverySlice(1)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [second],
    });

    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);
    expect(log.acceptReceipt(receipt(second, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(second, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(second, "controlInstalled"))).toBe(true);
    expect(log.retained()).toHaveLength(0);
    expect(log.recoverySlice(2)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [second],
    });
  });

  it("allows only the immediate entry kind named by an authority successor wait", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("op-wait", {
        nextControl: successorWait("op-wait", ["INTERACTION_COMMIT"]),
      }),
    );

    expect(() => log.commit(entryInput("op-wrong", { kind: "WAVE_ADVANCE" }))).toThrow(
      /not authorized by predecessor control/,
    );
    const successor = log.commit(entryInput("op-right", { kind: "INTERACTION_COMMIT" }));
    expect(successor.revision).toBe(2);
  });

  it("rejects a right-kind successor carrying the wrong live wave/turn coordinate", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("op-coordinate-wait", {
        nextControl: successorWait("op-coordinate-wait", ["INTERACTION_COMMIT"]),
      }),
    );
    const wrongCoordinate = {
      ...entryInput("1:0:REWARD:1", { kind: "INTERACTION_COMMIT" }),
      material: {
        digest: "coordinate-digest",
        payload: {
          envelope: {
            sessionEpoch: 1,
            wave: 2,
            turn: 1,
          },
        },
      },
    };
    expect(() => log.commit(wrongCoordinate)).toThrow(/not authorized by predecessor control/);
  });

  it("keeps a replica successor wait until an exact allowed next revision is admitted", () => {
    const log = makeReplicaLog(scheduler, sent);
    const predecessor = fullEntry(1, "op-wait", {
      nextControl: successorWait("op-wait", ["INTERACTION_COMMIT"]),
    });
    expect(log.admit(predecessor)).toEqual({ kind: "admitted" });
    expect(log.recordReplicaStage(predecessor, "materialApplied")).toBe(true);
    expect(log.recordReplicaStage(predecessor, "controlInstalled")).toBe(true);

    expect(log.admit(fullEntry(2, "op-wrong", { kind: "WAVE_ADVANCE" }))).toEqual({
      kind: "rejected",
      reason: "predecessor-control-mismatch",
    });
    expect(log.receivedThrough()).toBe(1);
    expect(log.admit(fullEntry(2, "op-right", { kind: "INTERACTION_COMMIT" }))).toEqual({ kind: "admitted" });
  });

  it("reconstructs an exact successor wait from an empty-tail recovery frontier", () => {
    const log = makeReplicaLog(scheduler, sent);
    log.adoptFrontier(7, {
      operationId: "op-frontier",
      nextControl: successorWait("op-frontier", ["WAVE_ADVANCE"]),
    });

    expect(log.admit(fullEntry(8, "op-wrong", { kind: "TURN_COMMIT" }))).toEqual({
      kind: "rejected",
      reason: "predecessor-control-mismatch",
    });
    expect(log.admit(fullEntry(8, "op-wave", { kind: "WAVE_ADVANCE" }))).toEqual({ kind: "admitted" });
  });

  it("refuses a recovery slice with an impossible hole or a frontier ahead of authority", () => {
    const log = makeLog(scheduler, sent);
    const first = log.commit(entryInput("op-recovery-hole-1"));
    log.commit(entryInput("op-recovery-hole-2"));
    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);

    // A real replica that still reported frontier 0 could not have retired revision 1. Refuse the
    // contradictory request rather than returning revision 2 as if it were a complete tail.
    expect(log.recoverySlice(0)).toBeNull();
    expect(log.recoverySlice(3)).toBeNull();
    expect(log.recoverySlice(-1)).toBeNull();
  });

  it("dispose leaves zero timers and zero leases", () => {
    const log = makeLog(scheduler, sent);
    log.commit(entryInput("op-1", { nextControl: commandControl() }));
    log.commit(entryInput("op-2", { nextControl: commandControl() }));
    log.commit(entryInput("op-3"));
    expect(log.diagnostics().retainedEntries).toBe(3);
    expect(scheduler.liveCount()).toBe(3);

    log.dispose("teardown");
    const diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(0);
    expect(diag.deliveryLeases).toBe(0);
    expect(diag.activeDeliveryTimers).toBe(0);
    expect(diag.disposed).toBe(true);
    expect(scheduler.liveCount()).toBe(0);
  });

  it("refuses capacity overflow without evicting truth or burning a revision", () => {
    const log = makeLog(scheduler, sent, { retainCapacity: 2 });
    const first = log.commit(entryInput("op-1"));
    const second = log.commit(entryInput("op-2"));

    expect(() => log.commit(entryInput("op-refused"))).toThrow(AuthorityRetentionOverflowError);
    expect(log.retained().map(entry => entry.revision)).toEqual([1, 2]);
    expect(log.diagnostics()).toMatchObject({
      headRevision: 2,
      retainedEntries: 2,
      retentionCapacity: 2,
      retentionRefusals: 1,
    });
    expect(scheduler.liveCount()).toBe(2);

    // Once exact proof retires the oldest truth, the next real commit receives revision 3. The refused
    // attempt never existed and therefore cannot create a gap at the replica.
    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);
    const third = log.commit(entryInput("op-3"));
    expect(third.revision).toBe(3);
    expect(log.retained().map(entry => entry.revision)).toEqual([second.revision, third.revision]);
  });

  it("publishes nothing and burns no revision when authority-local successor reservation fails", () => {
    const log = makeLog(scheduler, sent);
    const prepared: number[] = [];

    expect(() =>
      log.commit(entryInput("op-refused-local"), entry => {
        prepared.push(entry.revision);
        return null;
      }),
    ).toThrow("authority-local successor reservation refused");
    expect(prepared).toEqual([1]);
    expect(delivered(sent)).toEqual([]);
    expect(log.retained()).toEqual([]);
    expect(log.diagnostics()).toMatchObject({
      headRevision: 0,
      retainedEntries: 0,
      activeDeliveryTimers: 0,
    });

    const committed = log.commit(entryInput("op-after-refusal"), () => () => {});
    expect(committed.revision).toBe(1);
    expect(delivered(sent).map(entry => entry.operationId)).toEqual(["op-after-refusal"]);
  });

  it("keeps a committed entry retryable when the carrier throws synchronously", () => {
    let attempts = 0;
    const log = makeLog(scheduler, [], {
      send: () => {
        attempts += 1;
        throw new Error("carrier unavailable");
      },
    });

    const committed = log.commit(entryInput("op-send-fault"));
    expect(committed.revision).toBe(1);
    expect(attempts).toBe(1);
    expect(log.retained()).toHaveLength(1);
    expect(log.diagnostics()).toMatchObject({ activeDeliveryTimers: 1, wireSendFailures: 1 });

    scheduler.fireAll();
    expect(attempts).toBeGreaterThan(1);
    expect(log.retained()).toHaveLength(1);
    expect(log.diagnostics().activeDeliveryTimers).toBe(1);
  });

  it("retention immutability: mutating the committed return cannot rewrite the delivered/retained entry", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-1"));
    // The committed entry is frozen; a mutation attempt is a no-op (silent in sloppy mode, throws in strict).
    expect(Object.isFrozen(committed)).toBe(true);
    expect(() => {
      (committed as { operationId: string }).operationId = "tampered";
    }).toThrow();
    expect(log.retained()[0].operationId).toBe("op-1");
    expect(delivered(sent)[0].operationId).toBe("op-1");
  });
});
