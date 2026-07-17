/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op AUTHORITATIVE non-battle ME choice-forwarding - WIRE/RELAY contract (#633, TRACK-2
// Phase C). The diverted CoopReplayMePhase is a pure renderer + choice-forwarder; the host is
// the sole engine. This locks the two contract properties the phase wiring depends on, over a
// LoopbackTransport (the engine-free "test via spoofing" path the rest of the co-op suite uses):
//
//   1. GUEST-OWNED REVERSE forwarding round-trip with the AUTHORITATIVE wire types: the guest
//      relays its option INDEX (P1, kind "me") and each SUB-pick (P1b, kind "meSub") on seq_me;
//      the host (sole engine) awaits them, then STREAMS the authoritative presentation+sub-prompt
//      (P0 `mePresent`) and the comprehensive terminal resync (P4 `meResync`) back on seq_me's
//      OUTCOME inbox in FIFO order; and the LEAVE terminal (P5) on the DEDICATED seq_term. This is
//      the exact channel CoopReplayMePhase.{handleGuestOptionSelect, relayGuestSubPick,
//      awaitOutcomeThenTerminal, awaitHostTerminal} read.
//   2. SEQ-CHANNEL DISJOINTNESS: the three channels never collide -
//        seq_me   = COOP_ME_PUMP_SEQ_BASE (8_000_000) + start   (P0/P1/P1b/P4)
//        seq_term = COOP_ME_TERM_SEQ_BASE  (9_000_000) + start   (P5/P6)
//        raw start                                                (the reward shop)
//      including the load-bearing same-seq_me CHOICE-vs-OUTCOME inbox split (P1/P1b ride the
//      choice inbox; P0/P4 ride the outcome inbox) - so the host->guest terminal can never consume
//      the guest->host pick, and the reward shop's raw-start screen never adopts an ME outcome.
//
// Engine-FREE: no GameManager / no Phaser boot. The phase divert + the single `settled` terminal
// are exercised in-game (headless ME UI runner + dev scenarios); here we lock the transport
// contract those phases depend on. The seq BASES are imported from the SOURCE so the test tracks
// production, not a copy.

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_ME_BATTLE_HANDOFF, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** The seq base CoopReplayMePhase / the ME pump key off (`BASE + interactionCounter`); see
 *  coop-me-pump.ts (where the 9_000_000 term base is exported beside COOP_ME_BATTLE_HANDOFF). */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;

/** A comprehensive `meResync` blob matching the wire variant (no engine needed). */
const meResync = (
  over: Partial<Extract<CoopInteractionOutcome, { k: "meResync" }>> = {},
): Extract<CoopInteractionOutcome, { k: "meResync" }> => ({
  k: "meResync",
  base: null,
  party: ['{"species":143,"level":50,"friendship":70}'],
  meSaveData: '[{"type":1234,"seen":1}]',
  seed: "HOSTSEED",
  waveSeed: "HOSTWAVE",
  dex: "compressed-dex-blob",
  ...over,
});

describe("co-op authoritative ME forwarding - reverse round-trip + seq-channel disjointness (#633)", () => {
  it("reverse forwarding: guest relays index + sub-pick on seq_me, host applies + streams mePresent->meResync (FIFO), then leaves on seq_term", async () => {
    // GUEST owns this ME. The guest forwards its option pick + a party sub-pick; the HOST (sole
    // engine) awaits them, then streams the authoritative presentation/sub-prompt + comprehensive
    // resync on seq_me's OUTCOME inbox, and the LEAVE terminal on seq_term.
    const start = 3;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    // --- P1: guest relays its chosen option INDEX (kind "me") on seq_me / choice inbox.
    guestRelay.sendInteractionChoice(seqMe, "me", 1);
    const hostSawIndex = await hostRelay.awaitInteractionChoice(seqMe);
    expect(hostSawIndex?.choice).toBe(1);

    // The host's engine reaches a party sub-prompt -> streams a `mePresent` with a "party" subPrompt
    // on seq_me's OUTCOME inbox (P0 follow-up); the guest adopts it and opens its capture screen.
    const partyPrompt: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "party" },
    };
    hostRelay.sendInteractionOutcome(seqMe, "me", partyPrompt);
    const guestSawPrompt = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(guestSawPrompt?.k).toBe("mePresent");
    if (guestSawPrompt?.k !== "mePresent") {
      throw new Error("presentation kind lost over the wire");
    }
    expect(guestSawPrompt.subPrompt).toEqual({ kind: "party" });

    // --- P1b: guest relays the captured party SLOT (kind "meSub") on the SAME seq_me / choice inbox.
    guestRelay.sendInteractionChoice(seqMe, "meSub", 2, [0]);
    const hostSawSlot = await hostRelay.awaitInteractionChoice(seqMe);
    expect(hostSawSlot?.choice).toBe(2);

    // --- P4: host applies the option authoritatively, then streams the comprehensive terminal
    // resync on seq_me / OUTCOME inbox. FIFO after the (already consumed) presentation.
    hostRelay.sendInteractionOutcome(seqMe, "me", meResync({ seed: "POSTPICK" }));
    const guestSawResync = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(guestSawResync?.k).toBe("meResync");
    if (guestSawResync?.k !== "meResync") {
      throw new Error("resync kind lost over the wire");
    }
    expect(guestSawResync.seed).toBe("POSTPICK");
    expect(guestSawResync.party).toEqual(['{"species":143,"level":50,"friendship":70}']);

    // --- P5: host's ME terminal -> LEAVE sentinel on the DEDICATED seq_term (NOT seq_me).
    hostRelay.sendInteractionChoice(seqTerm, "me", COOP_INTERACTION_LEAVE);
    const guestSawTerminal = await guestRelay.awaitInteractionChoice(seqTerm);
    expect(guestSawTerminal?.choice).toBe(COOP_INTERACTION_LEAVE);
  });

  it("the host->guest terminal on seq_term never consumes the guest->host pick on seq_me (disjoint inboxes)", async () => {
    // P1/P1b ride seq_me; P5/P6 ride seq_term. A waiter on one seq must NEVER drain the other's
    // queue, or the host's terminal would eat the guest's option index (MAJOR-1).
    const start = 7;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    expect(seqMe).not.toBe(seqTerm);

    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    // A 1ms, immediately-firing timer so a missing message resolves null fast (no real wait).
    const guestRelay = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });

    // The guest relays its pick on seq_me; the host's TERMINAL waiter is on seq_term.
    guestRelay.sendInteractionChoice(seqMe, "me", 4);
    await new Promise(r => setTimeout(r, 0)); // land in the host buffer

    // A waiter on seq_term must NOT see the seq_me pick (it times out to null)...
    expect(await hostRelay.awaitInteractionChoice(seqTerm, 1)).toBeNull();
    // ...while the seq_me pick is still there for its proper waiter.
    expect((await hostRelay.awaitInteractionChoice(seqMe))?.choice).toBe(4);
  });

  it("on the SAME seq_me, the CHOICE inbox (P1/P1b) and OUTCOME inbox (P0/P4) never cross-consume", async () => {
    // The load-bearing split: P1/P1b (guest->host picks) ride the CHOICE inbox and P0/P4
    // (host->guest present/resync) ride the OUTCOME inbox, BOTH on seq_me. The relay keys them in
    // separate maps, so a pick is never adopted as an outcome and vice-versa.
    const start = 9;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });

    // Guest sends a CHOICE on seq_me; host sends an OUTCOME on the SAME seq_me.
    guestRelay.sendInteractionChoice(seqMe, "me", 5);
    hostRelay.sendInteractionOutcome(seqMe, "me", meResync({ seed: "SAMESEQ" }));
    await new Promise(r => setTimeout(r, 0)); // both land in their buffers

    // The host's awaitInteractionChoice(seq_me) gets ONLY the choice; it never sees the outcome.
    const pick = await hostRelay.awaitInteractionChoice(seqMe);
    expect(pick?.choice).toBe(5);
    // The guest's awaitInteractionOutcome(seq_me) gets ONLY the outcome; it never sees the choice.
    const out = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(out?.k === "meResync" ? out.seed : undefined).toBe("SAMESEQ");
  });

  it("the reward shop's RAW-start channel never collides with seq_me/seq_term (three disjoint bases)", async () => {
    // The embedded ME reward shop relays on the RAW interaction start (no BASE), while the ME
    // pick/terminal ride 8_000_000+start / 9_000_000+start. For ANY realistic start the three are
    // pairwise distinct, so the shop's choice never adopts an ME outcome and vice-versa.
    for (const start of [0, 1, 3, 7, 42, 100, 999]) {
      const raw = start;
      const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
      const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
      expect(new Set([raw, seqMe, seqTerm]).size).toBe(3);
      // The gap between bases (1_000_000) exceeds any plausible interaction-counter run length, so
      // raw `start` can never reach into the seq_me band and seq_me can never reach seq_term.
      expect(seqMe - raw).toBe(COOP_ME_PUMP_SEQ_BASE);
      expect(seqTerm - seqMe).toBe(COOP_ME_TERM_SEQ_BASE - COOP_ME_PUMP_SEQ_BASE);
    }

    // Functional check: a reward-shop choice on the RAW start and an ME pick on seq_me coexist
    // without cross-consuming.
    const start = 11;
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    owner.sendInteractionChoice(start, "reward", 0); // raw-start shop pick
    owner.sendInteractionChoice(COOP_ME_PUMP_SEQ_BASE + start, "me", 2); // seq_me ME pick

    const shopPick = await watcher.awaitInteractionChoice(start);
    expect(shopPick?.choice).toBe(0);
    const mePick = await watcher.awaitInteractionChoice(COOP_ME_PUMP_SEQ_BASE + start);
    expect(mePick?.choice).toBe(2);
  });

  it("the battle-handoff sentinel rides seq_term and is distinct from the leave sentinel (P6 vs P5)", async () => {
    // A battle-spawning ME relays COOP_ME_BATTLE_HANDOFF on seq_term so the guest's awaitHostTerminal
    // ends WITHOUT leaving (it lets the spawned battle run). A non-battle ME relays the LEAVE
    // sentinel on the same seq_term. The two must be distinguishable values on the same channel.
    expect(COOP_ME_BATTLE_HANDOFF).not.toBe(COOP_INTERACTION_LEAVE);

    const start = 13;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    hostRelay.sendInteractionChoice(seqTerm, "me", COOP_ME_BATTLE_HANDOFF);
    const handoff = await guestRelay.awaitInteractionChoice(seqTerm);
    expect(handoff?.choice).toBe(COOP_ME_BATTLE_HANDOFF);
  });
});
