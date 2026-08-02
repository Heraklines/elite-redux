/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("FieldStatShareAbAttr", () => {
  const unshiftNew = vi.fn();

  beforeEach(() => {
    unshiftNew.mockReset();
  });

  it("preserves hostile attribution when propagating a stat drop", () => {
    const holder = {
      isFainted: () => false,
      getBattlerIndex: () => 0,
    } as unknown as Pokemon;
    const other = {
      isFainted: () => false,
      getBattlerIndex: () => 1,
    } as unknown as Pokemon;
    initGlobalScene({
      currentBattle: { turn: 12 },
      getField: () => [holder, other],
      phaseManager: { unshiftNew },
    } as unknown as BattleScene);

    new FieldStatShareAbAttr().apply({
      pokemon: holder,
      stats: [Stat.ATK],
      stages: -1,
      selfTarget: false,
      simulated: false,
    });

    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 1, false, [Stat.ATK], -1);
  });
});
