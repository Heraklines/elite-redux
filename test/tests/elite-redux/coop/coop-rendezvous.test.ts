/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RECIPROCAL RENDEZVOUS primitive (#839). Pure-logic test (no game engine): proves the
// two-sided ready handshake over a real LoopbackTransport pair, and the three robustness
// properties the co-op wire class demands: buffer-before-waiter (early arrival, #812 class),
// idempotent duplicate arrival, and the anti-hang TIMEOUT that PROCEEDS with a LOUD WARN.
// =============================================================================

import { setCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Flush the loopback's queued microtask deliveries. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** A manual timer scheduler so a test can FIRE the timeout deterministically (no real wait). */
function makeManualScheduler() {
  const timers: Array<{ cb: () => void; cancelled: boolean }> = [];
  const schedule = (cb: () => void, _ms: number): (() => void) => {
    const entry = { cb, cancelled: false };
    timers.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const fireAll = () => {
    for (const t of timers) {
      if (!t.cancelled) {
        t.cancelled = true;
        t.cb();
      }
    }
  };
  return { schedule, fireAll };
}

describe("co-op reciprocal rendezvous primitive (#839)", () => {
  beforeEach(() => {
    setCoopDebug(true); // so coopWarn writes to console.warn (the soak asserts on the WARN)
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("both arrive at a point -> both sides resolve both-arrived (neither timed out)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    const hostP = host.rendezvous("cmd:5:2");
    const guestP = guest.rendezvous("cmd:5:2");
    await flush();

    const [hr, gr] = await Promise.all([hostP, guestP]);
    expect(hr.timedOut).toBe(false);
    expect(gr.timedOut).toBe(false);
    expect(hr.point).toBe("cmd:5:2");

    host.dispose();
    guest.dispose();
  });

  it("early arrival is BUFFERED: the partner arrives BEFORE the local await installs (#812 class)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // Guest arrives first and its arrival is delivered while the host has NOT yet awaited.
    guest.arrive("shop:11:0");
    await flush();
    expect(host.partnerHasArrived("shop:11:0")).toBe(true);

    // The host now runs its rendezvous - the buffered arrival resolves it WITHOUT a network wait.
    const hr = await host.rendezvous("shop:11:0");
    expect(hr.timedOut).toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("the LEADER blocks at the barrier until the FOLLOWER arrives, then proceeds", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    let hostCrossed = false;
    const hostP = host.rendezvous("cmd:12:3").then(r => {
      hostCrossed = true;
      return r;
    });
    await flush();
    // The follower (guest) has NOT arrived yet, so the leader must still be blocked.
    expect(hostCrossed).toBe(false);

    // The follower arrives - the leader unblocks.
    guest.arrive("cmd:12:3");
    await flush();
    const hr = await hostP;
    expect(hostCrossed).toBe(true);
    expect(hr.timedOut).toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("duplicate arrival is IDEMPOTENT: a re-sent arrival is a no-op (one wire send, resolves once)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    const sendSpy = vi.spyOn(pair.guest, "send");
    guest.arrive("cmd:1:1");
    guest.arrive("cmd:1:1"); // duplicate - suppressed on the wire
    guest.arrive("cmd:1:1"); // duplicate - suppressed on the wire
    expect(sendSpy.mock.calls.filter(c => c[0].t === "rendezvous").length).toBe(1);

    await flush();
    // A second delivery of the SAME arrival (e.g. a WebRTC re-deliver) is a harmless no-op on the host.
    pair.guest.send({ t: "rendezvous", point: "cmd:1:1" });
    await flush();
    expect(host.partnerHasArrived("cmd:1:1")).toBe(true);

    const hr = await host.rendezvous("cmd:1:1");
    expect(hr.timedOut).toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("DEAD PARTNER: the await times out -> resolves timedOut=true and emits a LOUD 'RENDEZVOUS TIMEOUT' WARN", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    // Only the host installs a rendezvous; the "partner" never arrives.
    const host = new CoopRendezvous(pair.host, { schedule: manual.schedule });

    const hostP = host.rendezvous("cmd:99:9");
    await flush();
    // The partner is dead - fire the anti-hang timeout deterministically.
    manual.fireAll();
    const hr = await hostP;

    expect(hr.timedOut).toBe(true);
    expect(hr.point).toBe("cmd:99:9");
    const timeoutWarn = warnSpy.mock.calls.find(c => String(c[0]).includes("RENDEZVOUS TIMEOUT"));
    expect(timeoutWarn, "the timeout emits a LOUD 'RENDEZVOUS TIMEOUT' WARN the soak can assert on").toBeTruthy();

    host.dispose();
  });

  it("#899 queued partner arrival wins when the vitest timeout fires before its delivery microtask", async () => {
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    const host = new CoopRendezvous(pair.host, { schedule: manual.schedule });
    const guest = new CoopRendezvous(pair.guest);

    const hostP = host.rendezvous("cmd:2:1");
    guest.arrive("cmd:2:1"); // queues the real arrival on LoopbackTransport's delivery microtask
    manual.fireAll(); // reproduce the loaded-pump race: wall timer fires before that queued delivery runs

    const result = await hostP;
    expect(result.timedOut, "the already-queued partner arrival must beat the test-only timeout backstop").toBe(false);
    expect(host.partnerHasArrived("cmd:2:1")).toBe(true);

    host.dispose();
    guest.dispose();
  });

  it("FAULT-INJECTION: the arrival is DROPPED on the wire -> both sides time out with the LOUD WARN", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Wrap the loopback so EVERY rendezvous arrival is dropped (a partner whose arrival never lands).
    const faulted = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "rendezvous" },
      { seed: 839 },
    );
    const host = new CoopRendezvous(faulted.host, { timeoutMs: 40 });
    const guest = new CoopRendezvous(faulted.guest, { timeoutMs: 40 });

    const [hr, gr] = await Promise.all([host.rendezvous("cmd:7:1"), guest.rendezvous("cmd:7:1")]);

    expect(hr.timedOut, "host barrier timed out (partner arrival dropped)").toBe(true);
    expect(gr.timedOut, "guest barrier timed out (partner arrival dropped)").toBe(true);
    expect(faulted.faultsInjected(), "the fault transport actually dropped the arrivals").toBeGreaterThan(0);
    const warns = warnSpy.mock.calls.filter(c => String(c[0]).includes("RENDEZVOUS TIMEOUT"));
    expect(warns.length, "both sides emitted the soak-assertable 'RENDEZVOUS TIMEOUT' WARN").toBeGreaterThanOrEqual(2);

    host.dispose();
    guest.dispose();
    faulted.host.close();
  });

  // ===========================================================================================
  // #847 CROSS-POINT RELEASE (the berry-bush deadlock). While awaiting point P, learning the partner
  // arrived at a DIFFERENT point Q it has ALSO not shared with us proves the partner diverged onto
  // another branch and will NEVER reach P. Resolve the P-await immediately with `crossPoint: Q` (INFO,
  // NOT the anti-hang timeout WARN) instead of eating the full 60s. The exact live trace: the reward
  // owner walked to `shop:3:2` while the partner opened a phantom `cmd:3:2` - each ate the full timeout.
  // ===========================================================================================
  it("#847 CROSS-POINT release (LIVE): awaiting P, the partner arrives at a DIFFERENT point Q -> resolve crossPoint=Q (info, not the timeout WARN)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // The host is the reward owner, parked at the shop barrier. The guest never reaches the shop - it
    // opened a phantom next-command instead (arrives cmd:3:2). The host's shop await must cross-release.
    let hostCrossed = false;
    const hostP = host.rendezvous("shop:3:2").then(r => {
      hostCrossed = true;
      return r;
    });
    await flush();
    expect(hostCrossed, "the host is still parked before the partner diverges").toBe(false);

    guest.arrive("cmd:3:2"); // the partner diverged to a DIFFERENT sync point
    await flush();
    const hr = await hostP;
    expect(hostCrossed).toBe(true);
    expect(hr.timedOut, "a cross-point release is NOT a dead-partner timeout").toBe(false);
    expect(hr.crossPoint, "the release carries the partner's foreign point").toBe("cmd:3:2");
    // The anti-hang timeout WARN the soak asserts on must NOT fire for a healthy cross-point release.
    expect(
      warnSpy.mock.calls.some(c => String(c[0]).includes("RENDEZVOUS TIMEOUT")),
      "a cross-point release emits INFO, never the timeout WARN",
    ).toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("#847 CROSS-POINT release (BUFFERED): a foreign arrival buffered BEFORE the await installs still cross-releases (the exact berry-bush ordering)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // The host reaches the reward shop and ARRIVES there; the guest BUFFERS this shop:3:2 arrival BEFORE
    // it opens its (phantom) cmd:3:2 await - the exact ordering from the live trace ("RECV arrival
    // point=shop:3:2 -> BUFFER (no waiter yet)" landing before the guest's own cmd:3:2 await).
    host.arrive("shop:3:2");
    await flush();
    expect(guest.partnerHasArrived("shop:3:2")).toBe(true);

    // The guest now opens its own-slot command barrier: the buffered foreign shop arrival cross-releases
    // it at await-START (no network wait, no timeout), so the guest proceeds immediately.
    const gr = await guest.rendezvous("cmd:3:2");
    expect(gr.timedOut).toBe(false);
    expect(gr.crossPoint, "the buffered foreign shop arrival cross-releases the command barrier").toBe("shop:3:2");

    host.dispose();
    guest.dispose();
  });

  it("#847 a partner arrival at a point WE ALSO reached does NOT cross-release the NEXT barrier (stale shared past-point guard)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // Turn 1: BOTH reach cmd:1:1 (both-arrived). The arrival stays in partnerArrived (the synchronous
    // fast-path never consumes it), but BOTH also localArrived it - so it is a SHARED past point, not a
    // divergent one.
    const [h1, g1] = await Promise.all([host.rendezvous("cmd:1:1"), guest.rendezvous("cmd:1:1")]);
    expect(h1.timedOut).toBe(false);
    expect(g1.crossPoint, "a normal both-arrived is not a cross-point").toBeUndefined();
    expect(h1.crossPoint).toBeUndefined();

    // Turn 2: the guest opens cmd:1:2 while the host has NOT yet reached it. The still-buffered cmd:1:1
    // (a point the guest ALSO reached) must NOT spuriously cross-release cmd:1:2 - it network-waits, or
    // the pacing barrier would be defeated every turn by the previous turn's shared arrival.
    let guestCrossed = false;
    const g2 = guest.rendezvous("cmd:1:2").then(r => {
      guestCrossed = true;
      return r;
    });
    await flush();
    expect(guestCrossed, "the stale SHARED cmd:1:1 did NOT cross-release cmd:1:2").toBe(false);

    // The host genuinely reaches cmd:1:2 -> a normal both-arrived (NOT a cross-point).
    host.arrive("cmd:1:2");
    await flush();
    const gr = await g2;
    expect(gr.timedOut).toBe(false);
    expect(gr.crossPoint).toBeUndefined();

    host.dispose();
    guest.dispose();
  });
});
