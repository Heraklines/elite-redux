/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op CAPABILITY negotiation (task #896 W2e-R2). Engine-free (lane-A) unit tests for the
// negotiated capability-bit handshake: intersection math, absent-field legacy peer, asymmetric
// flags fail closed BOTH directions, hot-rejoin preserves the negotiated set, re-pair renegotiates,
// and the surface-block / fail-closed predicates. See coop-capabilities.ts.
// =============================================================================

import {
  COOP_CAP_DURABILITY_JOURNAL,
  COOP_CAP_OP_BIOME,
  COOP_CAP_OP_ME,
  COOP_CAP_OP_REWARD,
  COOP_CAP_RENDERER_ALLOWLIST_ENFORCE,
  clearNegotiatedCoopCapabilities,
  getNegotiatedCoopCapabilities,
  hasNegotiatedCoopCapabilities,
  isCoopCapabilityNegotiated,
  isCoopSurfaceCapabilityBlocked,
  negotiateCoopCapabilities,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op capability negotiation (#896 W2e-R2)", () => {
  afterEach(() => {
    // Session-scoped module state: reset so tests never leak a negotiated set into each other.
    clearNegotiatedCoopCapabilities();
  });

  // ---------------------------------------------------------------------------
  // Pure intersection math.
  // ---------------------------------------------------------------------------
  describe("negotiateCoopCapabilities (pure intersection)", () => {
    it("returns the INTERSECTION of the two advertised sets, sorted + deduped", () => {
      const local = [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME, COOP_CAP_OP_REWARD];
      const peer = [COOP_CAP_OP_ME, COOP_CAP_OP_REWARD, COOP_CAP_DURABILITY_JOURNAL];
      expect(negotiateCoopCapabilities(local, peer)).toEqual([COOP_CAP_OP_ME, COOP_CAP_OP_REWARD].sort());
    });

    it("is SYMMETRIC: both peers compute the identical set regardless of argument order", () => {
      const a = [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME, COOP_CAP_RENDERER_ALLOWLIST_ENFORCE];
      const b = [COOP_CAP_OP_ME, COOP_CAP_OP_REWARD, COOP_CAP_RENDERER_ALLOWLIST_ENFORCE];
      expect(negotiateCoopCapabilities(a, b)).toEqual(negotiateCoopCapabilities(b, a));
    });

    it("dedupes duplicate advertisements on either side", () => {
      const local = [COOP_CAP_OP_BIOME, COOP_CAP_OP_BIOME, COOP_CAP_OP_ME];
      const peer = [COOP_CAP_OP_BIOME, COOP_CAP_OP_BIOME];
      expect(negotiateCoopCapabilities(local, peer)).toEqual([COOP_CAP_OP_BIOME]);
    });

    it("returns EMPTY when the sets are disjoint", () => {
      expect(negotiateCoopCapabilities([COOP_CAP_OP_BIOME], [COOP_CAP_OP_ME])).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // Backward compatibility: an OLDER peer sends no capability field.
    // -------------------------------------------------------------------------
    it("treats an ABSENT peer field (undefined) as the EMPTY set -> no features (legacy peer)", () => {
      const local = [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME, COOP_CAP_OP_REWARD];
      expect(negotiateCoopCapabilities(local, undefined)).toEqual([]);
    });

    it("treats an EMPTY peer array the same as an absent field -> no features", () => {
      expect(negotiateCoopCapabilities([COOP_CAP_OP_BIOME], [])).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Asymmetric flags FAIL CLOSED in BOTH directions.
  // ---------------------------------------------------------------------------
  describe("asymmetric advertisement fails closed both directions", () => {
    it("local ON + peer OFF for a capability -> the capability is NOT negotiated (this side)", () => {
      // This peer advertises biome; the other peer does not.
      setNegotiatedCoopCapabilities([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME], [COOP_CAP_OP_ME]);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false);
      expect(isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BIOME)).toBe(true);
      // The mutually-advertised capability IS negotiated.
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
      expect(isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_ME)).toBe(false);
    });

    it("the OTHER side (mirror args) computes the IDENTICAL verdict -> both peers agree", () => {
      // Peer advertises biome, we do not: the intersection drops biome on our side too.
      setNegotiatedCoopCapabilities([COOP_CAP_OP_ME], [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false);
      expect(isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BIOME)).toBe(true);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Fail-closed default: nothing is active until a handshake produces a set.
  // ---------------------------------------------------------------------------
  describe("fail-closed default (no negotiation yet)", () => {
    it("isCoopCapabilityNegotiated is FALSE for everything before any handshake", () => {
      expect(hasNegotiatedCoopCapabilities()).toBe(false);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false);
      expect(isCoopCapabilityNegotiated(COOP_CAP_RENDERER_ALLOWLIST_ENFORCE)).toBe(false);
    });

    it("isCoopSurfaceCapabilityBlocked is FALSE pre-handshake (a surface keeps its local-flag meaning)", () => {
      // No negotiation has run: a surface is not capability-blocked, so its local flag stands alone
      // (this is what keeps single-player + bare adapter unit tests working).
      expect(isCoopSurfaceCapabilityBlocked(COOP_CAP_OP_BIOME)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Session state: store / freeze / query.
  // ---------------------------------------------------------------------------
  describe("session-scoped negotiated set", () => {
    it("stores + returns the frozen effective set and exposes it via the getter", () => {
      const frozen = setNegotiatedCoopCapabilities(
        [COOP_CAP_OP_BIOME, COOP_CAP_OP_REWARD],
        [COOP_CAP_OP_REWARD, COOP_CAP_DURABILITY_JOURNAL],
      );
      expect([...frozen]).toEqual([COOP_CAP_OP_REWARD]);
      expect([...(getNegotiatedCoopCapabilities() ?? [])]).toEqual([COOP_CAP_OP_REWARD]);
      expect(hasNegotiatedCoopCapabilities()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Hot-rejoin PRESERVES the negotiated set; a genuine re-pair RENEGOTIATES.
  // ---------------------------------------------------------------------------
  describe("rejoin vs re-pair", () => {
    it("HOT REJOIN re-runs the handshake with the same sets -> IDENTICAL negotiated set (idempotent)", () => {
      const local = [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME];
      const peer = [COOP_CAP_OP_ME, COOP_CAP_OP_REWARD];
      const first = setNegotiatedCoopCapabilities(local, peer);
      // A hot rejoin re-announces the same hello; the peer re-sends its same set. No clear happens.
      const second = setNegotiatedCoopCapabilities(local, peer);
      expect([...second]).toEqual([...first]);
      expect([...second]).toEqual([COOP_CAP_OP_ME]);
    });

    it("a bare wireGeneration bump does NOT clear the set (only an explicit clear does)", () => {
      setNegotiatedCoopCapabilities([COOP_CAP_OP_ME], [COOP_CAP_OP_ME]);
      // Nothing else touches it: the set survives until a genuine re-pair clears it.
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
    });

    it("a GENUINE RE-PAIR clears then renegotiates against the NEW peer", () => {
      setNegotiatedCoopCapabilities([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME], [COOP_CAP_OP_BIOME, COOP_CAP_OP_ME]);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(true);
      // Fresh control-plane assembly: clear, then a new peer advertises a DIFFERENT set.
      clearNegotiatedCoopCapabilities();
      expect(hasNegotiatedCoopCapabilities()).toBe(false);
      setNegotiatedCoopCapabilities([COOP_CAP_OP_BIOME, COOP_CAP_OP_ME], [COOP_CAP_OP_ME]);
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_BIOME)).toBe(false); // the new peer lacks biome
      expect(isCoopCapabilityNegotiated(COOP_CAP_OP_ME)).toBe(true);
    });
  });
});
