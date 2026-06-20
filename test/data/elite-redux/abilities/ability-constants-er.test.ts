/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it } from "vitest";

function powerMultipliers(abilityId: AbilityId): number[] {
  return allAbilities[abilityId].attrs
    .filter(attr => attr.constructor.name === "MovePowerBoostAbAttr")
    .map(attr => (attr as unknown as { powerMultiplier: number }).powerMultiplier);
}

function statMultiplier(abilityId: AbilityId, stat: Stat): number | undefined {
  const attr = allAbilities[abilityId].attrs.find(
    candidate =>
      candidate.constructor.name === "StatMultiplierAbAttr" && (candidate as unknown as { stat: Stat }).stat === stat,
  );
  return (attr as unknown as { multiplier: number } | undefined)?.multiplier;
}

describe("ER vanilla ability constants", () => {
  it("uses the dex evasion multipliers", () => {
    expect(statMultiplier(AbilityId.SAND_VEIL, Stat.EVA)).toBe(1.25);
    expect(statMultiplier(AbilityId.SNOW_CLOAK, Stat.EVA)).toBe(1.25);
  });

  it("uses Hustle's all-attack 1.4 power and 0.9 accuracy", () => {
    expect(powerMultipliers(AbilityId.HUSTLE)).toContain(1.4);
    expect(statMultiplier(AbilityId.HUSTLE, Stat.ACC)).toBe(0.9);
    expect(statMultiplier(AbilityId.HUSTLE, Stat.ATK)).toBeUndefined();
  });

  it("uses the dex power constants for Sheer Force, Reckless, and Analytic", () => {
    expect(powerMultipliers(AbilityId.SHEER_FORCE)).toContain(1.3);
    expect(powerMultipliers(AbilityId.RECKLESS)).toContain(1.2);
    expect(powerMultipliers(AbilityId.ANALYTIC)).toContain(1.3);
  });

  it("keeps Brute Force's Reckless conditions mutually exclusive", () => {
    const bruteForceId = ER_ID_MAP.abilities[758] as AbilityId;
    const conditions = allAbilities[bruteForceId].attrs
      .filter(attr => attr.constructor.name === "MovePowerBoostAbAttr")
      .map(
        attr =>
          (attr as unknown as { condition: (user: Pokemon, target: Pokemon | null, move: Move) => boolean }).condition,
      );
    const user = { getTag: () => ({}) } as unknown as Pokemon;

    expect(conditions.filter(condition => condition(user, null, allMoves[MoveId.DOUBLE_EDGE]))).toHaveLength(1);
    expect(conditions.filter(condition => condition(user, null, allMoves[MoveId.TACKLE]))).toHaveLength(1);
  });

  it("refreshes the Reckless and Analytic composites with the corrected values", () => {
    expect(powerMultipliers(ER_ID_MAP.abilities[1007] as AbilityId)).toContain(1.2);
    expect(powerMultipliers(ER_ID_MAP.abilities[793] as AbilityId)).toContain(1.3);
    expect(powerMultipliers(ER_ID_MAP.abilities[860] as AbilityId)).toContain(1.3);
  });
});
