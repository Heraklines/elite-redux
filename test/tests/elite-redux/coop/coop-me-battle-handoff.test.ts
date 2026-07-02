/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op AUTHORITATIVE-mode mystery-encounter BATTLE HANDOFF (#633). Engine-free,
// protocol-level over a LoopbackTransport - the only headless-testable layer for
// two co-op clients (globalScene is a process singleton, so two full GameManagers
// cannot coexist; we test the SYNC LAYER exactly like coop-interaction-sync).
//
// THE BUG this protects against (live, 2 clients, AUTHORITATIVE netcode): a mystery
// encounter whose option spawns a wild BOSS battle desyncs. The GUEST owns the ME
// (parity counter odd) and drives the option pick; the HOST is the button-replay
// WATCHER and STALLS at MysteryEncounterPhase - the owner's button stream DRIES UP at
// the encounter -> battle boundary (the owner forks into the spawned battle + parks in
// CoopReplayTurnPhase instead of pressing through), so the host never selects the
// option, never reaches the battle, and the guest waits in CoopReplayTurnPhase forever.
// Deadlock. (See the first test - it reproduces exactly that stall against the pump.)
//
// THE FIX (proven here at the protocol level): at the encounter -> battle boundary the
// owner relays a BATTLE-HANDOFF sentinel (distinct from LEAVE) on the dedicated 9M
// TERMINAL seq the peer's `CoopReplayMePhase.awaitHostTerminal` listens on; and the HOST
// streams the ME battle's enemy party keyed by the ME INTERACTION (not just waveIndex,
// since the battle spawns mid-wave), which the GUEST adopts verbatim. Both then fall
// into the existing host-drives / guest-replays battle path, so the boss is identical +
// host-authoritative regardless of who OWNED the encounter (BOTH owner cases covered
// below). The peer side here is a plain relay await - the M6 authoritative model; the
// old lockstep watcher pump was deleted with M6b.
// =============================================================================

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { COOP_ME_BATTLE_HANDOFF, CoopMePump } from "#data/elite-redux/coop/coop-me-pump";
import { type CoopSerializedEnemy, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** Flush the loopback (delivers on a macrotask via setTimeout(0), like the live transport). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
/** Let the relay await chain drain across several macrotasks before asserting. */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await flush();
  }
};

/** A one-mon boss party the host "generated" for the ME battle. */
const BOSS_PARTY: CoopSerializedEnemy[] = [
  {
    fieldIndex: 0,
    data: {
      speciesId: 999,
      level: 50,
      formIndex: 0,
      gender: 0,
      abilityIndex: 0,
      shiny: false,
      ivs: [31, 31, 31, 31, 31, 31],
    },
  },
];

