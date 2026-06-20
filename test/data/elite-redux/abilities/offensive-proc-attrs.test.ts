/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostAttackApplyBattlerTagAbAttr, PostAttackApplyStatusEffectAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it, vi } from "vitest";

function makePokemon(id: number, status: StatusEffect | null = null): Pokemon {
  return {
    id,
    status: status === null ? null : { effect: status },
    hasAbilityWithAttr: vi.fn(() => false),
    canSetStatus: vi.fn(() => true),
    trySetStatus: vi.fn(),
    canAddTag: vi.fn(() => true),
    addTag: vi.fn(),
    randBattleSeedInt: vi.fn(() => 0),
  } as unknown as Pokemon;
}

function makeMove(contactCheck: ReturnType<typeof vi.fn>): Move {
  return {
    category: MoveCategory.PHYSICAL,
    doesFlagEffectApply: contactCheck,
  } as unknown as Move;
}

function makeParams(holder: Pokemon, target: Pokemon, move: Move) {
  return {
    pokemon: holder,
    opponent: target,
    move,
    hitResult: HitResult.EFFECTIVE,
    damage: 50,
    simulated: false,
  };
}

describe("offensive status and battler-tag proc attrs", () => {
  it("allows a statused holder to inflict a status", () => {
    const holder = makePokemon(1, StatusEffect.BURN);
    const target = makePokemon(2);
    const attr = new PostAttackApplyStatusEffectAbAttr(true, 100, StatusEffect.POISON);
    const params = makeParams(
      holder,
      target,
      makeMove(
        vi.fn(({ flag, user, target: moveTarget }) => {
          expect(flag).toBe(MoveFlags.MAKES_CONTACT);
          expect(user).toBe(holder);
          expect(moveTarget).toBe(target);
          return true;
        }),
      ),
    );

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(target.trySetStatus).toHaveBeenCalledWith(StatusEffect.POISON, holder);
  });

  it("uses the holder as contact user and chance user for battler tags", () => {
    const holder = makePokemon(1, StatusEffect.BURN);
    const target = makePokemon(2);
    const chance = vi.fn((user: Pokemon, chanceTarget: Pokemon) => {
      expect(user).toBe(holder);
      expect(chanceTarget).toBe(target);
      return 100;
    });
    const attr = new PostAttackApplyBattlerTagAbAttr(true, chance, BattlerTagType.ER_FROSTBITE);
    const params = makeParams(
      holder,
      target,
      makeMove(
        vi.fn(({ flag, user, target: moveTarget }) => {
          expect(flag).toBe(MoveFlags.MAKES_CONTACT);
          expect(user).toBe(holder);
          expect(moveTarget).toBe(target);
          return true;
        }),
      ),
    );

    expect(attr.canApply(params)).toBe(true);
    expect(chance).toHaveBeenCalledWith(holder, target, params.move);
    attr.apply(params);
    expect(target.addTag).toHaveBeenCalledWith(BattlerTagType.ER_FROSTBITE);
  });
});
