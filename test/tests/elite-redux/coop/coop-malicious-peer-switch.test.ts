/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Malicious-peer hardening (#829): the co-op interaction relay applies a CROSS-OWNER faint-replacement
// switch cursor (the peer relays a replacement pick for its OWN field slot; the authoritative host
// summons that mon into the slot). Without validation a malicious/buggy peer could forge a pick for a
// slot it does NOT own and drive a switch on the other player's mon. The relay now validates, on the
// faint-switch seq band ONLY (where slot ownership is well-defined via the fixed 2-player seat map),
// that the addressed slot is owned by the PEER (the sender), never this client's own seat - dropping a
// violating message LOUDLY ([coop:security] WARN) without ever buffering / delivering / applying it.
//
// Engine-FREE (relay + LoopbackTransport only), so it runs in the default suite like
// coop-interaction-relay.test.ts.

import { COOP_FAINT_SWITCH_SEQ_BASE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it, vi } from "vitest";

/** Was ANY console.warn call the loud security drop? */
function warnedSecurity(spy: ReturnType<typeof vi.spyOn>): boolean {
  return spy.mock.calls.some(([m]) => String(m).includes("[coop:security]"));
}

describe("co-op malicious-peer switch hardening (#829)", () => {
  it("DROPS a forged cross-owner faint-switch pick (peer targets the RECEIVER's own seat) + LOUD [coop:security] warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      // Inject the timer so the parked waiter's timeout fires deterministically (no real 20min wait).
      const hostRelay = new CoopInteractionRelay(host, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const guestRelay = new CoopInteractionRelay(guest);

      // Slot 0 is the HOST's OWN field seat - a pick for it must come from the HOST, never the guest.
      const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_HOST_FIELD_INDEX;
      // The host is parked awaiting on that seq; a MALICIOUS guest forges a replacement pick for it.
      const awaited = hostRelay.awaitInteractionChoice(seq, 1000);
      guestRelay.sendInteractionChoice(seq, "switch", 3, [0, 999]);
      await new Promise(r => setTimeout(r, 0)); // let the loopback microtask deliver

      // Dropped LOUDLY.
      expect(warnedSecurity(warnSpy)).toBe(true);

      // State unchanged: the forged pick did NOT satisfy the parked waiter (it was never delivered or
      // buffered), so ONLY the injected timeout resolves it - to null (the host never applies the cursor).
      expect(timer.fire).toBeDefined();
      timer.fire?.();
      expect(await awaited).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("DELIVERS a legitimate same-owner faint-switch pick (the real owner path stays intact)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, guest } = createLoopbackPair();
      const hostRelay = new CoopInteractionRelay(host);
      const guestRelay = new CoopInteractionRelay(guest);

      // Slot 1 is the GUEST's OWN field seat: the guest relaying its OWN replacement is the legitimate
      // production path (CoopGuestFaintSwitchPhase -> the host's awaiting SwitchPhase). It must pass.
      const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
      const awaited = hostRelay.awaitInteractionChoice(seq);
      guestRelay.sendInteractionChoice(seq, "switch", 3, [0, 999]);

      const res = await awaited;
      expect(res).not.toBeNull();
      expect(res?.choice).toBe(3);
      expect(res?.data).toEqual([0, 999]);
      // Never flagged as a security drop.
      expect(warnedSecurity(warnSpy)).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("uses the live field owner after party compaction instead of the launch-slot map", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, guest } = createLoopbackPair();
      // Reproduce the host-half-wipe geometry: the guest survivor has been recentered into slot 0.
      const liveOwners = new Map<number, "host" | "guest">([
        [COOP_HOST_FIELD_INDEX, "guest"],
        [COOP_GUEST_FIELD_INDEX, "host"],
      ]);
      const hostRelay = new CoopInteractionRelay(host, {
        resolveFieldSlotOwner: fieldIndex => liveOwners.get(fieldIndex) ?? "host",
      });
      const guestRelay = new CoopInteractionRelay(guest);

      const recenteredGuestSeq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_HOST_FIELD_INDEX;
      const legitimate = hostRelay.awaitInteractionChoice(recenteredGuestSeq);
      guestRelay.sendInteractionChoice(recenteredGuestSeq, "switch", 3, [0, 999]);

      expect((await legitimate)?.choice, "the recentered guest can replace its own slot 0 mon").toBe(3);
      expect(warnedSecurity(warnSpy)).toBe(false);
      hostRelay.dispose();

      const nowHostOwnedSeq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
      const timer: { fire?: () => void } = {};
      const guardedHostRelay = new CoopInteractionRelay(host, {
        resolveFieldSlotOwner: fieldIndex => liveOwners.get(fieldIndex) ?? "host",
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const forged = guardedHostRelay.awaitInteractionChoice(nowHostOwnedSeq, 1000);
      guestRelay.sendInteractionChoice(nowHostOwnedSeq, "switch", 2, [0, 999]);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(warnedSecurity(warnSpy)).toBe(true);
      timer.fire?.();
      expect(await forged, "the guest still cannot replace the host-owned recentered slot").toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("leaves NON-switch interaction seqs (reward/shop/ME) untouched by the ownership check", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, guest } = createLoopbackPair();
      const hostRelay = new CoopInteractionRelay(host);
      const guestRelay = new CoopInteractionRelay(guest);

      // A plain reward-shop pick (seq 0, outside the faint-switch band) is delivered regardless of any
      // seat parity - the ownership gate is scoped to the faint-switch band ONLY.
      const awaited = hostRelay.awaitInteractionChoice(0);
      guestRelay.sendInteractionChoice(0, "reward", 2);

      const res = await awaited;
      expect(res?.choice).toBe(2);
      expect(warnedSecurity(warnSpy)).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
