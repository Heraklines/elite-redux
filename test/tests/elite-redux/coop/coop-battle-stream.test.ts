/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op host-authoritative battle STREAM (#633, LIVE-D). The host->guest wire:
// the host streams the enemy party + per-turn resolutions + out-of-turn checkpoints;
// the guest awaits each turn and renders it, never computing. Verified over a
// LoopbackTransport (the same "test via spoofing" path the rest of the suite uses).

import { CoopBattleStreamer, type CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
  CoopMessage,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { describe, expect, it } from "vitest";

const flushWire = () => new Promise<void>(resolve => queueMicrotask(resolve));

const emptyCheckpoint = (): CoopBattleCheckpoint => ({
  tick: 19,
  field: [
    {
      bi: 0,
      partyIndex: 0,
      speciesId: 1,
      hp: 1,
      maxHp: 1,
      status: 0,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      fainted: false,
    },
  ],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

const emptyAuthoritativeState = (wave: number, turn = 1, tick = 20): CoopAuthoritativeBattleStateV1 => ({
  version: 1,
  tick,
  wave,
  turn,
  playerParty: [{ id: 1 }],
  enemyParty: [{ id: 2 }],
  field: [{ side: "player", bi: 0, partyIndex: 0, pokemonId: 1, presented: true }],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 123,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
});

const emptyFullField = (): CoopFullMonSnapshot[] => [
  {
    bi: 0,
    partyIndex: 0,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

function emitCompleteTurn(
  stream: CoopBattleStreamer,
  turn: number,
  events: Parameters<CoopBattleStreamer["emitTurn"]>[3],
  checkpoint: CoopBattleCheckpoint,
  checksum: string,
): void {
  stream.emitTurn(7, 1, turn, events, checkpoint, checksum, "{}", emptyFullField(), emptyAuthoritativeState(1, turn));
}

function sendCompleteCheckpoint(
  stream: CoopBattleStreamer,
  reason: string,
  checkpoint: CoopBattleCheckpoint,
  checksum: string,
  state = emptyAuthoritativeState(1),
): void {
  stream.sendCheckpoint(reason, 7, state.wave, state.turn, checkpoint, checksum, emptyFullField(), state);
}

function checkpointEnvelope(
  reason = "replacement",
  checkpoint = emptyCheckpoint(),
  checksum = "deadbeefdeadbeef",
  state = emptyAuthoritativeState(4, 2),
): CoopCheckpointEnvelope {
  return {
    reason,
    epoch: 7,
    wave: state.wave,
    turn: state.turn,
    revision: state.tick,
    checkpoint,
    checksum,
    fullField: emptyFullField(),
    authoritativeState: state,
  };
}

describe("co-op host-authoritative battle stream (#633, LIVE-D)", () => {
  it("the guest adopts the host's exact enemy party", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    let got: { wave: number; count: number } | null = null;
    guestStream.onEnemyPartySync((wave, enemies) => {
      got = { wave, count: enemies.length };
    });

    hostStream.sendEnemyParty(7, [
      { fieldIndex: 2, data: { species: 1 } },
      { fieldIndex: 3, data: { species: 4 } },
    ]);
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual({ wave: 7, count: 2 });
  });

  it("awaitEnemyParty resolves with the host's party when the guest is parked first (LIVE-D6)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    // Guest reaches its encounter and waits BEFORE the host (still at its save-slot
    // screen) has generated - the realistic order with the launch-hang fix.
    const awaited = guestStream.awaitEnemyParty(7);
    hostStream.sendEnemyParty(7, [{ fieldIndex: 2, data: { speciesId: 163 } }]);

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.[0]?.data.speciesId).toBe(163);
  });

  it("awaitEnemyParty returns a party that arrived BEFORE the await (race buffer)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
    await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

    const res = await guestStream.awaitEnemyParty(9);
    expect(res?.[0]?.data.speciesId).toBe(1);
  });

  it("pairs the complete new-wave state with enemyPartySync until the guest consumes it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const state = emptyAuthoritativeState(9);

    hostStream.sendEnemyParty(9, [{ fieldIndex: 2, data: { speciesId: 1 } }], -1, 0, state);
    await guestStream.awaitEnemyParty(9);

    expect(guestStream.consumeEnemyPartyState(9)).toEqual(state);
    expect(guestStream.consumeEnemyPartyState(9), "boundary state is one-shot").toBeUndefined();
  });

  it("awaitEnemyParty resolves null on timeout (guest then generates its own - never hangs)", async () => {
    const { guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const awaited = guestStream.awaitEnemyParty(3, 1000);
    expect(timer.fire).toBeDefined();
    timer.fire?.(); // simulate the timeout firing
    expect(await awaited).toBeNull();
  });

  it("awaitEnemyParty for one wave is NOT satisfied by a stale OTHER wave's party", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    // Host sends wave 5; the guest is waiting on wave 6 -> the stale party never
    // satisfies it, and it times out to null (then rolls its own).
    hostStream.sendEnemyParty(5, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
    const awaited = guestStream.awaitEnemyParty(6, 1000);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a turn resolution the guest is awaiting is delivered (host -> guest lockstep replacement)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const awaited = guestStream.awaitTurn(1);
    emitCompleteTurn(
      hostStream,
      1,
      [{ k: "message", text: "Bulbasaur fainted!" }],
      emptyCheckpoint(),
      "deadbeefdeadbeef",
    );

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.turn).toBe(1);
    expect(res?.events[0]).toEqual({ k: "message", text: "Bulbasaur fainted!" });
  });

  it("a resolution that arrives BEFORE the guest awaits is buffered and returned (race fix)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    // Host is faster: it sends turn 2 before the guest reaches its await.
    emitCompleteTurn(hostStream, 2, [{ k: "faint", bi: 2 }], emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

    const res = await guestStream.awaitTurn(2);
    expect(res).not.toBeNull();
    expect(res?.events[0]).toEqual({ k: "faint", bi: 2 });
  });

  it("a turn that never arrives resolves null after the timeout (guest shows 'waiting')", async () => {
    const { host, guest } = createLoopbackPair();
    new CoopBattleStreamer(host);
    // Fire the timeout immediately (no host emit).
    const guestStream = new CoopBattleStreamer(guest, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    const res = await guestStream.awaitTurn(1);
    expect(res).toBeNull();
  });

  it("runtime-drops a malformed protocol-31 turn instead of buffering partial authority", async () => {
    const { host, guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const guestStream = new CoopBattleStreamer(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });
    const awaited = guestStream.awaitTurn(1);
    host.send({
      t: "turnResolution",
      turn: 1,
      events: [],
      checkpoint: emptyCheckpoint(),
      checksum: "deadbeefdeadbeef",
    } as unknown as CoopMessage);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a second await for the same turn supersedes the stale one (resolves it null)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const first = guestStream.awaitTurn(1);
    const second = guestStream.awaitTurn(1);
    emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "deadbeefdeadbeef");

    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
  });

  it("consumeEnemyParty returns the host's party for the matching wave, then clears it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    hostStream.sendEnemyParty(3, [{ fieldIndex: 0, data: { species: 265, abilityIndex: 1 } }]);
    await new Promise(r => setTimeout(r, 0));

    // Wrong wave -> nothing (the guest never adopts a stale wave's enemies).
    expect(guestStream.consumeEnemyParty(2)).toBeNull();
    // Right wave -> the party, and it is consumed (one-shot).
    const enemies = guestStream.consumeEnemyParty(3);
    expect(enemies).not.toBeNull();
    expect(enemies?.[0].data.abilityIndex).toBe(1);
    expect(guestStream.consumeEnemyParty(3)).toBeNull();
  });

  it("out-of-turn checkpoints reach the guest's handler", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    let reason: string | null = null;
    guestStream.onCheckpoint(r => {
      reason = r;
    });
    sendCompleteCheckpoint(hostStream, "switch", emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0));
    expect(reason).toBe("switch");
  });

  it("a replacement retransmit request with no retained host frame emits nothing", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    let arrivals = 0;
    guestStream.onCheckpointEnvelope(() => arrivals++);

    guestStream.requestReplacementCheckpoint(checkpointEnvelope());
    await new Promise(r => setTimeout(r, 0));

    expect(arrivals).toBe(0);
    expect(guestStream.peekCheckpoint()).toBeNull();
    hostStream.dispose();
    guestStream.dispose();
  });

  it("a held safe boundary can observe the complete replacement envelope without stealing the legacy observer", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);
    const checkpoint = { ...emptyCheckpoint(), tick: 19 };
    const state = { ...emptyAuthoritativeState(4), tick: 20, turn: 2 };
    const legacyReasons: string[] = [];
    const envelopes: { reason: string; checkpointTick: number | undefined; stateTick: number | undefined }[] = [];

    guestStream.onCheckpoint(reason => legacyReasons.push(reason));
    const unsubscribeThrowingObserver = guestStream.onCheckpointEnvelope(() => {
      throw new Error("observer failure must be isolated");
    });
    const unsubscribe = guestStream.onCheckpointEnvelope(envelope => {
      envelopes.push({
        reason: envelope.reason,
        checkpointTick: envelope.checkpoint.tick,
        stateTick: envelope.authoritativeState?.tick,
      });
    });
    const replayWake = guestStream.awaitTurnOrLiveEvent(2, 0);

    sendCompleteCheckpoint(hostStream, "replacement", checkpoint, "deadbeefdeadbeef", state);
    await new Promise(r => setTimeout(r, 0));

    expect(await replayWake, "a throwing observer did not suppress the replay-pump waiter").toEqual({
      kind: "checkpoint",
    });
    expect(envelopes).toEqual([{ reason: "replacement", checkpointTick: 19, stateTick: 20 }]);
    expect(legacyReasons, "a throwing envelope observer did not suppress the legacy fan-out").toEqual(["replacement"]);
    expect(guestStream.peekCheckpoint()?.authoritativeState?.turn).toBe(2);
    expect(guestStream.consumeCheckpoint()?.reason).toBe("replacement");
    expect(guestStream.peekCheckpoint()).toBeNull();

    // A failed safe-boundary apply requests the host's retained frame. This must create a SECOND real
    // envelope notification (not merely re-read the guest's old object), enabling same-tick idempotent retry.
    guestStream.requestReplacementCheckpoint(checkpointEnvelope("replacement", checkpoint, "deadbeefdeadbeef", state));
    await new Promise(r => setTimeout(r, 0));
    expect(envelopes).toHaveLength(2);
    expect(guestStream.consumeCheckpoint()?.authoritativeState?.tick).toBe(20);

    unsubscribe();
    unsubscribeThrowingObserver();
    sendCompleteCheckpoint(hostStream, "later", { ...emptyCheckpoint(), tick: 21 }, "cafebabecafebabe", {
      ...state,
      tick: 22,
    });
    await new Promise(r => setTimeout(r, 0));
    expect(envelopes, "the temporary recovery observer was removed").toHaveLength(2);
    expect(
      legacyReasons,
      "the independent legacy observer sees the requested retransmit and remains installed",
    ).toEqual(["replacement", "replacement", "later"]);
    guestStream.dispose();
    hostStream.dispose();
  });

  describe("protocol-32 retained authority transactions", () => {
    const context = () => ({ epoch: 7, wave: 1, turn: 1 });

    it("accepts production string-enum battler tags in a complete carrier", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host, { authorityContext: context });
      const guestStream = new CoopBattleStreamer(guest, { authorityContext: context });
      const fullField = emptyFullField();
      // BattlerTagType is a string enum at runtime even though the historical snapshot type used an
      // unsafe numeric cast.  This used to make a real SEEDED/ENCORE turn disappear as "malformed".
      fullField[0].tags = ["SEEDED" as never];

      const awaited = guestStream.awaitTurn(1);
      hostStream.emitTurn(
        7,
        1,
        1,
        [],
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        "{}",
        fullField,
        emptyAuthoritativeState(1),
      );

      expect((await awaited)?.fullField[0].tags).toEqual(["SEEDED"]);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("recovers a dropped turn commit, re-ACKs a dropped ACK, and applies observers once", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333231 });
      const hostRetryTimers: (() => void)[] = [];
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: context,
        schedule: cb => {
          hostRetryTimers.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: context });
      let appliedDeliveries = 0;
      let pendingReplies = 0;
      guestStream.onTurnCommit(() => appliedDeliveries++);
      pair.guest.onMessage(msg => {
        if (msg.t === "turnCommitPending") {
          pendingReplies++;
        }
      });

      pair.armNextDrop("turnResolution", "host");
      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [{ k: "message", text: "retained" }], emptyCheckpoint(), "deadbeefdeadbeef");
      await flushWire();
      expect(pair.counters.host.oneShotDropped, "the first commit was actually lost").toBe(1);

      guestStream.requestTurnCommit(7, 1, 1);
      const resolution = await awaited;
      expect(resolution?.events).toEqual([{ k: "message", text: "retained" }]);
      expect(appliedDeliveries).toBe(1);

      pair.armNextDrop("turnCommitAck", "guest");
      guestStream.acknowledgeTurnCommit(resolution!);
      await flushWire();
      hostRetryTimers.shift()?.();
      await flushWire();
      expect(appliedDeliveries, "the production host retry was re-ACKed before observer/apply fan-out").toBe(1);

      const pendingBefore = pendingReplies;
      guestStream.requestTurnCommit(7, 1, 1, resolution!.revision);
      await flushWire();
      expect(pendingReplies, "the exact retained commit was cleared only after the successful re-ACK").toBeGreaterThan(
        pendingBefore,
      );
      hostStream.dispose();
      guestStream.dispose();
    });

    it("rejects cross-wave traffic and malformed bi-only authority before buffering", async () => {
      const { host, guest } = createLoopbackPair();
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 2, turn: 1 }),
      });
      let delivered = 0;
      guestStream.onTurnCommit(() => delivered++);
      const valid = checkpointEnvelope(
        "turnResolution",
        emptyCheckpoint(),
        "deadbeefdeadbeef",
        emptyAuthoritativeState(1),
      );
      const base = {
        t: "turnResolution",
        epoch: valid.epoch,
        wave: valid.wave,
        turn: valid.turn,
        revision: valid.revision,
        events: [] as const,
        checkpoint: valid.checkpoint,
        checksum: valid.checksum,
        preimage: "{}",
        fullField: valid.fullField,
        authoritativeState: valid.authoritativeState,
      };

      host.send(base as unknown as CoopMessage);
      host.send({
        ...base,
        wave: 2,
        authoritativeState: { ...valid.authoritativeState, wave: 2 },
        fullField: [{ bi: 0 }],
      } as unknown as CoopMessage);
      host.send({
        ...base,
        wave: 2,
        events: [{ k: "hp", bi: 99, hp: 0, maxHp: 1 }],
        authoritativeState: { ...valid.authoritativeState, wave: 2 },
      } as unknown as CoopMessage);
      await flushWire();

      expect(delivered, "neither stale addresses nor structurally fake carriers reach apply observers").toBe(0);
      expect(guestStream.consumeLiveEvents(1)).toEqual([]);
      guestStream.dispose();
    });

    it("retains multiple replacement revisions and clears only an exact converged ACK", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host, {
        authorityContext: () => ({ epoch: 7, wave: 4, turn: 2 }),
      });
      const guestStream = new CoopBattleStreamer(guest, {
        authorityContext: () => ({ epoch: 7, wave: 4, turn: 2 }),
      });
      const oldEnvelope = checkpointEnvelope();
      const newCheckpoint = { ...emptyCheckpoint(), tick: 21 };
      const newEnvelope = checkpointEnvelope(
        "replacement",
        newCheckpoint,
        "cafebabecafebabe",
        emptyAuthoritativeState(4, 2, 22),
      );
      const rawRevisions: number[] = [];
      guest.onMessage(msg => {
        if (msg.t === "battleCheckpoint") {
          rawRevisions.push(msg.revision);
        }
      });

      hostStream.sendCheckpoint(
        "replacement",
        oldEnvelope.epoch,
        oldEnvelope.wave,
        oldEnvelope.turn,
        oldEnvelope.checkpoint,
        oldEnvelope.checksum,
        oldEnvelope.fullField,
        oldEnvelope.authoritativeState,
      );
      hostStream.sendCheckpoint(
        "replacement",
        newEnvelope.epoch,
        newEnvelope.wave,
        newEnvelope.turn,
        newEnvelope.checkpoint,
        newEnvelope.checksum,
        newEnvelope.fullField,
        newEnvelope.authoritativeState,
      );
      await flushWire();

      guest.send({
        t: "battleCheckpointAck",
        reason: "replacement",
        epoch: oldEnvelope.epoch,
        wave: oldEnvelope.wave,
        turn: oldEnvelope.turn,
        revision: oldEnvelope.revision,
        checkpointTick: oldEnvelope.checkpoint.tick!,
        stateTick: oldEnvelope.authoritativeState.tick,
        checksum: "0000000000000001",
      });
      await flushWire();
      const beforeWrongAckRequest = rawRevisions.length;
      guestStream.requestReplacementCheckpoint(oldEnvelope);
      await flushWire();
      expect(rawRevisions.slice(beforeWrongAckRequest)).toEqual([20]);

      guestStream.acknowledgeReplacement(oldEnvelope);
      await flushWire();
      const afterExactAck = rawRevisions.length;
      guestStream.requestReplacementCheckpoint(oldEnvelope);
      await flushWire();
      expect(rawRevisions).toHaveLength(afterExactAck);

      guestStream.requestReplacementCheckpoint(newEnvelope);
      await flushWire();
      expect(rawRevisions.at(-1), "the newer unacked replacement remains independently replayable").toBe(22);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("host retries a replacement after a lost ACK and the guest re-ACKs without reopening it", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333252 });
      const hostRetryTimers: (() => void)[] = [];
      const replacementContext = () => ({ epoch: 7, wave: 4, turn: 2 });
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: replacementContext,
        schedule: cb => {
          hostRetryTimers.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: replacementContext });
      const envelope = checkpointEnvelope();
      let opened = 0;
      guestStream.onCheckpointEnvelope(() => opened++);

      hostStream.sendCheckpoint(
        "replacement",
        envelope.epoch,
        envelope.wave,
        envelope.turn,
        envelope.checkpoint,
        envelope.checksum,
        envelope.fullField,
        envelope.authoritativeState,
      );
      await flushWire();
      expect(opened).toBe(1);
      expect(guestStream.consumeCheckpoint()).not.toBeNull();

      pair.armNextDrop("battleCheckpointAck", "guest");
      guestStream.acknowledgeReplacement(envelope);
      await flushWire();
      hostRetryTimers.shift()?.();
      await flushWire();
      expect(opened, "duplicate replacement was re-ACKed before recovery observers/command UI").toBe(1);

      guestStream.requestReplacementCheckpoint(envelope);
      await flushWire();
      expect(opened, "the successful re-ACK cleared host retention").toBe(1);
      hostStream.dispose();
      guestStream.dispose();
    });

    it("retries a lost fatal frame, re-ACKs duplicates exactly once, and honors its absolute deadline", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x50333246 });
      const scheduled: (() => void)[] = [];
      let now = 0;
      const hostStream = new CoopBattleStreamer(pair.host, {
        authorityContext: context,
        now: () => now,
        schedule: cb => {
          scheduled.push(cb);
          return () => {};
        },
      });
      const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: context });
      let routed = 0;
      guestStream.onAuthorityFailure(() => routed++);
      const failure = {
        t: "authorityFailure" as const,
        failureId: "fatal-1",
        epoch: 7,
        wave: 1,
        turn: 1,
        revision: 1,
        boundary: "turnResolution" as const,
        reason: "capture failed",
      };

      pair.armNextDrop("authorityFailure", "host");
      const acknowledged = hostStream.broadcastAuthorityFailure(failure);
      await flushWire();
      expect(routed).toBe(0);
      scheduled.shift()?.();
      await expect(acknowledged).resolves.toBe(true);
      expect(routed).toBe(1);

      pair.host.send(failure);
      await flushWire();
      expect(routed, "duplicate fatal delivery is re-ACKed without a second terminal route").toBe(1);
      hostStream.dispose();
      guestStream.dispose();

      const unackedPair = createLoopbackPair();
      const deadlineTimers: (() => void)[] = [];
      now = 0;
      const unackedHost = new CoopBattleStreamer(unackedPair.host, {
        authorityContext: context,
        now: () => now,
        schedule: cb => {
          deadlineTimers.push(cb);
          return () => {};
        },
      });
      const expired = unackedHost.broadcastAuthorityFailure({ ...failure, failureId: "fatal-deadline" });
      now = 3_000;
      deadlineTimers.shift()?.();
      await expect(expired).resolves.toBe(false);
      unackedHost.dispose();
    });
  });

  it("dispose fails an in-flight await and stops listening", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const awaited = guestStream.awaitTurn(5);
    guestStream.dispose();
    expect(await awaited).toBeNull();

    // After dispose the guest no longer buffers/handles anything.
    let fired = false;
    guestStream.onCheckpoint(() => {
      fired = true;
    });
    sendCompleteCheckpoint(hostStream, "post-dispose", emptyCheckpoint(), "deadbeefdeadbeef");
    await new Promise(r => setTimeout(r, 0));
    expect(fired).toBe(false);
  });

  describe("ghost-pool sync (#633)", () => {
    // A minimal pool - the streamer relays it verbatim (order preserved), which is what
    // makes the guest's seeded ghost pick land on the same team as the host.
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixtures; the streamer is shape-agnostic
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;

    it("the guest receives the host's ghost pool verbatim + in order", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      let got: { id: string }[] | null = null;
      guestStream.onGhostPool(p => {
        got = p as unknown as { id: string }[];
      });
      hostStream.sendGhostPool(pool);
      await new Promise(r => setTimeout(r, 0));
      expect((got as { id: string }[] | null)?.map(t => t.id)).toEqual(["a", "b", "c"]);
    });

    it("buffers a pool that arrives BEFORE the guest subscribes (eager broadcast)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Host broadcasts on prefetch-resolve, possibly before the guest's runtime wires its
      // handler - the message must be buffered + delivered on subscribe, never lost.
      hostStream.sendGhostPool(pool);
      await new Promise(r => setTimeout(r, 0));
      let got: { id: string }[] | null = null;
      guestStream.onGhostPool(p => {
        got = p as unknown as { id: string }[];
      });
      expect((got as { id: string }[] | null)?.length).toBe(3);
    });
  });

  describe("checksum-driven resync handshake (#633, TRACK-2)", () => {
    it("emitTurn / sendCheckpoint carry the host's checksum to the guest's await/consume", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      const awaited = guestStream.awaitTurn(1);
      emitCompleteTurn(hostStream, 1, [], emptyCheckpoint(), "feedface00000001");
      const res = await awaited;
      expect(res?.checksum).toBe("feedface00000001");

      sendCompleteCheckpoint(hostStream, "switch", emptyCheckpoint(), "feedface00000002");
      await new Promise(r => setTimeout(r, 0));
      const envelope = guestStream.consumeCheckpoint();
      expect(envelope?.checksum).toBe("feedface00000002");
      expect(envelope?.reason).toBe("switch");
      // One-shot: consumed.
      expect(guestStream.consumeCheckpoint()).toBeNull();
    });

    it("a guest requestStateSync round-trips to the host and back as a stateSync blob", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Host answers the guest's resync request with a blob (echoing the seq).
      let sawTurn = -1;
      hostStream.onStateSyncRequest((turn, seq) => {
        sawTurn = turn;
        hostStream.sendStateSync(`blob-for-turn-${turn}`, seq);
      });

      const blob = await guestStream.requestStateSync(7);
      expect(sawTurn).toBe(7);
      expect(blob).toBe("blob-for-turn-7");
    });

    it("a stale stateSync (older seq) never satisfies the newest resync request", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // The host answers the FIRST request late + the SECOND promptly. The first request
      // is superseded by the second (one in flight at a time), so the late seq-1 reply is
      // dropped and only the seq-2 reply satisfies the live await.
      const seqs: number[] = [];
      hostStream.onStateSyncRequest((_turn, seq) => {
        seqs.push(seq);
        if (seq === 2) {
          hostStream.sendStateSync("fresh", seq);
        }
      });

      const first = guestStream.requestStateSync(1); // seq 1 - superseded
      const second = guestStream.requestStateSync(2); // seq 2 - the live one
      // The stale seq-1 reply, were it to arrive, must not satisfy `second`.
      hostStream.sendStateSync("stale", 1);

      expect(await first).toBeNull();
      expect(await second).toBe("fresh");
      expect(seqs).toEqual([1, 2]);
    });

    it("a resync that never gets answered times out to null (degraded, never hung)", async () => {
      const { host, guest } = createLoopbackPair();
      new CoopBattleStreamer(host); // host installs no responder
      const guestStream = new CoopBattleStreamer(guest, {
        timeoutMs: 1,
        schedule: cb => {
          cb();
          return () => {};
        },
      });
      expect(await guestStream.requestStateSync(3)).toBeNull();
    });

    it("the owner's ME-boundary checksum reaches the watcher's handler (#633 Phase C)", async () => {
      const { host, guest } = createLoopbackPair();
      const ownerStream = new CoopBattleStreamer(host);
      const watcherStream = new CoopBattleStreamer(guest);

      let got: { seq: number; checksum: string } | null = null;
      watcherStream.onMeChecksum((seq, checksum) => {
        got = { seq, checksum };
      });
      ownerStream.sendMeChecksum(42, "cafebabecafebabe");
      await new Promise(r => setTimeout(r, 0));
      expect(got).toEqual({ seq: 42, checksum: "cafebabecafebabe" });
    });
  });

  describe("enemy-party handoff robustness (#633/#698 re-request + retry)", () => {
    it("a guest requestEnemyParty reaches the host's responder, which re-broadcasts the party", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Host responder: re-broadcast a fixed party for the requested wave (mirrors the
      // runtime responder, which serializes captureCoopEnemies() once the host has it).
      let sawRequest = -1;
      hostStream.onEnemyPartyRequest(wave => {
        sawRequest = wave;
        hostStream.sendEnemyParty(wave, [{ fieldIndex: 2, data: { speciesId: 296 } }]);
      });

      guestStream.requestEnemyParty(4);
      await new Promise(r => setTimeout(r, 0));
      expect(sawRequest).toBe(4);

      const enemies = guestStream.consumeEnemyParty(4);
      expect(enemies?.[0]?.data.speciesId).toBe(296);
    });

    it("awaitEnemyPartyWithRetry re-requests on the interval and resolves when the host answers a retry", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);

      // Drive the retry timer manually; the underlying long await never fires its ceiling here.
      const timers: (() => void)[] = [];
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          timers.push(cb);
          return () => {};
        },
      });

      // Host has NOT broadcast yet; it only answers a re-request (the lost-message case).
      const requests: number[] = [];
      hostStream.onEnemyPartyRequest(wave => {
        requests.push(wave);
        // Answer the SECOND request to prove the immediate replay request is followed by timed retry.
        if (requests.length === 2) {
          hostStream.sendEnemyParty(wave, [{ fieldIndex: 2, data: { speciesId: 307 } }]);
        }
      });

      const awaited = guestStream.awaitEnemyPartyWithRetry(4, w => guestStream.requestEnemyParty(w), {
        timeoutMs: 120_000,
        retryIntervalMs: 5_000,
        maxRetries: 6,
      });

      // The first request was sent immediately after parking. The first scheduled timer is the
      // underlying await's ceiling; the retry timer follows it.
      expect(timers.length).toBe(2); // [0] = ceiling, [1] = first retry
      await new Promise(r => setTimeout(r, 0));
      expect(requests).toEqual([4]);
      // Fire the first timed retry -> second request, which the host answers.
      timers[1]?.();
      const res = await awaited;
      expect(requests).toEqual([4, 4]);
      expect(res?.[0]?.data.speciesId).toBe(307);
    });

    it("replays the exact retained wave carrier after first-envelope loss", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x454e454d });
      const hostStream = new CoopBattleStreamer(pair.host);
      const guestStream = new CoopBattleStreamer(pair.guest);
      const state = emptyAuthoritativeState(9);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];

      pair.armNextDrop("enemyPartySync", "host");
      hostStream.sendEnemyParty(9, party, 44, 1, state);
      const received = await guestStream.awaitEnemyPartyWithRetry(9, wave => guestStream.requestEnemyParty(wave), {
        timeoutMs: 1_000,
        retryIntervalMs: 100,
        maxRetries: 1,
      });

      expect(pair.counters.host.oneShotDropped, "the first full wave carrier was actually lost").toBe(1);
      expect(received).toEqual(party);
      expect(guestStream.meTypeForWave(9), "the host ME verdict survives replay").toBe(44);
      expect(guestStream.battleTypeForWave(9), "the host battle type survives replay").toBe(1);
      expect(guestStream.consumeEnemyPartyState(9), "the complete wave boundary survives replay").toEqual(state);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("replays the complete encounter authority after first-envelope loss", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x454e4354 });
      const hostStream = new CoopBattleStreamer(pair.host);
      const guestStream = new CoopBattleStreamer(pair.guest);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];
      const encounter = {
        battleType: 1,
        mysteryEncounterType: -1,
        formatId: "double",
        enemyLevels: [40, 41],
        trainer: {
          trainerType: 12,
          variant: 2,
          partyTemplateIndex: 1,
          name: "Authority",
          partnerName: "Replay",
        },
      };

      pair.armNextDrop("enemyPartySync", "host");
      hostStream.sendEnemyParty(9, party, -1, 1, undefined, encounter);
      await guestStream.awaitEnemyPartyWithRetry(9, wave => guestStream.requestEnemyParty(wave), {
        timeoutMs: 1_000,
        retryIntervalMs: 100,
        maxRetries: 1,
      });

      expect(guestStream.consumeEnemyPartyEncounter(9)).toEqual(encounter);
      expect(guestStream.consumeEnemyPartyEncounter(9), "encounter authority is consumed atomically").toBeUndefined();

      hostStream.dispose();
      guestStream.dispose();
    });

    it("never downgrades a retained complete carrier to a party-only retry response", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);
      const party = [{ fieldIndex: 0, data: { speciesId: 307, level: 40 } }];
      const encounter = {
        battleType: 0,
        mysteryEncounterType: -1,
        formatId: "double",
        enemyLevels: [40, 40],
      };

      hostStream.sendEnemyParty(2, party, -1, 0, undefined, encounter);
      await new Promise(r => setTimeout(r, 0));
      // Model the obsolete CommandPhase/re-request responder attempting to replace the same wave with
      // a narrower carrier. The stream must retain and replay the complete EncounterPhase authority.
      hostStream.sendEnemyParty(2, party, undefined, 0);
      guestStream.consumeEnemyParty(2);
      guestStream.consumeEnemyPartyEncounter(2);
      guestStream.requestEnemyParty(2);
      await new Promise(r => setTimeout(r, 0));

      expect(guestStream.consumeEnemyParty(2)).toEqual(party);
      expect(guestStream.consumeEnemyPartyEncounter(2)).toEqual(encounter);

      hostStream.dispose();
      guestStream.dispose();
    });

    it("awaitEnemyPartyWithRetry resolves immediately from a party buffered BEFORE the await (no retry needed)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // The host's broadcast lands before the guest reaches its await -> consumed from the buffer.
      hostStream.sendEnemyParty(4, [{ fieldIndex: 2, data: { speciesId: 296 } }]);
      await new Promise(r => setTimeout(r, 0));

      let requested = false;
      const res = await guestStream.awaitEnemyPartyWithRetry(4, () => {
        requested = true;
      });
      expect(res?.[0]?.data.speciesId).toBe(296);
      expect(requested).toBe(false);
    });

    it("awaitEnemyPartyWithRetry resolves null after the ceiling so the production caller can fail closed", async () => {
      const { guest } = createLoopbackPair();
      // Every scheduled timer fires immediately: the retries re-request (no host), then the
      // ceiling-await also fires immediately -> null. Null never authorizes local enemy generation.
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          cb();
          return () => {};
        },
      });
      const res = await guestStream.awaitEnemyPartyWithRetry(4, () => {}, {
        timeoutMs: 1,
        retryIntervalMs: 1,
        maxRetries: 2,
      });
      expect(res).toBeNull();
    });

    it("a requestEnemyParty with no host responder is a safe no-op (does not throw)", async () => {
      const { host, guest } = createLoopbackPair();
      new CoopBattleStreamer(host); // host installs no responder
      const guestStream = new CoopBattleStreamer(guest);
      expect(() => guestStream.requestEnemyParty(4)).not.toThrow();
      await new Promise(r => setTimeout(r, 0));
    });
  });

  // Fix #1 (#633): the enemy-party stream carries each enemy's HELD ITEMS (serialized
  // ModifierData blobs) for TRAINER + wild waves, so the guest reconstructs the host's
  // exact items instead of rolling its own (which double / diverged the items). We assert
  // the held-item payload survives the wire AND a JSON round-trip (the real WebRTC transport
  // structured-clones / JSON-encodes), since that is the shape buildCoopEnemy reconstructs.
  describe("enemy held-item carry (#633 Fix #1)", () => {
    const heldItems = [
      { typeId: "LEFTOVERS", className: "TurnHealModifier", args: [999], stackCount: 1 },
      { typeId: "BERRY", className: "BerryModifier", args: [999], stackCount: 2, typePregenArgs: [4] },
    ];

    it("the host's serialized held items reach the guest verbatim", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      hostStream.sendEnemyParty(4, [{ fieldIndex: 0, data: { speciesId: 163, heldItems } }]);
      await new Promise(r => setTimeout(r, 0));

      const enemies = guestStream.consumeEnemyParty(4);
      const carried = enemies?.[0]?.data.heldItems as typeof heldItems | undefined;
      expect(carried).toBeDefined();
      expect(carried).toEqual(heldItems);
    });

    it("the held-item payload survives a JSON round-trip (real transport encoding)", () => {
      // buildCoopEnemy -> applyCoopEnemyHeldItems reconstructs `new ModifierData(blob, false)`
      // from exactly these plain fields, so the wire encoding must preserve them losslessly.
      const round = JSON.parse(JSON.stringify({ speciesId: 163, heldItems }));
      expect(round.heldItems).toEqual(heldItems);
      expect(round.heldItems[1].typePregenArgs).toEqual([4]);
    });
  });

  // #633 M4 push-snapshot launch: the host PUSHES the full session snapshot at launch and the guest
  // BOOTS from it, and the `requestEnemyParty` POLL is DELETED (the guest awaits the host's one-shot
  // push event-driven over the ordered/reliable channel). These engine-free tests pin the wire half:
  // the launchSnapshot round-trip (parked-waiter + race-buffer + timeout) and that awaitEnemyParty
  // emits ZERO re-request messages. (The full two-engine convergence proof is coop-duo-launch-snapshot.)
  describe("launch snapshot + poll deletion (#633 M4)", () => {
    const SESSION_JSON = JSON.stringify({ seed: "abc", waveIndex: 1, party: [], enemyParty: [] });

    it("the guest awaits the host's launchSnapshot PUSH when parked first (no poll)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // Guest reaches launch and parks BEFORE the host has generated (the realistic order).
      const awaited = guestStream.awaitLaunchSnapshot(1);
      hostStream.sendLaunchSnapshot(1, SESSION_JSON);

      expect(await awaited).toBe(SESSION_JSON);
    });

    it("the guest consumes a launchSnapshot that arrived BEFORE its await (race buffer)", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      hostStream.sendLaunchSnapshot(1, SESSION_JSON);
      await new Promise(r => setTimeout(r, 0)); // let it land in the guest buffer

      expect(await guestStream.awaitLaunchSnapshot(1)).toBe(SESSION_JSON);
    });

    it("a guest that missed the launchSnapshot re-requests the host's cached snapshot", async () => {
      const { host, guest } = createLoopbackPair();
      const hostStream = new CoopBattleStreamer(host);

      // The push lands before the guest streamer exists, reproducing a lost boundary frame.
      hostStream.sendLaunchSnapshot(1, SESSION_JSON);
      await new Promise(r => setTimeout(r, 0));
      const guestStream = new CoopBattleStreamer(guest);

      expect(await guestStream.awaitLaunchSnapshot(1)).toBe(SESSION_JSON);
    });

    it("awaitLaunchSnapshot resolves null on timeout (authoritative caller fails closed)", async () => {
      const { guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const guestStream = new CoopBattleStreamer(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const awaited = guestStream.awaitLaunchSnapshot(1, 5_000);
      timer.fire?.(); // fire the timeout
      expect(await awaited).toBeNull();
    });

    it("THE POLL IS GONE: awaitEnemyParty sends ZERO requestEnemyParty messages on the wire", async () => {
      const { host, guest } = createLoopbackPair();
      // Tap everything the GUEST endpoint sends toward the host (host receives it here).
      const hostSeen: string[] = [];
      host.onMessage(msg => hostSeen.push(msg.t));
      const hostStream = new CoopBattleStreamer(host);
      const guestStream = new CoopBattleStreamer(guest);

      // The M4 production path awaits event-driven (awaitEnemyParty), NOT the retry poll. Even with
      // a wait window elapsing before the host answers, the guest must NEVER re-request.
      const awaited = guestStream.awaitEnemyParty(3, 5_000);
      await new Promise(r => setTimeout(r, 0));
      hostStream.sendEnemyParty(3, [{ fieldIndex: 2, data: { speciesId: 1 } }]);
      const res = await awaited;

      expect(res?.[0]?.data.speciesId).toBe(1);
      expect(hostSeen, "the guest emitted NO requestEnemyParty (the poll is deleted)").not.toContain(
        "requestEnemyParty",
      );
    });
  });
});

