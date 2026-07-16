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
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
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

  it("deduplicates journal-first then raw interaction-choice carriers", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    watcher.materializeCommittedInteractionChoice(8, "abilityPicker", -3, [11], "1:0:800");
    owner.sendInteractionChoice(8, "abilityPicker", -3, [11]);
    expect((await watcher.awaitInteractionChoice(8))?.data).toEqual([11]);
    const echo = watcher.awaitInteractionChoice(8, 1);
    timer.fire?.();
    expect(await echo).toBeNull();
  });

  it("deduplicates raw-first then journal interaction-choice carriers", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    owner.sendInteractionChoice(9, "abilityPicker", -3, [12, 2]);
    await Promise.resolve();
    watcher.materializeCommittedInteractionChoice(9, "abilityPicker", -3, [12, 2], "1:0:900");
    expect((await watcher.awaitInteractionChoice(9))?.data).toEqual([12, 2]);
    const echo = watcher.awaitInteractionChoice(9, 1);
    timer.fire?.();
    expect(await echo).toBeNull();
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

  // Fix #2 (#633): the OWNER host-streams its rolled reward-option list so the WATCHER
  // rebuilds it instead of re-rolling (party luck would diverge the pools + the RNG cursor).
  describe("reward-option streaming (#633 Fix #2)", () => {
    const options = [
      { id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 },
      { id: "TM_NORMAL", tier: 2, upgradeCount: 1, cost: 0, pregenArgs: [33] },
    ];

    it("delivers the owner's rolled option list to a parked watcher", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      const awaited = watcher.awaitRewardOptions(7, 0);
      owner.sendRewardOptions(7, 0, options);

      const res = await awaited;
      expect(res).toEqual(options);
    });

    it("buffers options that arrive before the watcher awaits (race fix)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      owner.sendRewardOptions(7, 0, options);
      await new Promise(r => setTimeout(r, 0)); // let it buffer
      const res = await watcher.awaitRewardOptions(7, 0);
      expect(res).toEqual(options);
    });

    it("re-requests and recovers the exact cached owner options when the first stream frame is lost", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 81017 });
      const owner = new CoopInteractionRelay(pair.host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(pair.guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      pair.armNextDrop("rewardOptions", "host");
      owner.sendRewardOptions(8, 0, options);
      const awaited = watcher.awaitRewardOptions(8, 0, 1000);
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();

      expect(await awaited).toEqual(options);
      expect(pair.counters.host.oneShotDropped).toBe(1);
    });

    it("keys options by (seq, reroll) - a different reroll round does not satisfy the wait", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      // Owner streams the reroll-0 list; the watcher is waiting on reroll 1.
      owner.sendRewardOptions(7, 0, options);
      const awaited = watcher.awaitRewardOptions(7, 1, 1000);
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();
      expect(await awaited).toBeNull();
    });

    it("does not alias two ordered ME surfaces at the same seq and reroll", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const firstSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
      const secondSurface = { surfaceId: "modifier:me:graves:1", ordinal: 1 } as const;

      owner.sendRewardOptions(7, 0, options, firstSurface);
      await new Promise(r => setTimeout(r, 0));
      const wrongSurface = watcher.awaitRewardOptions(7, 0, 1000, secondSurface);
      timer.fire?.();
      expect(await wrongSurface).toBeNull();
      expect(await watcher.awaitRewardOptions(7, 0, 1000, firstSurface)).toEqual(options);
    });

    it("drops a malformed ordered surface before it can satisfy an option waiter", async () => {
      const { host, guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const expectedSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
      const awaited = watcher.awaitRewardOptions(7, 0, 1000, expectedSurface);

      host.send({
        t: "rewardOptions",
        seq: 7,
        reroll: 0,
        options,
        rewardSurface: { surfaceId: "Modifier 0", ordinal: 0 },
      });
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();
      expect(await awaited).toBeNull();
    });

    it("times out to null so the caller can fail closed without using a local roll", async () => {
      const { guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      const awaited = watcher.awaitRewardOptions(2, 0, 1000);
      expect(timer.fire).toBeDefined();
      timer.fire?.();
      expect(await awaited).toBeNull();
    });
  });
});
