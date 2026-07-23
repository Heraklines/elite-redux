/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 ENEMY-COMMAND relay (C4). Engine-free over a LoopbackTransport pair:
// the host requests the enemy-side command for a turn; the remote peer answers (or ships
// unprompted); out-of-order buffering by turn; a turn-timer timeout resolves null (AI
// fallback signal); dispose cancels an in-flight request. Mirrors the co-op relay tests.

import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

/** A never-firing schedule so the timeout path is only exercised where a test wants it. */
const noTimer = () => () => {};

describe("Showdown enemy-command relay (C4)", () => {
  it("host request <-> peer responder: the relayed command resolves the host await", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });

    peerRelay.onCommandRequest(() => ({ command: 0, cursor: 0, moveId: 42, targets: [2] }));

    const cmdPromise = hostRelay.requestEnemyCommand(1);
    await flush();
    const cmd = await cmdPromise;

    expect(cmd).not.toBeNull();
    expect(cmd).toMatchObject({ command: 0, cursor: 0, moveId: 42, targets: [2] });

    hostRelay.dispose();
    peerRelay.dispose();
  });

  it("buffers an out-of-order command: a reply that arrives before the request still resolves it", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });

    // Raw peer ships its command for turn 3 BEFORE the host asks (races ahead).
    guest.send({ t: "showdownCommand", turn: 3, command: { command: 0, cursor: 1, moveId: 7 } });
    await flush();

    // The host's request for turn 3 consumes the buffered command instantly.
    const cmd = await hostRelay.requestEnemyCommand(3);
    expect(cmd).toMatchObject({ command: 0, cursor: 1, moveId: 7 });

    hostRelay.dispose();
  });

  it("Sync waits symmetrically without emitting an authority request", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });
    const receivedByPeer: string[] = [];
    const off = guest.onMessage(message => receivedByPeer.push(message.t));

    const pending = hostRelay.awaitCommand(8, 1);
    await flush();
    expect(receivedByPeer).not.toContain("showdownCommandRequest");

    peerRelay.sendCommand(8, { command: 0, cursor: 2, moveId: 99 }, 1);
    await flush();
    expect(await pending).toMatchObject({ cursor: 2, moveId: 99 });

    off();
    hostRelay.dispose();
    peerRelay.dispose();
  });

  it("keeps per-turn buffers distinct (a later turn does not clobber an unconsumed earlier one)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });

    guest.send({ t: "showdownCommand", turn: 1, command: { command: 0, cursor: 0, moveId: 11 } });
    guest.send({ t: "showdownCommand", turn: 2, command: { command: 0, cursor: 0, moveId: 22 } });
    await flush();

    // Consume turn 2 first, then turn 1 - both must resolve to their OWN command.
    expect(await hostRelay.requestEnemyCommand(2)).toMatchObject({ moveId: 22 });
    expect(await hostRelay.requestEnemyCommand(1)).toMatchObject({ moveId: 11 });

    hostRelay.dispose();
  });

  it("timeout resolves null (the AI-fallback signal) when the peer never answers", async () => {
    const { host } = createLoopbackPair();
    // Immediate-fire injected timer so the turn-timer path is deterministic + fast.
    const hostRelay = new ShowdownCommandRelay(host, {
      schedule: cb => {
        cb();
        return () => {};
      },
    });

    const cmd = await hostRelay.requestEnemyCommand(1);
    expect(cmd).toBeNull();

    hostRelay.dispose();
  });

  it("dispose cancels an in-flight request (resolves null so the host AI-falls-back)", async () => {
    const { host } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });

    const cmdPromise = hostRelay.requestEnemyCommand(5);
    hostRelay.dispose();
    expect(await cmdPromise).toBeNull();
  });

  it("a second request on the same turn supersedes the first (resolves it null)", async () => {
    const { host } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });

    const first = hostRelay.requestEnemyCommand(1);
    const second = hostRelay.requestEnemyCommand(1);
    expect(await first).toBeNull(); // superseded

    // The second is still in flight; dispose resolves it null too.
    hostRelay.dispose();
    expect(await second).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // MULTI-SLOT keying (doubles/triples). RED-PROOF: revert the (turn,fieldIndex)
  // key to turn-only and these fail - the two per-turn awaits collide / the wrong
  // slot's command satisfies an await. A 1v1 keeps fieldIndex 0 (the tests above).
  // ---------------------------------------------------------------------------

  it("doubles: two per-turn awaits (slot 0 + slot 1) each resolve to THEIR OWN slot's command", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });

    // The peer answers each slot with a distinct move so a cross-slot leak is observable.
    peerRelay.onCommandRequest(({ fieldIndex }) => ({ command: 0, cursor: fieldIndex, moveId: 100 + fieldIndex }));

    // The host awaits BOTH enemy slots on the SAME turn (the doubles case that turn-only keying breaks).
    const slot0 = hostRelay.requestEnemyCommand(4, 0);
    const slot1 = hostRelay.requestEnemyCommand(4, 1);
    await flush();
    await flush();

    expect(await slot0, "slot 0 await resolves to slot 0's command").toMatchObject({ cursor: 0, moveId: 100 });
    expect(await slot1, "slot 1 await resolves to slot 1's command").toMatchObject({ cursor: 1, moveId: 101 });

    hostRelay.dispose();
    peerRelay.dispose();
  });

  it("doubles: unprompted per-slot sendCommand routes each command to its matching slot await", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });

    // Peer ships both own-slot commands UNPROMPTED (the live guest path: it picks then ships each slot).
    peerRelay.sendCommand(7, { command: 0, cursor: 0, moveId: 200 }, 0);
    peerRelay.sendCommand(7, { command: 0, cursor: 1, moveId: 201 }, 1);
    await flush();

    // The host consumes each slot's buffered command - slot 1's command must NOT satisfy slot 0's request.
    expect(await hostRelay.requestEnemyCommand(7, 1), "slot 1 request gets slot 1's move").toMatchObject({
      moveId: 201,
    });
    expect(await hostRelay.requestEnemyCommand(7, 0), "slot 0 request gets slot 0's move").toMatchObject({
      moveId: 200,
    });

    hostRelay.dispose();
    peerRelay.dispose();
  });

  it("triples: three per-turn slots stay distinct (no collision/stall across 0/1/2)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });

    peerRelay.onCommandRequest(({ fieldIndex }) => ({ command: 0, cursor: fieldIndex, moveId: 300 + fieldIndex }));

    const awaits = [0, 1, 2].map(fi => hostRelay.requestEnemyCommand(9, fi));
    await flush();
    await flush();
    const results = await Promise.all(awaits);

    expect(results.map(r => r?.moveId)).toEqual([300, 301, 302]);

    hostRelay.dispose();
    peerRelay.dispose();
  });

  it("a request that races ahead of the responder is buffered PER SLOT and answered on install", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(host, { schedule: noTimer });
    const peerRelay = new ShowdownCommandRelay(guest, { schedule: noTimer });

    // Host asks for BOTH slots before the peer installs its responder (#812-mirror, per slot).
    const slot0 = hostRelay.requestEnemyCommand(2, 0);
    const slot1 = hostRelay.requestEnemyCommand(2, 1);
    await flush();

    // Now the peer installs its responder - both buffered requests must drain to their own slot.
    peerRelay.onCommandRequest(({ fieldIndex }) => ({ command: 0, cursor: fieldIndex, moveId: 400 + fieldIndex }));
    await flush();
    await flush();

    expect(await slot0).toMatchObject({ moveId: 400 });
    expect(await slot1).toMatchObject({ moveId: 401 });

    hostRelay.dispose();
    peerRelay.dispose();
  });
});
