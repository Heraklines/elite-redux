/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import { describe, expect, it, vi } from "vitest";

const ping = (ts: number): CoopMessage => ({ t: "ping", ts });

describe("co-op production-transition scheduled transport", () => {
  it("delivers FIFO only when the destination client is explicitly pumped", () => {
    const pair = createScheduledCoopPair();
    const hostRx = vi.fn();
    const guestRx = vi.fn();
    pair.host.onMessage(hostRx);
    pair.guest.onMessage(guestRx);

    pair.host.send(ping(1));
    pair.host.send(ping(2));
    pair.guest.send(ping(3));

    expect(hostRx, "send never resumes the peer in the sender's scene context").not.toHaveBeenCalled();
    expect(guestRx, "guest remains parked until its own scheduler turn").not.toHaveBeenCalled();
    expect(pair.pending("guest")).toBe(2);
    expect(pair.pending("host")).toBe(1);

    expect(pair.flush("guest", 1), "owner-fast schedule can deliver a bounded burst").toBe(1);
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([1]);
    expect(hostRx).not.toHaveBeenCalled();

    pair.flush("host");
    pair.flush("guest");
    expect(hostRx.mock.calls.map(([message]) => message.ts)).toEqual([3]);
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([1, 2]);
  });

  it("supports declared drop/duplicate/reconnect schedules without reordering surviving frames", () => {
    const pair = createScheduledCoopPair();
    const guestRx = vi.fn();
    const states: string[] = [];
    pair.guest.onMessage(guestRx);
    pair.guest.onStateChange(state => states.push(state));

    pair.dropNext("guest", message => message.t === "ping" && message.ts === 1);
    pair.duplicateNext("guest", message => message.t === "ping" && message.ts === 2);
    pair.host.send(ping(1));
    pair.host.send(ping(2));
    pair.host.send(ping(3));
    pair.flush("guest");
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([2, 2, 3]);

    pair.host.send(ping(4));
    pair.disconnect();
    pair.reconnect();
    pair.flush("guest");
    expect(
      guestRx.mock.calls.map(([message]) => message.ts),
      "old-generation queued frame is rejected",
    ).toEqual([2, 2, 3]);
    expect(states).toEqual(["disconnected", "connected"]);

    pair.host.send(ping(5));
    pair.flush("guest");
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([2, 2, 3, 5]);
  });

  it("reorders one valid pair without letting a stale reconnect frame block the queue", () => {
    const pair = createScheduledCoopPair();
    const guestRx = vi.fn();
    pair.guest.onMessage(guestRx);

    pair.reorderNext("guest", message => message.t === "ping" && message.ts === 1);
    pair.host.send(ping(1));
    expect(pair.flush("guest"), "reorder waits until the selected frame has a follower").toBe(0);
    pair.host.send(ping(2));
    expect(pair.flush("guest")).toBe(2);
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([2, 1]);

    pair.reorderNext("guest", message => message.t === "ping" && message.ts === 3);
    pair.host.send(ping(3));
    pair.disconnect();
    pair.reconnect();
    expect(pair.flush("guest"), "old-generation reorder target is discarded without waiting for a follower").toBe(0);
    expect(pair.pending("guest")).toBe(0);

    pair.host.send(ping(4));
    expect(pair.flush("guest")).toBe(1);
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([2, 1, 4]);
  });

  it("can boot with ordinary microtask delivery, then switch to explicit per-client scheduling", async () => {
    const pair = createScheduledCoopPair({ automatic: true });
    const guestRx = vi.fn();
    pair.guest.onMessage(guestRx);
    pair.host.send(ping(1));
    await Promise.resolve();
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([1]);

    pair.setAutomaticDelivery(false);
    pair.host.send(ping(2));
    await Promise.resolve();
    expect(
      guestRx.mock.calls.map(([message]) => message.ts),
      "manual journey does not cross scene contexts",
    ).toEqual([1]);
    pair.flush("guest");
    expect(guestRx.mock.calls.map(([message]) => message.ts)).toEqual([1, 2]);
  });
});
