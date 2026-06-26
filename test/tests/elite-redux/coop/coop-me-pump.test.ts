/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MYSTERY-ENCOUNTER input pump (#633) - engine-free unit tests over a
// LoopbackTransport. Proves the authoritative button stream is FIFO + lossless (never
// drops, unlike the cosmetic mirror), readiness-gated (waits out the watcher's text
// scroll before applying), idempotent across nested option-selects (no double loop),
// and degrades to a safe skip on timeout. The LoopbackTransport delivers via
// queueMicrotask, so each batch of sends is followed by `await settle()`.
// =============================================================================

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_ME_BATTLE_HANDOFF, CoopMePump, type CoopMePumpEngine } from "#data/elite-redux/coop/coop-me-pump";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** Let the loopback microtasks + the pump's await/readiness chain drain before asserting. */
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
};

/** A recording engine with a settable ready flag. */
function makeEngine(ready = true): CoopMePumpEngine & { applied: number[]; ready: boolean } {
  const e = {
    applied: [] as number[],
    ready,
    isReady() {
      return e.ready;
    },
    applyButton(button: number) {
      e.applied.push(button);
    },
  };
  return e;
}

const SEQ = 8_000_042;
/** Macrotask tick so the readiness poll advances at a realistic (testable) pace, not instantly
 *  draining its best-effort guard. When the handler is READY the poll exits before ticking. */
const fastTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("co-op mystery-encounter input pump (#633)", () => {
  it("replays the owner's buttons on the watcher IN ORDER (lossless FIFO)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const wRelay = new CoopInteractionRelay(guest);
    const watcher = new CoopMePump(wRelay, { tick: fastTick });
    const eng = makeEngine();
    watcher.attach(eng);

    owner.beginOwner(SEQ);
    watcher.beginWatcher(SEQ, () => {});
    owner.relayOwnerButton(10);
    owner.relayOwnerButton(11);
    owner.relayOwnerButton(12);
    await settle();

    expect(eng.applied).toEqual([10, 11, 12]);
    expect(watcher.isWatcher()).toBe(true);
    expect(watcher.isSessionActive()).toBe(true);

    owner.endOwner();
    await settle();
    expect(watcher.isSessionActive()).toBe(false); // leave sentinel ended the loop

    owner.endSession();
    watcher.endSession();
  });

  it("is readiness-gated: holds a relayed button until the watcher's handler is READY", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const watcher = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const eng = makeEngine(false); // handler busy (text scrolling)
    watcher.attach(eng);

    owner.beginOwner(SEQ);
    watcher.beginWatcher(SEQ, () => {});
    owner.relayOwnerButton(20);
    await settle();
    expect(eng.applied).toEqual([]); // not applied while the handler is not ready

    eng.ready = true; // text finished, prompt up
    await settle();
    expect(eng.applied).toEqual([20]); // now it lands - never lost

    owner.endOwner();
    watcher.endSession();
  });

  it("beginWatcher is idempotent on the same seq (nested option-select spawns no 2nd loop)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const watcher = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const eng = makeEngine();
    watcher.attach(eng);

    owner.beginOwner(SEQ);
    watcher.beginWatcher(SEQ, () => {});
    watcher.beginWatcher(SEQ, () => {}); // re-enter (nested) - must not start a 2nd loop
    watcher.beginWatcher(SEQ, () => {});

    owner.relayOwnerButton(30);
    owner.relayOwnerButton(31);
    await settle();

    // A second loop would double-consume / double-apply; lossless single-apply proves one loop.
    expect(eng.applied).toEqual([30, 31]);

    owner.endOwner();
    watcher.endSession();
  });

  it("degrades to a safe skip when the owner's next button never arrives (timeout)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    // Short watcher wait so the timeout fires fast under test.
    const watcher = new CoopMePump(new CoopInteractionRelay(guest, { timeoutMs: 10 }), {
      tick: fastTick,
      waitMs: 10,
    });
    const eng = makeEngine();
    watcher.attach(eng);

    let degraded = false;
    owner.beginOwner(SEQ);
    watcher.beginWatcher(SEQ, () => {
      degraded = true;
    });
    owner.relayOwnerButton(40);
    await settle(); // first button applies
    expect(eng.applied).toEqual([40]);

    // No further buttons: the watcher's await times out -> onDegrade fires, session ends.
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    expect(degraded).toBe(true);
    expect(watcher.isSessionActive()).toBe(false);

    owner.endSession();
  });

  it("AUTHORITATIVE (#633 B-1): the owner sends its TERMINAL on termSeq, NOT on the 8M pick seq", async () => {
    // The B-1 regression: the authoritative host begins the pump with a DEDICATED terminal seq
    // (9M+start) and the authoritative guest awaits the terminal there. If endOwner() sent the
    // LEAVE on the 8M pick seq (the old bug) the 9M waiter would only resolve via the ~20-min
    // disconnect timeout - every authoritative non-battle ME hung the guest. This proves the
    // terminal actually lands on termSeq, and that an 8M-only listener never drains it.
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const guestRelay = new CoopInteractionRelay(guest);

    const SEQ_ME = 8_000_007; // guest -> host picks (P1/P1b)
    const SEQ_TERM = 9_000_007; // host -> guest terminal (P5/P6), disjoint
    owner.beginOwner(SEQ_ME, SEQ_TERM);

    // A waiter parked on the 8M pick seq (where guest->host picks ride) must NOT see the terminal.
    let drainedOnPickSeq: number | null | undefined;
    void guestRelay.awaitInteractionChoice(SEQ_ME, 10).then(a => {
      drainedOnPickSeq = a?.choice ?? null;
    });

    owner.endOwner();
    await settle();

    // The terminal LEAVE landed on the dedicated terminal seq, exactly where the guest awaits it.
    const sawTerminal = await guestRelay.awaitInteractionChoice(SEQ_TERM, 10);
    expect(sawTerminal?.choice).toBe(COOP_INTERACTION_LEAVE);
    // ...and the 8M pick-seq waiter timed out to null (the terminal never crossed channels).
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(drainedOnPickSeq ?? null).toBeNull();

    owner.endSession();
  });

  it("AUTHORITATIVE (#633 B-1): the BATTLE-HANDOFF sentinel also rides termSeq, not the 8M pick seq", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const guestRelay = new CoopInteractionRelay(guest);

    const SEQ_ME = 8_000_009;
    const SEQ_TERM = 9_000_009;
    owner.beginOwner(SEQ_ME, SEQ_TERM);
    owner.relayMeBattleHandoff();
    await settle();

    expect((await guestRelay.awaitInteractionChoice(SEQ_TERM, 10))?.choice).toBe(COOP_ME_BATTLE_HANDOFF);
    expect(await guestRelay.awaitInteractionChoice(SEQ_ME, 10)).toBeNull();

    owner.endSession();
  });

  it("LOCKSTEP (#633): with no termSeq the terminal stays on seq - the watcher loop catches it (byte-identical)", async () => {
    // Default termSeq == seq: the lockstep watcher loop awaits buttons AND the terminal on the SAME
    // seq, so omitting termSeq must keep the LEAVE on `seq` and end the loop, exactly as before.
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const watcher = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    watcher.attach(makeEngine());

    owner.beginOwner(SEQ); // no termSeq
    let left = false;
    watcher.beginWatcher(SEQ, () => {
      left = true;
    });
    owner.endOwner();
    await settle();
    expect(left, "the LEAVE on `seq` reached the same-seq watcher loop").toBe(true);
    expect(watcher.isSessionActive()).toBe(false);

    watcher.endSession();
  });

  it("the OWNER never applies into its own engine (it only relays)", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerEng = makeEngine();
    const owner = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    owner.attach(ownerEng);
    const watcher = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    watcher.attach(makeEngine());

    owner.beginOwner(SEQ);
    watcher.beginWatcher(SEQ, () => {});
    owner.relayOwnerButton(50);
    await settle();

    expect(ownerEng.applied).toEqual([]); // owner drives its real handler directly, not via the pump

    owner.endOwner();
    watcher.endSession();
  });
});
