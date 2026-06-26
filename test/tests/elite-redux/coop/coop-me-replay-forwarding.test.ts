/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op NON-BATTLE mystery-encounter REPLAY forwarding (#633, TRACK-2 Phase C). The
// guest's ME engine/RNG is diverged from the host's, so the diverted CoopReplayMePhase
// is a pure renderer + choice-forwarder. This verifies the two wire primitives that
// drive it, over a LoopbackTransport (the same engine-free, "test via spoofing" path
// the rest of the co-op suite uses):
//
//   1. REVERSE-DIRECTION forwarding (guest OWNS the ME): the guest relays its choice ->
//      the host (watcher) awaits it, runs it authoritatively, and STREAMS the outcome
//      back -> the guest adopts that outcome before its leave terminal. Keyed to the
//      SAME seq the phases use (COOP_ME_PUMP_SEQ_BASE + interactionCounter), so this is
//      the exact channel CoopReplayMePhase.awaitOwnerOutcomeThenLeave reads.
//   2. ME NARRATION stream (host OWNS the ME): the host streams each dialogue line and
//      the guest's CoopReplayMePhase queues it verbatim (cosmetic; the outcome rides the
//      reward alternation + the full-state snapshot, so a dropped line never desyncs).
//
// Engine-FREE: no GameManager / no Phaser boot. The phase wiring (divert + the single
// `settled` terminal) is exercised in-game via the headless ME UI runner + scenarios;
// here we lock the transport contract those phases depend on.

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** The seq base CoopReplayMePhase / the ME pump key off (`BASE + interactionCounter`). */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;

const grant = (over: Partial<Extract<CoopInteractionOutcome, { k: "rewardGrant" }>> = {}): CoopInteractionOutcome => ({
  k: "rewardGrant",
  modifierTypeId: "EXP_CHARM",
  args: [],
  partySlot: -1,
  moneyDelta: 0,
  ...over,
});

describe("co-op non-battle ME replay forwarding (#633, TRACK-2 Phase C)", () => {
  it("reverse direction: guest forwards its choice, host runs it + streams the outcome, guest adopts it", async () => {
    // GUEST owns this ME (odd interaction counter), so the guest forwards its pick and the
    // HOST is the watcher that resolves it authoritatively and streams the outcome back.
    const interactionCounter = 3;
    const seq = COOP_ME_PUMP_SEQ_BASE + interactionCounter;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    // Guest (owner) relays its option pick for this ME.
    guestRelay.sendInteractionChoice(seq, "me", 1, [0]);

    // Host (watcher) awaits the guest's choice, "runs" it authoritatively, then streams the
    // outcome back on the SAME seq (the reverse direction CoopReplayMePhase listens on).
    const hostSawChoice = await hostRelay.awaitInteractionChoice(seq);
    expect(hostSawChoice?.choice).toBe(1);
    expect(hostSawChoice?.data).toEqual([0]);
    hostRelay.sendInteractionOutcome(seq, "me", grant({ modifierTypeId: "ROGUE_BALL", moneyDelta: -600 }));

    // Guest adopts the host's authoritative outcome (what awaitOwnerOutcomeThenLeave reads).
    const adopted = await guestRelay.awaitInteractionOutcome(seq);
    expect(adopted?.k).toBe("rewardGrant");
    if (adopted?.k !== "rewardGrant") {
      throw new Error("ME outcome kind lost over the wire");
    }
    expect(adopted.modifierTypeId).toBe("ROGUE_BALL");
    expect(adopted.moneyDelta).toBe(-600);
  });

  it("reverse direction outcome is keyed per interactionCounter (a different ME's seq never adopts it)", async () => {
    const ownedSeq = COOP_ME_PUMP_SEQ_BASE + 5;
    const otherSeq = COOP_ME_PUMP_SEQ_BASE + 6;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });

    hostRelay.sendInteractionOutcome(ownedSeq, "me", grant({ modifierTypeId: "LUCKY_EGG" }));
    await new Promise(r => setTimeout(r, 0)); // land in the guest buffer

    // A DIFFERENT ME's phase (different interactionCounter) must NOT consume this outcome:
    // it times out to null while the owned-seq outcome stays buffered.
    expect(await guestRelay.awaitInteractionOutcome(otherSeq)).toBeNull();
    // The owned ME's phase still adopts the buffered outcome on its own seq.
    const adopted = await guestRelay.awaitInteractionOutcome(ownedSeq);
    expect(adopted?.k === "rewardGrant" ? adopted.modifierTypeId : undefined).toBe("LUCKY_EGG");
  });

  it("guest outcome await times out to null so a host stall never hangs the ME (defensive leave)", async () => {
    const { guest } = createLoopbackPair();
    const guestRelay = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    // CoopReplayMePhase.awaitOwnerOutcomeThenLeave falls through to the leave-sentinel on null.
    expect(await guestRelay.awaitInteractionOutcome(COOP_ME_PUMP_SEQ_BASE + 1)).toBeNull();
  });

  it("ME narration: the host streams each line and the guest queues it verbatim, in order", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const queued: string[] = [];
    const off = guestStream.onMeMessage(text => queued.push(text));

    hostStream.sendMeMessage("A mysterious stranger appears.");
    hostStream.sendMeMessage("Will you help, or walk away?");
    await new Promise(r => setTimeout(r, 0));

    expect(queued).toEqual(["A mysterious stranger appears.", "Will you help, or walk away?"]);

    // CoopReplayMePhase drops the subscription at its terminal: no line lands after.
    off();
    hostStream.sendMeMessage("This should not be queued.");
    await new Promise(r => setTimeout(r, 0));
    expect(queued).toHaveLength(2);
  });

  it("the meMessage wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    const msg: CoopMessage = { t: "meMessage", text: "The well glows faintly." };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});
