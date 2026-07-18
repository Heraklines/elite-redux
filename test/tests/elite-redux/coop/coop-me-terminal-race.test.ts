/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op AUTHORITATIVE HOST-OWNED non-battle ME terminal race - SOFTLOCK regression (#633,
// #693/#698). The diverted CoopReplayMePhase (host-owned branch) used to await ONLY the host's
// `meResync` outcome on seq_me (8M) and proceed to the 9M terminal AFTER it. But NOT every host ME
// terminal is preceded by a meResync: a battle-spawning option (relayMeBattleHandoff) and the host's
// degrade paths fire the TERMINAL sentinel (LEAVE / battle-handoff) on seq_term (9M) with NO meResync
// on seq_me. Meanwhile the host's pump streams its per-button presses as `meBtn` interactionChoices on
// seq_me's CHOICE inbox (which the host-owned guest never reads). So the guest parked on
// awaitInteractionOutcome(8M) forever while the terminal sat unconsumed on 9M and the meBtn picks piled
// up in the 8M CHOICE inbox - the live freeze ("got all the messages, then locked there").
//
// The fix RACES the next 8M outcome against the 9M terminal, so a host terminal that arrives WITHOUT a
// trailing meResync still resolves the guest. This test reproduces the exact race contract
// CoopReplayMePhase.awaitOutcomeThenTerminal depends on, over a LoopbackTransport (engine-free, the
// same "test via spoofing" path the rest of the co-op suite uses). The seq bases are imported from the
// SOURCE so the test tracks production.

import {
  COOP_INTERACTION_LEAVE,
  type CoopInteractionChoice,
  CoopInteractionRelay,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { COOP_ME_BATTLE_HANDOFF, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** The seq base CoopReplayMePhase / the ME pump key off (`BASE + interactionCounter`). */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
/** Routing tag the host pump uses for its per-button presses (coop-me-pump ME_PUMP_KIND). */
const ME_PUMP_KIND = "meBtn";

const meResync = (
  over: Partial<Extract<CoopInteractionOutcome, { k: "meResync" }>> = {},
): Extract<CoopInteractionOutcome, { k: "meResync" }> => ({
  k: "meResync",
  base: null,
  party: ['{"species":143,"level":50,"friendship":70}'],
  meSaveData: "[]",
  seed: "HOSTSEED",
  waveSeed: "HOSTWAVE",
  dex: "dex-blob",
  ...over,
});

type RaceWinner =
  | { tag: "outcome"; outcome: CoopInteractionOutcome | null }
  | { tag: "terminal"; action: CoopInteractionChoice | null };

/**
 * The guest-side race CoopReplayMePhase.awaitOutcomeThenTerminal performs: start BOTH the 8M OUTCOME
 * await and the 9M TERMINAL await, then race them. Modeled here EXACTLY (same arm-start order, same
 * single shared `terminalArm`) so the relay contract the phase relies on is locked (the phase itself
 * needs Phaser; this is the engine-free core).
 *
 * Both arms drain their own buffer synchronously when started. The terminal arm is kept as a SHARED
 * promise so the caller resolves the terminal via this SAME `terminalArm` afterwards - never a fresh 9M
 * read that would block on an inbox already drained into it. The OUTCOME arm is raced FIRST so it WINS a
 * both-buffered tie (a meResync + a terminal both already buffered -> apply the resync, don't skip it);
 * when only the terminal is buffered it wins uncontested. The 8M outcome arm uses the relay's default
 * (long, real) timeout - matching production COOP_ME_REPLAY_WAIT_MS - so a buffered terminal wins over an
 * outcome that is genuinely not coming, exactly as it does live. (An immediately-firing test timer would
 * resolve the absent outcome to null in the same microtask and mask the race; production never does that.)
 */
function startRace(
  relay: CoopInteractionRelay,
  seqMe: number,
  seqTerm: number,
): { race: Promise<RaceWinner>; terminalArm: Promise<{ tag: "terminal"; action: CoopInteractionChoice | null }> } {
  const outcomeArm = relay.awaitInteractionOutcome(seqMe).then(outcome => ({ tag: "outcome" as const, outcome }));
  const terminalArm = relay.awaitInteractionChoice(seqTerm).then(action => ({ tag: "terminal" as const, action }));
  return { race: Promise.race([outcomeArm, terminalArm]), terminalArm };
}

describe("co-op authoritative host-owned ME terminal race (#633 softlock #693/#698)", () => {
  it("host streams presentation + N meBtn picks + a LEAVE terminal (no meResync): the guest resolves the terminal, never hangs", async () => {
    const start = 2;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest); // real (long) default timeout, like production

    // --- P0: host streams the authoritative presentation on seq_me's OUTCOME inbox (the guest's
    // start() adopts this first; here we just drain it so the loop starts on the SAME inbox state).
    const present: CoopInteractionOutcome = { k: "mePresent", tokens: {}, meetsReqs: [], labels: [] };
    hostRelay.sendInteractionOutcome(seqMe, "mePresent", present);
    const adoptedPresent = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(adoptedPresent?.k).toBe("mePresent");

    // --- The host human drives the ME: the pump relays each handler-ready button as a `meBtn`
    // interactionChoice on seq_me's CHOICE inbox (the live choice=4/choice=5). The host-owned guest
    // reads only the OUTCOME inbox + the 9M terminal, so these BUFFER (depth grows), never consumed.
    hostRelay.sendInteractionChoice(seqMe, ME_PUMP_KIND, 4);
    hostRelay.sendInteractionChoice(seqMe, ME_PUMP_KIND, 5);

    // --- The ME ends via a path with NO trailing meResync (e.g. leaveEncounterWithoutBattle): the
    // host sends the LEAVE sentinel on the DEDICATED seq_term (9M). NOTHING is sent on seq_me's
    // OUTCOME inbox.
    hostRelay.sendInteractionChoice(seqTerm, ME_PUMP_KIND, COOP_INTERACTION_LEAVE);
    await new Promise(r => setTimeout(r, 0)); // everything lands in the guest's buffers

    // --- The fix: the guest races the 8M outcome (none coming) against the 9M terminal -> the
    // BUFFERED terminal wins (buffer-hit, resolves synchronously) over an outcome that never arrives,
    // so the guest leaves instead of hanging on a meResync that never comes.
    const winner = await startRace(guestRelay, seqMe, seqTerm).race;
    expect(winner.tag).toBe("terminal");
    if (winner.tag !== "terminal") {
      throw new Error("terminal arm should win when no meResync is streamed");
    }
    expect(winner.action?.choice).toBe(COOP_INTERACTION_LEAVE);

    // The buffered meBtn picks were never consumed by the host-owned guest (by design) - assert they
    // are still parked on the CHOICE inbox (so the race resolving the terminal lost nothing it needed).
    expect((await guestRelay.awaitInteractionChoice(seqMe, 1))?.choice).toBe(4);
    expect((await guestRelay.awaitInteractionChoice(seqMe, 1))?.choice).toBe(5);

    // Cancel the still-pending (long-timeout) outcome-arm waiter so vitest teardown is not held.
    guestRelay.dispose();
    hostRelay.dispose();
  });

  it("a battle-spawning host ME fires the HANDOFF on seq_term with no meResync: the guest resolves it via the race", async () => {
    const start = 4;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest); // real (long) default timeout, like production

    // The host's option spawned a battle: relayMeBattleHandoff sends the HANDOFF sentinel on seq_term
    // and ends the pump WITHOUT ever streaming a meResync.
    hostRelay.sendInteractionChoice(seqTerm, ME_PUMP_KIND, COOP_ME_BATTLE_HANDOFF);
    await new Promise(r => setTimeout(r, 0));

    const winner = await startRace(guestRelay, seqMe, seqTerm).race;
    expect(winner.tag).toBe("terminal");
    if (winner.tag !== "terminal") {
      throw new Error("terminal arm should win on a battle-handoff with no meResync");
    }
    expect(winner.action?.choice).toBe(COOP_ME_BATTLE_HANDOFF);

    guestRelay.dispose();
    hostRelay.dispose();
  });

  it("when the host DOES stream a meResync (standard rewards path), the OUTCOME arm wins and is applied before the terminal", async () => {
    const start = 6;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest); // real (long) default timeout, like production

    // Standard ME-rewards terminal: meResync on seq_me's OUTCOME inbox, THEN the LEAVE on seq_term.
    hostRelay.sendInteractionOutcome(seqMe, "meResync", meResync({ seed: "POSTPICK" }));
    hostRelay.sendInteractionChoice(seqTerm, ME_PUMP_KIND, COOP_INTERACTION_LEAVE);
    await new Promise(r => setTimeout(r, 0));

    // BOTH arms have a buffered message (buffer-hit, both resolve synchronously). The OUTCOME arm wins
    // the race (the resync is surfaced + applied). The terminal was DRAINED into the shared terminalArm
    // (started first), so the phase resolves the terminal via THAT arm - never a fresh seq_term read
    // (which would block on the now-empty inbox). So the existing meResync-apply is preserved AND the
    // terminal still ends the ME.
    const { race, terminalArm } = startRace(guestRelay, seqMe, seqTerm);
    const winner = await race;
    expect(winner.tag).toBe("outcome");
    if (winner.tag !== "outcome") {
      throw new Error("outcome arm should win when a meResync is streamed before the terminal");
    }
    expect(winner.outcome?.k).toBe("meResync");
    expect(winner.outcome?.k === "meResync" ? winner.outcome.seed : undefined).toBe("POSTPICK");

    // The terminal is held in the shared terminalArm for the post-resync resolution (NOT lost): the
    // phase awaits it after applying the resync. A fresh seq_term read would find nothing (drained).
    expect((await terminalArm).action?.choice).toBe(COOP_INTERACTION_LEAVE);
    expect(await guestRelay.awaitInteractionChoice(seqTerm, 1)).toBeNull();

    guestRelay.dispose();
    hostRelay.dispose();
  });

  it("JOURNAL MODE: the 9M terminal arm is inert, so a null/stray outcome-arm win cannot be terminal-resolved (must re-request)", async () => {
    // Regression lock for the #693 battle-handoff class surviving in real browser netcode (run 29634537697).
    // In journal mode CoopReplayMePhase.awaitOutcomeThenTerminal sets `terminalArm = journalTerminalArm`, a
    // promise that NEVER resolves (the retained ME_TERMINAL transaction drives the terminal directly via
    // setOnMeCommittedTerminal - the raw 9M inbox is never consumed). The host streams NO meResync on 8M in
    // journal mode, so the OUTCOME arm resolves null on timeout ("outcome arm resolved without subPrompt/
    // meResync; resolving via terminal arm"). The BUG: the fall-through used to `void terminalArm.then(...)`,
    // which is DEAD against the inert journal arm - nothing re-requested the committed terminal, so the guest
    // hung while the host's durable ME_PRESENT/ME_PICK continuation deadline exhausted, dropping BOTH clients
    // to Title. This test locks the premise: with the inert journal terminal arm, a null outcome-arm win can
    // NEVER be resolved by awaiting the terminal arm, so the phase MUST take an independent recovery
    // re-request (production: handleTerminalAction(null) -> recoverMissingControl -> durability.reconnect()).
    const start = 10;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);

    // Journal mode: the terminal is delivered OUT OF BAND (via the committed transaction), never on 9M. Model
    // that exactly as production does - the never-resolving journal terminal arm.
    const journalTerminalArm = new Promise<{ tag: "terminal"; action: CoopInteractionChoice | null }>(() => {});
    // The OUTCOME arm resolves null (the host sent no meResync; a short bounded timeout stands in for the long
    // production wait so the test is fast) - this is the exact "outcome arm resolved without ... meResync" win.
    const outcomeArm = guestRelay
      .awaitInteractionOutcome(seqMe, 5)
      .then(outcome => ({ tag: "outcome" as const, outcome }));

    const winner = await Promise.race([outcomeArm, journalTerminalArm]);
    expect(winner.tag, "the null OUTCOME arm wins - the inert journal terminal arm cannot").toBe("outcome");
    if (winner.tag !== "outcome") {
      throw new Error("the inert journal terminal arm must not resolve the race");
    }
    expect(winner.outcome, "no meResync/subPrompt was streamed - the outcome is null").toBeNull();

    // Awaiting the journal terminal arm to end the ME (the old fall-through) hangs forever: a bounded probe
    // sentinel always wins the race against it, proving the terminal can never be resolved that way.
    const sentinel = Symbol("never");
    const resolvedByTerminalArm = await Promise.race([
      journalTerminalArm.then(() => "terminal" as const),
      new Promise<typeof sentinel>(r => setTimeout(() => r(sentinel), 10)),
    ]);
    expect(resolvedByTerminalArm, "the inert journal terminal arm never resolves; a re-request is required").toBe(
      sentinel,
    );

    guestRelay.dispose();
    hostRelay.dispose();
  });

  it("a mid-ME sub-prompt mePresent wins the race over the terminal so the guest captures it before leaving", async () => {
    // A host sub-prompt (party / secondary) streams a `mePresent` with a subPrompt on seq_me's OUTCOME
    // inbox BEFORE any terminal. The race must surface it (so the guest opens its capture screen), not
    // the terminal - i.e. a pending terminal waiter must never pre-empt a real outcome.
    const start = 8;
    const seqMe = COOP_ME_PUMP_SEQ_BASE + start;
    const seqTerm = COOP_ME_TERM_SEQ_BASE + start;
    const { host, guest } = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest); // real (long) default timeout, like production

    const partyPrompt: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "party" },
    };
    hostRelay.sendInteractionOutcome(seqMe, "mePresent", partyPrompt);
    await new Promise(r => setTimeout(r, 0));

    const winner = await startRace(guestRelay, seqMe, seqTerm).race;
    expect(winner.tag).toBe("outcome");
    if (winner.tag !== "outcome" || winner.outcome?.k !== "mePresent") {
      throw new Error("sub-prompt mePresent should win the race");
    }
    expect(winner.outcome.subPrompt).toEqual({ kind: "party" });

    guestRelay.dispose();
    hostRelay.dispose();
  });
});
