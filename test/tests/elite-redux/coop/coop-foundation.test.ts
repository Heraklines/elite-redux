/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op foundation (#633): the swappable transport (LoopbackTransport) + the
// pure-logic ownership / interaction-alternation model. No game engine involved.

import {
  COOP_SLOTS_PER_PLAYER,
  CoopInteractionTurn,
  coopFieldIndexOf,
  coopOwnerOfFieldIndex,
  coopOwnerOfPartySlot,
  coopPartySlotRange,
} from "#data/elite-redux/coop/coop-session";
import { type CoopConnectionState, type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** Flush pending microtasks (LoopbackTransport delivers on a microtask). */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe("co-op foundation (#633)", () => {
  describe("LoopbackTransport", () => {
    it("connects a host/guest pair", () => {
      const { host, guest } = createLoopbackPair();
      expect(host.role).toBe("host");
      expect(guest.role).toBe("guest");
      expect(host.state).toBe("connected");
      expect(guest.state).toBe("connected");
    });

    it("delivers messages both ways, asynchronously (never re-entrant)", async () => {
      const { host, guest } = createLoopbackPair();
      const got: CoopMessage[] = [];
      guest.onMessage(m => got.push(m));

      const msg: CoopMessage = { t: "ping", ts: 123 };
      host.send(msg);
      expect(got, "not delivered synchronously").toHaveLength(0);
      await flush();
      expect(got).toEqual([msg]);

      const hostGot: CoopMessage[] = [];
      host.onMessage(m => hostGot.push(m));
      guest.send({ t: "pong", ts: 456 });
      await flush();
      expect(hostGot).toEqual([{ t: "pong", ts: 456 }]);
    });

    it("close() closes self, disconnects the peer, and stops delivery", async () => {
      const { host, guest } = createLoopbackPair();
      const states: CoopConnectionState[] = [];
      guest.onStateChange(s => states.push(s));
      const got: CoopMessage[] = [];
      guest.onMessage(m => got.push(m));

      host.close();
      expect(host.state).toBe("closed");
      expect(guest.state).toBe("disconnected");
      expect(states).toContain("disconnected");

      host.send({ t: "ping", ts: 1 }); // closed -> no-op
      await flush();
      expect(got).toHaveLength(0);
    });

    it("unsubscribe stops a handler from receiving", async () => {
      const { host, guest } = createLoopbackPair();
      const got: CoopMessage[] = [];
      const off = guest.onMessage(m => got.push(m));
      off();
      host.send({ t: "ping", ts: 1 });
      await flush();
      expect(got).toHaveLength(0);
    });
  });

  describe("ownership model", () => {
    it("partitions the 6-slot party: 0..2 host, 3..5 guest", () => {
      expect([0, 1, 2].map(coopOwnerOfPartySlot)).toEqual(["host", "host", "host"]);
      expect([3, 4, 5].map(coopOwnerOfPartySlot)).toEqual(["guest", "guest", "guest"]);
      expect(COOP_SLOTS_PER_PLAYER).toBe(3);
      expect(coopPartySlotRange("host")).toEqual({ start: 0, end: 3 });
      expect(coopPartySlotRange("guest")).toEqual({ start: 3, end: 6 });
    });

    it("maps field slots: 0 = host active, 1 = guest active", () => {
      expect(coopOwnerOfFieldIndex(0)).toBe("host");
      expect(coopOwnerOfFieldIndex(1)).toBe("guest");
      expect(coopFieldIndexOf("host")).toBe(0);
      expect(coopFieldIndexOf("guest")).toBe(1);
    });
  });

  describe("CoopInteractionTurn", () => {
    it("alternates host/guest and round-trips through JSON", () => {
      const turn = new CoopInteractionTurn();
      expect(turn.current()).toBe("host");
      expect(turn.isOwner("host")).toBe(true);
      turn.advance();
      expect(turn.current()).toBe("guest");
      turn.advance();
      expect(turn.current()).toBe("host");

      expect(CoopInteractionTurn.fromJSON(turn.toJSON()).current()).toBe(turn.current());
      expect(CoopInteractionTurn.fromJSON(5).current()).toBe("guest"); // odd -> guest
      expect(CoopInteractionTurn.fromJSON(-3).current()).toBe("host"); // bad input clamps to host
    });

    it("advance is IDEMPOTENT per interaction (keyed to the observed counter) (#633)", () => {
      const turn = new CoopInteractionTurn();
      // First completion of interaction 0 advances 0 -> 1 and reports it advanced.
      expect(turn.advance(0)).toBe(true);
      expect(turn.toJSON()).toBe(1);
      // A SECOND call for the SAME interaction (still keyed to 0) is a no-op - this is
      // what stops the owner's terminal + the watcher's terminal + the reconcile
      // broadcast from double-counting one interaction.
      expect(turn.advance(0)).toBe(false);
      expect(turn.toJSON()).toBe(1);
      // The next interaction (keyed to 1) advances 1 -> 2.
      expect(turn.advance(1)).toBe(true);
      expect(turn.toJSON()).toBe(2);
      // No-arg advance stays unconditional (legacy callers).
      expect(turn.advance()).toBe(true);
      expect(turn.toJSON()).toBe(3);
    });

    it("mergeRemote is MONOTONIC-MAX - a stale/late broadcast can never rewind (#633)", () => {
      const turn = new CoopInteractionTurn();
      turn.advance(); // counter = 1 (locally advanced)
      turn.advance(); // counter = 2
      // A late broadcast carrying an OLDER value must NOT clobber the correct local
      // counter (the old blind overwrite is exactly what desynced the ME owner/seq).
      turn.mergeRemote(1);
      expect(turn.toJSON()).toBe(2);
      turn.mergeRemote(0);
      expect(turn.toJSON()).toBe(2);
      // A genuinely-ahead peer pulls a behind client forward.
      turn.mergeRemote(5);
      expect(turn.toJSON()).toBe(5);
      // Garbage is ignored.
      turn.mergeRemote(Number.NaN);
      expect(turn.toJSON()).toBe(5);
    });
  });
});
