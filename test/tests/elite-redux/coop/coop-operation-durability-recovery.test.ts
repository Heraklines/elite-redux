/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// W2e-R2 - DURABILITY RECOVERY COMPLETENESS (contract doc §4.4/§4.6/§8.6; #896 remaining
// items + #898). Failure-first proofs of the recovery holes the external reviewer's tests
// 5,6,7,9,10 + the reconnect-asymmetry finding named. ENGINE-FREE (the durability + operation
// layers are pure): the managers are driven directly over the in-process loopback, with a
// ChannelGate to CUT an endpoint (drop outbound) so a lost frame is a real wire event, not a
// mock. Each item's EXPECTED-RED reason against the current code is in its comment; a red item
// is committed as `it.fails(...)` (a documented expected-failure guard - it PASSES while the
// defect stands) and flipped to `it(...)` once the fix makes it green for the RIGHT reason.
//
//   I1 (#898)  RECONNECT ASYMMETRY: production reconnects only the GUEST (coop-runtime.ts gates
//              runtime.durability?.reconnect() behind isCoopAuthoritativeGuest()). The FIRST/ONLY
//              op of a fresh class, if dropped, is never recovered: the guest has no ledger entry
//              for that class so requests no coopResync, and the host never proactively resends.
// =============================================================================

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import {
  type CoopApplyOutcome,
  type CoopDurabilityHooks,
  CoopDurabilityManager,
  type CoopJournalEntry,
  setCoopDurabilityEnabled,
} from "#data/elite-redux/coop/coop-durability";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Await several microtask turns so the loopback (queueMicrotask) delivery + ACK round-trips settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/** A thin gate that can CUT a CoopTransport endpoint (drop outbound) + records every sent `t`. */
class ChannelGate implements CoopTransport {
  cut = false;
  readonly sentTypes: string[] = [];
  constructor(private readonly inner: CoopTransport) {}
  get role(): CoopRole {
    return this.inner.role;
  }
  get state(): CoopConnectionState {
    return this.inner.state;
  }
  send(msg: CoopMessage): void {
    this.sentTypes.push(msg.t);
    if (this.cut) {
      return;
    }
    this.inner.send(msg);
  }
  onMessage(handler: (msg: CoopMessage) => void): () => void {
    return this.inner.onMessage(handler);
  }
  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    return this.inner.onStateChange(handler);
  }
  close(): void {
    this.inner.close();
  }
}

/** A synthetic durable wave op keyed `(cls="wave", seq=wave)`. */
function waveMsg(wave: number): CoopMessage {
  return { t: "waveResolved", wave, outcome: "win" };
}

/** A recording receiver over a wave class - records every wave it NEWLY applies. */
function recordingWaveHooks(applied: number[], outcome: () => CoopApplyOutcome = () => "applied"): CoopDurabilityHooks {
  return {
    extractKey: (msg: CoopMessage) => (msg.t === "waveResolved" ? { cls: "wave", seq: msg.wave } : null),
    apply: (entry: CoopJournalEntry) => {
      const o = outcome();
      if (o === "applied" && entry.msg.t === "waveResolved") {
        applied.push(entry.msg.wave);
      }
      return o;
    },
  };
}

