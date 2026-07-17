/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op host-authoritative interaction OUTCOME primitive (#633, TRACK-2 Phase C). The
// owner's client resolves a pick against the HOST's pool and STREAMS the authoritative
// outcome (item granted / reroll / leave); the watcher adopts it verbatim instead of
// re-deriving from its own (possibly divergent) pool. This verifies the wire shape +
// the relay's FIFO-per-seq / race-buffer / seq-isolation / timeout discipline over a
// LoopbackTransport - the same dead-but-verified pattern the battle streamer used before
// it was wired in. The engine-coupled grant/apply lives in the reward + ME phases.

import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const grant = (over: Partial<Extract<CoopInteractionOutcome, { k: "rewardGrant" }>> = {}): CoopInteractionOutcome => ({
  k: "rewardGrant",
  modifierTypeId: "EXP_CHARM",
  args: [],
  partySlot: -1,
  moneyDelta: -250,
  ...over,
});

describe("co-op interaction OUTCOME primitive (#633, TRACK-2 Phase C)", () => {
  it("delivers the host's resolved reward grant to a parked watcher", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    const awaited = watcher.awaitInteractionOutcome(0);
    owner.sendInteractionOutcome(0, "reward", grant({ modifierTypeId: "ROGUE_BALL", moneyDelta: -600 }));

    const res = await awaited;
    expect(res?.k).toBe("rewardGrant");
    if (res?.k !== "rewardGrant") {
      throw new Error("outcome kind lost over the wire");
    }
    // The watcher adopts the HOST's item + money, not its own pool's index-0 item.
    expect(res.modifierTypeId).toBe("ROGUE_BALL");
    expect(res.moneyDelta).toBe(-600);
    expect(res.partySlot).toBe(-1);
  });

  it("delivers a multi-pick shop OUTCOME sequence FIFO, ending in leave", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    owner.sendInteractionOutcome(3, "shop", grant({ modifierTypeId: "POTION", partySlot: 1, moneyDelta: -100 }));
    owner.sendInteractionOutcome(3, "shop", { k: "reroll", moneyDelta: -50 });
    owner.sendInteractionOutcome(3, "shop", { k: "leave" });
    await new Promise(r => setTimeout(r, 0)); // let them buffer

    const first = await watcher.awaitInteractionOutcome(3);
    expect(first?.k === "rewardGrant" ? first.partySlot : undefined).toBe(1);
    const second = await watcher.awaitInteractionOutcome(3);
    expect(second?.k).toBe("reroll");
    expect(second?.k === "reroll" ? second.moneyDelta : undefined).toBe(-50);
    const third = await watcher.awaitInteractionOutcome(3);
    expect(third?.k).toBe("leave");
  });

  it("buffers an outcome that arrives BEFORE its waiter (race fix)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    owner.sendInteractionOutcome(2, "reward", grant({ modifierTypeId: "LUCKY_EGG" }));
    await new Promise(r => setTimeout(r, 0)); // land in the watcher buffer

    expect(watcher.hasBufferedInteractionOutcomeFor(2)).toBe(true);
    const res = await watcher.awaitInteractionOutcome(2);
    expect(res?.k === "rewardGrant" ? res.modifierTypeId : undefined).toBe("LUCKY_EGG");
    expect(watcher.hasBufferedInteractionOutcomeFor(2)).toBe(false);
  });

  it("an outcome for a stale/other seq is buffered harmlessly, never consumed by a different seq", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });

    owner.sendInteractionOutcome(9, "reward", grant());
    await new Promise(r => setTimeout(r, 0));
    // Awaiting a DIFFERENT seq must time out to null (the seq-9 outcome stays buffered).
    expect(await watcher.awaitInteractionOutcome(4)).toBeNull();
  });

  it("times out to null so the watcher never hangs", async () => {
    const { guest } = createLoopbackPair();
    const watcher = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    expect(await watcher.awaitInteractionOutcome(0)).toBeNull();
  });

  it("dispose fails any in-flight outcome await with null", async () => {
    const { guest } = createLoopbackPair();
    const watcher = new CoopInteractionRelay(guest);
    const awaited = watcher.awaitInteractionOutcome(7);
    watcher.dispose();
    expect(await awaited).toBeNull();
  });

  it("the interactionOutcome wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    const outcomes: CoopInteractionOutcome[] = [
      grant({
        modifierTypeId: "MASTER_BALL",
        args: [1, 2],
        partySlot: 3,
        moneyDelta: -1000,
      }),
      { k: "reroll", moneyDelta: -75 },
      { k: "leave" },
    ];
    for (const outcome of outcomes) {
      const msg: CoopMessage = {
        t: "interactionOutcome",
        seq: 1,
        kind: "reward",
        outcome,
      };
      expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
    }
  });
});
