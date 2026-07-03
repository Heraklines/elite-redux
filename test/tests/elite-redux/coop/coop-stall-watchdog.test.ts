/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #806 stall watchdog - end-to-end over REAL transports + relays with fake
// time: both peers park in network waits, keepalive beats exchange, the
// mutual-wait cycle is detected, and recovery cancels the parked waits.
// =============================================================================

import type { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { wireCoopStallWatchdog } from "#data/elite-redux/coop/coop-runtime";
import { type CoopWireChannel, WebRtcTransport } from "#data/elite-redux/coop/coop-webrtc-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWire implements CoopWireChannel {
  readyState = "open";
  peer: MockWire | null = null;
  private msgHandler: ((d: string) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;
  send(data: string): void {
    this.peer?.msgHandler?.(data);
  }
  close(): void {
    this.readyState = "closed";
    this.closeHandler?.();
  }
  onMessage(h: (d: string) => void): void {
    this.msgHandler = h;
  }
  onOpen(h: () => void): void {
    this.openHandler = h;
  }
  onClose(h: () => void): void {
    this.closeHandler = h;
  }
}

/** Minimal stream stand-in: the watchdog only reads oldestNetworkWaitMs(). */
const idleStream = { oldestNetworkWaitMs: () => -1 } as unknown as CoopBattleStreamer;

describe("#806 stall watchdog end-to-end (keepalive + mutual-wait detection + recovery)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("both peers parked 20s+ -> beats exchange -> recovery cancels the parked waits", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const hostT = new WebRtcTransport("host", a);
    const guestT = new WebRtcTransport("guest", b);
    const hostRelay = new CoopInteractionRelay(hostT);
    const guestRelay = new CoopInteractionRelay(guestT);
    // The watchdog only touches runtime.controller.versionMismatch + identity checks.
    const stubRuntime = { controller: { versionMismatch: false } } as unknown as CoopRuntime;
    wireCoopStallWatchdog(hostT, hostRelay, idleStream, stubRuntime);
    wireCoopStallWatchdog(guestT, guestRelay, idleStream, stubRuntime);

    // Both sides park in NETWORK waits on seqs nobody will ever answer - the live
    // deadlock shape (host awaits a pick, guest awaits a turn).
    const hostWait = hostRelay.awaitInteractionChoice(111_111, 1_200_000);
    const guestWait = guestRelay.awaitInteractionChoice(222_222, 1_200_000);
    let hostResolved = false;
    let guestResolved = false;
    void hostWait.then(() => {
      hostResolved = true;
    });
    void guestWait.then(() => {
      guestResolved = true;
    });

    // 15s in: both report via keepalive but the 20s trigger has not fired yet.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(hostResolved).toBe(false);
    expect(guestResolved).toBe(false);

    // 30s in: both sides have reported 20s+ waits with fresh beats -> PROVEN mutual-wait
    // deadlock -> recovery cancels the parked waits (timeouts/AI fallbacks take over live).
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(hostResolved, "host's parked wait was cancelled by recovery").toBe(true);
    expect(guestResolved, "guest's parked wait was cancelled by recovery").toBe(true);
  });

  it("one-sided waiting never triggers (a human browsing a shop is not a deadlock)", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const hostT = new WebRtcTransport("host", a);
    const guestT = new WebRtcTransport("guest", b);
    const hostRelay = new CoopInteractionRelay(hostT);
    const guestRelay = new CoopInteractionRelay(guestT);
    const stubRuntime = { controller: { versionMismatch: false } } as unknown as CoopRuntime;
    wireCoopStallWatchdog(hostT, hostRelay, idleStream, stubRuntime);
    wireCoopStallWatchdog(guestT, guestRelay, idleStream, stubRuntime);

    // Only the HOST waits (the guest is a human browsing a shop - no network wait).
    const hostWait = hostRelay.awaitInteractionChoice(333_333, 1_200_000);
    let hostResolved = false;
    void hostWait.then(() => {
      hostResolved = true;
    });

    // Even after a full minute, no recovery fires: one-sided waiting is normal play.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hostResolved, "one-sided wait NOT cancelled (no false positive)").toBe(false);

    // The guest answers like a human eventually would: the wait resolves normally.
    guestRelay.sendInteractionChoice(333_333, "test", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(hostResolved).toBe(true);
  });
});
