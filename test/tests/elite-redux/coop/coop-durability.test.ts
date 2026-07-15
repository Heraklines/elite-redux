/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Wave-2b transport durability (contract doc §4): engine-free unit tests for the durability CORE -
// message classification (§4.1), the bounded outbound queue + backpressure (§4.3), the revision-keyed
// journal with cumulative ACK/resend (§4.1/§4.2), the receiver idempotency ledger (§1.6), and the
// reconnect-from-revision tail/full-snapshot decision (§4.4). No engine, no globalScene, no Phaser.

import {
  COOP_DEFAULT_QUEUE_BOUNDS,
  CoopDurabilityManager,
  CoopJournal,
  CoopOutboundQueue,
  CoopReceiveLedger,
  classifyCoopMessage,
  isCoopCosmeticMessage,
  isCoopDurabilityEnabled,
  isCoopDurableMessage,
  setCoopDurabilityEnabled,
} from "#data/elite-redux/coop/coop-durability";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

/** A durable authoritative frame (wave resolution) keyed for the journal by class+seq externally. */
function durableMsg(wave: number): CoopMessage {
  return { t: "waveResolved", wave, outcome: "win" };
}
function nestedDurableMsg(value: number): Extract<CoopMessage, { t: "rewardOptions" }> {
  return {
    t: "rewardOptions",
    seq: 1,
    reroll: 0,
    options: [{ id: "RARE_CANDY", tier: 0, upgradeCount: 0, cost: 0, pregenArgs: [value] }],
  };
}
/** A cosmetic frame (render tick) - sheddable, never journaled. */
function cosmeticMsg(seq: number): CoopMessage {
  return { t: "battleEvent", epoch: 7, wave: 1, turn: 1, seq, event: { k: "msg", text: "x" } as never };
}

describe("durability §4.1: message classification (authoritative vs cosmetic vs internal)", () => {
  it("classifies the authoritative backbone as durable", () => {
    const durable: CoopMessage[] = [
      { t: "waveResolved", wave: 1, outcome: "win" },
      { t: "waveEndState", wave: 1, state: {} as never },
      {
        t: "turnResolution",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 2,
        events: [],
        checkpoint: {} as never,
        checksum: "1",
        preimage: "{}",
        fullField: [{} as never],
        authoritativeState: {} as never,
      },
      {
        t: "battleCheckpoint",
        reason: "r",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 2,
        checkpoint: {} as never,
        checksum: "1",
        fullField: [{} as never],
        authoritativeState: {} as never,
      },
      { t: "requestTurnCommit", epoch: 7, wave: 1, turn: 1, revision: 2 },
      { t: "turnCommitPending", epoch: 7, wave: 1, turn: 1 },
      {
        t: "turnCommitAck",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 2,
        checkpointTick: 1,
        stateTick: 2,
        checksum: "deadbeefdeadbeef",
        stage: "continuationReady",
        status: "applied",
      },
      {
        t: "requestBattleCheckpoint",
        reason: "replacement",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 2,
        checkpointTick: 1,
        stateTick: 2,
      },
      {
        t: "battleCheckpointAck",
        reason: "replacement",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 2,
        checkpointTick: 1,
        stateTick: 2,
        checksum: "deadbeefdeadbeef",
        stage: "continuationReady",
      },
      {
        t: "authorityFailure",
        failureId: "fatal-1",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 3,
        boundary: "turnResolution",
        reason: "capture failed",
      },
      {
        t: "authorityFailureAck",
        failureId: "fatal-1",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 3,
        boundary: "turnResolution",
      },
      { t: "interactionChoice", seq: 1, kind: "reward", choice: 0 },
      { t: "interactionOutcome", seq: 1, kind: "reward", outcome: { k: "reward" } as never },
      { t: "stateSync", blob: "b", seq: 1 },
      { t: "launchSnapshot", wave: 1, session: "s" },
      { t: "runConfig", difficulty: "elite", challenges: [] },
      { t: "rosterSync", role: "host", entries: [], ready: true },
      { t: "command", fieldIndex: 0, turn: 1, command: {} as never },
      { t: "rendezvous", point: "cmd:1:1" },
    ];
    for (const m of durable) {
      expect(classifyCoopMessage(m), m.t).toBe("durable");
      expect(isCoopDurableMessage(m), m.t).toBe(true);
      expect(isCoopCosmeticMessage(m), m.t).toBe(false);
    }
  });

  it("classifies presentation-only cue streams as cosmetic (sheddable, never journaled)", () => {
    const cosmetic: CoopMessage[] = [
      { t: "battleEvent", epoch: 7, wave: 1, turn: 1, seq: 0, event: { k: "msg", text: "x" } as never },
      { t: "uiInput", seq: 1, n: 0, button: 0, mode: 0 },
      { t: "meCursor", index: 0 },
      { t: "meMessage", text: "hi" },
    ];
    for (const m of cosmetic) {
      expect(classifyCoopMessage(m), m.t).toBe("cosmetic");
      expect(isCoopCosmeticMessage(m), m.t).toBe(true);
      expect(isCoopDurableMessage(m), m.t).toBe(false);
    }
  });

  it("classifies keepalive/liveness frames as internal (never queued, never journaled)", () => {
    for (const m of [
      { t: "ping", ts: 1 },
      { t: "pong", ts: 1 },
      { t: "stallBeat", waitingMs: 1 },
    ] as CoopMessage[]) {
      expect(classifyCoopMessage(m), m.t).toBe("internal");
      expect(isCoopDurableMessage(m), m.t).toBe(false);
      expect(isCoopCosmeticMessage(m), m.t).toBe(false);
    }
  });
});

