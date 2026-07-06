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

  it("independent points do not interfere (a barrier at one point never satisfies another)", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host);
    const guest = new CoopRendezvous(pair.guest);

    let aCrossed = false;
    const aP = host.rendezvous("cmd:1:1").then(r => {
      aCrossed = true;
      return r;
    });
    // The guest arrives at a DIFFERENT point - it must NOT satisfy the host's barrier at cmd:1:1.
    guest.arrive("cmd:1:2");
    await flush();
    expect(aCrossed).toBe(false);

    guest.arrive("cmd:1:1");
    await flush();
    await aP;
    expect(aCrossed).toBe(true);

    host.dispose();
    guest.dispose();
  });
});
