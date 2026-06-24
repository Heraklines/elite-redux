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

import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { CoopMePump, type CoopMePumpEngine } from "#data/elite-redux/coop/coop-me-pump";
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
