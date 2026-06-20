/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { BerserkOnThresholdAbAttr } from "#data/elite-redux/archetypes/berserk-on-threshold";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

describe("ER Berserk", () => {
  it("uses one dynamic threshold attr instead of separate Attack and Sp. Atk boosts", () => {
    const attrs = allAbilities[AbilityId.BERSERK].attrs;
    expect(attrs.filter(attr => attr instanceof BerserkOnThresholdAbAttr)).toHaveLength(1);
    expect(attrs.some(attr => attr.constructor.name === "PostDefendHpGatedStatStageChangeAbAttr")).toBe(false);
    expect(attrs.some(attr => attr.constructor.name === "PostDefendStatStageChangeAbAttr")).toBe(false);
  });

  it("uses wave data for its once-per-battle gate", () => {
    const fired = new Set<string>();
    const opponent = {} as unknown as Pokemon;
    const pokemon = {
      hp: 50,
      waveData: { entryEffectsFired: fired },
      getMaxHp: () => 100,
      isOpponent: (candidate: Pokemon) => candidate === opponent,
    } as unknown as Pokemon;
    const params = {
      pokemon,
      opponent,
      move: allMoves[MoveId.TACKLE],
      damage: 20,
      hitResult: HitResult.EFFECTIVE,
      simulated: false,
    } as PostMoveInteractionAbAttrParams;
    const attr = new BerserkOnThresholdAbAttr();

    expect(attr.canApply(params)).toBe(true);
    fired.add("berserk-on-threshold");
    expect(attr.canApply(params)).toBe(false);
  });
});
