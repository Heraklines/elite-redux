/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 PvP (C1): the versus SESSION KIND threads host->guest over the same
// co-op transport, exactly like netcodeMode. Pure logic over LoopbackTransport - no
// game engine. Covers: kind round-trip (host pins versus -> guest adopts it), an absent
// kind defaulting to "coop" (old-peer safety), and the versus mergedLaunchParty branch
// (each side launches its OWN picks; no merge).

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("showdown session kind (C1)", () => {
  it("threads kind:'versus' host -> guest via broadcastRunConfig", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host, { username: "Red" });
    const g = new CoopSessionController(guest, { username: "Blue" });
    h.connect();
    g.connect();
    await flush();

    // Host pins the versus kind at session start (as the runtime factory does).
    h.setSessionKind("versus");
    expect(h.isVersusSession()).toBe(true);
    // Guest defaults to coop until the host's runConfig arrives.
    expect(g.isVersusSession()).toBe(false);

    h.broadcastRunConfig({ difficulty: "hell", challenges: [] });
    await flush();

    // Guest adopted the host's versus kind off the runConfig.
    expect(g.isVersusSession()).toBe(true);
    expect(g.sessionKind).toBe("versus");
    expect(g.runConfig()?.kind).toBe("versus");
    // Roles are the classic host/guest assignment (unchanged by the kind).
    expect(h.role).toBe("host");
    expect(g.role).toBe("guest");
  });

  it("an absent kind on the wire is treated as coop (old-peer safety)", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host, { username: "Red" });
    const g = new CoopSessionController(guest, { username: "Blue" });
    h.connect();
    g.connect();
    await flush();

    // Simulate an OLDER host that never sends `kind`: send a bare runConfig.
    host.send({ t: "runConfig", difficulty: "ace", challenges: [] });
    await flush();

    expect(g.isVersusSession()).toBe(false);
    expect(g.sessionKind).toBe("coop");
    // A default-constructed controller is coop with no kind pinned.
    expect(h.isVersusSession()).toBe(false);
  });

  it("versus mergedLaunchParty returns each side's OWN picks, un-merged", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host, { username: "Red" });
    const g = new CoopSessionController(guest, { username: "Blue" });
    h.setSessionKind("versus");
    g.setSessionKind("versus");
    h.connect();
    g.connect();
    await flush();

    // Cheap picks so both fit the coop roster's per-player budget/cap (unchanged here -
    // showdown teambuild proper hands off Starter[] and doesn't ride this budget).
    h.setLocalRoster([
      { speciesId: 3, cost: 1 },
      { speciesId: 6, cost: 1 },
    ]);
    g.setLocalRoster([
      { speciesId: 9, cost: 1 },
      { speciesId: 12, cost: 1 },
    ]);
    h.setLocalReady(true);
    g.setLocalReady(true);
    await flush();

    // Each client's launch party is ITS OWN team only - the partner's picks are NOT
    // merged in (they arrive later as the enemy side via the showdown manifest).
    expect(h.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([3, 6]);
    expect(g.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([9, 12]);
  });

  it("coop mergedLaunchParty is unchanged (byte-identical merge)", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new CoopSessionController(host, { username: "Red" });
    const g = new CoopSessionController(guest, { username: "Blue" });
    // No setSessionKind -> defaults to coop.
    h.connect();
    g.connect();
    await flush();

    h.setLocalRoster([{ speciesId: 3, cost: 5 }]);
    g.setLocalRoster([
      { speciesId: 6, cost: 3 },
      { speciesId: 9, cost: 2 },
    ]);
    h.setLocalReady(true);
    g.setLocalReady(true);
    await flush();

    // Classic 6-slot merge: host 0..2, guest 3..5.
    expect(h.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([3, null, null, 6, 9, null]);
    expect(g.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([3, null, null, 6, 9, null]);
  });
});