describe("co-op authoritative ME battle handoff (#633)", () => {
  it("REPRO: with NO handoff sentinel the peer's terminal await starves at the ME -> battle boundary", async () => {
    // Guest owns the ME (the failing case). The peer (host) awaits the terminal on the 9M seq,
    // exactly as CoopReplayMePhase.awaitHostTerminal does.
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest));
    const peerRelay = new CoopInteractionRelay(host);

    const SEQ_ME = 8_000_001;
    const SEQ_TERM = 9_000_001;
    ownerPump.beginOwner(SEQ_ME, SEQ_TERM);

    // The owner commits its option picks (they ride the 8M pick seq)...
    ownerPump.relayOwnerButton(0);
    ownerPump.relayOwnerButton(99);
    await settle();

    // ...then FORKS into the spawned battle (initBattleWithEnemyConfig) and parks in
    // CoopReplayTurnPhase. WITHOUT the handoff sentinel it sends NOTHING on the terminal seq,
    // so the peer's terminal await starves - it can only ever time out = the old hang.
    const terminal = await peerRelay.awaitInteractionChoice(SEQ_TERM, 15);
    expect(terminal, "no sentinel -> the terminal await times out to null (the deadlock)").toBeNull();

    ownerPump.endSession();
  });

  it("FIX: the owner relays a BATTLE-HANDOFF sentinel; the peer's terminal await resolves WITHOUT a leave", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest));
    const peerRelay = new CoopInteractionRelay(host);

    const SEQ_ME = 8_000_001;
    const SEQ_TERM = 9_000_001;
    ownerPump.beginOwner(SEQ_ME, SEQ_TERM);
    ownerPump.relayOwnerButton(0);
    ownerPump.relayOwnerButton(99);
    await settle();

    // The owner spawns the battle: it relays the BATTLE-HANDOFF sentinel instead of pressing on.
    ownerPump.relayMeBattleHandoff();
    await settle();

    const terminal = await peerRelay.awaitInteractionChoice(SEQ_TERM, 15);
    expect(terminal?.choice, "the peer's terminal await resolved with the HANDOFF sentinel").toBe(
      COOP_ME_BATTLE_HANDOFF,
    );
    expect(terminal?.choice, "the sentinel is NOT the LEAVE (the battle must run, no encounter skip)").not.toBe(
      COOP_INTERACTION_LEAVE,
    );
    expect(ownerPump.isSessionActive(), "the owner's pump ended at the handoff").toBe(false);

    ownerPump.endSession();
  });

  it("FIX: the LEAVE sentinel still ends a NON-battle ME (distinct terminal, no handoff)", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest));
    const peerRelay = new CoopInteractionRelay(host);

    const SEQ_ME = 8_000_003;
    const SEQ_TERM = 9_000_003;
    ownerPump.beginOwner(SEQ_ME, SEQ_TERM);
    ownerPump.relayOwnerButton(5);
    await settle();
    // A pure-dialogue ME ends with the normal LEAVE sentinel (no battle).
    ownerPump.endOwner();
    await settle();

    const terminal = await peerRelay.awaitInteractionChoice(SEQ_TERM, 15);
    expect(terminal?.choice, "LEAVE still ends a non-battle ME on the terminal channel").toBe(COOP_INTERACTION_LEAVE);
    expect(terminal?.choice, "and it is NOT the battle handoff").not.toBe(COOP_ME_BATTLE_HANDOFF);
    expect(ownerPump.isSessionActive()).toBe(false);
  });

  // ===========================================================================
  // The host-authoritative ME battle PARTY stream (both owner cases share this:
  // the HOST always streams, the GUEST always adopts, regardless of who OWNED the ME).
  // ===========================================================================

  it("FIX (guest owns the ME): the host streams the boss keyed by the ME interaction; the guest adopts it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const waveIndex = 12;
    const meInteraction = 1; // odd -> guest owns the ME
    const key = meBattleHandoffKey(waveIndex, meInteraction);

    // The guest (the ME owner here) spawned the battle but must fight the HOST's mons.
    const adopting = guestStream.awaitMeBattleEnemyParty(key, 1_000);
    await flush();
    hostStream.sendMeBattleEnemyParty(key, BOSS_PARTY);
    await flush();

    const got = await adopting;
    expect(got, "the guest adopts the host's exact ME battle party").not.toBeNull();
    expect(got).toEqual(BOSS_PARTY);

    hostStream.dispose();
    guestStream.dispose();
  });

  it("FIX (host owns the ME): same stream/adopt path - the guest still adopts the host's boss", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const waveIndex = 13;
    const meInteraction = 2; // even -> host owns the ME
    const key = meBattleHandoffKey(waveIndex, meInteraction);

    const adopting = guestStream.awaitMeBattleEnemyParty(key, 1_000);
    await flush();
    hostStream.sendMeBattleEnemyParty(key, BOSS_PARTY);
    await flush();

    const got = await adopting;
    expect(got, "host-owned ME: the guest still adopts the host's party (battle host-authoritative)").toEqual(
      BOSS_PARTY,
    );

    hostStream.dispose();
    guestStream.dispose();
  });

  it("FIX: two ME battles in the SAME wave get distinct keys (no party collision)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const wave = 30;
    const keyA = meBattleHandoffKey(wave, 4);
    const keyB = meBattleHandoffKey(wave, 6);
    expect(keyA, "distinct ME interactions in a wave have distinct keys").not.toBe(keyB);

    const otherParty: CoopSerializedEnemy[] = [{ fieldIndex: 0, data: { speciesId: 111, level: 40 } }];
    hostStream.sendMeBattleEnemyParty(keyA, BOSS_PARTY);
    hostStream.sendMeBattleEnemyParty(keyB, otherParty);
    await flush();
    expect(await guestStream.awaitMeBattleEnemyParty(keyB, 1_000)).toEqual(otherParty);
    expect(await guestStream.awaitMeBattleEnemyParty(keyA, 1_000)).toEqual(BOSS_PARTY);

    hostStream.dispose();
    guestStream.dispose();
  });

  it("FIX: a stale/missing ME battle party times out to null (the guest falls back, never hangs)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const key = meBattleHandoffKey(7, 0);
    // No host send: the await must resolve null after the (short, injected) timeout.
    const got = await guestStream.awaitMeBattleEnemyParty(key, 10);
    expect(got, "a missing ME party times out to null - the guest generates its own, never hangs").toBeNull();

    hostStream.dispose();
    guestStream.dispose();
  });

  it("FIX: the buffered ME battle party is consumed even when it arrives before the awaiter (race)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const key = meBattleHandoffKey(20, 2);
    // The host streams it BEFORE the guest awaits (the host raced ahead).
    hostStream.sendMeBattleEnemyParty(key, BOSS_PARTY);
    await flush();
    const got = await guestStream.awaitMeBattleEnemyParty(key, 1_000);
    expect(got, "an early ME party is buffered and consumed by the next await").toEqual(BOSS_PARTY);

    hostStream.dispose();
    guestStream.dispose();
  });
});