describe("durability §5: the feature flag is a runtime-flippable both-state switch", () => {
  afterEach(() => setCoopDurabilityEnabled(true));

  it("defaults ON and flips both ways", () => {
    expect(isCoopDurabilityEnabled()).toBe(true);
    setCoopDurabilityEnabled(false);
    expect(isCoopDurabilityEnabled()).toBe(false);
    setCoopDurabilityEnabled(true);
    expect(isCoopDurabilityEnabled()).toBe(true);
  });
});

describe("durability §4.3: bounded outbound queue + backpressure", () => {
  it("enqueues durable frames while dark and flushes them FIFO on drain (no silent drop)", () => {
    const q = new CoopOutboundQueue();
    expect(q.offer(durableMsg(1), 10)).toBe("queued");
    expect(q.offer(durableMsg(2), 10)).toBe("queued");
    expect(q.offer(durableMsg(3), 10)).toBe("queued");
    expect(q.size()).toBe(3);
    expect(q.byteSize()).toBe(30);

    const flushed: number[] = [];
    q.drain(m => flushed.push((m as { wave: number }).wave));
    expect(flushed).toEqual([1, 2, 3]); // FIFO order preserved
    expect(q.size()).toBe(0);
    expect(q.byteSize()).toBe(0);
  });

  it("owns an immutable snapshot of a dark-channel frame", () => {
    const q = new CoopOutboundQueue();
    const offered = nestedDurableMsg(11);
    expect(q.offer(offered, 10)).toBe("queued");
    offered.options[0].pregenArgs![0] = 99;

    const flushed: number[] = [];
    q.drain(message => {
      if (message.t === "rewardOptions") {
        flushed.push(message.options[0].pregenArgs?.[0] ?? -1);
        message.options[0].pregenArgs![0] = 77;
      }
    });
    expect(flushed).toEqual([11]);
  });

  it("sheds cosmetic/internal frames instead of queuing them (fire-and-forget)", () => {
    const q = new CoopOutboundQueue();
    expect(q.offer(cosmeticMsg(1), 10)).toBe("shed");
    expect(q.offer({ t: "ping", ts: 1 }, 10)).toBe("shed");
    expect(q.size()).toBe(0);
  });

  it("COLLAPSES on count overflow: drops the backlog, raises needsResync, replays nothing", () => {
    const q = new CoopOutboundQueue({ maxCount: 3, maxBytes: 1 << 20 });
    expect(q.offer(durableMsg(1), 10)).toBe("queued");
    expect(q.offer(durableMsg(2), 10)).toBe("queued");
    expect(q.offer(durableMsg(3), 10)).toBe("queued");
    expect(q.needsResync()).toBe(false);
    // 4th durable frame exceeds maxCount -> collapse.
    expect(q.offer(durableMsg(4), 10)).toBe("collapsed");
    expect(q.needsResync()).toBe(true);
    expect(q.size()).toBe(0);

    const flushed: number[] = [];
    q.drain(m => flushed.push((m as { wave: number }).wave));
    expect(flushed).toEqual([]); // collapsed backlog is NOT replayed (journal reconnect covers it)
    expect(q.needsResync()).toBe(true);
    q.clearResync();
    expect(q.needsResync()).toBe(false);
  });

  it("COLLAPSES on byte overflow independently of count", () => {
    const q = new CoopOutboundQueue({ maxCount: 1000, maxBytes: 100 });
    expect(q.offer(durableMsg(1), 60)).toBe("queued");
    expect(q.offer(durableMsg(2), 60)).toBe("collapsed"); // 120 > 100
    expect(q.needsResync()).toBe(true);
  });

  it("exposes sane defaults", () => {
    expect(COOP_DEFAULT_QUEUE_BOUNDS.maxCount).toBeGreaterThan(0);
    expect(COOP_DEFAULT_QUEUE_BOUNDS.maxBytes).toBeGreaterThan(0);
  });
});

