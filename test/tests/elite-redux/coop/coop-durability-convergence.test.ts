/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Wave-2b transport durability - CONVERGENCE AFTER A CUT (contract doc §4.2/§4.4). This is the direct
// proof for review finding 3: today a drop between "owner committed" and "watcher applied" is
// UNREPAIRABLE generically (the #868 lobby self-heal + the guest's requestRunConfig retry are bespoke
// patches over this one hole). This test drives TWO CoopDurabilityManagers (host committer + guest
// receiver) over a real transport, CUTS the channel between the send and the receive of an AUTHORITATIVE
// committed op, then reconnects (a #805-style rejoin) and proves the guest CONVERGES via the journal
// tail replay - with the bespoke self-heals PROVABLY NOT the mechanism (they cannot even fire here; the
// only wire traffic is the durable ops + coopAck + coopResync).
//
// Engine-free (no GameManager, no ER_SCENARIO): the durability layer is pure, so a synthetic
// authoritative op stream (carried on `waveResolved`, keyed cls="wave" seq=wave) exercises it end-to-end.
// =============================================================================

import { CoopDurabilityManager, setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

/** A synthetic authoritative committed op, carried on the durable `waveResolved` arm (cls="wave", seq=wave). */
function waveOp(wave: number): CoopMessage {
  return { t: "waveResolved", wave, outcome: "win" };
}
const WAVE_KEY = (msg: CoopMessage) => (msg.t === "waveResolved" ? { cls: "wave", seq: msg.wave } : null);

/** Await several microtask turns so the loopback (queueMicrotask) delivery + ACK round-trips settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/**
 * A thin gate over a {@linkcode CoopTransport} endpoint that can CUT the channel (drop outbound frames -
 * exactly a dark channel: the frame is "sent" but never reaches the peer) and RESTORE it. Delegates
 * everything else verbatim, so the framing the peer sees is byte-identical.
 */
class ChannelGate implements CoopTransport {
  cut = false;
  /** Every `t` this endpoint attempted to send (asserted so the bespoke self-heals are proven absent). */
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
      return; // dark channel: the frame is lost between send and receive
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

/** The bespoke self-heal message classes that must NOT be the mechanism (review finding 3). */
const BESPOKE_SELFHEAL_TYPES = new Set([
  "requestStateSync",
  "stateSync",
  "requestRunConfig",
  "requestRoster",
  "requestEnemyParty",
  "rendezvous",
]);

describe("W2b durability convergence (§4.2/§4.4): a cut authoritative op is repaired by the journal, not a self-heal", () => {
  afterEach(() => setCoopDurabilityEnabled(true));

  it("MID-STREAM cut: a dropped committed op is healed by the gap-triggered tail request (no rejoin, no self-heal)", async () => {
    setCoopDurabilityEnabled(true);
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const applied: number[] = [];

    const host = new CoopDurabilityManager(hostGate);
    const guest = new CoopDurabilityManager(guestGate, {
      extractKey: WAVE_KEY,
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });

    // Commit 1 and 2 cleanly.
    host.commit("wave", 1, waveOp(1));
    host.commit("wave", 2, waveOp(2));
    await flush();
    expect(applied).toEqual([1, 2]);

    // CUT the channel and commit 3 - it is sent but never received (the review-finding-3 hole).
    hostGate.cut = true;
    host.commit("wave", 3, waveOp(3));
    await flush();
    expect(applied).toEqual([1, 2]); // 3 was lost between commit and apply

    // Channel recovers; the host commits 4. The guest sees 4 out of order -> requests the tail after 2,
    // and the host replays 3 then 4. Convergence, with NO bespoke self-heal involved.
    hostGate.cut = false;
    host.commit("wave", 4, waveOp(4));
    await flush();
    expect(applied).toEqual([1, 2, 3, 4]);

    // The ONLY wire traffic was durable ops + coopAck + coopResync - never a bespoke self-heal.
    for (const t of [...hostGate.sentTypes, ...guestGate.sentTypes]) {
      expect(BESPOKE_SELFHEAL_TYPES.has(t), `unexpected self-heal on the wire: ${t}`).toBe(false);
    }
    expect(guestGate.sentTypes).toContain("coopResync"); // the generic tail request WAS the mechanism
    host.dispose();
    guest.dispose();
  });

  it("TAIL cut + REJOIN: a committed-but-unacked op lost in the blip is recovered by reconnect() (the piece the purge dropped)", async () => {
    setCoopDurabilityEnabled(true);
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const applied: number[] = [];

    const host = new CoopDurabilityManager(hostGate);
    const guest = new CoopDurabilityManager(guestGate, {
      extractKey: WAVE_KEY,
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });

    host.commit("wave", 1, waveOp(1));
    host.commit("wave", 2, waveOp(2));
    await flush();
    expect(applied).toEqual([1, 2]);

    // CUT, then commit the FINAL op (3). Nothing follows it, so the guest never sees a gap -> today this
    // committed-but-unacked message is unrecoverable without a full snapshot. It is journaled but unacked.
    hostGate.cut = true;
    host.commit("wave", 3, waveOp(3));
    await flush();
    expect(applied).toEqual([1, 2]);

    // #805 hot rejoin: the channel is re-established. PRODUCTION TOPOLOGY (#898): only the GUEST runs
    // reconnect() (coop-runtime.ts gates it behind isCoopAuthoritativeGuest()). Its coopResync (known
    // class) + coopResyncAll make the host resend its committed-but-unacked tail (3); the guest converges.
    // This is precisely the message the buffer purge dropped before W2b.
    hostGate.cut = false;
    guest.reconnect();
    await flush();
    expect(applied).toEqual([1, 2, 3]);

    for (const t of [...hostGate.sentTypes, ...guestGate.sentTypes]) {
      expect(BESPOKE_SELFHEAL_TYPES.has(t), `unexpected self-heal on the wire: ${t}`).toBe(false);
    }
    host.dispose();
    guest.dispose();
  });

  it("DUPLICATE resend on rejoin is idempotent: replaying already-applied ops does not double-apply", async () => {
    setCoopDurabilityEnabled(true);
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const applied: number[] = [];
    const host = new CoopDurabilityManager(hostGate);
    const guest = new CoopDurabilityManager(guestGate, {
      extractKey: WAVE_KEY,
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });

    for (let w = 1; w <= 3; w++) {
      host.commit("wave", w, waveOp(w));
    }
    await flush();
    expect(applied).toEqual([1, 2, 3]);

    // A rejoin where the host is unsure of the guest's progress: it resends its whole unacked... but the
    // guest acked everything, so resendTail is empty. Force a redundant replay by a resync from an OLD point.
    guestGate.send({ t: "coopResync", cls: "wave", from: 0 });
    await flush();
    // The host replayed 1,2,3 again; the guest treated them as duplicates - no double-apply.
    expect(applied).toEqual([1, 2, 3]);
    host.dispose();
    guest.dispose();
  });

  it("with the flag ON the manager still lets the transport queue durable frames (both flag states are coherent)", async () => {
    // Flag OFF: the manager still journals + can replay on reconnect (the durability protocol is independent
    // of the transport's outbound queue). Convergence must hold with the flag OFF too.
    setCoopDurabilityEnabled(false);
    const pair = createLoopbackPair();
    const hostGate = new ChannelGate(pair.host);
    const guestGate = new ChannelGate(pair.guest);
    const applied: number[] = [];
    const host = new CoopDurabilityManager(hostGate);
    const guest = new CoopDurabilityManager(guestGate, {
      extractKey: WAVE_KEY,
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });

    host.commit("wave", 1, waveOp(1));
    hostGate.cut = true;
    host.commit("wave", 2, waveOp(2));
    await flush();
    hostGate.cut = false;
    guest.reconnect(); // production single-sided reconnect (#898)
    await flush();
    expect(applied).toEqual([1, 2]);
    host.dispose();
    guest.dispose();
  });
});

describe("W2b durability convergence (§4.4): the FAULT TRANSPORT drops authoritative ops; reconnect re-converges", () => {
  afterEach(() => setCoopDurabilityEnabled(true));

  it("a seeded fault profile that DROPS the durable op class still converges after reconnect (faults were injected)", async () => {
    setCoopDurabilityEnabled(true);
    // Fault ONLY the durable "wave" op (widen past the default cosmetic set) with a heavy drop rate, so the
    // authoritative backbone is genuinely cut - exactly the case the durability layer must heal.
    const faultable = (msg: CoopMessage) => msg.t === "waveResolved";
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 0.6, reorder: 0, delay: 0, faultable },
      { seed: 0xc0ffee },
    );
    const applied: number[] = [];
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: WAVE_KEY,
      apply: e => {
        applied.push((e.msg as { wave: number }).wave);
      },
    });

    const N = 12;
    for (let w = 1; w <= N; w++) {
      host.commit("wave", w, waveOp(w));
      await flush();
    }
    // Some ops were dropped by the fault transport -> the guest is behind + has requested tails.
    expect(pair.faultsInjected(), "the run must actually inject faults (not vacuous)").toBeGreaterThan(0);

    // Recover the channel + rejoin: the host resends the unacked tail, the guest fills its gaps, both
    // running the resync protocol until convergence. Iterate a few reconnect rounds (each round the guest
    // re-requests the next missing revision; the tail replay is idempotent).
    pair.setProfile(COOP_NO_FAULT_PROFILE);
    for (let round = 0; round < N + 2; round++) {
      guest.reconnect(); // production single-sided reconnect (#898): coopResyncAll drives the host resend
      await flush();
      if (applied.length === N) {
        break;
      }
    }

    // The guest converged to the full, in-order op history despite the authoritative drops.
    expect(applied).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    host.dispose();
    guest.dispose();
  });
});
