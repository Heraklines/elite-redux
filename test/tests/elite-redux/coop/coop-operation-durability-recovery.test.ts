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
  it.fails("I2: [RED] a journal tail replay after a snapshot double-applies subsumed ops (no ledger fast-forward)", async () => {
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

    // The rejoin FULL-SNAPSHOT pull adopts the host's authoritative state at head=5: the guest's LIVE
    // state now already includes 3,4,5. In production this is the DATA-plane snapshot, which does NOT
    // update the durability receiver ledger - so it stays at 2. (No manager.adoptSnapshot is called here.)

    // Channel recovers; the committer resends its committed-but-unacked tail (3,4,5) on reconnect.
    hostGate.cut = false;
    guestMgr.reconnect();
    await flush();

    // The snapshot already materialized 3,4,5; the durability applier must NOT re-run them. But the stale
    // ledger (still at 2) treats the resent tail as new -> DOUBLE APPLY. (Post-fix: adoptSnapshot fast-
    // forwards the ledger to 5, so the resent tail is deduped and `applied` stays [1,2].)
    expect(applied, "ops the snapshot subsumed must not re-run through the durability applier").toEqual([1, 2]);
    hostMgr.dispose();
    guestMgr.dispose();
  });
});
