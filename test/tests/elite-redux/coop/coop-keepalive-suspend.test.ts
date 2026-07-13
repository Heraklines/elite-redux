/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #857 round 3 - KEEPALIVE SUSPENSION RESILIENCE. Mobile browsers FREEZE setInterval when the screen
// locks or the tab is heavily backgrounded, so the keepalive timer stops firing during exactly the long
// idle barrier waits it exists to cover - ICE consent / the NAT binding then lapses and the channel is
// torn down into the reconnect flap. These engine-free tests drive the transport with an INJECTED clock +
// schedule (no live ICE, no timers) to prove: a resumed tick that observes a large wall-clock gap is
// classified as a suspend/resume event and re-warms immediately (kicking the rejoin proactively when the
// channel died during the freeze), the browser resume signals fire an immediate re-warm, every listener is
// unregistered on cancel, and the headless path (no document/window) touches no browser API.

import type { CoopConnectionState } from "#data/elite-redux/coop/coop-transport";
import {
  COOP_KEEPALIVE_MS,
  COOP_KEEPALIVE_SUSPEND_FACTOR,
  type CoopWireChannel,
  WebRtcTransport,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal in-process data-channel mock: enough of {@linkcode CoopWireChannel} for keepalive framing. */
class MockWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: string[] = [];
  lastError: string | undefined = undefined;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = "closed";
  }
  onMessage(): void {}
  onOpen(): void {}
  onClose(): void {}
  onBufferedAmountLow(): void {}
}

/** A manual scheduler: captures the keepalive callback so a test drives ticks deterministically. */
class ManualSchedule {
  private cb: (() => void) | null = null;
  ms = -1;
  cancelled = false;
  readonly schedule = (fn: () => void, interval: number): (() => void) => {
    this.cb = fn;
    this.ms = interval;
    return () => {
      this.cb = null;
      this.cancelled = true;
    };
  };
  tick(): void {
    this.cb?.();
  }
}

/**
 * Fake DOM EventTarget recording live listeners so a test can fire resume signals AND assert every listener
 * is later unregistered. Stubbed onto globalThis (via vi.stubGlobal) so the transport's `typeof document`/
 * `typeof window` feature-detection resolves to it.
 */
class FakeEventTarget {
  private readonly handlers = new Map<string, Set<() => void>>();
  addEventListener(type: string, handler: () => void): void {
    let set = this.handlers.get(type);
    if (set == null) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }
  removeEventListener(type: string, handler: () => void): void {
    this.handlers.get(type)?.delete(handler);
  }
  fire(type: string): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) {
      handler();
    }
  }
  activeListenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

const pingCount = (wire: MockWire): number => wire.sent.filter(frame => JSON.parse(frame).t === "ping").length;

describe("#857 keepalive SUSPENSION resilience: a resumed timer detects the screen-lock freeze gap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pings on a normal tick; a >3x wall-clock gap is classified as a suspend/resume event, logged, and re-warms", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    let nowMs = 0;
    const clock = () => nowMs;

    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule, clock);

    // A NORMAL tick (one interval later) just re-warms the path with a ping - no gap classification.
    nowMs += COOP_KEEPALIVE_MS;
    sched.tick();
    expect(pingCount(wire)).toBe(1);
    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("suspend/resume gap");

    // The tab is frozen (screen lock): the NEXT tick lands far in the future. gap > FACTOR x interval.
    const frozenGap = COOP_KEEPALIVE_MS * (COOP_KEEPALIVE_SUSPEND_FACTOR + 1);
    nowMs += frozenGap;
    sched.tick();

    // It re-warmed immediately (still-open channel refreshes consent) AND logged the gap in ms.
    expect(pingCount(wire)).toBe(2);
    const gapLog = logSpy.mock.calls.flat().join("\n");
    expect(gapLog).toContain("suspend/resume gap");
    expect(gapLog).toContain(`gap=${frozenGap}ms`);
    // A still-open channel is NOT kicked into rejoin - a single ping is enough.
    expect(transport.state).toBe("connected");
  });

  it("on a suspend gap where the channel DIED during the freeze, kicks the rejoin path proactively (no close event needed)", () => {
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const states: CoopConnectionState[] = [];
    transport.onStateChange(state => states.push(state));
    const sched = new ManualSchedule();
    let nowMs = 0;
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule, () => nowMs);
    expect(transport.state).toBe("connected");

    // The channel died while the tab was frozen; on a throttled tab the close EVENT can be arbitrarily
    // delayed, so the transport has not heard about it yet (readyState flips but no close handler fired).
    wire.readyState = "closed";

    nowMs += COOP_KEEPALIVE_MS * (COOP_KEEPALIVE_SUSPEND_FACTOR + 1);
    sched.tick();

    // The suspend-gap detection drove the transport to `disconnected` itself - the runtime's existing
    // onStateChange -> rejoinDriver reaction fires WITHOUT waiting for the delayed close event.
    expect(transport.state).toBe("disconnected");
    expect(states).toContain("disconnected");
  });

  it("does not misclassify: a gap of exactly 3x the interval is a normal tick (scheduler jitter tolerated)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    let nowMs = 0;
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule, () => nowMs);

    // Exactly 3x (the boundary) is NOT over the threshold - still a normal ping, no classification.
    nowMs += COOP_KEEPALIVE_MS * COOP_KEEPALIVE_SUSPEND_FACTOR;
    sched.tick();
    expect(pingCount(wire)).toBe(1);
    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("suspend/resume gap");
  });
});

