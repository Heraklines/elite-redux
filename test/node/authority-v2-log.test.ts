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
  private clock = 0;
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
  return { kind: "COMMAND", epoch: 1, wave: 1, turn: 1, ownerSeatId: 0, pokemonId: 42 };
}

function entryInput(
  operationId: string,
  opts: { nextControl?: CoopNextControl; subsumes?: number[]; context?: CoopFrameContextV2 } = {},
): Omit<CoopAuthorityEntry, "revision"> {
  return {
    context: opts.context ?? frameContext(),
    operationId,
    kind: "TURN_COMMIT",
    material: { digest: `digest-${operationId}`, payload: { op: operationId } },
    nextControl: opts.nextControl ?? null,
    subsumes: opts.subsumes ?? [],
  };
}

function fullEntry(
  revision: number,
  operationId: string,
  opts: { context?: CoopFrameContextV2; nextControl?: CoopNextControl } = {},
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
    ...over,
  });
}

function makeReplicaLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return makeLog(scheduler, sent, {
    localContext: frameContext({ senderSeatId: 1 }),
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
    expect(log.retained()).toHaveLength(1);

    // controlInstalled reaches the required stage -> NEWLY retired.
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
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

  it("a stale epoch is rejected as staleEpoch; membership/session mismatch reject", () => {
    const log = new AuthorityLog({
      localContext: frameContext({ sessionEpoch: 2, membershipRevision: 5, senderSeatId: 1 }),
      scheduler,
      send: wire => sent.push(wire),
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

    // Entry WITHOUT a nextControl: materialApplied alone retires it.
    const noControl = makeLog(scheduler, []);
    const b = noControl.commit(entryInput("op-2"));
    noControl.acceptReceipt(receipt(b, "admitted"));
    expect(noControl.acceptReceipt(receipt(b, "materialApplied"))).toBe(true);
    expect(noControl.retained()).toHaveLength(0);
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
