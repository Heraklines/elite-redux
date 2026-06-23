/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttrBaseParams, PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  ConsumeFirstFlaggedMoveOnUseAbAttr,
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
  FirstTurnPriorityClampAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import type { Pokemon } from "#field/pokemon";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

function priorityPokemon(): Pokemon {
  return {
    tempSummonData: { waveTurnCount: 1 },
  } as unknown as Pokemon;
}

describe("ER first-move priority abilities", () => {
  // The consume-on-LAND helper (Sidewinder 676's base behavior; Coil Up no longer
  // uses this - see the on-USE test below).
  it("consumes the on-land boost helper after a landed biting move", () => {
    const pokemon = priorityPokemon();
    const opponent = { isFainted: () => false } as unknown as Pokemon;
    const priorityAttr = new FirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE);
    const consumeAttr = new ConsumeFirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE);
    const priority = new NumberHolder(0);
    const priorityParams = { pokemon, move: allMoves[MoveId.BITE], priority };

    expect(priorityAttr.canApply(priorityParams)).toBe(true);
    priorityAttr.apply(priorityParams);
    expect(priority.value).toBe(1);

    consumeAttr.apply({
      pokemon,
      opponent,
      move: allMoves[MoveId.BITE],
      hitResult: HitResult.EFFECTIVE,
      damage: 10,
    });
    expect(priorityAttr.canApply(priorityParams)).toBe(false);
  });

  // Coil Up (302): the on-USE consumer spends the boost the first time a biting
  // move is used, EVEN if it does not land (miss / immune / fail) - #632.
  it("consumes Coil Up's boost on a biting move USED, even without a landed hit", () => {
    const priorityAttr = new FirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE);
    const onUseAttr = new ConsumeFirstFlaggedMoveOnUseAbAttr(MoveFlags.BITING_MOVE);
    // The holder just USED Bite (a biting move) - the consumer reads it from move history.
    const pokemon = {
      tempSummonData: { waveTurnCount: 1 },
      getLastXMoves: () => [{ move: MoveId.BITE }],
    } as unknown as Pokemon;
    const params = { pokemon } as unknown as AbAttrBaseParams;
    const priorityParams = { pokemon, move: allMoves[MoveId.BITE], priority: new NumberHolder(0) };

    expect(priorityAttr.canApply(priorityParams), "boost available before use").toBe(true);
    expect(onUseAttr.canApply(params), "a biting move USED triggers consumption (no hit needed)").toBe(true);
    onUseAttr.apply(params);
    expect(priorityAttr.canApply(priorityParams), "boost consumed after the biting move was used").toBe(false);
  });

  it("does NOT consume Coil Up's boost on a non-biting move", () => {
    const onUseAttr = new ConsumeFirstFlaggedMoveOnUseAbAttr(MoveFlags.BITING_MOVE);
    const pokemon = {
      tempSummonData: { waveTurnCount: 1 },
      getLastXMoves: () => [{ move: MoveId.TACKLE }],
    } as unknown as Pokemon;
    expect(onUseAttr.canApply({ pokemon } as unknown as AbAttrBaseParams)).toBe(false);
  });

  it("regains Sidewinder after a direct KO", () => {
    const pokemon = priorityPokemon();
    let fainted = false;
    const opponent = { isFainted: () => fainted } as unknown as Pokemon;
    const priorityAttr = new FirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE);
    const consumeAttr = new ConsumeFirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE, true);
    const params = {
      pokemon,
      opponent,
      move: allMoves[MoveId.BITE],
      hitResult: HitResult.EFFECTIVE,
      damage: 10,
    } as PostMoveInteractionAbAttrParams;

    consumeAttr.apply(params);
    expect(priorityAttr.canApply({ pokemon, move: allMoves[MoveId.BITE], priority: new NumberHolder(0) })).toBe(false);

    fainted = true;
    consumeAttr.apply({ ...params, move: allMoves[MoveId.TACKLE] });
    expect(priorityAttr.canApply({ pokemon, move: allMoves[MoveId.BITE], priority: new NumberHolder(0) })).toBe(true);
  });

  it("clamps negative priority to zero and raises nonnegative priority by one", () => {
    const attr = new FirstTurnPriorityClampAbAttr();
    const pokemon = priorityPokemon();
    const negative = new NumberHolder(-6);
    const neutral = new NumberHolder(0);

    attr.apply({ pokemon, move: allMoves[MoveId.DRAGON_TAIL], priority: negative });
    attr.apply({ pokemon, move: allMoves[MoveId.TACKLE], priority: neutral });

    expect(negative.value).toBe(0);
    expect(neutral.value).toBe(1);
  });
});

describe("ER Rhythmic", () => {
  it("has no maximum repeat cap and resets on a failed move", () => {
    const attr = new RepeatMovePowerBoostAbAttr({ bonus: 0.1 });
    const move = allMoves[MoveId.TACKLE];
    const repeatedPokemon = {
      getLastXMoves: () =>
        Array.from({ length: 20 }, () => ({
          move: MoveId.TACKLE,
          result: MoveResult.SUCCESS,
        })),
    } as unknown as Pokemon;
    const repeatedPower = new NumberHolder(100);
    attr.apply({ pokemon: repeatedPokemon, opponent: repeatedPokemon, move, power: repeatedPower });
    expect(repeatedPower.value).toBe(300);

    const failedPokemon = {
      getLastXMoves: () => [{ move: MoveId.TACKLE, result: MoveResult.FAIL }],
    } as unknown as Pokemon;
    const resetPower = new NumberHolder(100);
    attr.apply({ pokemon: failedPokemon, opponent: failedPokemon, move, power: resetPower });
    expect(resetPower.value).toBe(100);
  });
});
