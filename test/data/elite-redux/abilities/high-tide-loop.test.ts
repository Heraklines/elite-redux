/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — regression: High Tide (ER 503) "Triggers 50 BP Surf after using
// a Water-type move." Glacial Rage (788) is the Ice/Blizzard twin. Two failure
// modes the scripted follow-up must not have:
//
//   1. LOOP — the follow-up is itself a damaging move; without a guard it would
//      re-trigger the ability → an infinite chain (Surf firing ~50× on Manaphy).
//      The follow-up is always cast in MoveUseMode.INDIRECT (a *virtual* use), so
//      the guard bails when the move that just landed was virtual. (Gating on the
//      use-mode rather than the move id means a genuinely SELECTED Surf still
//      triggers — that was the "Thundercall ignores a real Thunder Shock" bug.)
//
//   2. MULTI-HIT — PostAttack fires once per HIT, so a multi-hit Water move would
//      enqueue the follow-up on every strike. We fire only on the final hit
//      (turnData.hitsLeft === 1) so it triggers once per move use.
//
// Both guards live in `PostAttackScriptedMoveAbAttr.canApply`; we verify them
// directly (deterministic, no battle harness).
// =============================================================================

import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function stubMove(id: MoveId, type: PokemonType): Move {
  return { id, type, hasFlag: () => false } as unknown as Move;
}

/** A holder whose last move was used in `useMode`, currently resolving a hit with `hitsLeft` strikes left. */
function stubUser(useMode: MoveUseMode, hitsLeft = 1): Pokemon {
  return { getLastXMoves: () => [{ useMode }], turnData: { hitsLeft } } as unknown as Pokemon;
}

function liveOpponent(): Pokemon {
  return { isFainted: () => false } as unknown as Pokemon;
}

function canApply(attr: PostAttackScriptedMoveAbAttr, move: Move, user: Pokemon): boolean {
  return attr.canApply({ pokemon: user, opponent: liveOpponent(), move, simulated: true } as never);
}

const highTide = () =>
  new PostAttackScriptedMoveAbAttr({ moveId: MoveId.SURF, power: 50, typeFilter: [PokemonType.WATER] });

describe("ER High Tide / Glacial Rage — scripted follow-up cannot loop or multi-fire", () => {
  it("fires after a normally-selected Water move", () => {
    expect(canApply(highTide(), stubMove(MoveId.WATER_GUN, PokemonType.WATER), stubUser(MoveUseMode.NORMAL))).toBe(
      true,
    );
  });

  it("REFUSES a virtual (INDIRECT) cast — its own follow-up cannot re-trigger", () => {
    // The follow-up is enqueued in MoveUseMode.INDIRECT; when it lands the hook
    // sees a virtual last-move and bails, so the chain can never recur.
    expect(canApply(highTide(), stubMove(MoveId.SURF, PokemonType.WATER), stubUser(MoveUseMode.INDIRECT))).toBe(false);
    // ...but a genuinely SELECTED Surf (NORMAL use) still triggers — the guard is
    // use-mode, not move-id (the Thundercall fix).
    expect(canApply(highTide(), stubMove(MoveId.SURF, PokemonType.WATER), stubUser(MoveUseMode.NORMAL))).toBe(true);
  });

  it("fires only ONCE on a multi-hit move (final hit), not per strike", () => {
    const ht = highTide();
    // non-final hits (hitsLeft > 1) are skipped...
    expect(canApply(ht, stubMove(MoveId.WATER_GUN, PokemonType.WATER), stubUser(MoveUseMode.NORMAL, 3))).toBe(false);
    expect(canApply(ht, stubMove(MoveId.WATER_GUN, PokemonType.WATER), stubUser(MoveUseMode.NORMAL, 2))).toBe(false);
    // ...only the final hit enqueues the follow-up.
    expect(canApply(ht, stubMove(MoveId.WATER_GUN, PokemonType.WATER), stubUser(MoveUseMode.NORMAL, 1))).toBe(true);
  });

  it("does not fire on an off-type move", () => {
    expect(canApply(highTide(), stubMove(MoveId.EMBER, PokemonType.FIRE), stubUser(MoveUseMode.NORMAL))).toBe(false);
  });

  it("Glacial Rage (Ice/Blizzard twin) behaves the same", () => {
    const glacialRage = new PostAttackScriptedMoveAbAttr({
      moveId: MoveId.BLIZZARD,
      power: 50,
      typeFilter: [PokemonType.ICE],
    });
    expect(canApply(glacialRage, stubMove(MoveId.ICE_BEAM, PokemonType.ICE), stubUser(MoveUseMode.NORMAL))).toBe(true);
    expect(canApply(glacialRage, stubMove(MoveId.BLIZZARD, PokemonType.ICE), stubUser(MoveUseMode.INDIRECT))).toBe(
      false,
    );
  });
});
