/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  beginActiveCoopMutation,
  CoopMutationLedger,
  setActiveCoopMutationLedger,
} from "#data/elite-redux/coop/coop-mutation-ledger";
import { afterEach, describe, expect, it } from "vitest";

describe("Authority V2 runtime mutation ledger", () => {
  afterEach(() => setActiveCoopMutationLedger(null));

  it("holds exact labelled tokens until each asynchronous owner settles", () => {
    const ledger = new CoopMutationLedger();
    const form = ledger.begin("phase:QuietFormChangePhase");
    const status = ledger.begin("phase:ObtainStatusEffectPhase");

    expect(ledger.snapshot()).toEqual({
      generation: 2,
      pendingTokens: 2,
      activeLabels: ["phase:ObtainStatusEffectPhase", "phase:QuietFormChangePhase"],
    });
    expect(form.settle()).toBe(true);
    expect(form.settle(), "a duplicate completion cannot advance the mutation generation").toBe(false);
    expect(ledger.snapshot()).toEqual({
      generation: 3,
      pendingTokens: 1,
      activeLabels: ["phase:ObtainStatusEffectPhase"],
    });
    expect(status.settle()).toBe(true);
    expect(ledger.snapshot()).toEqual({ generation: 4, pendingTokens: 0, activeLabels: [] });
  });

  it("settles against the captured runtime even after the active destination changes", () => {
    const host = new CoopMutationLedger();
    const guest = new CoopMutationLedger();
    setActiveCoopMutationLedger(host);
    const token = beginActiveCoopMutation("phase:PokemonHealPhase");
    expect(token).not.toBeNull();

    setActiveCoopMutationLedger(guest);
    expect(token?.settle()).toBe(true);
    expect(host.snapshot().pendingTokens, "the host lease closes on the host ledger").toBe(0);
    expect(guest.snapshot(), "the ambient guest ledger is untouched").toEqual({
      generation: 0,
      pendingTokens: 0,
      activeLabels: [],
    });
  });

  it("invalidates stale phase completions at runtime teardown", () => {
    const ledger = new CoopMutationLedger();
    const stale = ledger.begin("phase:PostTurnStatusEffectPhase");
    ledger.reset();
    const retired = ledger.snapshot();

    expect(retired.pendingTokens).toBe(0);
    expect(stale.settle(), "a retired callback cannot mutate the successor runtime's generation").toBe(false);
    expect(ledger.snapshot()).toEqual(retired);
  });

  it("rejects anonymous mutation work so diagnostics are always actionable", () => {
    expect(() => new CoopMutationLedger().begin("   ")).toThrow("non-empty label");
  });
});
