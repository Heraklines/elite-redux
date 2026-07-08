/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #861 KIND-VALIDATION + SESSION-BOUNDARY PURGE on the alternating-interaction relay.
//
// Live P0: a watcher's reward-pick await BUFFER-HIT resolved on a STALE, minutes-old
// interactionChoice sitting at the SAME (reused) seq instead of the host's genuine pick (which
// buffered UNUSED behind it) -> the wrong pick applied, the interaction counter never advanced, the
// run split. Two independent defenses, both proven here:
//   (a) an await declares the `kind`s it consumes; a buffered/incoming choice of a WRONG kind is
//       re-buffered (never resolves the waiter) and the genuine later pick resolves it, and
//   (b) every session/epoch boundary PURGES the buffered arrivals so a prior epoch's message can
//       never satisfy a new epoch's await (seqs reset per epoch).

import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_ME_CHOICE_KINDS, COOP_REWARD_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** A manual timer so a network-wait's timeout fires only when the test chooses. */
function manualTimer(): {
  relay: (guest: ReturnType<typeof createLoopbackPair>["guest"]) => CoopInteractionRelay;
  fire: () => void;
} {
  const box: { fire?: () => void } = {};
  return {
    relay: guest =>
      new CoopInteractionRelay(guest, {
        schedule: cb => {
          box.fire = cb;
          return () => {};
        },
      }),
    fire: () => box.fire?.(),
  };
}

