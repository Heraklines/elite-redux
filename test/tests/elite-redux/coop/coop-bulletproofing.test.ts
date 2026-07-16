/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #807 bulletproofing trio - engine-free unit proofs for the three standard
// netcode measures: monotonic state ticks (Source-style snapshot sequencing),
// the default-deny account-write gate, and protocol version negotiation.
// =============================================================================

import {
  coopAllowAccountWrite,
  coopGateAccountWrite,
  isCoopAccountWriteAllowed,
} from "#data/elite-redux/coop/coop-account-gate";
import { coopAcceptStateTick, coopNextStateTick, resetCoopStateTicks } from "#data/elite-redux/coop/coop-battle-engine";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

describe("#807 A: monotonic state ticks (snapshot sequencing)", () => {
  beforeEach(() => {
    resetCoopStateTicks();
  });

  it("accepts in-order ticks, rejects stale/duplicate, always accepts legacy undefined", () => {
    const t1 = coopNextStateTick();
    const t2 = coopNextStateTick();
    expect(t2).toBeGreaterThan(t1);

    // In-order applies advance the high-water mark.
    expect(coopAcceptStateTick(t1, "test")).toBe(true);
    expect(coopAcceptStateTick(t2, "test")).toBe(true);
    // A stale or duplicate tick is REJECTED - yesterday's snapshot can never
    // stomp today's state (the live stale-resync softlock class).
    expect(coopAcceptStateTick(t1, "test")).toBe(false);
    expect(coopAcceptStateTick(t2, "test")).toBe(false);
    // Legacy senders (no tick) are accepted and do NOT advance the mark.
    expect(coopAcceptStateTick(undefined, "test")).toBe(true);
    expect(coopAcceptStateTick(coopNextStateTick(), "test")).toBe(true);
  });

  it("session reset restarts the tick line (new run, fresh sequence)", () => {
    const t = coopNextStateTick();
    expect(coopAcceptStateTick(t, "test")).toBe(true);
    resetCoopStateTicks();
    // After reset, tick numbering restarts and low ticks are valid again.
    const fresh = coopNextStateTick();
    expect(fresh).toBe(1);
    expect(coopAcceptStateTick(fresh, "test")).toBe(true);
  });
});

describe("#807 B: default-deny account-write gate", () => {
  it("non-co-op writes are always allowed", () => {
    expect(coopGateAccountWrite(false, "test")).toBe(true);
  });

  it("co-op writes are BLOCKED outside a scope and allowed inside one (re-entrant)", () => {
    // Default-deny: an un-allowlisted write during co-op is refused.
    expect(coopGateAccountWrite(true, "leaky-path")).toBe(false);
    expect(isCoopAccountWriteAllowed()).toBe(false);

    // Inside an allowlisted scope the same write proceeds.
    const inner = coopAllowAccountWrite("own-catch", () => {
      expect(isCoopAccountWriteAllowed()).toBe(true);
      expect(coopGateAccountWrite(true, "own-catch")).toBe(true);
      // Re-entrancy: nested scopes stay allowed.
      return coopAllowAccountWrite("nested", () => coopGateAccountWrite(true, "nested"));
    });
    expect(inner).toBe(true);

    // The scope closes cleanly - back to default-deny.
    expect(coopGateAccountWrite(true, "after-scope")).toBe(false);
  });

  it("a throwing scope still closes (no stuck-open allowlist)", () => {
    expect(() =>
      coopAllowAccountWrite("boom", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(isCoopAccountWriteAllowed()).toBe(false);
    expect(coopGateAccountWrite(true, "after-throw")).toBe(false);
  });

  it("keeps the local first-unlock achievement egg grant explicitly scoped", () => {
    const source = readFileSync(resolve(process.cwd(), "src/data/elite-redux/er-achievement-rewards.ts"), "utf8");
    expect(source).toContain('coopAllowAccountWrite("achievement-egg-reward"');
  });
});
