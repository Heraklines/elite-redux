/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const flushWire = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op recovery snapshot full-address buffering", () => {
  it.each([
    ["wave", { epoch: 7, wave: 2, turn: 1 }],
    ["epoch", { epoch: 8, wave: 1, turn: 1 }],
  ] as const)("rejects a delayed prior-%s stateSync when the same numeric turn is reused", async (_label, next) => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 1, turn: 1 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const requests: number[] = [];

    hostStream.onStateSyncRequest((_requestTurn, seq) => {
      requests.push(seq);
      if (seq === 2) {
        hostStream.sendStateSync("current-boundary", seq);
      }
    });

    const staleBoundary = guestStream.requestStateSync(1);
    await flushWire();
    Object.assign(current, next);
    hostStream.sendStateSync("obsolete-boundary", 1);

    await expect(staleBoundary).resolves.toBeNull();
    await expect(guestStream.requestStateSync(1)).resolves.toBe("current-boundary");
    expect(requests).toEqual([1, 2]);

    hostStream.dispose();
    guestStream.dispose();
  });

  it("drops an unsolicited production stateSync instead of relabeling it as the current epoch", async () => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 11, wave: 20, turn: 1 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });

    // A queued reply from a disposed prior streamer can reuse seq=1. Without an addressed live waiter the
    // historical wire frame has no epoch/wave proof and therefore must not enter the new stream's inbox.
    hostStream.sendStateSync("unbound-stale", 1);
    await flushWire();
    hostStream.onStateSyncRequest((_requestTurn, seq) => hostStream.sendStateSync("bound-current", seq));

    await expect(guestStream.requestStateSync(1)).resolves.toBe("bound-current");

    hostStream.dispose();
    guestStream.dispose();
  });

  it("binds legacy request labels to the actual battle address", async () => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 13, wave: 7, turn: 3 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const recoveryCorrelation = 9_000_321;

    hostStream.onStateSyncRequest((requestTurn, seq) => {
      expect(requestTurn).toBe(recoveryCorrelation);
      hostStream.sendStateSync("me-or-rejoin-snapshot", seq);
    });

    await expect(guestStream.requestStateSync(recoveryCorrelation)).resolves.toBe("me-or-rejoin-snapshot");

    hostStream.dispose();
    guestStream.dispose();
  });
});
