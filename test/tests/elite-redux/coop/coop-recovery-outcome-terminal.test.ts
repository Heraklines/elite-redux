/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopBattleStreamer, type CoopStateSyncFailure } from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import {
  failCoopRecoveryOutcome,
  isCoopSharedTerminalFrozen,
  runCoopStateRecovery,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

function stubRuntime(battleStream?: CoopBattleStreamer): CoopRuntime {
  return {
    controller: {
      sessionEpoch: 4,
      role: "guest",
      interactionCounter: () => 0,
    },
    membership: { terminate: () => {} },
    battleSync: { freezeForTerminal: () => {} },
    battleStream,
    interactionRelay: { cancelWaiters: () => {} },
  } as unknown as CoopRuntime;
}

describe("closed recovery outcomes", () => {
  it.each([
    "missing",
    "throwing",
  ] as const)("runs an addressed durability snapshot through a %s receiver and invokes terminal closure", async receiverKind => {
    const pair = createLoopbackPair();
    const point = { epoch: 4, wave: 2, turn: 3 };
    const terminals: string[] = [];
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => point });
    const guestStream = new CoopBattleStreamer(pair.guest, {
      authorityContext: () => point,
      onRecoveryTerminal: reason => terminals.push(reason),
    });
    if (receiverKind === "throwing") {
      guestStream.onDurabilitySnapshot(() => {
        throw new Error("synthetic receiver failure");
      });
    }

    expect(
      hostStream.sendDurabilitySnapshot("durability-call-chain", {
        wave: point.wave,
        turn: point.turn,
        stateTick: 9,
        controlDigest: "durability-control-digest",
      }),
    ).toBe(true);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }

    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toContain(receiverKind === "missing" ? "no installed snapshot receiver" : "receiver threw");
    hostStream.dispose();
    guestStream.dispose();
  });

  it("runs the real request timer -> explicit timeout -> shared-terminal call chain on the short recovery budget", async () => {
    const pair = createLoopbackPair();
    const point = { epoch: 4, wave: 2, turn: 3 };
    const scheduled: number[] = [];
    const guestStream = new CoopBattleStreamer(pair.guest, {
      authorityContext: () => point,
      timeoutMs: 1_200_000,
      recoveryTimeoutMs: 37,
      schedule: (callback, ms) => {
        scheduled.push(ms);
        queueMicrotask(callback);
        return () => {};
      },
    });
    const runtime = stubRuntime(guestStream);

    await expect(
      runCoopStateRecovery({
        runtime,
        reason: "stall",
        label: "call-chain timeout",
        isCurrent: () => true,
        onSnapshot: () => {
          throw new Error("an unanswered recovery must not dispatch a snapshot");
        },
      }),
    ).resolves.toBe("terminal");

    expect(scheduled).toEqual([37]);
    expect(isCoopSharedTerminalFrozen(runtime)).toBe(true);
    guestStream.dispose();
  });

  it("runs a real exact-ticket round trip through the same coordinator without terminalizing", async () => {
    const pair = createLoopbackPair();
    const point = { epoch: 6, wave: 5, turn: 2 };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => point });
    const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => point });
    hostStream.onStateSyncRequest(ticket => {
      hostStream.sendStateSync("exact-call-chain", ticket, {
        wave: point.wave,
        turn: point.turn,
        stateTick: 9,
        controlDigest: "exact-control-digest",
      });
    });
    const runtime = stubRuntime(guestStream);
    const received: string[] = [];

    await expect(
      runCoopStateRecovery({
        runtime,
        reason: "rejoin",
        label: "call-chain success",
        isCurrent: () => true,
        onSnapshot: result => {
          received.push(result.blob);
          return true;
        },
      }),
    ).resolves.toBe("accepted");

    expect(received).toEqual(["exact-call-chain"]);
    expect(isCoopSharedTerminalFrozen(runtime)).toBe(false);
    hostStream.dispose();
    guestStream.dispose();
  });

  it.each([
    ["guest/host frontier mismatch", { kind: "superseded" }],
    ["host snapshot unavailable", { kind: "unavailable" }],
    ["request deadline", { kind: "timeout" }],
    ["connection generation changed", { kind: "reconnect-cancelled" }],
  ] satisfies [
    string,
    CoopStateSyncFailure,
  ][])("%s freezes the shared session synchronously and cannot continue mechanics", (_label, outcome) => {
    const runtime = stubRuntime();
    let mechanicsContinued = false;

    if (!failCoopRecoveryOutcome(runtime, outcome, `Regression ${outcome.kind}`)) {
      mechanicsContinued = true;
    }

    expect(mechanicsContinued).toBe(false);
    expect(isCoopSharedTerminalFrozen(runtime)).toBe(true);
  });
});
