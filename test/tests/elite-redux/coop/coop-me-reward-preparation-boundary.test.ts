/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Mystery battle reward preparation boundary", () => {
  it("keeps reward settlement out of BattleEnd", () => {
    const battleEnd = source("src/phases/battle-end-phase.ts");
    const boundaryStart = battleEnd.indexOf("    let meSettlementRetained = false;");
    const boundaryEnd = battleEnd.indexOf("    // Normal retained wins", boundaryStart);
    const boundary = battleEnd.slice(boundaryStart, boundaryEnd);

    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundary).toContain('this.meSettlementPlan?.continuation === "rewards"');
    expect(boundary).toContain("shouldDeferCoopMeBattleSettlementUntilRewardPreparation()");
    expect(boundary).toMatch(
      /shouldDeferCoopMeBattleSettlementUntilRewardPreparation\(\)[\s\S]*?\) \{[\s\S]*?meSettlementRetained = true;[\s\S]*?\} else if \(this\.meSettlementPlan != null\) \{[\s\S]*?commitCoopMeBattleSettlementAtBattleEnd/u,
    );
  });

  it("awaits automatic preparation before capture and opens the picker only afterward", () => {
    const rewardsPhase = source("src/phases/mystery-encounter-phases.ts");
    const methodStart = rewardsPhase.indexOf("  async doEncounterRewardsAndContinue(): Promise<void> {");
    const methodEnd = rewardsPhase.indexOf("\n  }\n}\n\n/**", methodStart);
    const method = rewardsPhase.slice(methodStart, methodEnd);

    const prepareCall = method.indexOf("const preparation = rewardPlan.prepareAutomaticEffects();");
    const prepareAwait = method.indexOf("await preparation;");
    const capture = method.indexOf("commitCoopMeBattleSettlementAfterRewardPreparation(this.meSettlementPlan);");
    const picker = method.indexOf("encounter.doEncounterRewards();");

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(prepareCall).toBeGreaterThanOrEqual(0);
    expect(prepareAwait).toBeGreaterThan(prepareCall);
    expect(capture).toBeGreaterThan(prepareAwait);
    expect(picker).toBeGreaterThan(capture);
  });

  it("keeps setEncounterRewards callsites on a typed preparation/surface adapter", () => {
    const encounter = source("src/data/mystery-encounters/mystery-encounter.ts");
    const utilities = source("src/data/mystery-encounters/utils/encounter-phase-utils.ts");

    expect(encounter).toContain("export interface MysteryEncounterRewardPlan");
    expect(encounter).toContain('readonly kind: "modifier";');
    expect(utilities).toContain("prepareAutomaticEffects: () => preRewardsCallback?.(),");
    expect(utilities).toContain("encounter.doEncounterRewards = rewardPlan.openRewardSurfaces;");
  });
});