describe("stale-turn finalize mark (#790 + regression fix)", () => {
  it("marks kill same-wave duplicates but NEVER survive the wave boundary (the live 'stuck after normal combat' regression)", () => {
    const { host } = createLoopbackPair();
    const stream = new CoopBattleStreamer(host);
    // Within a wave: once turn N finalized, N and below are stale, N+1 is live.
    stream.markTurnFinalized(1, 2);
    expect(stream.isTurnFinalized(1, 1), "earlier turn same wave is stale").toBe(true);
    expect(stream.isTurnFinalized(1, 2), "the finalized turn itself is stale").toBe(true);
    expect(stream.isTurnFinalized(1, 3), "the NEXT turn is live").toBe(false);
    // A different waveIndex never matches (the guard is wave-scoped).
    expect(stream.isTurnFinalized(2, 1), "another wave's turn 1 is live").toBe(false);
    // THE REGRESSION: the guest's waveIndex may not tick before the next wave's turn 1 replay
    // starts, so the wave boundary MUST clear the mark - otherwise (same stale waveIndex, turn 1)
    // reads as a duplicate and the new wave's first turn is killed in a loop.
    stream.clearFinalizedMark();
    expect(stream.isTurnFinalized(1, 1), "after the wave-boundary clear NOTHING is stale").toBe(false);
    expect(stream.isTurnFinalized(1, 2), "after the wave-boundary clear NOTHING is stale (finalized turn)").toBe(false);
  });
});
