/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: pp-reduction-on-contact cluster.
//
// Covers ER ability Spiteful (#518). We stub the attacker's `moveset` to
// expose a `PokemonMove`-like object with a tracked `usePp` call and verify
// the proc fires only on contact moves, only when the move id is found in
// the attacker's moveset, and only on actual damaging hits.
// =============================================================================

import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usePp = vi.fn();

beforeEach(() => {
  usePp.mockClear();
});

function makeMovesetEntry(moveId: MoveId) {
  return { moveId, usePp: (count: number) => usePp(count) };
}

function makeStubMon(opts: { moveset?: { moveId: MoveId; usePp: (n: number) => void }[] } = {}): Pokemon {
  return {
    moveset: opts.moveset ?? [],
  } as unknown as Pokemon;
}

function makeStubMove(opts: { id: MoveId; flags: MoveFlags[] }): Move {
  return {
    id: opts.id,
    doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => opts.flags.includes(flag),
  } as unknown as Move;
}

function makeParams(opts: { user: Pokemon; target: Pokemon; move: Move; hitResult?: HitResult; simulated?: boolean }) {
  return {
    pokemon: opts.target,
    opponent: opts.user,
    move: opts.move,
    hitResult: opts.hitResult ?? HitResult.EFFECTIVE,
    damage: 50,
    simulated: opts.simulated ?? false,
  };
}

describe("PpReductionOnContactAbAttr", () => {
  it("constructs and exposes accessors", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    expect(attr.getReduction()).toBe(4);
    expect(attr.requiresContact()).toBe(true);
  });

  it("rejects non-positive reduction values", () => {
    expect(() => new PpReductionOnContactAbAttr({ reduction: 0 })).toThrow();
    expect(() => new PpReductionOnContactAbAttr({ reduction: -1 })).toThrow();
    expect(() => new PpReductionOnContactAbAttr({ reduction: 1.5 })).toThrow();
  });

  it("contactRequired defaults to true", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    expect(attr.requiresContact()).toBe(true);
  });

  it("allows opting out of contact requirement", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4, contactRequired: false });
    expect(attr.requiresContact()).toBe(false);
  });

  it("fires when the attacker uses a contact move present in their moveset", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    const move = makeStubMove({ id: MoveId.TACKLE, flags: [MoveFlags.MAKES_CONTACT] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.TACKLE)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(usePp).toHaveBeenCalledWith(4);
  });

  it("does NOT fire when contactRequired and the move isn't a contact move", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    const move = makeStubMove({ id: MoveId.SWIFT, flags: [] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.SWIFT)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire when the move isn't in the attacker's moveset", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    const move = makeStubMove({ id: MoveId.TACKLE, flags: [MoveFlags.MAKES_CONTACT] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.SCRATCH)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire when the hit was NO_EFFECT (immunity)", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    const move = makeStubMove({ id: MoveId.TACKLE, flags: [MoveFlags.MAKES_CONTACT] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.TACKLE)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move, hitResult: HitResult.NO_EFFECT });
    expect(attr.canApply(params)).toBe(false);
  });

  it("simulated runs do not call usePp", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 4 });
    const move = makeStubMove({ id: MoveId.TACKLE, flags: [MoveFlags.MAKES_CONTACT] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.TACKLE)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move, simulated: true });
    attr.apply(params);
    expect(usePp).not.toHaveBeenCalled();
  });

  it("contact-not-required mode fires on non-contact moves too", () => {
    const attr = new PpReductionOnContactAbAttr({ reduction: 2, contactRequired: false });
    const move = makeStubMove({ id: MoveId.SWIFT, flags: [] });
    const user = makeStubMon({ moveset: [makeMovesetEntry(MoveId.SWIFT)] });
    const target = makeStubMon();
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(usePp).toHaveBeenCalledWith(2);
  });
});
