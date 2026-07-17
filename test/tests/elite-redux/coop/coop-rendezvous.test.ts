/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RECIPROCAL RENDEZVOUS primitive (#839). Pure-logic test (no game engine): proves the
// two-sided ready handshake over a real LoopbackTransport pair, and the three robustness
// properties the co-op wire class demands: buffer-before-waiter (early arrival, #812 class),
// idempotent duplicate arrival, and timeout recovery that retransmits while keeping the boundary closed.
// =============================================================================

import { setCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { coopMachineWaitLabels } from "#data/elite-redux/coop/coop-stall-probe";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { CoopFlapTransport } from "#test/tools/coop-flap-transport";
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
  const fireNext = () => {
    const t = timers.find(entry => !entry.cancelled);
    if (t != null) {
      t.cancelled = true;
      t.cb();
    }
  };
  return { schedule, fireNext };
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

  it("point-specific reannounce repairs an arrival the peer did not observe", async () => {
    const faulted = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 840 });
    faulted.armNextDrop("rendezvous", "guest");
    const host = new CoopRendezvous(faulted.host);
    const guest = new CoopRendezvous(faulted.guest);

    guest.arrive("cmd:3:2");
    await flush();
    expect(host.partnerHasArrived("cmd:3:2")).toBe(false);

    guest.reannounce("cmd:3:2");
    await flush();
    expect(host.partnerHasArrived("cmd:3:2")).toBe(true);

    host.dispose();
    guest.dispose();
  });

  it("hot rejoin automatically rehydrates an arrival sent while the channel was dark", async () => {
    const pair = createLoopbackPair();
    const guestWire = new CoopFlapTransport(pair.guest);
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(guestWire);

    guestWire.setConnected(false);
    guest.arrive("shop:14:7");
    const hostWait = host.rendezvous("shop:14:7");
    await flush();
    expect(host.partnerHasArrived("shop:14:7")).toBe(false);

    guestWire.setConnected(true);
    const result = await hostWait;
    expect(result).toMatchObject({ point: "shop:14:7", timedOut: false });
    expect(host.partnerHasArrived("shop:14:7")).toBe(true);
    host.dispose();
    guest.dispose();
  });

  it("restores the peer-complementary barrier, releases the exact waiter, and never invents an arrival", async () => {
    const faulted = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 933 });
    faulted.armNextDrop("rendezvous", "guest");
    const host = new CoopRendezvous(faulted.host);
    const guest = new CoopRendezvous(faulted.guest);
    const point = "cmd:7:1";

    const guestWait = guest.rendezvous(point);
    await flush();
    expect(host.partnerHasArrived(point), "the original guest arrival was lost").toBe(false);

    expect(
      guest.restorePeerControlSnapshot({
        localArrived: [point],
        partnerArrived: [],
        awaiting: [point, "cmd:future:1"],
      }),
    ).toBe(true);
    const result = await guestWait;
    await flush();

    expect(result).toMatchObject({ point, timedOut: false });
    expect(host.partnerHasArrived(point), "the preserved local arrival is retransmitted to the peer").toBe(true);
    expect(guest.describeArrivals()).toMatchObject({
      localArrived: [point],
      partnerArrived: [point],
      awaiting: [],
    });
    expect(
      guest.describeArrivals().localArrived,
      "a peer wait alone is not proof that this client reached a future barrier",
    ).not.toContain("cmd:future:1");

    host.dispose();
    guest.dispose();
  });

  it("refuses malformed barrier snapshots without mutating the live view", () => {
    const pair = createLoopbackPair();
    const guest = new CoopRendezvous(pair.guest);
    guest.arrive("shop:8:2");
    const before = guest.describeArrivals();

    expect(
      guest.restorePeerControlSnapshot({
        localArrived: ["cmd:8:2", "cmd:8:2"],
        partnerArrived: [],
        awaiting: [],
      }),
    ).toBe(false);
    expect(guest.describeArrivals()).toEqual(before);
    guest.dispose();
  });

  it("LOST ARRIVAL: timeout retransmits and keeps the boundary closed until the partner arrives", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    // Only the host installs a rendezvous; the "partner" never arrives.
    const host = new CoopRendezvous(pair.host, { schedule: manual.schedule });

    const hostP = host.rendezvous("cmd:99:9");
    await flush();
    let crossed = false;
    void hostP.then(() => {
      crossed = true;
    });
    manual.fireNext();
    await flush();
    expect(crossed, "a timeout never authorizes unilateral continuation").toBe(false);
    expect(
      warnSpy.mock.calls.some(c => String(c[0]).includes("RENDEZVOUS RECOVERY RETRY")),
      "the timeout emits a loud recovery marker",
    ).toBe(true);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("PROCEEDING"))).toBe(false);

    // The peer/reconnect eventually supplies the exact arrival; only then may the boundary cross.
    pair.guest.send({ t: "rendezvous", point: "cmd:99:9" });
    const hr = await hostP;
    expect(hr.timedOut).toBe(false);
    expect(hr.point).toBe("cmd:99:9");

    host.dispose();
  });

  it("incompatible cmd:3:2 wait exhausts finitely into a fatal closed result", async () => {
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    const failures: unknown[] = [];
    const host = new CoopRendezvous(pair.host, {
      schedule: manual.schedule,
      maxRecoveryAttempts: 2,
      onRecoveryExhausted: failure => failures.push(failure),
    });

    const wait = host.rendezvous("cmd:3:2");
    expect(coopMachineWaitLabels().some(label => label.startsWith("coop-rendezvous:cmd:3:2@"))).toBe(true);

    manual.fireNext();
    await flush();
    manual.fireNext();
    await flush();
    let crossed = false;
    void wait.then(() => {
      crossed = true;
    });
    expect(crossed, "two bounded retransmits never authorize the incompatible command point").toBe(false);

    manual.fireNext();
    await flush();
    const result = await wait;
    expect(result).toEqual({ point: "cmd:3:2", timedOut: true });
    expect(failures).toEqual([{ point: "cmd:3:2", attempts: 2, kind: "arrival" }]);
    expect(coopMachineWaitLabels().some(label => label.startsWith("coop-rendezvous:cmd:3:2@"))).toBe(false);

    host.dispose();
  });

  it("supports a longer command-pacing retry budget without weakening the bounded terminal", async () => {
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    const failures: unknown[] = [];
    const host = new CoopRendezvous(pair.host, {
      schedule: manual.schedule,
      maxRecoveryAttempts: 2,
      onRecoveryExhausted: failure => failures.push(failure),
    });

    const wait = host.rendezvous("cmd:1:1", 60_000, 7);
    for (let attempt = 0; attempt < 7; attempt++) {
      manual.fireNext();
      await flush();
      expect(failures, `command pacing remains open after retransmit ${attempt + 1}/7`).toEqual([]);
    }
    manual.fireNext();
    await flush();

    expect(await wait).toEqual({ point: "cmd:1:1", timedOut: true });
    expect(failures).toEqual([{ point: "cmd:1:1", attempts: 7, kind: "arrival" }]);
    host.dispose();
  });

  it("#899 queued partner arrival wins when the vitest timeout fires before its delivery microtask", async () => {
    const pair = createLoopbackPair();
    const manual = makeManualScheduler();
    const host = new CoopRendezvous(pair.host, { schedule: manual.schedule });
    const guest = new CoopRendezvous(pair.guest);

    const hostP = host.rendezvous("cmd:2:1");
    guest.arrive("cmd:2:1"); // queues the real arrival on LoopbackTransport's delivery microtask
    manual.fireNext(); // reproduce the loaded-pump race: wall timer fires before that queued delivery runs

    const result = await hostP;
    expect(result.timedOut, "the already-queued partner arrival must beat the test-only timeout backstop").toBe(false);
    expect(host.partnerHasArrived("cmd:2:1")).toBe(true);

    host.dispose();
    guest.dispose();
  });

  it("FAULT-INJECTION: first arrivals are dropped -> retry heals and neither side proceeds early", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const faulted = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 839 });
    faulted.armNextDrop("rendezvous", "both");
    const host = new CoopRendezvous(faulted.host, { timeoutMs: 40 });
    const guest = new CoopRendezvous(faulted.guest, { timeoutMs: 40 });

    const [hr, gr] = await Promise.all([host.rendezvous("cmd:7:1"), guest.rendezvous("cmd:7:1")]);

    expect(hr.timedOut, "host crossed only after the recovered exact arrival").toBe(false);
    expect(gr.timedOut, "guest crossed only after the recovered exact arrival").toBe(false);
    expect(faulted.faultsInjected(), "the fault transport actually dropped the arrivals").toBeGreaterThan(0);
    const warns = warnSpy.mock.calls.filter(c => String(c[0]).includes("RENDEZVOUS RECOVERY RETRY"));
    expect(warns.length, "at least one side emitted the recovery retry marker").toBeGreaterThanOrEqual(1);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("PROCEEDING"))).toBe(false);

    host.dispose();
    guest.dispose();
    faulted.host.close();
  });

  // ===========================================================================================
  // HOST-AUTHORITATIVE CROSS-POINT ROUTE (the berry-bush deadlock). A foreign arrival proves the peers
  // reached different branches. The host states its local point as the winning route, retransmits until
  // the guest ACKs, and only then proceeds. The guest receives an explicit routed-away result.
  // ===========================================================================================
  it("#847 CROSS-POINT release (LIVE) remains classified separately from timeout recovery", async () => {
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
    expect(hr.timedOut).toBe(false);
    expect(hr.crossPoint).toBe("cmd:3:2");
    expect(hr.authoritativePoint).toBe("shop:3:2");
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("RENDEZVOUS RECOVERY RETRY"))).toBe(false);

    host.dispose();
    guest.dispose();
  });

  it("#847 buffered cross-point is resolved by the host route, never local guest inference", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // The host reaches the reward shop and ARRIVES there; the guest BUFFERS this shop:3:2 arrival BEFORE
    // it opens its (phantom) cmd:3:2 await - the exact ordering from the live trace ("RECV arrival
    // point=shop:3:2 -> BUFFER (no waiter yet)" landing before the guest's own cmd:3:2 await).
    host.arrive("shop:3:2");
    await flush();
    expect(guest.partnerHasArrived("shop:3:2")).toBe(true);

    const guestP = guest.rendezvous("cmd:3:2");
    await flush();
    // Host now observes the guest's buffered cmd arrival while awaiting its authoritative shop point.
    const [gr, hr] = await Promise.all([guestP, host.awaitPartner("shop:3:2")]);
    expect(gr.timedOut).toBe(false);
    expect(gr.crossPoint).toBe("shop:3:2");
    expect(gr.authoritativePoint).toBe("shop:3:2");
    expect(hr.authoritativePoint).toBe("shop:3:2");

    host.dispose();
    guest.dispose();
  });

  it("FAULT-INJECTION: lost phaseRoute and ACK retransmit until both adopt the host branch", async () => {
    const faulted = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 847 });
    faulted.armNextDrop("phaseRoute", "host");
    faulted.armNextDrop("phaseRouteAck", "guest");
    const host = new CoopRendezvous(faulted.host, { timeoutMs: 20 });
    const guest = new CoopRendezvous(faulted.guest, { timeoutMs: 20 });

    const hostP = host.rendezvous("shop:8:4");
    const guestP = guest.rendezvous("cmd:8:4");
    const [hr, gr] = await Promise.all([hostP, guestP]);

    expect(hr.authoritativePoint).toBe("shop:8:4");
    expect(gr.authoritativePoint).toBe("shop:8:4");
    expect(faulted.faultsInjected()).toBeGreaterThanOrEqual(2);

    host.dispose();
    guest.dispose();
    faulted.host.close();
  });

  it("host shop WATCHER proactively routes a foreign guest command without a host waiter", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // Odd-counter shop: host is the WATCHER, so production only calls arrive(shop) and never awaitPartner.
    host.arrive("shop:6:5");
    await flush();
    const gr = await guest.rendezvous("cmd:6:2");

    expect(gr.timedOut).toBe(false);
    expect(gr.authoritativePoint).toBe("shop:6:5");
    expect(gr.point).toBe("cmd:6:2");

    host.dispose();
    guest.dispose();
  });

  it("routes a guest that regresses to an already-observed command after both peers crossed the next wave", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    // The guest alone touched the phantom cmd:12:1 while the host took a non-battle ME branch. Both peers
    // then genuinely crossed cmd:13:1. This is the live guest-owned ME ordering: a retained old wave-12
    // CommandPhase became current after its rendezvous control state had been rebuilt. Its retransmit is a
    // duplicate to the host, and the host never had a local cmd:12:1 from which same-wave matching could heal.
    guest.arrive("cmd:12:1");
    await flush();
    guest.arrive("cmd:13:1");
    await flush();
    host.arrive("cmd:13:1");
    await flush();
    guest.purgeBufferedArrivals("simulate retained old CommandPhase after authoritative wave advance");

    const result = await guest.rendezvous("cmd:12:1");

    expect(result.timedOut).toBe(false);
    expect(result.point).toBe("cmd:12:1");
    expect(result.crossPoint).toBe("cmd:13:1");
    expect(result.authoritativePoint).toBe("cmd:13:1");

    host.dispose();
    guest.dispose();
  });

  it("routes a stale duplicate command to a causally-later same-wave shop boundary", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    await Promise.all([host.rendezvous("cmd:3:1"), guest.rendezvous("cmd:3:1")]);
    host.arrive("shop:3:0");
    await flush();
    guest.purgeBufferedArrivals("simulate catch finalization retaining the old CommandPhase");

    const result = await guest.rendezvous("cmd:3:1");

    expect(result.timedOut).toBe(false);
    expect(result.authoritativePoint).toBe("shop:3:0");

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
