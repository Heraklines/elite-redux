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
// owner relays a BATTLE-HANDOFF sentinel (distinct from LEAVE) so the watcher ENDS the
// pump WITHOUT leaving the encounter; and the HOST streams the ME battle's enemy party
// keyed by the ME INTERACTION (not just waveIndex, since the battle spawns mid-wave),
// which the GUEST adopts verbatim. Both then fall into the existing host-drives /
// guest-replays battle path, so the boss is identical + host-authoritative regardless
// of who OWNED the encounter (BOTH owner cases covered below).
// =============================================================================

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { meBattleHandoffKey } from "#data/elite-redux/coop/coop-me-battle-handoff";
import { CoopMePump, type CoopMePumpEngine } from "#data/elite-redux/coop/coop-me-pump";
import { type CoopSerializedEnemy, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** Flush the loopback (delivers on a macrotask via setTimeout(0), like the live transport). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
/** Let the pump's await/readiness chain drain across several macrotasks before asserting. */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await flush();
  }
};

/** A recording pump engine with a settable ready flag (mirrors the ui.ts surface). */
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

const fastTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

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
  it("REPRO: the watcher's button stream dries up at the encounter -> battle boundary (the old hang)", async () => {
    // Guest owns the ME (the failing case). The watcher (host) replays the owner's buttons.
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const watcherPump = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const watcherEng = makeEngine();
    watcherPump.attach(watcherEng);

    const SEQ = 8_000_001;
    let left = false;
    let handedOff = false;
    ownerPump.beginOwner(SEQ);
    watcherPump.beginWatcher(SEQ, {
      onLeave: () => {
        left = true;
      },
      onBattleHandoff: () => {
        handedOff = true;
      },
    });

    // The owner presses the option-commit, which the watcher replays.
    ownerPump.relayOwnerButton(0); // cursor stays on option 0
    ownerPump.relayOwnerButton(99); // ACTION = commit the option
    await settle();
    expect(watcherEng.applied).toEqual([0, 99]);

    // Now the owner FORKS into the spawned battle (initBattleWithEnemyConfig) and would park in
    // CoopReplayTurnPhase - WITHOUT the handoff sentinel it sends NO MORE buttons, so the watcher
    // is stuck in awaitInteractionChoice: it neither advances to the battle nor degrades = HANG.
    await settle();
    expect(left, "old behavior without the sentinel: watcher does not leave...").toBe(false);
    expect(handedOff, "...and does not hand off...").toBe(false);
    expect(watcherPump.isSessionActive(), "...it is STILL parked = the deadlock").toBe(true);

    ownerPump.endSession();
    watcherPump.endSession();
  });

  it("FIX: the owner relays a BATTLE-HANDOFF sentinel; the watcher ends the pump WITHOUT leaving the encounter", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const watcherPump = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    const watcherEng = makeEngine();
    watcherPump.attach(watcherEng);

    const SEQ = 8_000_001;
    let left = false;
    let handedOff = false;
    ownerPump.beginOwner(SEQ);
    watcherPump.beginWatcher(SEQ, {
      onLeave: () => {
        left = true;
      },
      onBattleHandoff: () => {
        handedOff = true;
      },
    });

    ownerPump.relayOwnerButton(0);
    ownerPump.relayOwnerButton(99);
    await settle();
    expect(watcherEng.applied).toEqual([0, 99]);

    // The owner spawns the battle: it relays the BATTLE-HANDOFF sentinel instead of pressing on.
    ownerPump.relayMeBattleHandoff();
    await settle();

    expect(handedOff, "watcher ran the battle-handoff callback").toBe(true);
    expect(left, "watcher did NOT leaveEncounterWithoutBattle (the battle must run)").toBe(false);
    expect(watcherPump.isSessionActive(), "the pump ended cleanly at the handoff (no hang)").toBe(false);
    expect(ownerPump.isSessionActive(), "the owner's pump also ended at the handoff").toBe(false);

    ownerPump.endSession();
    watcherPump.endSession();
  });

  it("FIX: the LEAVE sentinel still skips a NON-battle ME (no handoff) - lockstep behavior preserved", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const watcherPump = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    watcherPump.attach(makeEngine());

    const SEQ = 8_000_003;
    let left = false;
    let handedOff = false;
    ownerPump.beginOwner(SEQ);
    watcherPump.beginWatcher(SEQ, {
      onLeave: () => {
        left = true;
      },
      onBattleHandoff: () => {
        handedOff = true;
      },
    });

    ownerPump.relayOwnerButton(5);
    await settle();
    // A pure-dialogue ME ends with the normal LEAVE sentinel (no battle).
    ownerPump.endOwner();
    await settle();

    expect(left, "LEAVE still fast-forwards a non-battle ME").toBe(true);
    expect(handedOff, "no battle handoff for a non-battle ME").toBe(false);
    expect(watcherPump.isSessionActive()).toBe(false);

    watcherPump.endSession();
  });

  it("FIX: a bare-function watcher callback is still accepted as legacy onLeave (backward compat)", async () => {
    const { host, guest } = createLoopbackPair();
    const ownerPump = new CoopMePump(new CoopInteractionRelay(guest), { tick: fastTick });
    const watcherPump = new CoopMePump(new CoopInteractionRelay(host), { tick: fastTick });
    watcherPump.attach(makeEngine());

    const SEQ = 8_000_004;
    let left = false;
    ownerPump.beginOwner(SEQ);
    // Legacy callers (and the existing unit tests) pass a bare function = onLeave only.
    watcherPump.beginWatcher(SEQ, () => {
      left = true;
    });
    ownerPump.relayOwnerButton(7);
    await settle();
    ownerPump.endOwner();
    await settle();
    expect(left, "the bare function still fires on LEAVE").toBe(true);

    watcherPump.endSession();
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