describe("durability §4.1/§4.2: journal commit + cumulative ACK + resend tail", () => {
  it("records committed ops per class with a monotonic high-water mark", () => {
    const j = new CoopJournal();
    j.commit("envelope", 1, durableMsg(1));
    j.commit("envelope", 2, durableMsg(2));
    j.commit("envelope", 3, durableMsg(3));
    expect(j.highWaterMark("envelope")).toBe(3);
    expect(j.depth()).toBe(3);
    expect(j.classes()).toEqual(["envelope"]);
  });

  it("keeps journal retention immutable from caller and replay-consumer mutation", () => {
    const j = new CoopJournal();
    const committed = nestedDurableMsg(12);
    expect(j.commit("envelope", 1, committed)).toBe(true);
    committed.options[0].pregenArgs![0] = 98;

    const replay = j.resendTail("envelope");
    expect((replay[0].msg as Extract<CoopMessage, { t: "rewardOptions" }>).options[0].pregenArgs).toEqual([12]);
    (replay[0].msg as Extract<CoopMessage, { t: "rewardOptions" }>).options[0].pregenArgs![0] = 76;

    expect(
      (j.entry("envelope", 1)?.msg as Extract<CoopMessage, { t: "rewardOptions" }>).options[0].pregenArgs,
      "mutating a returned replay copy cannot rewrite the retained identity",
    ).toEqual([12]);
    expect(j.commit("envelope", 1, nestedDurableMsg(12))).toBe(true);
    expect(j.commit("envelope", 1, nestedDurableMsg(13))).toBe(false);
  });

  it("resendTail returns the committed-but-unacked tail; a cumulative ACK shrinks it (§4.2)", () => {
    const j = new CoopJournal();
    for (let r = 1; r <= 5; r++) {
      j.commit("envelope", r, durableMsg(r));
    }
    // Nothing acked yet -> the whole run is unacked.
    expect(j.resendTail("envelope").map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(j.unackedCount()).toBe(5);

    // Guest acks through 3 (cumulative) -> only 4,5 remain to resend.
    j.ack("envelope", 3);
    expect(j.ackedThrough("envelope")).toBe(3);
    expect(j.resendTail("envelope").map(e => e.seq)).toEqual([4, 5]);
    expect(j.unackedCount()).toBe(2);

    // A stale/older ACK is ignored (cumulative, monotonic).
    j.ack("envelope", 1);
    expect(j.ackedThrough("envelope")).toBe(3);

    // Ack through head -> nothing to resend.
    j.ack("envelope", 5);
    expect(j.resendTail("envelope")).toEqual([]);
    expect(j.unackedCount()).toBe(0);
  });

  it("DROP-BEFORE-ACK resend: a committed op whose ACK never arrived is exactly the resend tail", () => {
    const j = new CoopJournal();
    j.commit("envelope", 1, durableMsg(1));
    j.commit("envelope", 2, durableMsg(2)); // <- this broadcast is DROPPED on the wire
    j.commit("envelope", 3, durableMsg(3));
    // The guest only saw + acked revision 1 (2 was lost, so it can't have applied 3 in order either).
    j.ack("envelope", 1);
    // The host's resend set is the tail after the last ACK: exactly {2,3}.
    expect(j.resendTail("envelope").map(e => e.seq)).toEqual([2, 3]);
  });

  it("an exact retry restores an absent high-water entry and rejects a conflicting same-seq payload", () => {
    const j = new CoopJournal(4);
    j.restoreHighWater({ envelope: 5 });
    expect(j.highWaterMark("envelope"), "cold resume retained the committed revision identity").toBe(5);
    expect(j.tailFrom("envelope", 4), "the bounded replay entry itself was not persisted").toEqual([]);

    expect(j.commit("envelope", 5, durableMsg(5)), "exact retry concretely restores replayability").toBe(true);
    expect(j.tailFrom("envelope", 4)).toEqual([
      expect.objectContaining({ cls: "envelope", seq: 5, msg: durableMsg(5) }),
    ]);

    expect(
      j.commit("envelope", 5, durableMsg(6)),
      "the immutable revision cannot be rebound to a conflicting wire payload",
    ).toBe(false);
    expect(j.tailFrom("envelope", 4)[0].msg).toEqual(durableMsg(5));
  });
});

describe("durability §1.6: receiver idempotency ledger (duplicate + gap detection)", () => {
  it("applies each revision exactly once, in order", () => {
    const rx = new CoopReceiveLedger();
    expect(rx.shouldApply("envelope", 1)).toBe(true);
    rx.markApplied("envelope", 1);
    expect(rx.appliedThrough("envelope")).toBe(1);

    expect(rx.shouldApply("envelope", 2)).toBe(true);
    rx.markApplied("envelope", 2);
    expect(rx.appliedThrough("envelope")).toBe(2);
  });

  it("DUPLICATE-DELIVERY idempotence: a re-delivered applied revision is a no-op (safe resend)", () => {
    const rx = new CoopReceiveLedger();
    rx.markApplied("envelope", 1);
    rx.markApplied("envelope", 2);
    // Host resends 1 and 2 (it didn't see the ACK) -> the guest treats them as duplicates, not re-applies.
    expect(rx.isDuplicate("envelope", 1)).toBe(true);
    expect(rx.isDuplicate("envelope", 2)).toBe(true);
    expect(rx.shouldApply("envelope", 1)).toBe(false);
    expect(rx.shouldApply("envelope", 2)).toBe(false);
    // markApplied is monotonic: a duplicate does not rewind the mark.
    rx.markApplied("envelope", 1);
    expect(rx.appliedThrough("envelope")).toBe(2);
  });

  it("GAP detection: a revision that skips ahead is not applied out of order (→ request tail)", () => {
    const rx = new CoopReceiveLedger();
    rx.markApplied("envelope", 1);
    // Revision 3 arrives but 2 was missed.
    expect(rx.hasGap("envelope", 3)).toBe(true);
    expect(rx.shouldApply("envelope", 3)).toBe(false);
    // After the tail fills 2, 3 applies.
    expect(rx.shouldApply("envelope", 2)).toBe(true);
    rx.markApplied("envelope", 2);
    expect(rx.hasGap("envelope", 3)).toBe(false);
    expect(rx.shouldApply("envelope", 3)).toBe(true);
  });
});

describe("durability §4.4: reconnect-from-revision (tail replay vs full-snapshot fallback)", () => {
  it("serves the journal tail after the guest's last-applied revision, in order", () => {
    const j = new CoopJournal();
    for (let r = 1; r <= 6; r++) {
      j.commit("envelope", r, durableMsg(r));
    }
    // Guest reconnects having applied through 3: it needs 4,5,6.
    expect(j.needsFullSnapshot("envelope", 3)).toBe(false);
    expect(j.tailFrom("envelope", 3).map(e => e.seq)).toEqual([4, 5, 6]);
  });

  it("REPLAY re-converges an idempotent receiver after a mid-stream cut", () => {
    const j = new CoopJournal();
    const rx = new CoopReceiveLedger();
    // Host commits 1..5; the guest applied 1..2 then the channel was cut (3,4,5 lost).
    for (let r = 1; r <= 5; r++) {
      j.commit("envelope", r, durableMsg(r));
    }
    rx.markApplied("envelope", 1);
    rx.markApplied("envelope", 2);

    // Reconnect: host replays the tail after the guest's last-applied revision (2).
    for (const e of j.tailFrom("envelope", rx.appliedThrough("envelope"))) {
      if (rx.shouldApply(e.cls, e.seq)) {
        rx.markApplied(e.cls, e.seq);
      }
    }
    // The guest has now converged to head, in order, with no double-apply.
    expect(rx.appliedThrough("envelope")).toBe(5);
  });

  it("REPLAY is idempotent even if the tail overlaps what the guest already applied", () => {
    const j = new CoopJournal();
    const rx = new CoopReceiveLedger();
    for (let r = 1; r <= 4; r++) {
      j.commit("envelope", r, durableMsg(r));
    }
    rx.markApplied("envelope", 1);
    rx.markApplied("envelope", 2);
    rx.markApplied("envelope", 3);
    // Host, unsure of the guest's exact progress, replays from an OLDER point (from=1): 2,3 are duplicates.
    let applied = 0;
    for (const e of j.tailFrom("envelope", 1)) {
      if (rx.shouldApply(e.cls, e.seq)) {
        rx.markApplied(e.cls, e.seq);
        applied++;
      }
    }
    expect(applied).toBe(1); // only revision 4 was genuinely new
    expect(rx.appliedThrough("envelope")).toBe(4);
  });

  it("falls back to a FULL SNAPSHOT when the gap is deeper than the bounded ring", () => {
    const j = new CoopJournal(4); // ring holds only the last 4 revisions
    for (let r = 1; r <= 10; r++) {
      j.commit("envelope", r, durableMsg(r));
    }
    // Ring now holds 7..10 only.
    expect(j.depth()).toBe(4);
    // A guest at revision 2 is deeper than the ring can replay -> full snapshot.
    expect(j.needsFullSnapshot("envelope", 2)).toBe(true);
    // A guest at revision 8 is within the ring -> tail replay suffices.
    expect(j.needsFullSnapshot("envelope", 8)).toBe(false);
    expect(j.tailFrom("envelope", 8).map(e => e.seq)).toEqual([9, 10]);
    // After a full snapshot at head, the receiver adopts head and needs nothing more.
    const rx = new CoopReceiveLedger();
    rx.adoptSnapshot("envelope", j.highWaterMark("envelope"));
    expect(rx.appliedThrough("envelope")).toBe(10);
    expect(rx.isDuplicate("envelope", 9)).toBe(true);
  });

  it("a peer already at/ahead of head never needs a snapshot or a tail", () => {
    const j = new CoopJournal();
    j.commit("envelope", 1, durableMsg(1));
    expect(j.needsFullSnapshot("envelope", 1)).toBe(false);
    expect(j.needsFullSnapshot("envelope", 5)).toBe(false);
    expect(j.tailFrom("envelope", 1)).toEqual([]);
  });
});

describe("durability §4/§1.8: control-plane PERSISTENCE for cold-resume convergence", () => {
  afterEach(() => setCoopDurabilityEnabled(true));

  it("the interaction counter restores forward so alternating-owner PARITY survives a cold resume", () => {
    // A resume that reset the counter from an ODD value to 0 would FLIP ownership (parity). Restoring it
    // keeps the parity - the correctness point of persisting it.
    const turn = new CoopInteractionTurn();
    turn.restore(7); // persisted odd counter
    expect(turn.toJSON()).toBe(7);
    expect(CoopInteractionTurn.ownerOf(7)).toBe(turn.current()); // parity preserved
    // Restore never rewinds below the live counter, and ignores an invalid value.
    turn.restore(3);
    expect(turn.toJSON()).toBe(7);
    turn.restore(-1);
    expect(turn.toJSON()).toBe(7);
    turn.restore(9);
    expect(turn.toJSON()).toBe(9);
  });

  it("the journal high-water + ledger applied marks round-trip through serialize/restore", () => {
    const j = new CoopJournal();
    j.commit("envelope", 1, durableMsg(1));
    j.commit("envelope", 5, durableMsg(5));
    j.commit("reward", 3, durableMsg(3));
    expect(j.serializeHighWater()).toEqual({ envelope: 5, reward: 3 });

    // A fresh journal restores the high-water so a later commit continues monotonically (does not reset).
    const resumed = new CoopJournal();
    resumed.restoreHighWater({ envelope: 5, reward: 3 });
    expect(resumed.highWaterMark("envelope")).toBe(5);
    resumed.commit("envelope", 6, durableMsg(6)); // continues past the persisted mark
    expect(resumed.highWaterMark("envelope")).toBe(6);

    const rx = new CoopReceiveLedger();
    rx.markApplied("envelope", 4);
    const marks = rx.serialize();
    expect(marks).toEqual({ envelope: 4 });
    const rx2 = new CoopReceiveLedger();
    rx2.restore(marks);
    expect(rx2.appliedThrough("envelope")).toBe(4);
  });

  it("the durability manager persists + restores its committer high-water and receiver applied marks", async () => {
    setCoopDurabilityEnabled(true);
    const pair: { host: CoopTransport; guest: CoopTransport } = createLoopbackPair();
    const applied: number[] = [];
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: m => (m.t === "waveResolved" ? { cls: "wave", seq: m.wave } : null),
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });
    host.commit("wave", 1, durableMsg(1));
    host.commit("wave", 2, durableMsg(2));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([1, 2]);

    // The committer's high-water + the receiver's applied marks are captured for the save...
    expect(host.highWaterMarks()).toEqual({ wave: 2 });
    expect(guest.appliedMarks()).toEqual({ wave: 2 });

    // ...and restore onto a fresh manager (cold resume) so revisions continue past them, not from 0.
    const resumedHost = new CoopDurabilityManager(createLoopbackPair().host);
    resumedHost.restore({ wave: 2 }, {});
    resumedHost.commit("wave", 3, durableMsg(3));
    expect(resumedHost.highWaterMarks()).toEqual({ wave: 3 });

    host.dispose();
    guest.dispose();
  });
});
