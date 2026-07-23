/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op battle command relay (#633, LIVE-C). The host-authoritative partner
// command travels over the transport: the host offers the legal move slots and
// awaits the peer's pick; the SpoofGuest answers it in-process. This is the pure,
// engine-free core - verified over a LoopbackTransport (the exact "test it via
// spoofing" path) - that runs unchanged over the real WebRTC transport.

import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { getCoopCausalTrace, resetCoopCausalTrace } from "#data/elite-redux/coop/coop-causal-trace";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import type { CoopBattleCommandOffer } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { CoopFlapTransport } from "#test/tools/coop-flap-transport";
import { describe, expect, it } from "vitest";

describe("co-op battle command relay (#633, LIVE-C)", () => {
  const legalOffer: CoopBattleCommandOffer = {
    moves: [
      {
        slot: 1,
        moveId: 55,
        targetSets: [[2], [3]],
        targetRefSets: [[{ side: "enemy", pokemonId: 200 }], [{ side: "enemy", pokemonId: 300 }]],
        canTera: false,
      },
    ],
    switches: [{ slot: 4, canNormal: true, canBaton: false }],
    ballTypes: [0],
    ballTargets: [2],
    ballTargetRefs: [{ side: "enemy", pokemonId: 200 }],
    canRun: false,
  };

  it("host requests a command; the peer's chosen slot comes back over the transport", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    // The peer picks the SECOND offered slot - proving the host receives the
    // peer's actual choice, not a local guess.
    guestSync.onCommandRequest(({ moveSlots }) => ({ command: Command.FIGHT, cursor: moveSlots[1] }));

    const cmd = await hostSync.requestPartnerCommand(1, 3, [0, 2]);
    expect(cmd).not.toBeNull();
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // moveSlots[1]
  });

  it("records one canonical command lifecycle from legal offer through authoritative apply", async () => {
    resetCoopCausalTrace();
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    const address = { epoch: 42, wave: 7, pokemonId: 9001 };

    const awaited = hostSync.requestPartnerCommand(1, 3, [1], "guest", legalOffer, address);
    guestSync.broadcastLocalCommand(
      1,
      3,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      address,
    );
    await expect(awaited).resolves.toMatchObject({ command: Command.FIGHT, moveId: 55 });

    const commandEvents = getCoopCausalTrace().filter(event => event.domain === "command");
    expect(new Set(commandEvents.map(event => event.causalId))).toEqual(new Set(["e42:w7:t3:guest:p9001"]));
    // The local human may commit before the queued offer frame arrives; that eager intent is retained and
    // applied first. Observing the late offer then replays the retained command, which the authoritative
    // side correctly classifies as a duplicate. Preserve that complete real transport lifecycle.
    expect(commandEvents.map(event => event.stage)).toEqual([
      "offer-sent",
      "intent-sent",
      "offer-received",
      "applied",
      "duplicate",
    ]);
  });

  it("a request with no responding peer resolves null (caller -> AI fallback)", async () => {
    const { host } = createLoopbackPair();
    // Fire the timeout immediately (no peer responder installed).
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    const cmd = await hostSync.requestPartnerCommand(1, 0, [0, 1]);
    expect(cmd).toBeNull();
  });

  it("fences an exact command timeout before its null continuation can choose AI", async () => {
    const { host } = createLoopbackPair();
    let expire: (() => void) | null = null;
    const observed: unknown[] = [];
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 25,
      schedule: cb => {
        expire = cb;
        return () => {
          expire = null;
        };
      },
      onCommandTimeout: timeout => {
        observed.push({ timeout, frozenInsideCallback: hostSync.isTerminalFrozen() });
      },
    });
    const awaited = hostSync.requestPartnerCommand(1, 9, [0, 1], "guest", legalOffer, {
      epoch: 71,
      wave: 20,
      pokemonId: 8080,
    });
    let frozenAtContinuation = false;
    const continued = awaited.then(command => {
      frozenAtContinuation = hostSync.isTerminalFrozen();
      return command;
    });

    expect(expire).not.toBeNull();
    expire!();
    await expect(continued).resolves.toBeNull();
    expect(observed).toEqual([
      {
        timeout: {
          epoch: 71,
          wave: 20,
          turn: 9,
          owner: "guest",
          pokemonId: 8080,
          fieldIndex: 1,
        },
        frozenInsideCallback: true,
      },
    ]);
    expect(frozenAtContinuation).toBe(true);
    expect(hostSync.isTerminalFrozen()).toBe(true);
    await expect(
      hostSync.requestPartnerCommand(1, 10, [0], "guest", legalOffer, {
        epoch: 71,
        wave: 20,
        pokemonId: 8080,
      }),
    ).resolves.toBeNull();
    hostSync.dispose();
  });

  it("the SpoofGuest answers the host's request end-to-end (loopback)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    // A real SpoofGuest binds its own responder over the guest endpoint; it picks
    // the FIRST offered slot (it has no engine - the host did the legality work).
    new SpoofGuest(guest);

    const cmd = await hostSync.requestPartnerCommand(1, 0, [2, 3]);
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // the first offered slot
  });

  it("broadcastLocalCommand resolves the PEER's awaiting partner-command (lockstep, #633, LIVE-C)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // LOCKSTEP: the HOST awaits the partner's slot 1 (the guest's own slot). The
    // GUEST, instead of answering a request, BROADCASTS its own pick for slot 1.
    // That `command` message matches the host's pending request by fieldIndex and
    // resolves it with the exact move the human chose - no AI fallback.
    const awaited = hostSync.requestPartnerCommand(1, 0, [0, 1, 2]);
    guestSync.broadcastLocalCommand(1, 0, { command: Command.FIGHT, cursor: 2, moveId: 999, targets: [2] });

    const cmd = await awaited;
    expect(cmd).not.toBeNull();
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // the human's actual pick crossed the wire
    expect(cmd?.moveId).toBe(999);
  });

  it("a command broadcast BEFORE the request is buffered and resolves the later await (race fix, #633)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // The peer is FASTER: it broadcasts its slot-1 move before this client has
    // even reached that slot's await. Without buffering this dropped -> the host
    // timed out 30s -> AI (the live "stuck then desync" bug). Now it's buffered.
    guestSync.broadcastLocalCommand(1, 0, { command: Command.FIGHT, cursor: 3, moveId: 42 });
    await new Promise(r => setTimeout(r, 0)); // let the broadcast land in the host inbox

    const cmd = await hostSync.requestPartnerCommand(1, 0, [0, 1, 2, 3]);
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(3); // the buffered pick, not an AI fallback
    expect(cmd?.moveId).toBe(42);
  });

  it("never lets a same-turn buffered command for another Pokemon satisfy the exact waiter", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);
    const guestAddress = { epoch: 17, wave: 1, pokemonId: 111 };
    const hostAddress = { epoch: 17, wave: 1, pokemonId: 999 };

    guestSync.broadcastLocalCommand(
      1,
      1,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      guestAddress,
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    await expect(hostSync.requestPartnerCommand(1, 1, [1], "guest", legalOffer, hostAddress)).resolves.toBeNull();
    expect(hostSync.isTerminalFrozen(), "an actor-id mismatch exhausts the bounded exact wait fail-closed").toBe(true);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("replays a retained local command only for an exact actor address after a dropped first send", async () => {
    const pair = createLoopbackPair();
    const guestWire = new CoopFlapTransport(pair.guest);
    const guestSync = new CoopBattleSync(guestWire);
    const guestAddress = { epoch: 23, wave: 1, pokemonId: 321 };
    const staleAddress = { epoch: 23, wave: 1, pokemonId: 654 };

    guestWire.setConnected(false);
    guestSync.broadcastLocalCommand(
      1,
      1,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      guestAddress,
    );
    guestWire.setConnected(true);

    const replies: Extract<Parameters<typeof pair.host.send>[0], { t: "command" }>[] = [];
    const off = pair.host.onMessage(message => {
      if (message.t === "command") {
        replies.push(message);
      }
    });
    pair.host.send({
      t: "commandRequest",
      fieldIndex: 1,
      turn: 1,
      moveSlots: [1],
      offer: legalOffer,
      owner: "guest",
      ...staleAddress,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replies, "a stale actor address cannot consume or replay the retained intent").toEqual([]);

    pair.host.send({
      t: "commandRequest",
      fieldIndex: 1,
      turn: 1,
      moveSlots: [1],
      offer: legalOffer,
      owner: "guest",
      ...guestAddress,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      epoch: 23,
      wave: 1,
      pokemonId: 321,
      command: { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
    });
    off();
    guestSync.dispose();
  });

  it("never lets a live command for another Pokemon resolve an already-waiting exact request", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);
    const awaited = hostSync.requestPartnerCommand(1, 1, [1], "guest", legalOffer, {
      epoch: 31,
      wave: 1,
      pokemonId: 700,
    });

    guestSync.broadcastLocalCommand(1, 1, { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] }, "guest", {
      epoch: 31,
      wave: 1,
      pokemonId: 701,
    });

    await expect(awaited).resolves.toBeNull();
    expect(hostSync.isTerminalFrozen(), "wrong-actor live traffic cannot advance the current command surface").toBe(
      true,
    );
    hostSync.dispose();
    guestSync.dispose();
  });

  it("keeps an exact retained intent after a stale actor-address rejection", async () => {
    const pair = createLoopbackPair();
    // Model an actual post-construction loss window. Frames before the first-ever
    // subscription are now intentionally retained for controller construction races.
    const closeInitialHostSubscription = pair.host.onMessage(() => {});
    closeInitialHostSubscription();
    const guestSync = new CoopBattleSync(pair.guest);
    const currentAddress = { epoch: 37, wave: 4, pokemonId: 700 };
    guestSync.broadcastLocalCommand(
      1,
      3,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      currentAddress,
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    const replies: Extract<Parameters<typeof pair.host.send>[0], { t: "command" }>[] = [];
    const off = pair.host.onMessage(message => {
      if (message.t === "command") {
        replies.push(message);
      }
    });
    pair.host.send({
      t: "commandRejected",
      fieldIndex: 1,
      turn: 3,
      reason: "stale actor mutation",
      owner: "guest",
      epoch: 37,
      wave: 4,
      pokemonId: 701,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    pair.host.send({
      t: "commandRequest",
      fieldIndex: 1,
      turn: 3,
      moveSlots: [1],
      offer: legalOffer,
      owner: "guest",
      ...currentAddress,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(replies, "wrong-address rejection cannot delete the current actor's retained commit").toHaveLength(1);
    expect(replies[0]).toMatchObject({ pokemonId: 700, command: { moveId: 55, targets: [2] } });
    off();
    guestSync.dispose();
  });

  it("refuses to guess when multiple entity-id-skewed commands occupy the same logical slot", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);
    const first = { epoch: 41, wave: 1, pokemonId: 801 };
    const second = { epoch: 41, wave: 1, pokemonId: 802 };

    guestSync.broadcastLocalCommand(1, 1, { command: Command.FIGHT, cursor: 1, moveId: 55 }, "guest", first);
    guestSync.broadcastLocalCommand(1, 1, { command: Command.POKEMON, cursor: 4 }, "guest", second);
    await new Promise(resolve => setTimeout(resolve, 0));

    await expect(
      hostSync.requestPartnerCommand(1, 1, [1], "guest", legalOffer, { epoch: 41, wave: 1, pokemonId: 999 }),
    ).resolves.toBeNull();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("broadcastLocalCommand for a DIFFERENT slot does not resolve an await on another slot", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);

    // Host awaits slot 1; the guest broadcasts a command for slot 0. Matching is by
    // fieldIndex, so slot 1's await is untouched and falls through to the timeout
    // (null -> the caller's AI fallback).
    const awaited = hostSync.requestPartnerCommand(1, 0, [0]);
    guestSync.broadcastLocalCommand(0, 0, { command: Command.FIGHT, cursor: 0 });

    const cmd = await awaited;
    expect(cmd).toBeNull();
  });

  it("a fast peer that broadcasts turn N then N+1 does NOT clobber turn N's command (desync fix, #633)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // The peer races ahead and broadcasts BOTH this turn's and the next turn's command
    // for slot 1 before the host reaches the await. A fieldIndex-only latest-wins inbox
    // kept only the LAST (turn 6) and handed it to the host's turn-5 await -> one client
    // acted a turn out of step = the live move/switch/target desync. Turn-keying keeps
    // each turn's command separate so the right one resolves the right await.
    guestSync.broadcastLocalCommand(1, 5, { command: Command.FIGHT, cursor: 1, moveId: 50, targets: [2] });
    guestSync.broadcastLocalCommand(1, 6, { command: Command.FIGHT, cursor: 2, moveId: 60, targets: [3] });
    await new Promise(r => setTimeout(r, 0)); // both land in the host inbox

    // The await for turn 5 gets turn 5's command (move 50 / target [2]), NOT turn 6's.
    const t5 = await hostSync.requestPartnerCommand(1, 5, [0, 1, 2]);
    expect(t5?.moveId).toBe(50);
    expect(t5?.cursor).toBe(1);
    expect(t5?.targets).toEqual([2]);

    // ...and turn 6's command is still there for turn 6's await (not pruned as "stale").
    const t6 = await hostSync.requestPartnerCommand(1, 6, [0, 1, 2]);
    expect(t6?.moveId).toBe(60);
    expect(t6?.cursor).toBe(2);
    expect(t6?.targets).toEqual([3]);
  });

  it("a superseding request for the same slot resolves the stale one null", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.onCommandRequest(({ moveSlots }) => ({ command: Command.FIGHT, cursor: moveSlots[0] }));

    const first = hostSync.requestPartnerCommand(1, 0, [0]);
    const second = hostSync.requestPartnerCommand(1, 1, [1]);
    // The first is superseded immediately (resolves null); the second still gets a
    // valid command back over the wire (matching is by slot, so we don't assert
    // WHICH reply lands - only that the stale request is cleared and a real one wins).
    expect(await first).toBeNull();
    const secondCmd = await second;
    expect(secondCmd).not.toBeNull();
    expect(secondCmd?.command).toBe(Command.FIGHT);
  });

  it("hot rejoin reissues the exact unresolved legal-action offer instead of AI-falling back", async () => {
    const pair = createLoopbackPair();
    const hostWire = new CoopFlapTransport(pair.host);
    const hostSync = new CoopBattleSync(hostWire);
    const guestSync = new CoopBattleSync(pair.guest);
    guestSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots[1],
      moveId: 777,
    }));

    hostWire.setConnected(false);
    const awaited = hostSync.requestPartnerCommand(1, 9, [0, 3], "guest");
    expect(hostSync.describePendingRequests()).toEqual([{ fieldIndex: 1, turn: 9, moveSlots: [0, 3], owner: "guest" }]);

    hostWire.setConnected(true);
    const command = await awaited;
    expect(command).toMatchObject({ command: Command.FIGHT, cursor: 3, moveId: 777 });
    expect(hostSync.describePendingRequests()).toEqual([]);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("snapshot recovery replays the retained local command only at the exact epoch/wave/entity address", async () => {
    const { host, guest } = createLoopbackPair();
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true);
    const address = { epoch: 61, wave: 10, pokemonId: 404 };
    const received: Array<{ epoch?: number | undefined; wave?: number | undefined; pokemonId?: number | undefined }> =
      [];
    const off = host.onMessage(message => {
      if (message.t === "command") {
        received.push({ epoch: message.epoch, wave: message.wave, pokemonId: message.pokemonId });
      }
    });
    guestSync.broadcastLocalCommand(
      1,
      3,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      address,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    received.length = 0;

    expect(
      guestSync.restorePeerPendingRequests(
        [{ fieldIndex: 1, turn: 3, moveSlots: [1], offer: legalOffer, owner: "guest", address }],
        61,
        10,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toEqual([{ epoch: 61, wave: 10, pokemonId: 404 }]);

    expect(
      guestSync.restorePeerPendingRequests(
        [
          {
            fieldIndex: 1,
            turn: 3,
            moveSlots: [1],
            offer: legalOffer,
            owner: "guest",
            address: { ...address, epoch: 60 },
          },
        ],
        61,
        10,
      ),
    ).toBe(false);
    expect(
      guestSync.restorePeerPendingRequests(
        [{ fieldIndex: 1, turn: 3, moveSlots: [1], offer: legalOffer, owner: "host", address }],
        61,
        10,
      ),
    ).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received, "stale/foreign surfaces must not emit another command").toHaveLength(1);
    off();
    guestSync.dispose();
  });

  it("snapshot recovery buffers an exact addressed request until the public command responder opens", async () => {
    const { host, guest } = createLoopbackPair();
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true);
    const received: CoopBattleCommandOffer[] = [];
    const commands: number[] = [];
    const off = host.onMessage(message => {
      if (message.t === "command") {
        commands.push(message.command.cursor);
      }
    });
    const address = { epoch: 62, wave: 20, pokemonId: 505 };

    expect(
      guestSync.restorePeerPendingRequests(
        [{ fieldIndex: 1, turn: 4, moveSlots: [1], offer: legalOffer, owner: "guest", address }],
        62,
        20,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(commands).toEqual([]);

    guestSync.onCommandRequest(request => {
      if (request.offer != null) {
        received.push(request.offer);
      }
      return { command: Command.FIGHT, cursor: request.moveSlots[0] };
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toEqual([legalOffer]);
    expect(commands).toEqual([1]);
    off();
    guestSync.dispose();
  });

  it("keeps two same-owner active Pokemon on distinct epoch/wave/entity command addresses", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    const firstAddress = { epoch: 7, wave: 20, pokemonId: 101 };
    const secondAddress = { epoch: 7, wave: 20, pokemonId: 202 };

    const first = hostSync.requestPartnerCommand(0, 3, [1], "guest", legalOffer, firstAddress);
    const second = hostSync.requestPartnerCommand(2, 3, [1], "guest", legalOffer, secondAddress);
    guestSync.broadcastLocalCommand(
      0,
      3,
      { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
      "guest",
      firstAddress,
    );
    guestSync.broadcastLocalCommand(2, 3, { command: Command.POKEMON, cursor: 4 }, "guest", secondAddress);

    await expect(first).resolves.toMatchObject({ command: Command.FIGHT, moveId: 55 });
    await expect(second).resolves.toMatchObject({ command: Command.POKEMON, cursor: 4 });
    hostSync.dispose();
    guestSync.dispose();
  });

  it("buffers same-turn seat/entity commands independently and never lets a stale epoch unblock the live actor", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const firstAddress = { epoch: 8, wave: 3, pokemonId: 101 };
    const secondAddress = { epoch: 8, wave: 3, pokemonId: 202 };

    guest.send({
      t: "command",
      fieldIndex: 0,
      turn: 5,
      owner: "host",
      ...firstAddress,
      command: { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
    });
    guest.send({
      t: "command",
      fieldIndex: 0,
      turn: 5,
      owner: "guest",
      ...secondAddress,
      command: { command: Command.POKEMON, cursor: 4 },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    await expect(hostSync.requestPartnerCommand(0, 5, [1], "host", undefined, firstAddress)).resolves.toMatchObject({
      command: Command.FIGHT,
      moveId: 55,
    });
    await expect(hostSync.requestPartnerCommand(0, 5, [1], "guest", undefined, secondAddress)).resolves.toMatchObject({
      command: Command.POKEMON,
      cursor: 4,
    });

    const currentAddress = { epoch: 9, wave: 3, pokemonId: 303 };
    guest.send({
      t: "command",
      fieldIndex: 1,
      turn: 5,
      owner: "guest",
      epoch: 8,
      wave: 3,
      pokemonId: 303,
      command: { command: Command.FIGHT, cursor: 0, moveId: 44, targets: [2] },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    let settled = false;
    const current = hostSync.requestPartnerCommand(1, 5, [1], "guest", legalOffer, currentAddress).then(command => {
      settled = true;
      return command;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled, "same wave/turn/entity from a stale epoch cannot satisfy the current exact wait").toBe(false);

    guest.send({
      t: "command",
      fieldIndex: 1,
      turn: 5,
      owner: "guest",
      ...currentAddress,
      command: { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] },
    });
    await expect(current).resolves.toMatchObject({ command: Command.FIGHT, moveId: 55 });
    hostSync.dispose();
  });

  it("rejects a live illegal reply and immediately commits the host-authored legal default", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    let requests = 0;
    let rejections = 0;
    const off = guest.onMessage(message => {
      if (message.t === "commandRequest") {
        requests++;
      } else if (message.t === "commandRejected") {
        rejections++;
      }
    });
    const awaited = hostSync.requestPartnerCommand(1, 4, [1], "guest", legalOffer);

    guestSync.broadcastLocalCommand(1, 4, { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [99] }, "guest");
    expect(await awaited).toMatchObject({ command: Command.FIGHT, moveId: 55, targets: [2] });
    expect(hostSync.describePendingRequests()).toHaveLength(0);
    expect(requests, "an invalid deterministic responder cannot create a request/reply recursion").toBe(1);
    expect(rejections).toBe(1);
    off();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("rejects an illegal pre-wait buffer and resolves with the authoritative default", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.broadcastLocalCommand(1, 5, { command: Command.POKEMON, cursor: 0 }, "guest");
    await new Promise(resolve => setTimeout(resolve, 0));

    const awaited = hostSync.requestPartnerCommand(1, 5, [1], "guest", legalOffer);
    expect(await awaited).toMatchObject({ command: Command.FIGHT, cursor: 1, moveId: 55, targets: [2] });
    hostSync.dispose();
    guestSync.dispose();
  });

  it("repairs a stale local battler index only when the host offer has one unambiguous target set", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    const soleTargetOffer: CoopBattleCommandOffer = {
      ...legalOffer,
      moves: [
        {
          slot: 1,
          moveId: 55,
          targetSets: [[2]],
          targetRefSets: [[{ side: "enemy", pokemonId: 200 }]],
          canTera: false,
        },
      ],
    };

    let rejections = 0;
    const off = guest.onMessage(message => {
      if (message.t === "commandRejected") {
        rejections++;
      }
    });
    // This is the exact fast-UI race: the move auto-submits before the request/offer arrives and the local
    // renderer has no numeric target. The later single-set offer makes the missing geometry unambiguous.
    guestSync.broadcastLocalCommand(1, 8, { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [] }, "guest");
    await new Promise(resolve => setTimeout(resolve, 0));
    const command = await hostSync.requestPartnerCommand(1, 8, [1], "guest", soleTargetOffer);

    expect(command).toMatchObject({ moveId: 55, targets: [2] });
    expect(rejections, "the legal implicit target is normalized before validation, not rejected/defaulted").toBe(0);
    off();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("repairs the same implicit target when the authority waiter already exists", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    const soleTargetOffer: CoopBattleCommandOffer = {
      ...legalOffer,
      moves: [
        {
          slot: 1,
          moveId: 55,
          targetSets: [[2]],
          targetRefSets: [[{ side: "enemy", pokemonId: 200 }]],
          canTera: false,
        },
      ],
    };
    let rejections = 0;
    const off = guest.onMessage(message => {
      if (message.t === "commandRejected") {
        rejections++;
      }
    });

    const command = hostSync.requestPartnerCommand(1, 9, [1], "guest", soleTargetOffer);
    guestSync.broadcastLocalCommand(1, 9, { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [] }, "guest");

    await expect(command).resolves.toMatchObject({ moveId: 55, targets: [2] });
    expect(rejections, "the live waiter also accepts the sole offered target without a rejection round-trip").toBe(0);
    off();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("maps an ambiguous local battler index through stable side plus Pokemon identity", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.broadcastLocalCommand(
      1,
      9,
      {
        command: Command.FIGHT,
        cursor: 1,
        moveId: 55,
        targets: [-1],
        targetRefs: [{ side: "enemy", pokemonId: 300 }],
      },
      "guest",
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    const command = await hostSync.requestPartnerCommand(1, 9, [1], "guest", legalOffer);
    expect(command).toMatchObject({ moveId: 55, targets: [3], targetRefs: [{ side: "enemy", pokemonId: 300 }] });
    hostSync.dispose();
    guestSync.dispose();
  });

  it.each([
    { command: Command.POKEMON, cursor: 4, targets: [], baton: false },
    { command: Command.RUN, cursor: 0, targets: [] },
  ])("normalizes the former production $command wire shape by removing irrelevant targets", async raw => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.broadcastLocalCommand(1, 12, raw, "guest");
    await new Promise(resolve => setTimeout(resolve, 0));

    const command = await hostSync.requestPartnerCommand(1, 12, [1], "guest", {
      ...legalOffer,
      canRun: raw.command === Command.RUN,
    });
    expect(command).toMatchObject({ command: raw.command, cursor: raw.cursor });
    expect(command).not.toHaveProperty("targets");
    hostSync.dispose();
    guestSync.dispose();
  });

  it("retains the local committed pick and replays it when both sides reconnect", async () => {
    const pair = createLoopbackPair();
    const hostWire = new CoopFlapTransport(pair.host);
    const guestWire = new CoopFlapTransport(pair.guest);
    const hostSync = new CoopBattleSync(hostWire);
    const guestSync = new CoopBattleSync(guestWire);
    hostWire.setConnected(false);
    guestWire.setConnected(false);

    guestSync.broadcastLocalCommand(1, 6, { command: Command.FIGHT, cursor: 1, moveId: 55, targets: [3] }, "guest");
    const awaited = hostSync.requestPartnerCommand(1, 6, [1], "guest", legalOffer);
    guestWire.setConnected(true);
    hostWire.setConnected(true);

    expect(await awaited).toMatchObject({ moveId: 55, targets: [3] });
    hostSync.dispose();
    guestSync.dispose();
  });
});

describe("#812: pre-responder commandRequest buffering (the 'wrong move / didn't wait' live fix)", () => {
  it("an OWN-slot request arriving before the responder installs is BUFFERED and answered on install", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true); // the slot is ours - responder is coming

    // Host asks while the guest has NO responder yet (mid-replay in production).
    const reply = hostSync.requestPartnerCommand(1, 3, [1, 2, 3, 4]);
    await new Promise(r => setTimeout(r, 10));

    // The responder installs late (replay finished) - the buffered request must be answered.
    guestSync.onCommandRequest(() => ({ command: 1, cursor: 2, moveId: 55 }) as never);
    const res = await reply;
    expect(res, "the REAL pick answered the buffered request (no decline, no AI)").not.toBeNull();
    expect((res as { moveId?: number }).moveId).toBe(55);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("an unaddressed FOREIGN-slot request retains the legacy immediate decline fallback", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => false); // both clients think the slot is the other's

    const res = await hostSync.requestPartnerCommand(0, 1, [1]);
    expect(res, "declined -> null -> host AI fallback (deadlock broken)").toBeNull();
    expect(hostSync.isTerminalFrozen()).toBe(false);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("uses the addressed owner instead of a stale field-index probe after host recenter", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    // Reproduce the real turn-2 window: host compacted the guest mon to field 0, while the guest's
    // previous-turn replay still sees field 0 as host-owned. The old probe falsely DECLINED here.
    guestSync.setSlotOwnershipProbe(() => false);
    const address = { epoch: 23, wave: 1, pokemonId: 707 };

    const awaited = hostSync.requestPartnerCommand(0, 2, [0, 1, 2, 3], "guest", undefined, address);
    // Production has no responder. Once replay reaches the real picker, its independent owner-keyed
    // broadcast may use the guest's still-unreconciled field index and must satisfy the retained await.
    guestSync.broadcastLocalCommand(
      1,
      2,
      { command: Command.FIGHT, cursor: 0, moveId: 22, targets: [2] },
      "guest",
      address,
    );

    await expect(awaited).resolves.toMatchObject({ moveId: 22, targets: [2] });
    hostSync.dispose();
    guestSync.dispose();
  });

  it("fences an addressed ownership decline before its null continuation can choose AI", async () => {
    const { host, guest } = createLoopbackPair();
    const observed: unknown[] = [];
    let hostSync: CoopBattleSync;
    hostSync = new CoopBattleSync(host, {
      onCommandTimeout: timeout => {
        observed.push({ timeout, frozenInsideCallback: hostSync.isTerminalFrozen() });
      },
    });
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true);
    let frozenAtContinuation = false;

    const continued = hostSync
      .requestPartnerCommand(0, 2, [0], "host", undefined, {
        epoch: 24,
        wave: 1,
        pokemonId: 808,
      })
      .then(command => {
        frozenAtContinuation = hostSync.isTerminalFrozen();
        return command;
      });

    await expect(continued).resolves.toBeNull();
    expect(observed).toEqual([
      {
        timeout: {
          epoch: 24,
          wave: 1,
          turn: 2,
          owner: "host",
          pokemonId: 808,
          fieldIndex: 0,
        },
        frozenInsideCallback: true,
      },
    ]);
    expect(frozenAtContinuation).toBe(true);
    expect(hostSync.isTerminalFrozen()).toBe(true);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("answers only the newest full-address request when a delayed prior-wave frame arrives before the UI", async () => {
    const { host, guest } = createLoopbackPair();
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true);
    const replies: Extract<Parameters<typeof host.send>[0], { t: "command" }>[] = [];
    const off = host.onMessage(message => {
      if (message.t === "command") {
        replies.push(message);
      }
    });
    const oldRequest = {
      t: "commandRequest" as const,
      fieldIndex: 1,
      turn: 1,
      moveSlots: [0],
      owner: "guest" as const,
      epoch: 17,
      wave: 9,
      pokemonId: 101,
    };
    const currentRequest = { ...oldRequest, wave: 10, pokemonId: 202 };

    host.send(oldRequest);
    await new Promise(resolve => setTimeout(resolve, 0));
    host.send(currentRequest);
    await new Promise(resolve => setTimeout(resolve, 0));
    host.send(oldRequest); // reordered retransmission from the obsolete wave
    await new Promise(resolve => setTimeout(resolve, 0));

    guestSync.onCommandRequest(() => ({ command: Command.FIGHT, cursor: 0, moveId: 55 }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(replies, "the reopened command UI must never answer the obsolete buffered boundary").toHaveLength(1);
    expect(replies[0]).toMatchObject({ epoch: 17, wave: 10, turn: 1, pokemonId: 202, owner: "guest" });
    off();
    guestSync.dispose();
  });

  it("retains distinct same-boundary active slots while pruning obsolete command boundaries", async () => {
    const { host, guest } = createLoopbackPair();
    const guestSync = new CoopBattleSync(guest);
    guestSync.setSlotOwnershipProbe(() => true);
    const replyFields: number[] = [];
    const off = host.onMessage(message => {
      if (message.t === "command") {
        replyFields.push(message.fieldIndex);
      }
    });

    for (const [fieldIndex, pokemonId] of [
      [0, 301],
      [2, 302],
    ] as const) {
      host.send({
        t: "commandRequest",
        fieldIndex,
        turn: 4,
        moveSlots: [0],
        owner: "guest",
        epoch: 19,
        wave: 20,
        pokemonId,
      });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    guestSync.onCommandRequest(() => ({ command: Command.FIGHT, cursor: 0, moveId: 55 }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(replyFields.sort((left, right) => left - right)).toEqual([0, 2]);
    off();
    guestSync.dispose();
  });
});

describe("#851: OWNER-keyed relay survives a post-half-wipe field-index skew", () => {
  // The REAL #851: after a HOST-half-wipe recenter + party compaction (host-only), the surviving
  // GUEST mon sits at field index 0 on the HOST (compacted) but is still at index 1 on the GUEST
  // (its checkpoint reconcile lags a beat). In production the guest never installs a responder - the
  // host's requestPartnerCommand is matched ONLY against the guest's independent broadcastLocalCommand.
  // With the LEGACY fieldIndex key (`wave:0:turn` vs `wave:1:turn`) the two never match, the request
  // eats the 20-min timeout, and the AI plays the survivor's move alone (the live long-stall UX). The
  // owner ("guest") is INVARIANT across that index skew, so keying by owner matches despite the skew.

  it("FAILS-BEFORE model: divergent field indexes with NO owner never match -> the request times out (null)", async () => {
    const { host, guest } = createLoopbackPair();
    // Short, self-firing timeout so the never-matching request resolves promptly for the assertion.
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);

    // HOST awaits the survivor at its COMPACTED index 0; the GUEST broadcasts the SAME mon at its
    // un-reconciled index 1. No owner is stamped (the pre-fix behavior), so the keys are `wave:0` vs
    // `wave:1` and never meet. This is the 20-min-stall root cause, reproduced as a prompt timeout.
    const awaited = hostSync.requestPartnerCommand(0, 7, [0, 1, 2]);
    guestSync.broadcastLocalCommand(1, 7, { command: Command.FIGHT, cursor: 2, moveId: 777, targets: [2] });

    expect(await awaited, "fieldIndex-keyed relay CANNOT match the skewed indexes -> null (the stall)").toBeNull();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("PASSES-AFTER: stamping the OWNER matches the skewed indexes; EXACTLY ONE command is consumed", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // Count the `command` messages the HOST endpoint receives - the guest broadcasts exactly one.
    let commandsReceived = 0;
    const off = host.onMessage(msg => {
      if (msg.t === "command") {
        commandsReceived++;
      }
    });

    // HOST awaits the survivor at COMPACTED index 0, owner "guest"; GUEST broadcasts the SAME mon at
    // its un-reconciled index 1, owner "guest". Divergent field indexes, IDENTICAL owner -> the owner
    // key `wave:guest:turn` matches on both sides, so the human's actual pick crosses the wire.
    const awaited = hostSync.requestPartnerCommand(0, 7, [0, 1, 2], "guest");
    guestSync.broadcastLocalCommand(1, 7, { command: Command.FIGHT, cursor: 2, moveId: 777, targets: [2] }, "guest");

    const cmd = await awaited;
    expect(cmd, "the owner key matched despite the index skew (no timeout, no AI)").not.toBeNull();
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2);
    expect(cmd?.moveId).toBe(777); // the human's actual pick, not an AI fallback
    expect(cmd?.targets).toEqual([2]);
    // Let reconnect replay duplicates settle. The relay may carry the retained pick twice (initial
    // broadcast + request replay), but the host's settled-address ledger consumes it exactly once.
    await new Promise(r => setTimeout(r, 0));
    expect(commandsReceived, "at least one human command crossed the owner-keyed wire").toBeGreaterThanOrEqual(1);

    off();
    hostSync.dispose();
    guestSync.dispose();
  });

  it("owner keying is symmetric: the guest awaiting the HOST's mon matches across the same skew", async () => {
    // The reciprocal direction (each client awaits the PARTNER slot in lockstep): the GUEST awaits the
    // host's mon by owner "host", the HOST broadcasts its own mon by owner "host" - matched across a
    // divergent index exactly the same way, so a live double never strands either partner-await.
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    const awaited = guestSync.requestPartnerCommand(1, 4, [0, 1], "host");
    hostSync.broadcastLocalCommand(0, 4, { command: Command.FIGHT, cursor: 1, moveId: 88 }, "host");

    const cmd = await awaited;
    expect(cmd?.moveId).toBe(88);
    expect(cmd?.cursor).toBe(1);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("a buffered owner-keyed broadcast that lands BEFORE the request still resolves it (race + owner)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // The guest is faster: it broadcasts (owner "guest", index 1) before the host reaches its await
    // for the survivor at compacted index 0. The buffer is owner-keyed, so the later request consumes it.
    guestSync.broadcastLocalCommand(1, 9, { command: Command.FIGHT, cursor: 0, moveId: 3 }, "guest");
    await new Promise(r => setTimeout(r, 0)); // let it land in the host inbox (owner-keyed)

    const cmd = await hostSync.requestPartnerCommand(0, 9, [0, 1], "guest");
    expect(cmd?.moveId).toBe(3);
    hostSync.dispose();
    guestSync.dispose();
  });

  it("the responder (SpoofGuest) path also echoes the owner so its reply matches the owner key", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    // The dev/spoof responder path (not production, but must not regress): it answers by owner too.
    guestSync.onCommandRequest(({ moveSlots }) => ({ command: Command.FIGHT, cursor: moveSlots[0], moveId: 123 }));

    const cmd = await hostSync.requestPartnerCommand(0, 2, [4, 5], "guest");
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(4);
    expect(cmd?.moveId).toBe(123);
    hostSync.dispose();
    guestSync.dispose();
  });
});
