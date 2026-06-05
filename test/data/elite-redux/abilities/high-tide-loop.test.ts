/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — regression: High Tide (ER 503) "Triggers 50 BP Surf after using
// a Water-type move." Glacial Rage (788) is the Ice/Blizzard twin. The scripted
// follow-up is itself a move of the SAME type that triggers the ability, so
// without a re-entry guard the follow-up re-triggers the ability → an infinite
// loop (reported as Surf firing ~50× on Manaphy/Kyurem).
//
// The guard lives entirely in `PostAttackScriptedMoveAbAttr.canApply`: it bails
// when the move that just hit IS the scripted follow-up. We verify it directly
// (deterministic, no battle harness): the trigger move fires the follow-up once,
// and the follow-up move itself is refused — so the chain can never recur.
// =============================================================================

import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function stubMove(id: MoveId, type: PokemonType): Move {
  return { id, type, hasFlag: () => false } as unknown as Move;
}

function liveOpponent(): Pokemon {
  return { isFainted: () => false } as unknown as Pokemon;
}

function canApply(attr: PostAttackScriptedMoveAbAttr, move: Move): boolean {
  return attr.canApply({ pokemon: {} as Pokemon, opponent: liveOpponent(), move, simulated: true } as never);
}

describe("ER High Tide / Glacial Rage — scripted follow-up cannot loop", () => {
  it("High Tide fires off a non-Surf Water move but REFUSES its own Surf follow-up", () => {
    const highTide = new PostAttackScriptedMoveAbAttr({
      moveId: MoveId.SURF,
      power: 50,
      typeFilter: [PokemonType.WATER],
    });
    // A different Water move triggers the follow-up...
    expect(canApply(highTide, stubMove(MoveId.WATER_GUN, PokemonType.WATER))).toBe(true);
    // ...but the scripted Surf itself must NOT re-trigger (this is the loop guard).
    expect(canApply(highTide, stubMove(MoveId.SURF, PokemonType.WATER))).toBe(false);
  });

  it("Glacial Rage fires off a non-Blizzard Ice move but REFUSES its own Blizzard follow-up", () => {
    const glacialRage = new PostAttackScriptedMoveAbAttr({
      moveId: MoveId.BLIZZARD,
      power: 50,
      typeFilter: [PokemonType.ICE],
    });
    expect(canApply(glacialRage, stubMove(MoveId.ICE_BEAM, PokemonType.ICE))).toBe(true);
    expect(canApply(glacialRage, stubMove(MoveId.BLIZZARD, PokemonType.ICE))).toBe(false);
  });

  it("does not fire on an off-type move", () => {
    const highTide = new PostAttackScriptedMoveAbAttr({
      moveId: MoveId.SURF,
      power: 50,
      typeFilter: [PokemonType.WATER],
    });
    expect(canApply(highTide, stubMove(MoveId.EMBER, PokemonType.FIRE))).toBe(false);
  });
});
