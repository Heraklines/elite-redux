/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_AUTHORITY_ID,
  COOP_PLAYER_COUNT,
  CoopInteractionTurn,
  type CoopOwnedMon,
  coopInteractionOwnerSeat,
  coopOwnerOfFieldIndex,
  coopOwnerOfFieldSlot,
  coopRoleOfSeat,
  coopSeatIsAuthority,
  coopSeatOfRole,
} from "#data/elite-redux/coop/coop-session";
import { describe, expect, it } from "vitest";

/**
 * M5 (#633): the seat / PlayerId generalization must keep the 2-player model byte-identical
 * (the whole green convergence suite keys off it) while exposing an N-ready seat model. These
 * are pure / engine-free so they run with no scene.
 */
describe("co-op seat / PlayerId model (#633 M5)", () => {
  describe("role <-> seat mapping is bijective for 2 players", () => {
    it("host = seat 0 = authority, guest = seat 1", () => {
      expect(coopSeatOfRole("host")).toBe(0);
      expect(coopSeatOfRole("guest")).toBe(1);
      expect(coopRoleOfSeat(0)).toBe("host");
      expect(coopRoleOfSeat(1)).toBe("guest");
      // Round-trips both directions.
      expect(coopRoleOfSeat(coopSeatOfRole("host"))).toBe("host");
      expect(coopRoleOfSeat(coopSeatOfRole("guest"))).toBe("guest");
    });

    it("the authority is seat 0", () => {
      expect(COOP_AUTHORITY_ID).toBe(0);
      expect(coopSeatIsAuthority(0)).toBe(true);
      expect(coopSeatIsAuthority(1)).toBe(false);
      expect(coopSeatIsAuthority(2)).toBe(false);
    });
  });

  describe("interaction owner: N-ready round-robin subsumes the 2-player parity", () => {
    it("playerCount 2 matches the old even=host / odd=guest parity", () => {
      expect(COOP_PLAYER_COUNT).toBe(2);
      for (let counter = 0; counter < 8; counter++) {
        const seat = coopInteractionOwnerSeat(counter, 2);
        expect(seat).toBe(counter % 2);
        // ownerOf now delegates through the seat model - must be unchanged.
        expect(CoopInteractionTurn.ownerOf(counter)).toBe(counter % 2 === 0 ? "host" : "guest");
      }
    });

    it("round-robins over 3 players (0,1,2,0,1,2,...)", () => {
      const seats = [0, 1, 2, 3, 4, 5, 6].map(c => coopInteractionOwnerSeat(c, 3));
      expect(seats).toEqual([0, 1, 2, 0, 1, 2, 0]);
    });

    it("is safe for negative / non-integer counters and playerCount", () => {
      expect(coopInteractionOwnerSeat(-1, 2)).toBe(1);
      expect(coopInteractionOwnerSeat(-2, 3)).toBe(1);
      expect(coopInteractionOwnerSeat(2.9, 2)).toBe(0);
      // playerCount clamps to at least 1 (never a divide-by-zero / NaN).
      expect(coopInteractionOwnerSeat(5, 0)).toBe(0);
      expect(coopInteractionOwnerSeat(5, -3)).toBe(0);
    });
  });

  describe("field-slot ownership reads the mon's coopOwner tag (N-ready)", () => {
    const host: CoopOwnedMon = { coopOwner: "host" };
    const guest: CoopOwnedMon = { coopOwner: "guest" };
    const untagged: CoopOwnedMon = {};

    it("matches the fixed slot map at the launch order (slot 0 host, slot 1 guest)", () => {
      const field = [host, guest];
      expect(coopOwnerOfFieldSlot(field, 0)).toBe("host");
      expect(coopOwnerOfFieldSlot(field, 1)).toBe("guest");
      // Identical to the legacy fixed-slot resolver for the launch layout.
      expect(coopOwnerOfFieldSlot(field, 0)).toBe(coopOwnerOfFieldIndex(0));
      expect(coopOwnerOfFieldSlot(field, 1)).toBe(coopOwnerOfFieldIndex(1));
    });

    it("tracks the TRUE owner after a slot reorder (a switch / give)", () => {
      // Guest's mon is now in field slot 0, host's in slot 1 (post-reorder). The fixed
      // slot map would report the WRONG owner; the tag-based resolver stays correct.
      const reordered = [guest, host];
      expect(coopOwnerOfFieldSlot(reordered, 0)).toBe("guest");
      expect(coopOwnerOfFieldSlot(reordered, 1)).toBe("host");
    });

    it("falls back to the fixed slot map when the slot is empty or untagged", () => {
      expect(coopOwnerOfFieldSlot([undefined, guest], 0)).toBe("host");
      expect(coopOwnerOfFieldSlot([untagged, guest], 0)).toBe("host");
      expect(coopOwnerOfFieldSlot([host, undefined], 1)).toBe("guest");
    });
  });
});
