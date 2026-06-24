/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op alternating-interaction relay (#633). Same seed -> both clients generate the
// IDENTICAL reward/shop/ME pool, so only the OWNER's CHOICE crosses the wire and the
// WATCHER applies the same index to its own pool. Verified over a LoopbackTransport:
// FIFO per-interaction delivery (multi-buy shops), race buffering, timeout->null, and
// stale-seq isolation.

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

describe("co-op alternating-interaction relay (#633)", () => {
  it("delivers the owner's choice to a parked watcher (reward pick)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    const awaited = watcher.awaitInteractionChoice(0);
    owner.sendInteractionChoice(0, "reward", 2);

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.choice).toBe(2);
    expect(res?.data).toBeUndefined();
  });

  it("delivers a multi-pick shop sequence FIFO, ending in the leave sentinel", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // Owner buys slot 5 (onto party mon 1), then slot 2, then leaves - all one interaction.
    owner.sendInteractionChoice(3, "biomeShop", 5, [1]);
    owner.sendInteractionChoice(3, "biomeShop", 2);
    owner.sendInteractionChoice(3, "biomeShop", COOP_INTERACTION_LEAVE);
    await new Promise(r => setTimeout(r, 0)); // let them buffer

    const first = await watcher.awaitInteractionChoice(3);
    expect(first?.choice).toBe(5);
    expect(first?.data).toEqual([1]);
    const second = await watcher.awaitInteractionChoice(3);
    expect(second?.choice).toBe(2);
    const third = await watcher.awaitInteractionChoice(3);
    expect(third?.choice).toBe(COOP_INTERACTION_LEAVE);
  });

  it("times out to null so the watcher never hangs, then leaves", async () => {
    const { guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const awaited = watcher.awaitInteractionChoice(1, 1000);
    expect(timer.fire).toBeDefined();
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a choice for a DIFFERENT interaction seq does not satisfy the wait", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    // Owner sends a choice for interaction 4; the watcher is waiting on interaction 5.
    owner.sendInteractionChoice(4, "me", 0);
    const awaited = watcher.awaitInteractionChoice(5, 1000);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });
});
