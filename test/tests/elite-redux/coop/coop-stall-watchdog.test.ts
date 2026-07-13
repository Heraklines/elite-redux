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
import { getCoopCausalTrace, resetCoopCausalTrace } from "#data/elite-redux/coop/coop-causal-trace";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { wireCoopStallWatchdog } from "#data/elite-redux/coop/coop-runtime";
import { COOP_ME_PUMP_SEQ_BASE, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
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
    resetCoopCausalTrace();
  });
  afterEach(() => {
    setCoopMeInteractionStart(-1);
    vi.useRealTimers();
    resetCoopCausalTrace();
  });

  it("active Mystery 8M/9M waits survive mutual-stall recovery and resolve only from exact host/owner carriers", async () => {
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

    const pinned = 17;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + pinned;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + pinned;
    setCoopMeInteractionStart(pinned);
    const hostPickWait = hostRelay.awaitInteractionChoice(seqMe, 1_200_000);
    const guestTerminalWait = guestRelay.awaitInteractionChoice(seqTerm, 1_200_000);
    let hostResolved = false;
    let guestResolved = false;
    void hostPickWait.then(() => {
      hostResolved = true;
    });
    void guestTerminalWait.then(() => {
      guestResolved = true;
    });

    // The watchdog still detects the mutual wait and runs recovery, but must not synthesize null by
    // sticky-cancelling the active Mystery control channels.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(getCoopCausalTrace().some(event => event.stage === "stall-detected")).toBe(true);
    expect(hostResolved, "8M owner-pick wait is retained").toBe(false);
    expect(guestResolved, "9M terminal wait is retained").toBe(false);

    guestRelay.sendInteractionChoice(seqMe, "me", 2);
    hostRelay.sendInteractionChoice(seqTerm, "meBtn", -1);
    await vi.advanceTimersByTimeAsync(0);
    expect((await hostPickWait)?.choice).toBe(2);
    expect((await guestTerminalWait)?.choice).toBe(-1);
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
    const recoveries = getCoopCausalTrace().filter(event => event.domain === "recovery");
    expect(
      recoveries.some(event => event.stage === "stall-detected"),
      "the deadlock has a structured causal edge",
    ).toBe(true);
    expect(new Set(recoveries.map(event => event.causalId)).size, "both peers correlate the same stall boundary").toBe(
      1,
    );
  });

  it("#857 R2: idle keepalive pings are NOT a deadlock signal (idle channel + pings -> watchdog never fires)", async () => {
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

    // BOTH peers keep the idle channel warm with #857 keepalive pings (the two-humans-parked-at-the-
    // pre-battle-barrier shape), but NEITHER is in a network wait. Pings are transport-internal and must
    // never be miscounted as liveness/deadlock traffic - the watchdog must stay quiet through them.
    hostT.startKeepalive(5_000);
    guestT.startKeepalive(5_000);

    // Park a lone one-sided wait so there IS something recovery would wrongly cancel if it fired.
    const hostWait = hostRelay.awaitInteractionChoice(444_444, 1_200_000);
    let resolved = false;
    void hostWait.then(() => {
      resolved = true;
    });

    // A full minute of keepalive pings + a one-sided wait: no mutual deadlock -> recovery never fires.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved, "idle keepalive pings never trip the stall watchdog").toBe(false);

    // The peer eventually answers like a human would: the wait resolves normally (channel stayed healthy).
    guestRelay.sendInteractionChoice(444_444, "test", 7);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(hostT.state).toBe("connected");
    expect(guestT.state).toBe("connected");
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
