/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MYSTERY-ENCOUNTER owner relay (#633, authoritative-only after M6) - engine-free
// unit tests over a LoopbackTransport. The pump is now the OWNER half only: it relays the
// owner's meaningful buttons on the 8M pick seq and its TERMINALS (LEAVE / battle-handoff)
// on the dedicated 9M terminal seq. The PEER side is a plain CoopInteractionRelay await -
// exactly what the production authoritative guest's `CoopReplayMePhase` does - so these
// tests pin the real consumer contract. The old lockstep WATCHER loop (injected engine
// replaying raw buttons) was retired in M3 and physically deleted in M6b; its tests went
// with it. The LoopbackTransport delivers via queueMicrotask, so each batch of sends is
// followed by `await settle()`.
// =============================================================================

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_ME_BATTLE_HANDOFF, CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** Let the loopback microtasks drain before asserting. */
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
};

const SEQ = 8_000_042;

describe("co-op mystery-encounter owner relay (#633)", () => {
  it("relays the owner's buttons to the peer IN ORDER on the pick seq (lossless FIFO)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
    const peerRelay = new CoopInteractionRelay(guest);

    owner.beginOwner(SEQ);
    expect(owner.isSessionActive()).toBe(true);
    owner.relayOwnerButton(10);
    owner.relayOwnerButton(11);
    owner.relayOwnerButton(12);
    await settle();

    // The peer (production: CoopReplayMePhase) drains the FIFO in relay order, losslessly.
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const action = await peerRelay.awaitInteractionChoice(SEQ, 10);
      expect(action, `button ${i} arrived`).not.toBeNull();
      seen.push(action!.choice);
    }
    expect(seen).toEqual([10, 11, 12]);

    owner.endSession();
  });

  it("relayOwnerButton is a no-op with NO active session (nothing leaks onto the wire)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
    const peerRelay = new CoopInteractionRelay(guest);

    owner.relayOwnerButton(99); // never began
    owner.beginOwner(SEQ);
    owner.endSession();
    owner.relayOwnerButton(98); // session already ended
    await settle();

    expect(await peerRelay.awaitInteractionChoice(SEQ, 10)).toBeNull();
  });

  it("beginOwner is idempotent on the same seq and REFRESHES termSeq on a nested re-entry", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
    const peerRelay = new CoopInteractionRelay(guest);

    const SEQ_TERM = 9_000_042;
    owner.beginOwner(SEQ, SEQ_TERM);
    // A nested option-select re-enters beginOwner with the same seq: the session stays open
    // (no reset) and the terminal seq is refreshed, so the terminal still lands on 9M.
    owner.beginOwner(SEQ, SEQ_TERM);
    expect(owner.isSessionActive()).toBe(true);

    owner.endOwner();
    await settle();
    expect((await peerRelay.awaitInteractionChoice(SEQ_TERM, 10))?.choice).toBe(COOP_INTERACTION_LEAVE);
  });

  it("AUTHORITATIVE (#633 B-1): the owner sends its TERMINAL on termSeq, NOT on the 8M pick seq", async () => {
    // The B-1 regression: the authoritative host begins the pump with a DEDICATED terminal seq
    // (9M+start) and the authoritative guest awaits the terminal there. If endOwner() sent the
    // LEAVE on the 8M pick seq (the old bug) the 9M waiter would only resolve via the ~20-min
    // disconnect timeout - every authoritative non-battle ME hung the guest. This proves the
    // terminal actually lands on termSeq, and that an 8M-only listener never drains it.
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
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
    const owner = new CoopMePump(new CoopInteractionRelay(host));
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

  it("with no termSeq the terminal defaults onto seq (a caller with no split stays coherent)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
    const peerRelay = new CoopInteractionRelay(guest);

    owner.beginOwner(SEQ); // no termSeq -> terminal rides `seq`
    owner.endOwner();
    await settle();

    expect((await peerRelay.awaitInteractionChoice(SEQ, 10))?.choice).toBe(COOP_INTERACTION_LEAVE);
    expect(owner.isSessionActive()).toBe(false);
  });

  it("both terminals close the session EXACTLY ONCE (no duplicate sentinel after end)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopMePump(new CoopInteractionRelay(host));
    const peerRelay = new CoopInteractionRelay(guest);

    const SEQ_TERM = 9_000_011;
    owner.beginOwner(SEQ, SEQ_TERM);
    owner.relayMeBattleHandoff(); // terminal 1: sends the sentinel + ends the session
    owner.endOwner(); // terminal 2 AFTER end: must send NOTHING (session already closed)
    await settle();

    expect((await peerRelay.awaitInteractionChoice(SEQ_TERM, 10))?.choice).toBe(COOP_ME_BATTLE_HANDOFF);
    // No second sentinel behind it - endOwner after the handoff was a no-op.
    expect(await peerRelay.awaitInteractionChoice(SEQ_TERM, 10)).toBeNull();
    expect(owner.isSessionActive()).toBe(false);
  });
});
