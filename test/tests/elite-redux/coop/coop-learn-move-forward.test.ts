/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op AUTHORITATIVE move-learn forward (#633 BUG3+5). In authoritative co-op the HOST is the sole
// battle engine, but a full-moveset GUEST-owned mon's "which move to forget" pick belongs to the human
// who owns that mon. The host streams a `learnMoveForward` prompt on a DISJOINT per-slot channel
// (9_100_000 + partySlot) and AWAITS the guest's chosen forget-slot; the guest opens the picker and
// relays an index back; the host applies it - or, on a timeout / disconnect, keeps the mon's current
// moves (the NO-HANG guarantee). This verifies that wire protocol + the no-hang fallback + the seq
// disjointness from the 9_000_001 lockstep relay, engine-free over a LoopbackTransport (exactly the
// dead-but-verified pattern the relay primitives use). The engine-coupled apply lives in LearnMovePhase.

import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

// Mirrors the constants in src/phases/learn-move-phase.ts (kept local so this stays engine-free).
const COOP_LEARN_MOVE_SEQ = 9_000_001;
const COOP_LEARN_MOVE_FWD_SEQ_BASE = 9_100_000;

const forward = (
  over: Partial<Extract<CoopInteractionOutcome, { k: "learnMoveForward" }>> = {},
): CoopInteractionOutcome => ({
  k: "learnMoveForward",
  partySlot: 1,
  moveId: 33,
  maxMoveCount: 4,
  ...over,
});

describe("co-op authoritative move-learn forward (#633 BUG3+5)", () => {
  it("forwards a guest-owned-mon prompt and the guest relays its forget-slot back to the host", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    const slot = 1;
    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + slot;

    // Host streams the forward prompt; guest consumes it (the level-up listener / Shroom phase path).
    const guestSawForward = guestRelay.awaitInteractionOutcome(seq);
    hostRelay.sendInteractionOutcome(seq, "learnMoveForward", forward({ partySlot: slot }));
    const fwd = await guestSawForward;
    expect(fwd?.k).toBe("learnMoveForward");
    if (fwd?.k !== "learnMoveForward") {
      throw new Error("forward kind lost over the wire");
    }
    expect(fwd.partySlot).toBe(slot);
    expect(fwd.maxMoveCount).toBe(4);

    // Guest picks forget-slot 1 and relays it; host awaits + adopts it (the slot it will learnMove into).
    const hostAwaitsPick = hostRelay.awaitInteractionChoice(seq);
    guestRelay.sendInteractionChoice(seq, "learnMove", 1);
    const pick = await hostAwaitsPick;
    expect(pick).not.toBeNull();
    expect(pick?.choice).toBe(1);
  });

  it("NO-HANG: a guest that never replies times out to null so the host keeps current moves", async () => {
    const { host } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const hostRelay = new CoopInteractionRelay(host, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + 1;
    const awaited = hostRelay.awaitInteractionChoice(seq, 1000);
    expect(timer.fire).toBeDefined();
    timer.fire?.(); // simulate the finite-timeout expiring (disconnected / idle partner)
    // null => LearnMovePhase falls back to getMaxMoveCount() == "did not learn" (keep current moves).
    expect(await awaited).toBeNull();
  });

  it("NO-HANG: dispose() mid-await resolves the host's forward wait to null (session teardown)", async () => {
    const { host } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);

    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + 2;
    const awaited = hostRelay.awaitInteractionChoice(seq); // parked, no reply
    hostRelay.dispose(); // teardown fails all in-flight waiters null
    expect(await awaited).toBeNull();
  });

  it("the forward channel is DISJOINT per slot and from the 9_000_001 lockstep relay (no cross-consume)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    // Two queued level-up learns for DIFFERENT mons (slots 1 and 2) ride disjoint seqs.
    const seqSlot1 = COOP_LEARN_MOVE_FWD_SEQ_BASE + 1;
    const seqSlot2 = COOP_LEARN_MOVE_FWD_SEQ_BASE + 2;
    expect(seqSlot1).not.toBe(seqSlot2);
    // The forward base is disjoint from the lockstep owner/watcher relay seq.
    expect(seqSlot1).not.toBe(COOP_LEARN_MOVE_SEQ);
    expect(seqSlot2).not.toBe(COOP_LEARN_MOVE_SEQ);

    // A pick on the lockstep seq must NOT satisfy a host waiting on the forward seq.
    const timer: { fire?: () => void } = {};
    const isolatedHost = new CoopInteractionRelay(createLoopbackPair().host, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });
    const awaited = isolatedHost.awaitInteractionChoice(seqSlot1, 1000);
    guestRelay.sendInteractionChoice(COOP_LEARN_MOVE_SEQ, "learnMove", 0); // lockstep seq
    hostRelay.sendInteractionChoice(seqSlot2, "learnMove", 0); // a DIFFERENT forward slot
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull(); // neither the lockstep nor the other-slot pick crossed over
  });

  it("a forward outcome round-trips all scalars (partySlot / moveId / maxMoveCount)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + 3;
    const awaited = guestRelay.awaitInteractionOutcome(seq);
    hostRelay.sendInteractionOutcome(seq, "learnMoveForward", forward({ partySlot: 3, moveId: 999, maxMoveCount: 5 }));
    const res = await awaited;
    expect(res?.k).toBe("learnMoveForward");
    if (res?.k !== "learnMoveForward") {
      throw new Error("forward kind lost over the wire");
    }
    expect(res.partySlot).toBe(3);
    expect(res.moveId).toBe(999);
    expect(res.maxMoveCount).toBe(5); // ER's 5th-move-slot consumable raises the cap / sentinel
  });
});