describe("W2e-R2 durability recovery completeness: guest-only reconnect + snapshot fast-forward + overflow + send-retry", () => {
  beforeEach(() => {
    setCoopDurabilityEnabled(true);
  });
  afterEach(() => {
    setCoopDurabilityEnabled(true);
  });

  // ===========================================================================================
  // I1 (#898) - RECONNECT ASYMMETRY: the FIRST op of a fresh class, dropped, is unrecoverable by
  // a GUEST-ONLY reconnect (the production topology).
  // EXPECTED RED (current code): reconnect()'s receiver arm iterates ledger.serializeClasses() -
  // classes the guest has applied at least one op for. A never-seen class is NOT there, so no
  // coopResync is sent for it; and production never runs reconnect() on the host, so the host never
  // proactively resends its committed-but-unacked tail. The op is permanently lost, both sides idle.
  // ===========================================================================================
  it("I1: a GUEST-ONLY reconnect recovers the dropped FIRST op of a fresh class via coopResyncAll (#898)", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const applied: number[] = [];
    const hostMgr = new CoopDurabilityManager(hostGate);
    const guestMgr = new CoopDurabilityManager(pair.guest, recordingWaveHooks(applied));

    // The FIRST and ONLY op ever sent for class "wave" is committed while the host channel is dark.
    hostGate.cut = true;
    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    await flush();
    expect(applied, "the dropped first op never arrived").toEqual([]);

    // Channel recovers. PRODUCTION TOPOLOGY: only the GUEST reconnects (coop-runtime.ts gates
    // runtime.durability?.reconnect() behind isCoopAuthoritativeGuest()).
    hostGate.cut = false;
    guestMgr.reconnect();
    await flush();

    // The guest has NO ledger entry for "wave" (never applied op 1), so it requests NO coopResync,
    // and the host was never asked to resend -> the op stays lost. (Post-fix this becomes [1].)
    expect(applied, "a guest-only reconnect must recover the first op of a fresh class").toEqual([1]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // I2 - SNAPSHOT FAST-FORWARD: a rejoining guest that adopts a full-state snapshot subsuming journaled
  // ops must NOT double-apply those ops when the journal tail later replays, and its receiver ledger must
  // fast-forward to the snapshot's head (no spurious resync of ops the snapshot subsumed).
  // EXPECTED RED (current code): the DATA-plane full-snapshot adoption does not touch the durability
  // receiver ledger; there was NO way to fast-forward it. So the ledger stays at its pre-snapshot mark and
  // a subsequent journal tail replay (a committer resend) re-runs the applier for the subsumed ops.
  // ===========================================================================================
  it("I2: adopting a snapshot fast-forwards the ledger so a journal tail replay does not double-apply subsumed ops", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const applied: number[] = [];
    const hostMgr = new CoopDurabilityManager(hostGate);
    const guestMgr = new CoopDurabilityManager(pair.guest, recordingWaveHooks(applied));

    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    hostMgr.commit("wave", 2, { t: "waveResolved", wave: 2, outcome: "win" });
    await flush();
    expect(applied).toEqual([1, 2]);

    // Host commits 3,4,5 while the channel is dark: the guest misses them.
    hostGate.cut = true;
    for (const w of [3, 4, 5]) {
      hostMgr.commit("wave", w, { t: "waveResolved", wave: w, outcome: "win" });
    }
    await flush();
    expect(applied).toEqual([1, 2]);

    // The rejoin FULL-SNAPSHOT pull adopts the host's authoritative state at head=5: the guest's LIVE state
    // now already includes 3,4,5. The fix routes that adoption into the durability receiver via adoptSnapshot,
    // which fast-forwards the ledger to 5 AND ACKs, so the committer's resend tail shrinks to nothing.
    hostGate.cut = false;
    guestMgr.adoptSnapshot("wave", 5);
    await flush();

    // A subsequent journal tail replay (committer resend on reconnect) of the subsumed ops must be DEDUPED,
    // not re-run through the applier, and the guest must NOT spuriously coopResync from a stale mark.
    guestMgr.reconnect();
    await flush();

    expect(applied, "ops the snapshot subsumed must not re-run through the durability applier").toEqual([1, 2]);
    expect(hostMgr.unackedCount(), "the snapshot ACK caught the committer up to head -> nothing left to resend").toBe(
      0,
    );
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("I2b production seam: a stateSync snapshot fast-forwards every stamped operation class", async () => {
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest);

    for (let revision = 1; revision <= 3; revision++) {
      hostMgr.commit("op:wave", revision, waveMsg(revision));
    }
    await flush();
    expect(hostMgr.unackedCount()).toBe(3);

    const marks = { "op:wave": 3 };
    expect(hostMgr.retainSnapshotFrontier("i2b-control", marks)).toBe(true);
    guestMgr.adoptSnapshotMarksForTransaction(marks);
    expect(guestMgr.ackSnapshotMarksAfterTransaction(marks, "i2b-control")).toBe(true);
    await flush();

    expect(hostMgr.unackedCount(), "snapshot adoption must ACK every operation revision it subsumed").toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // I3 - OVERFLOW RESYNC: when the bounded journal ring has EVICTED the ops the receiver is missing (the
  // peer was gone long enough), a reconnect must DETECT the gap (the ring's oldest retained is past the
  // receiver's acked position) and ESCALATE to a full-state resync - never silently resend an unusable
  // partial tail that the receiver cannot apply (a gap at the evicted ops).
  // EXPECTED RED (current code): the coopResyncAll path (resendUnackedTail) blindly resends the retained
  // tail with NO deep-gap check, so an overflowed class gets an unusable partial tail and no escalation.
  // ===========================================================================================
  it("I3: coopResyncAll on an overflowed class escalates to a full snapshot instead of resending an unusable partial tail", async () => {
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const snapshots: Array<{ cls: string; head: number; marks: Record<string, number> }> = [];
    // Ring capacity 3: after 6 commits it retains 4,5,6 and EVICTS 1,2,3.
    const hostMgr = new CoopDurabilityManager(
      hostGate,
      {
        sendFullSnapshot: (cls, head, marks) => snapshots.push({ cls, head, marks }),
      },
      3,
    );
    const guestMgr = new CoopDurabilityManager(pair.guest);

    // Use a non-wave carrier so the assertion below can distinguish an unrelated retained class resend
    // from an illegal partial replay of the overflowed wave class.
    hostMgr.commit("reward", 1, { t: "coopAck", cls: "synthetic", seq: 1 });
    for (let w = 1; w <= 6; w++) {
      hostMgr.commit("wave", w, waveMsg(w));
    }
    await flush();
    hostGate.sentTypes.length = 0; // ignore the original commit broadcasts
    snapshots.length = 0;

    // The peer reconnected having ACKed nothing (acked=0). The ring's oldest retained (4) is past acked+1
    // (=1), so the retained tail (4,5,6) is UNUSABLE (a gap at 1,2,3). coopResyncAll must escalate to a
    // full snapshot rather than resend the unusable tail.
    pair.guest.send({ t: "coopResyncAll" });
    await flush();

    expect(snapshots, "an overflowed deep gap must escalate with the complete atomic control frontier").toEqual([
      { cls: "wave", head: 6, marks: { reward: 1, wave: 6 } },
    ]);
    expect(
      hostGate.sentTypes.filter(t => t === "waveResolved"),
      "the unusable partial tail must NOT be resent for an overflowed class",
    ).toEqual([]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("I3b production carrier: a deep-gap snapshot crosses the live stream and fast-forwards the guest", async () => {
    const pair = createLoopbackPair();
    const current = { epoch: 1, wave: 1, turn: 1 };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => current });
    const guestMgr = new CoopDurabilityManager(pair.guest);
    let liveSnapshotHead = 0;
    let hostMgr!: CoopDurabilityManager;
    hostMgr = new CoopDurabilityManager(
      pair.host,
      {
        sendFullSnapshot: (cls, head) => {
          const marks = { [cls]: head };
          const controlDigest = `deep-gap-${cls}-${head}`;
          expect(hostMgr.retainSnapshotFrontier(controlDigest, marks)).toBe(true);
          hostStream.sendDurabilitySnapshot(JSON.stringify({ controlDigest, journalHighWater: marks }), {
            wave: current.wave,
            turn: current.turn,
            stateTick: head,
            controlDigest,
          });
        },
      },
      3,
    );
    guestStream.onDurabilitySnapshot(({ blob }) => {
      const snapshot = JSON.parse(blob) as { controlDigest: string; journalHighWater: Record<string, number> };
      liveSnapshotHead = snapshot.journalHighWater.wave ?? 0;
      guestMgr.adoptSnapshotMarksForTransaction(snapshot.journalHighWater);
      guestMgr.ackSnapshotMarksAfterTransaction(snapshot.journalHighWater, snapshot.controlDigest);
    });

    for (let revision = 1; revision <= 6; revision++) {
      hostMgr.commit("wave", revision, waveMsg(revision));
    }
    await flush();
    pair.guest.send({ t: "coopResyncAll" });
    await flush();

    expect(liveSnapshotHead, "the deep-gap full snapshot must reach the guest's live apply callback").toBe(6);
    expect(hostMgr.unackedCount(), "snapshot adoption must ACK the evicted operation range").toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
    hostStream.dispose();
    guestStream.dispose();
  });

  it("I3c: only the exact host-retained snapshot digest and complete frontier can retire operations", async () => {
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest);
    for (let revision = 1; revision <= 3; revision++) {
      hostMgr.commit("wave", revision, waveMsg(revision));
    }
    await flush();
    const marks = { wave: 3 };
    expect(hostMgr.retainSnapshotFrontier("exact-control", marks)).toBe(true);

    pair.guest.send({ t: "coopSnapshotAck", controlDigest: "unknown-control", marks });
    pair.guest.send({ t: "coopSnapshotAck", controlDigest: "exact-control", marks: { wave: 2 } });
    pair.guest.send({ t: "coopSnapshotAck", controlDigest: "exact-control", marks: { wave: 3, forged: 9 } });
    await flush();
    expect(hostMgr.unackedCount(), "unknown or altered snapshot proofs must fail closed").toBe(3);

    guestMgr.adoptSnapshotMarksForTransaction(marks);
    expect(guestMgr.ackSnapshotMarksAfterTransaction(marks, "exact-control")).toBe(true);
    await flush();
    expect(hostMgr.unackedCount()).toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("I3d: a committed snapshot proof is retransmitted after channel replacement", async () => {
    const pair = createLoopbackPair();
    const guestGate = new ChannelGate(pair.guest);
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(guestGate);
    hostMgr.commit("wave", 1, waveMsg(1));
    await flush();
    const marks = { wave: 1 };
    expect(hostMgr.retainSnapshotFrontier("rejoin-control", marks)).toBe(true);
    guestMgr.adoptSnapshotMarksForTransaction(marks);

    guestGate.cut = true;
    expect(guestMgr.ackSnapshotMarksAfterTransaction(marks, "rejoin-control")).toBe(true);
    await flush();
    expect(hostMgr.unackedCount(), "the first proof was lost with the channel").toBe(1);

    guestGate.cut = false;
    guestMgr.reconnect();
    await flush();
    expect(hostMgr.unackedCount(), "reconnect must replay the exact committed snapshot proof").toBe(0);
    expect(guestGate.sentTypes.filter(type => type === "coopSnapshotAck")).toHaveLength(2);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // I4 - SEND RETRY: an op whose transport send() THROWS (the channel is DEAD at send time, not merely
  // unACKed) must stay journaled + retriable and MUST NOT break the committer, then be resent on reconnect.
  // EXPECTED RED (current code): commit() calls transport.send() unguarded, so a throwing send propagates
  // the throw out of commit() (breaking any caller that does not wrap it - e.g. the keystone applier).
  // ===========================================================================================
  it("I4: a commit whose send THROWS stays journaled + retriable, does not break the committer, and resends on reconnect", async () => {
    let dead = true;
    const applied: number[] = [];
    const pair = createLoopbackPair();
    // A transport that THROWS on send while dead (a real WebRTC dead-channel InvalidStateError), then heals.
    const flaky: CoopTransport = {
      get role() {
        return pair.host.role;
      },
      get state() {
        return pair.host.state;
      },
      send(msg: CoopMessage) {
        if (dead) {
          throw new Error("channel dead at send time");
        }
        pair.host.send(msg);
      },
      onMessage: h => pair.host.onMessage(h),
      onStateChange: h => pair.host.onStateChange(h),
      close: () => pair.host.close(),
    };
    const hostMgr = new CoopDurabilityManager(flaky);
    const guestMgr = new CoopDurabilityManager(pair.guest, recordingWaveHooks(applied));

    // The send THROWS. commit() must NOT propagate it - the op is journaled BEFORE the send, so it stays
    // retriable; a throwing send must be caught, not break the committer.
    expect(() => hostMgr.commit("wave", 1, waveMsg(1))).not.toThrow();
    await flush();
    expect(applied, "the throwing send never delivered").toEqual([]);
    expect(hostMgr.unackedCount(), "the op stays journaled + retriable after a throwing send").toBe(1);

    // The channel heals; a reconnect resends the journaled op - it was never dropped.
    dead = false;
    guestMgr.reconnect();
    await flush();
    expect(applied, "the throw-dropped op is resent on reconnect (never lost)").toEqual([1]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // I6a - CHECKPOINT REPLAY LOADER (does-not-exist verification): the reviewer claimed the persisted
  // control-plane checkpoint is not LOADED into the durability receiver on cold resume. W2e-R closed that:
  // applyCoopControlPlaneSaveData (coop-runtime.ts, wired in game-data.ts save+load) calls
  // durability.restore(marks, marks), which restores the RECEIVER LEDGER (not just the committer high-water).
  // This test PROVES the receiver ledger is loaded: after a cold resume at N it rejects a stale op (<=N) and
  // accepts the resumed producer's N+1. (Documented does-not-exist finding - no fix needed for this half.)
  // ===========================================================================================
  it("I6a: a cold resume LOADS the durability receiver ledger (rejects stale <=N, accepts the resumed N+1)", async () => {
    const N = 5;
    const pair = createLoopbackPair();
    const applied: number[] = [];
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, recordingWaveHooks(applied));

    // COLD RESUME at high-water N (exactly what applyCoopControlPlaneSaveData does: restore(marks, marks)).
    hostMgr.restore({ wave: N }, { wave: N });
    guestMgr.restore({ wave: N }, { wave: N });

    // A stale re-delivery at/below N must be dropped by the restored receiver ledger (idempotent, no re-apply).
    pair.host.send(waveMsg(N));
    await flush();
    expect(applied, "the restored receiver ledger rejects a stale op <= N").toEqual([]);

    // The resumed producer continues MONOTONICALLY at N+1; the restored receiver ACCEPTS it.
    hostMgr.commit("wave", N + 1, waveMsg(N + 1));
    await flush();
    expect(applied, "the restored receiver ledger accepts the resumed producer's N+1").toEqual([N + 1]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // I6b - the CONNECTED residual: a cold resume restores the receiver ledger + committer high-water but NOT
  // the committer's peer-ACK view. After a CONVERGED save both peers are at N, so the committer's acked view
  // should also be N. Left at 0, the overflow-escalation (I3) fires SPURIOUSLY: the first post-resume op
  // (N+1) that the guest has not yet ACKed makes the ring hold only [N+1], and with acked=0 the committer
  // reads oldest(N+1) as a deep gap and escalates to a HEAVY full snapshot - even though the guest is a
  // single revision behind and the ring holds exactly the op it needs.
  // EXPECTED RED (current code): CoopDurabilityManager.restore does not restore the journal's acked map.
  // ===========================================================================================
  it("I6b: a cold resume restores the committer's acked view so a post-resume resend serves the tail, not a spurious full snapshot", async () => {
    const N = 5;
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const snapshots: number[] = [];
    const applied: number[] = [];
    const hostMgr = new CoopDurabilityManager(hostGate, { sendFullSnapshot: (_cls, head) => snapshots.push(head) });
    const guestMgr = new CoopDurabilityManager(pair.guest, recordingWaveHooks(applied));

    hostMgr.restore({ wave: N }, { wave: N });
    guestMgr.restore({ wave: N }, { wave: N });

    // The resumed producer commits N+1 while the channel is dark: the guest misses it + never ACKs it.
    hostGate.cut = true;
    hostMgr.commit("wave", N + 1, waveMsg(N + 1));
    await flush();
    expect(applied).toEqual([]);

    // A reconnect resend. The guest is at N and needs exactly N+1, which the ring holds. The committer's
    // acked view SHOULD be N (converged resume) -> serve the tail [N+1]. Left at 0 it treats oldest(N+1) as
    // a deep gap and SPURIOUSLY escalates to a full snapshot (heavy) instead of serving the single op.
    hostGate.cut = false;
    pair.guest.send({ t: "coopResyncAll" });
    await flush();
    expect(snapshots, "a converged resume must not spuriously escalate to a full snapshot").toEqual([]);
    expect(applied, "the guest gets the single missing op via the tail, not a heavy snapshot").toEqual([N + 1]);
    hostMgr.dispose();
    guestMgr.dispose();
  });
});
