/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op host-authoritative battle STREAM (#633, LIVE-D). The host->guest wire:
// the host streams the enemy party + per-turn resolutions + out-of-turn checkpoints;
// the guest awaits each turn and renders it, never computing. Verified over a
// LoopbackTransport (the same "test via spoofing" path the rest of the suite uses).

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const emptyCheckpoint = (): CoopBattleCheckpoint => ({
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

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
    hostStream.emitTurn(1, [{ k: "message", text: "Bulbasaur fainted!" }], emptyCheckpoint());

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
    hostStream.emitTurn(2, [{ k: "faint", bi: 2 }], emptyCheckpoint());
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

  it("a second await for the same turn supersedes the stale one (resolves it null)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStream = new CoopBattleStreamer(host);
    const guestStream = new CoopBattleStreamer(guest);

    const first = guestStream.awaitTurn(1);
    const second = guestStream.awaitTurn(1);
    hostStream.emitTurn(1, [], emptyCheckpoint());

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
    hostStream.sendCheckpoint("switch", emptyCheckpoint());
    await new Promise(r => setTimeout(r, 0));
    expect(reason).toBe("switch");
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
    hostStream.sendCheckpoint("post-dispose", emptyCheckpoint());
    await new Promise(r => setTimeout(r, 0));
    expect(fired).toBe(false);
  });
});
