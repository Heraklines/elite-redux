/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op session handshake (#633, P1): two clients pick their OWN starters on
// their OWN screens and mirror state over the transport. Verified two ways:
//   - host CoopSessionController <-> SpoofGuest (the local-dev path), and
//   - host CoopSessionController <-> guest CoopSessionController (symmetry).
// Pure logic over LoopbackTransport - no game engine.

import {
  COOP_CAP_DURABILITY_JOURNAL,
  COOP_CAP_OP_BIOME,
  clearNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { computeErDataFingerprint } from "#data/elite-redux/coop/coop-data-fingerprint";
import { CoopSessionController, type CoopSessionSnapshot } from "#data/elite-redux/coop/coop-session-controller";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import { COOP_PROTOCOL_VERSION, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush before asserting. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op session controller (#633, P1)", () => {
  it("rolls an atomically staged interaction counter back to the exact prior value", () => {
    const { host } = createLoopbackPair();
    const controller = new CoopSessionController(host);
    controller.restoreInteractionCounter(5);
    expect(controller.interactionCounter()).toBe(5);
    expect(controller.adoptAuthoritativeInteractionCounterForTransaction(9)).toBe(true);
    expect(controller.interactionCounter()).toBe(9);

    controller.restoreAuthoritativeInteractionCounterForTransaction(5);
    expect(controller.interactionCounter(), "transaction rollback may move backward to its exact snapshot").toBe(5);
    controller.dispose();
  });

  describe("functional compatibility launch barrier", () => {
    it("refuses protocol-33 launch when biome operations or durability do not survive negotiation", async () => {
      clearNegotiatedCoopCapabilities();
      const { host, guest } = createLoopbackPair();
      const required = [COOP_CAP_OP_BIOME, COOP_CAP_DURABILITY_JOURNAL];
      const h = new CoopSessionController(host, {
        version: COOP_PROTOCOL_VERSION,
        localCapabilities: required,
        requiredCapabilities: required,
      });
      const g = new CoopSessionController(guest, {
        version: COOP_PROTOCOL_VERSION,
        localCapabilities: [COOP_CAP_OP_BIOME],
        requiredCapabilities: required,
      });
      h.connect();
      g.connect();
      await flush();
      expect(h.compatibilityAccepted).toBe(false);
      expect(g.compatibilityAccepted).toBe(false);
      h.dispose();
      g.dispose();
      clearNegotiatedCoopCapabilities();
    });

    it("rejects an er-coop-32 peer that contains only one side of the merged protocol-33 contract", async () => {
      expect(COOP_PROTOCOL_VERSION).toBe("er-coop-33");
      const { host, guest } = createLoopbackPair();
      const controller = new CoopSessionController(host, {
        username: "Host",
        version: COOP_PROTOCOL_VERSION,
      });
      controller.connect();
      guest.send({ t: "hello", version: "er-coop-32", username: "Cached", role: "guest", epoch: 0 });
      await flush();

      expect(controller.versionMismatch).toBe(true);
      expect(controller.compatibilityAccepted).toBe(false);
      expect(controller.bothReady()).toBe(false);
      controller.dispose();
    });

    async function readyAgainstFingerprint(kind: "functional" | "presentation"): Promise<CoopSessionController> {
      const { host, guest } = createLoopbackPair();
      const controller = new CoopSessionController(host, {
        username: "Host",
        version: COOP_PROTOCOL_VERSION,
        requireFunctionalFingerprint: true,
      });
      controller.connect();
      guest.send({
        t: "hello",
        version: COOP_PROTOCOL_VERSION,
        username: "Guest",
        role: "guest",
        epoch: 0,
      });
      const fp = computeErDataFingerprint();
      const peer = structuredClone(fp);
      if (kind === "functional") {
        peer.movesData.hash = "ffffffffffffffff";
      } else {
        peer.movesName.hash = "eeeeeeeeeeeeeeee";
      }
      guest.send({ t: "dataFingerprint", fp: peer });
      guest.send({ t: "rosterSync", role: "guest", entries: [{ speciesId: 2, cost: 1 }], ready: true });
      controller.setLocalRoster([{ speciesId: 1, cost: 1 }]);
      controller.setLocalReady(true);
      await flush();
      return controller;
    }

    it("refuses launch when a simulation-affecting data fingerprint differs", async () => {
      const controller = await readyAgainstFingerprint("functional");
      expect(controller.functionalFingerprintMismatch).toBe(true);
      expect(controller.compatibilityAccepted).toBe(false);
      expect(controller.bothReady()).toBe(false);
    });

    it("separates localization-only drift from functional compatibility", async () => {
      const controller = await readyAgainstFingerprint("presentation");
      expect(controller.presentationFingerprintMismatch).toBe(true);
      expect(controller.functionalFingerprintMismatch).toBe(false);
      expect(controller.compatibilityAccepted).toBe(true);
      expect(controller.bothReady()).toBe(true);
    });
  });

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

    it("a host advance is DEFERRED on the partner and converges at the partner's own next advance (#698 BUG2)", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);
      expect(h.interactionOwner()).toBe("host");
      expect(g.interactionOwner()).toBe("host");

      // Host completes its interaction and advances; the broadcast crosses the wire.
      // BUG2 fix: the inbound `interaction` broadcast no longer EAGERLY bumps the guest's
      // live counter (that poisoned the next reward shop's owner pin when it landed in the
      // inter-wave gap). It is DEFERRED into pendingRemote and folded in at the guest's own
      // next deterministic advance. So immediately after the host's advance + flush the
      // guest's LIVE counter is unchanged (still 0 / owner host) - the deferred target is parked.
      h.advanceInteraction();
      await flush();
      expect(h.interactionOwner()).toBe("guest");
      expect(g.interactionCounter()).toBe(0); // NOT eagerly bumped - deferred
      expect(g.interactionOwner()).toBe("host"); // guest's live owner is still itself-vs-host at 0

      // Both clients advance LOCALLY + deterministically for the same logical interaction
      // (the real lockstep flow). The guest's own advance increments 0 -> 1 and folds the
      // deferred remote (1, equal -> no extra jump), so both now agree on whose turn it is.
      g.advanceInteraction();
      await flush();
      expect(g.interactionCounter()).toBe(1);
      expect(g.interactionOwner()).toBe("guest");
      expect(h.interactionOwner()).toBe("guest"); // both converged
    });

    it("a resume re-initializes the interaction counter identically on both clients (#833: no persisted restore)", () => {
      // #833 dangler cleanup: the interaction counter is NOT persisted in SessionSaveData, and the
      // production-dead `restoreInteractionCounter` seam was removed (nothing to restore). A real
      // resume relies on BOTH clients re-initializing the counter identically from the fresh runtime
      // assembly - which is exactly base 0 (host owns the first interaction). Assert that invariant.
      const { host } = createLoopbackPair();
      const h = new CoopSessionController(host);
      h.advanceInteraction();
      h.advanceInteraction();
      h.advanceInteraction(); // mid-run: counter = 3 -> owner guest
      expect(h.interactionCounter()).toBe(3);

      // Post-reload: a fresh controller on EITHER role re-initializes to 0 (host owns interaction 0),
      // so the even/odd ownership parity is preserved for a resume that re-enters from the top.
      const { host: host2, guest: guest2 } = createLoopbackPair();
      const resumedHost = new CoopSessionController(host2);
      const resumedGuest = new CoopSessionController(guest2);
      expect(resumedHost.interactionCounter()).toBe(0);
      expect(resumedGuest.interactionCounter()).toBe(0);
      expect(resumedHost.interactionOwner()).toBe("host"); // fresh = 0 -> host owns the first interaction
      expect(resumedGuest.interactionOwner()).toBe("host"); // both clients agree
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

    it("FAILURE-FIRST: a lost partner-completion counter is requested again and never times out open", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0x434f554e });
      const h = new CoopSessionController(pair.host);
      const g = new CoopSessionController(pair.guest);

      pair.armNextDrop("interaction", "host");
      h.advanceInteraction(0);
      g.advanceInteraction(0);
      await flush();
      expect(g.interactionCounter()).toBe(1);
      expect(g.partnerInteractionCounterSeen(), "the host's first completion broadcast was actually lost").toBe(0);

      await expect(
        g.awaitPartnerInteraction(5),
        "timeout must request the host's retained counter and remain closed until it arrives",
      ).resolves.toBe(true);
      expect(g.partnerInteractionCounterSeen()).toBe(1);
      expect(pair.counters.host.oneShotDropped).toBe(1);
    });
  });

  describe("run-config sync (#633, LIVE-C) - host decides, guest follows", () => {
    it("the host's difficulty + challenges cross the wire to the guest", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);
      // Before the host decides, neither side has a config.
      expect(h.runConfig()).toBeNull();
      expect(g.runConfig()).toBeNull();

      h.broadcastRunConfig({ difficulty: "hell", challenges: [{ id: 3, value: 1, severity: 0 }] });
      await flush();

      // The host knows its own config immediately; the guest mirrors it.
      expect(h.runConfig()?.difficulty).toBe("hell");
      expect(g.runConfig()?.difficulty).toBe("hell");
      expect(g.runConfig()?.challenges).toEqual([{ id: 3, value: 1, severity: 0 }]);
    });

    it("a guest does NOT override the run config (host-authoritative)", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);

      // A stray broadcast FROM the guest must not become the host's config.
      g.broadcastRunConfig({ difficulty: "youngster", challenges: [] });
      await flush();
      expect(h.runConfig()).toBeNull(); // host ignores a guest-sourced config

      // The host's broadcast is authoritative and reaches the guest.
      h.broadcastRunConfig({ difficulty: "elite", challenges: [] });
      await flush();
      expect(g.runConfig()?.difficulty).toBe("elite");
    });

    it("the host's run SEED crosses the wire so the guest pins to it (#633, LIVE-A)", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);

      h.broadcastRunConfig({ difficulty: "hell", challenges: [], seed: "ABC123seedXYZ" });
      await flush();

      // The host knows its own seed immediately; the guest mirrors the SAME seed so
      // both engines roll identical enemies / RNG (lockstep).
      expect(h.runConfig()?.seed).toBe("ABC123seedXYZ");
      expect(g.runConfig()?.seed).toBe("ABC123seedXYZ");
    });

    it("a run config with no seed leaves the guest's seed unset (back-compat)", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);

      // Older host (no seed in the config) -> the guest sees an undefined seed and
      // keeps its own (the legacy behavior), never crashing on the missing field.
      h.broadcastRunConfig({ difficulty: "ace", challenges: [] });
      await flush();
      expect(g.runConfig()?.difficulty).toBe("ace");
      expect(g.runConfig()?.seed).toBeUndefined();
    });
  });

  describe("full-starter roster sync (#633, LIVE-B) - byte-identical merged party", () => {
    it("the partner's FULL starter blob crosses the wire and both clients merge the SAME party", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host, { username: "Red" });
      const g = new CoopSessionController(guest, { username: "Blue" });
      h.connect();
      g.connect();

      // Each side picks with FULL starter data (form / IVs / nature / ability /
      // moves), not just speciesId+cost.
      h.setLocalRoster([
        {
          speciesId: 3,
          cost: 5,
          starter: {
            speciesId: 3,
            shiny: true,
            variant: 2,
            formIndex: 1,
            female: true,
            abilityIndex: 2,
            passive: true,
            nature: 5,
            moveset: [33, 22, 11, 44],
            pokerus: false,
            teraType: 7,
            ivs: [31, 30, 29, 28, 27, 26],
          },
        },
      ]);
      g.setLocalRoster([
        {
          speciesId: 6,
          cost: 3,
          starter: {
            speciesId: 6,
            shiny: false,
            variant: 0,
            formIndex: 0,
            female: false,
            abilityIndex: 1,
            passive: false,
            nature: 10,
            moveset: [52, 53],
            pokerus: true,
            ivs: [1, 2, 3, 4, 5, 6],
          },
        },
      ]);
      h.setLocalReady(true);
      g.setLocalReady(true);
      await flush();

      // The HOST sees the GUEST's full blob as its partner half (rebuilt exactly).
      const hPartner = h.partnerEntries();
      expect(hPartner).toHaveLength(1);
      expect(hPartner[0].starter?.moveset).toEqual([52, 53]);
      expect(hPartner[0].starter?.abilityIndex).toBe(1);
      expect(hPartner[0].starter?.ivs).toEqual([1, 2, 3, 4, 5, 6]);

      // The GUEST sees the HOST's full blob as its partner half.
      const gPartner = g.partnerEntries();
      expect(gPartner).toHaveLength(1);
      expect(gPartner[0].starter?.shiny).toBe(true);
      expect(gPartner[0].starter?.formIndex).toBe(1);
      expect(gPartner[0].starter?.nature).toBe(5);
      expect(gPartner[0].starter?.teraType).toBe(7);
      expect(gPartner[0].starter?.moveset).toEqual([33, 22, 11, 44]);

      // Both authorities can reconstruct the SAME merged party (host half first):
      // host's full starter in slot 0, guest's in slot 3. The full blobs match
      // across machines, so the launch parties are byte-identical.
      const hMerged = h.mergedLaunchParty();
      const gMerged = g.mergedLaunchParty();
      expect(hMerged[0]?.starter?.moveset).toEqual([33, 22, 11, 44]); // host pick
      expect(hMerged[3]?.starter?.moveset).toEqual([52, 53]); // guest pick
      // The guest's controller agrees on the exact same merged starters.
      expect(gMerged[0]?.starter).toEqual(hMerged[0]?.starter);
      expect(gMerged[3]?.starter).toEqual(hMerged[3]?.starter);
    });

    it("a roster entry WITHOUT a full blob still syncs by speciesId+cost (back-compat)", async () => {
      const { host, guest } = createLoopbackPair();
      const h = new CoopSessionController(host);
      const g = new CoopSessionController(guest);
      h.connect();
      g.connect();

      // Older client / mid-select snapshot: speciesId + cost only, no `starter`.
      g.setLocalRoster([{ speciesId: 25, cost: 4 }]);
      await flush();

      const partner = h.partnerEntries();
      expect(partner).toHaveLength(1);
      expect(partner[0].speciesId).toBe(25);
      expect(partner[0].cost).toBe(4);
      expect(partner[0].starter).toBeUndefined();
    });
  });
});
