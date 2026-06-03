/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Unit tests for the offense-side type-change primitive
// (PostAttackChangeTargetTypeAbAttr). When the holder lands a contact attack,
// the target's types are overwritten to a single configured type. Mirror of
// PostDefendChangeAttackerTypeAbAttr. Wires the offensive half of Damp (6) and
// Magical Dust (304).
import { PostAttackChangeTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-change-target-type";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function makeMove(opts: { contact?: boolean; status?: boolean; moveType?: PokemonType } = {}): Move {
  const contact = opts.contact ?? true;
  return {
    category: opts.status ? MoveCategory.STATUS : MoveCategory.PHYSICAL,
    is: (kind: string) => kind === "AttackMove",
    doesFlagEffectApply: () => contact,
    _moveType: opts.moveType ?? PokemonType.NORMAL,
  } as unknown as Move;
}

function makeTarget(): Pokemon & { summonData: { types: PokemonType[] }; updated: boolean } {
  return {
    summonData: { types: [PokemonType.GRASS] },
    updated: false,
    updateInfo() {
      this.updated = true;
    },
  } as unknown as Pokemon & { summonData: { types: PokemonType[] }; updated: boolean };
}

function makeHolder(moveType = PokemonType.NORMAL): Pokemon {
  return { getMoveType: () => moveType } as unknown as Pokemon;
}

function run(attr: PostAttackChangeTargetTypeAbAttr, holder: Pokemon, target: Pokemon, move: Move) {
  const params = { pokemon: holder, opponent: target, move, simulated: false } as unknown as Parameters<
    PostAttackChangeTargetTypeAbAttr["apply"]
  >[0];
  const fired = attr.canApply(params);
  if (fired) {
    attr.apply(params);
  }
  return fired;
}

describe("PostAttackChangeTargetTypeAbAttr (offense-side type change)", () => {
  it("overwrites the target's types to the fixed type on a contact attack", () => {
    const attr = new PostAttackChangeTargetTypeAbAttr({ type: PokemonType.WATER, contactOnly: true });
    const target = makeTarget();
    const fired = run(attr, makeHolder(), target, makeMove({ contact: true }));
    expect(fired).toBe(true);
    expect(target.summonData.types).toEqual([PokemonType.WATER]);
    expect(target.updated).toBe(true);
  });

  it("does NOT fire for a non-contact move when contactOnly", () => {
    const attr = new PostAttackChangeTargetTypeAbAttr({ type: PokemonType.WATER, contactOnly: true });
    const target = makeTarget();
    const fired = run(attr, makeHolder(), target, makeMove({ contact: false }));
    expect(fired).toBe(false);
    expect(target.summonData.types).toEqual([PokemonType.GRASS]);
  });

  it("does NOT fire for status moves (default attackCondition requires a damaging move)", () => {
    const attr = new PostAttackChangeTargetTypeAbAttr({ type: PokemonType.WATER, contactOnly: false });
    const fired = run(attr, makeHolder(), makeTarget(), makeMove({ status: true }));
    expect(fired).toBe(false);
  });

  it("resolves 'moveType' to the holder's move type", () => {
    const attr = new PostAttackChangeTargetTypeAbAttr({ type: "moveType", contactOnly: false });
    const target = makeTarget();
    run(attr, makeHolder(PokemonType.PSYCHIC), target, makeMove({ moveType: PokemonType.PSYCHIC }));
    expect(target.summonData.types).toEqual([PokemonType.PSYCHIC]);
  });
});
