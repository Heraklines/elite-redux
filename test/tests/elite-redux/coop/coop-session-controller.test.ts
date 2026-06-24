/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op session handshake (#633, P1): two clients pick their OWN starters on
// their OWN screens and mirror state over the transport. Verified two ways:
//   - host CoopSessionController <-> SpoofGuest (the local-dev path), and
//   - host CoopSessionController <-> guest CoopSessionController (symmetry).
// Pure logic over LoopbackTransport - no game engine.

import { CoopSessionController, type CoopSessionSnapshot } from "#data/elite-redux/coop/coop-session-controller";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op session controller (#633, P1)", () => {
  describe("host controller <-> spoofed guest (local-dev path)", () => {
    it("runs the full handshake: connect -> partner picks -> both ready -> merged party", async () => {
      const { host, guest } = createLoopbackPair();
      const controller = new CoopSessionController(host, { username: "Ash" });
      const spoof = new SpoofGuest(guest, {
        username: "May (CPU)",
        roster: [
          { speciesId: 7, cost: 3 },
          { speciesId: 10, cost: 1 },
        ],
      });

      const snaps: CoopSessionSnapshot[] = [];
      controller.onChange(s => snaps.push(s));

      // 1. Both announce themselves.
      controller.connect();
      spoof.connect();
      await flush();
      expect(controller.partnerConnected).toBe(true);
      expect(controller.partnerName).toBe("May (CPU)");

      // 2. Local player picks their own team (host half).
      controller.setLocalRoster([
        { speciesId: 1, cost: 3 },
        { speciesId: 4, cost: 2 },
      ]);
      expect(controller.localEntries()).toHaveLength(2);
      expect(controller.snapshot().localSpent).toBe(5);

      // 3. Partner is still choosing -> host sees their count but not-ready.
      spoof.announcePicking();
      await flush();
      expect(controller.partnerReady).toBe(false);
      expect(controller.snapshot().partnerCount).toBe(2);
      expect(controller.snapshot().partnerSpent).toBe(4);
      expect(controller.bothReady()).toBe(false);

      // 4. Partner locks in.
      spoof.lockIn();
      await flush();
      expect(controller.partnerReady).toBe(true);
      expect(controller.bothReady()).toBe(false); // local not ready yet

      // 5. Local locks in -> both ready.
      controller.setLocalReady(true);
      expect(controller.bothReady()).toBe(true);
      expect(controller.snapshot().bothReady).toBe(true);

      // 6. Merged launch party: host 0..2, guest 3..5, in pick order.
      const party = controller.mergedLaunchParty();
      expect(party).toHaveLength(6);
      expect(party[0]?.speciesId).toBe(1);
      expect(party[1]?.speciesId).toBe(4);
      expect(party[2]).toBeNull();
      expect(party[3]?.speciesId).toBe(7);
      expect(party[4]?.speciesId).toBe(10);
      expect(party[5]).toBeNull();

      // onChange fired along the way (connect, picks, partner updates, ready).
      expect(snaps.length).toBeGreaterThanOrEqual(4);
      expect(snaps.at(-1)?.bothReady).toBe(true);
    });

    it("autoComplete() drives the partner all the way to ready in one call", async () => {
      const { host, guest } = createLoopbackPair();
      const controller = new CoopSessionController(host);
      const spoof = new SpoofGuest(guest); // default roster (2 mons / 5 pts)

      controller.connect();
      controller.setLocalRoster([{ speciesId: 25, cost: 4 }]);
      controller.setLocalReady(true);
      spoof.autoComplete();
      await flush();

      expect(controller.partnerConnected).toBe(true);
      expect(controller.partnerReady).toBe(true);
      expect(controller.bothReady()).toBe(true);
      expect(controller.partnerEntries()).toEqual(spoof.pickedRoster());
    });
  });

  describe("two real controllers (protocol symmetry)", () => {
    it("host and guest each mirror the other's roster + readiness", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host, { username: "Red" });
      const g = new CoopSessionController(guest, { username: "Blue" });

      h.connect();
      g.connect();
      await flush();
      expect(h.partnerName).toBe("Blue");
      expect(g.partnerName).toBe("Red");

      h.setLocalRoster([{ speciesId: 3, cost: 5 }]);
      g.setLocalRoster([
        { speciesId: 6, cost: 3 },
        { speciesId: 9, cost: 2 },
      ]);
      await flush();

      // Each sees the OTHER's picks as the partner half.
      expect(g.partnerEntries().map(e => e.speciesId)).toEqual([3]);
      expect(h.partnerEntries().map(e => e.speciesId)).toEqual([6, 9]);

      h.setLocalReady(true);
      g.setLocalReady(true);
      await flush();
      expect(h.bothReady()).toBe(true);
      expect(g.bothReady()).toBe(true);

      // Both authorities agree on the merged party (host half first).
      expect(h.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([3, null, null, 6, 9, null]);
      expect(g.mergedLaunchParty().map(e => e?.speciesId ?? null)).toEqual([3, null, null, 6, 9, null]);
    });

    it("a partner un-readying (edited roster) drops bothReady again", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);
      h.connect();
      g.connect();
      h.setLocalRoster([{ speciesId: 1, cost: 1 }]);
      g.setLocalRoster([{ speciesId: 2, cost: 1 }]);
      h.setLocalReady(true);
      g.setLocalReady(true);
      await flush();
      expect(h.bothReady()).toBe(true);

      // Guest changes their mind -> un-ready -> host's bothReady falls.
      g.setLocalReady(false);
      await flush();
      expect(h.partnerReady).toBe(false);
      expect(h.bothReady()).toBe(false);
    });
  });

  describe("interaction alternation (#633, P4)", () => {
    it("starts with the host owning the first interaction; advancing alternates", () => {
      const { host } = createLoopbackPair();
      const h = new CoopSessionController(host);
      // Interaction 0 -> host, 1 -> guest, 2 -> host, ...
      expect(h.interactionOwner()).toBe("host");
      expect(h.isLocalInteractionTurn()).toBe(true); // local is the host
      h.advanceInteraction();
      expect(h.interactionOwner()).toBe("guest");
      expect(h.isLocalInteractionTurn()).toBe(false);
      h.advanceInteraction();
      expect(h.interactionOwner()).toBe("host");
      expect(h.isLocalInteractionTurn()).toBe(true);
      // The counter is exposed for persistence with the run record.
      expect(h.interactionCounter()).toBe(2);
    });

    it("from the GUEST's point of view, isLocalInteractionTurn is true on guest turns", () => {
      const { guest } = createLoopbackPair();
      const g = new CoopSessionController(guest);
      // Interaction 0 -> host owns it, so the guest is NOT the owner yet.
      expect(g.interactionOwner()).toBe("host");
      expect(g.isLocalInteractionTurn()).toBe(false);
      g.advanceInteraction();
      expect(g.interactionOwner()).toBe("guest");
      expect(g.isLocalInteractionTurn()).toBe(true); // now it's the guest's turn
    });

    it("a host advance is mirrored to the partner so both agree on whose turn it is", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);
      expect(h.interactionOwner()).toBe("host");
      expect(g.interactionOwner()).toBe("host");

      // Host completes its interaction and advances; the broadcast crosses the wire.
      h.advanceInteraction();
      await flush();
      expect(h.interactionOwner()).toBe("guest");
      expect(g.interactionOwner()).toBe("guest"); // mirrored from the host
      expect(g.interactionCounter()).toBe(1);
    });

    it("the counter persists: restoreInteractionCounter resumes the order (round-trip)", () => {
      const { host } = createLoopbackPair();
      const h = new CoopSessionController(host);
      h.advanceInteraction();
      h.advanceInteraction();
      h.advanceInteraction(); // counter = 3 -> owner guest
      const saved = h.interactionCounter();
      expect(saved).toBe(3);

      // A fresh controller (post-reload) restores the saved counter.
      const { host: host2 } = createLoopbackPair();
      const resumed = new CoopSessionController(host2);
      expect(resumed.interactionOwner()).toBe("host"); // fresh = 0
      resumed.restoreInteractionCounter(saved);
      expect(resumed.interactionCounter()).toBe(3);
      expect(resumed.interactionOwner()).toBe("guest"); // 3 is odd -> guest
    });

    it("the snapshot carries the interaction owner + local-turn flag for the UI", () => {
      const { host } = createLoopbackPair();
      const h = new CoopSessionController(host);
      expect(h.snapshot().interactionOwner).toBe("host");
      expect(h.snapshot().localInteractionTurn).toBe(true);
      h.advanceInteraction();
      expect(h.snapshot().interactionOwner).toBe("guest");
      expect(h.snapshot().localInteractionTurn).toBe(false);
    });
  });
});
