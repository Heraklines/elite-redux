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
});
