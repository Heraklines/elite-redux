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
    hostStream.emitTurn(1, [{ k: "message", text: "Bulbasaur fainted!" }], emptyCheckpoint(), "deadbeefdeadbeef");

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
    hostStream.emitTurn(2, [{ k: "faint", bi: 2 }], emptyCheckpoint(), "deadbeefdeadbeef");
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
    hostStream.emitTurn(1, [], emptyCheckpoint(), "deadbeefdeadbeef");

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
    hostStream.sendCheckpoint("switch", emptyCheckpoint(), "deadbeefdeadbeef");
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
    hostStream.sendCheckpoint("post-dispose", emptyCheckpoint(), "deadbeefdeadbeef");
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
      hostStream.emitTurn(1, [], emptyCheckpoint(), "feedface00000001");
      const res = await awaited;
      expect(res?.checksum).toBe("feedface00000001");

      hostStream.sendCheckpoint("switch", emptyCheckpoint(), "feedface00000002");
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
});
