import { generateMoodyEnemyBoonLoadout, MOODY_ENEMY_RUNTIME_BOON_IDS } from "#data/elite-redux/moody/moody-enemy";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => resetMoodyModeState());

describe("Moody enemy boon loadout", () => {
  it("spends every player acquisition point on the current enemy loadout", () => {
    const saved = createMoodyModeState("enemy-parity");
    saved.acquisitionRolls = 18;
    expect(restoreMoodyModeState(saved)).toBe(true);
    const enemy = generateMoodyEnemyBoonLoadout([], 80, 1);
    expect(enemy.boons.reduce((total, boon) => total + boon.rank, 0)).toBe(saved.acquisitionRolls);
    expect(enemy.boons.every(boon => boon.rank <= 3)).toBe(true);
    expect(enemy.boons.every(boon => MOODY_ENEMY_RUNTIME_BOON_IDS.has(boon.boonId))).toBe(true);
  });
});