describe("#861 co-op relay kind-validation + session-boundary purge", () => {
  describe("(a) kind-validation - a stale WRONG-KIND buffered choice never satisfies a typed await", () => {
    it("skips a stale same-seq wrong-kind entry and resolves on the genuine later reward pick (both pre-buffered)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      // The bug's exact shape: a stale minutes-old entry (wrong kind) is buffered at the reused reward
      // seq (choice=2 data=[0]), and the host's GENUINE reward pick (choice=1 data=[0,3,3]) buffers
      // right behind it. Before the fix a plain FIFO buffer-hit returned the stale choice=2.
      owner.sendInteractionChoice(0, "me", 2, [0]); // STALE: a prior epoch's ME pick at this seq
      owner.sendInteractionChoice(0, "reward", 1, [0, 3, 3]); // GENUINE: the host's real reward pick
      await new Promise(r => setTimeout(r, 0)); // let both buffer

      const res = await watcher.awaitInteractionChoice(0, 1000, COOP_REWARD_CHOICE_KINDS);
      expect(res).not.toBeNull();
      expect(res?.choice).toBe(1); // the genuine pick, NOT the stale choice=2
      expect(res?.data).toEqual([0, 3, 3]);
      expect(res?.kind).toBe("reward");
    });

    it("re-buffers a stale entry, parks, then resolves on the genuine pick that arrives after parking", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      owner.sendInteractionChoice(0, "me", 2, [0]); // stale wrong-kind pre-buffered
      await new Promise(r => setTimeout(r, 0));

      // The reward await sees only the wrong-kind entry -> re-buffers it and parks (no buffer-hit).
      const awaited = watcher.awaitInteractionChoice(0, 5000, COOP_REWARD_CHOICE_KINDS);
      owner.sendInteractionChoice(0, "reward", 1, [0, 3, 3]); // genuine pick arrives while parked
      const res = await awaited;
      expect(res?.choice).toBe(1);
      expect(res?.data).toEqual([0, 3, 3]);
      expect(res?.kind).toBe("reward");
    });

    it("an incoming wrong-kind choice does NOT resolve a parked typed waiter (it stays parked)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      const awaited = watcher.awaitInteractionChoice(0, 5000, COOP_REWARD_CHOICE_KINDS);
      let settled = false;
      void awaited.then(() => {
        settled = true;
      });

      owner.sendInteractionChoice(0, "me", 9); // wrong kind - must NOT resolve the reward waiter
      await new Promise(r => setTimeout(r, 0));
      expect(settled).toBe(false);

      owner.sendInteractionChoice(0, "reward", 4); // the genuine pick resolves it
      const res = await awaited;
      expect(res?.choice).toBe(4);
      expect(res?.kind).toBe("reward");
    });

    it("a legitimate multi-kind site (reward shop) still accepts every one of its kinds in FIFO order", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      // The reward loop legitimately streams several kinds on one seq: a lock toggle, then a buy, then
      // a reroll. All are reward-band kinds and must ALL be delivered (never re-buffered).
      owner.sendInteractionChoice(0, "lock", 0);
      owner.sendInteractionChoice(0, "reward", 3, [0]);
      owner.sendInteractionChoice(0, "reroll", -2);
      await new Promise(r => setTimeout(r, 0));

      expect((await watcher.awaitInteractionChoice(0, 1000, COOP_REWARD_CHOICE_KINDS))?.kind).toBe("lock");
      expect((await watcher.awaitInteractionChoice(0, 1000, COOP_REWARD_CHOICE_KINDS))?.kind).toBe("reward");
      expect((await watcher.awaitInteractionChoice(0, 1000, COOP_REWARD_CHOICE_KINDS))?.kind).toBe("reroll");
    });

    it("an un-typed await (no expectedKinds) keeps the legacy accept-any behavior", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      owner.sendInteractionChoice(0, "me", 7);
      await new Promise(r => setTimeout(r, 0));
      const res = await watcher.awaitInteractionChoice(0); // no expectedKinds -> accept any
      expect(res?.choice).toBe(7);
    });
  });

  describe("(b) session-boundary purge - a stale buffered arrival cannot satisfy a new epoch's await", () => {
    it("purgeBufferedArrivals drops a buffered choice so a later await no longer buffer-hits (times out instead)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer = manualTimer();
      const watcher = timer.relay(guest);

      // A prior epoch's reward pick is buffered at seq 5.
      owner.sendInteractionChoice(5, "reward", 2, [0]);
      await new Promise(r => setTimeout(r, 0));

      // The session boundary (clearCoopRuntime.dispose / applyCoopLaunchSession resume / hot-rejoin
      // resync) purges the buffers. The NEW epoch's await must NOT resolve on the stale pick.
      watcher.purgeBufferedArrivals("test session boundary");

      const awaited = watcher.awaitInteractionChoice(5, 1000, COOP_REWARD_CHOICE_KINDS);
      timer.fire();
      expect(await awaited).toBeNull();
    });

    it("without a purge the same buffered choice WOULD have satisfied the await (control)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      owner.sendInteractionChoice(5, "reward", 2, [0]);
      await new Promise(r => setTimeout(r, 0));
      const res = await watcher.awaitInteractionChoice(5, 1000, COOP_REWARD_CHOICE_KINDS);
      expect(res?.choice).toBe(2); // buffer-hit (proves the purge above is what changed the outcome)
    });

    it("purge also drops buffered rewardOptions and outcomes", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer = manualTimer();
      const watcher = timer.relay(guest);

      owner.sendRewardOptions(7, 0, [{ id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 }]);
      await new Promise(r => setTimeout(r, 0));
      expect(watcher.hasBufferedRewardOptionsFor("7:")).toBe(true);

      watcher.purgeBufferedArrivals("test");
      expect(watcher.hasBufferedRewardOptionsFor("7:")).toBe(false);

      const awaited = watcher.awaitRewardOptions(7, 0, 1000);
      timer.fire();
      expect(await awaited).toBeNull();
    });

    it("purge clears sticky-cancelled seqs so a reused low-counter seq is live again next epoch", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      // Park then sticky-cancel seq 0 (the resync-rescue path).
      void watcher.awaitInteractionChoice(0, 5000, COOP_REWARD_CHOICE_KINDS);
      watcher.cancelWaiters(() => true);
      // While sticky-cancelled, a fresh await on seq 0 resolves null immediately.
      expect(await watcher.awaitInteractionChoice(0, 5000, COOP_REWARD_CHOICE_KINDS)).toBeNull();

      // The new epoch purges -> seq 0 is live again and a genuine pick resolves it.
      watcher.purgeBufferedArrivals("new epoch");
      const awaited = watcher.awaitInteractionChoice(0, 5000, COOP_REWARD_CHOICE_KINDS);
      owner.sendInteractionChoice(0, "reward", 1);
      expect((await awaited)?.choice).toBe(1);
    });
  });

  describe("kind-set constants stay in sync with the registry", () => {
    it("every ME kind is distinct from every reward kind (cross-family sets never overlap)", () => {
      for (const meKind of COOP_ME_CHOICE_KINDS) {
        expect(COOP_REWARD_CHOICE_KINDS).not.toContain(meKind);
      }
    });
  });
});