describe("#857 keepalive: browser resume signals fire an immediate re-warm + gap check", () => {
  let fakeDocument: FakeDocument;
  let fakeWindow: FakeEventTarget;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    fakeWindow = new FakeEventTarget();
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("window", fakeWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a visibilitychange to visible sends an immediate keepalive ping (does not wait for the throttled timer)", () => {
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    fakeDocument.visibilityState = "visible";
    fakeDocument.fire("visibilitychange");
    expect(pingCount(wire)).toBe(1);
  });

  it("ignores the HIDE half of visibilitychange (only a resume to visible re-warms)", () => {
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    fakeDocument.visibilityState = "hidden";
    fakeDocument.fire("visibilitychange");
    expect(pingCount(wire)).toBe(0);
  });

  it("pageshow, focus, and online each drive an immediate re-warm", () => {
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    fakeWindow.fire("pageshow");
    fakeWindow.fire("focus");
    fakeWindow.fire("online");
    expect(pingCount(wire)).toBe(3);
  });

  it("a resume signal after a long freeze runs the SAME suspend-gap detection as a delayed tick", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    let nowMs = 0;
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule, () => nowMs);

    // The wake signal (visibilitychange) arrives before the still-throttled timer tick fires.
    const frozenGap = COOP_KEEPALIVE_MS * (COOP_KEEPALIVE_SUSPEND_FACTOR + 2);
    nowMs += frozenGap;
    fakeDocument.fire("visibilitychange");

    const gapLog = logSpy.mock.calls.flat().join("\n");
    expect(gapLog).toContain("suspend/resume gap");
    expect(gapLog).toContain("source=visibilitychange");
    expect(gapLog).toContain(`gap=${frozenGap}ms`);
    expect(pingCount(wire)).toBe(1);
  });

  it("cancel/close unregisters every browser resume listener (teardown leaks nothing)", () => {
    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    // startKeepalive registered: document visibilitychange (1) + window pageshow/focus/online (3).
    expect(fakeDocument.activeListenerCount()).toBe(1);
    expect(fakeWindow.activeListenerCount()).toBe(3);

    transport.close();

    expect(fakeDocument.activeListenerCount(), "document listener removed on close").toBe(0);
    expect(fakeWindow.activeListenerCount(), "window listeners removed on close").toBe(0);

    // Firing the signals after teardown does nothing (no dangling handler pings a closed transport).
    fakeDocument.fire("visibilitychange");
    fakeWindow.fire("pageshow");
    expect(pingCount(wire)).toBe(0);
  });
});

describe("#857 keepalive: the headless path (no document/window) touches no browser API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts, ticks, and cancels cleanly with no browser globals available", () => {
    // Simulate a truly headless environment: the globals resolve to undefined, so `typeof document`/
    // `typeof window` are "undefined" and the feature-detection short-circuits (no listener registered).
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");

    const wire = new MockWire();
    const transport = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();

    expect(() => transport.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule)).not.toThrow();
    // The timer path still functions - keepalive does not depend on any browser resume signal.
    sched.tick();
    expect(pingCount(wire)).toBe(1);

    // Teardown is clean even though no listeners were ever registered.
    expect(() => transport.close()).not.toThrow();
    expect(sched.cancelled).toBe(true);
  });
});
