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
    const graves = source("src/data/mystery-encounters/encounters/graves-of-the-fallen-encounter.ts");
    const rewardsPhase = source("src/phases/mystery-encounter-phases.ts");
    const replay = source("src/phases/coop-replay-me-phase.ts");
    const runtime = source("src/data/elite-redux/coop/coop-runtime.ts");

    expect(encounter).toContain("export interface MysteryEncounterRewardPlan");
    expect(encounter).toContain(
      "export interface MysteryEncounterModifierRewardSurface extends CoopMeModifierRewardSurfaceProjection",
    );
    expect(encounter).toContain("readonly rewardSurfaceProjections: readonly CoopMeRewardSurfaceProjection[];");
    expect(utilities).toContain("prepareAutomaticEffects: () => {");
    expect(utilities).toContain("encounter.doEncounterRewards = rewardPlan.openRewardSurfaces;");
    expect(utilities).toContain("preRewardsCallback?.(preparationContext)");
    expect(utilities).toContain("registerModifierSurface: settings => {");
    expect(utilities).not.toContain("injectedSurfaces");
    expect(utilities).toContain("queuedModifierSurfaceCountAfterPreparation !== queuedModifierSurfaceCount");
    expect(utilities).toContain("use registerModifierSurface");
    expect(utilities).toContain("const egg = new Egg({ ...eggOptions, pulled: false });");
    expect(utilities).toContain('kind: "egg"');
    expect(utilities).toContain("preparedEggs.push(egg)");
    expect(utilities).toContain("for (const egg of preparedEggs)");
    expect(utilities).toContain("eggOptions.pulled === true");
    expect(utilities).toContain("egg.addEggToGameDataOnce()");
    expect(rewardsPhase).toContain('coopAllowAccountWrite("me-egg-reward"');
    expect(rewardsPhase).toContain("new Egg(eggOptions).addEggToGameDataOnce()");
    expect(graves).toContain("({ registerModifierSurface }) => {");
    expect(graves).toContain("registerModifierSurface(settings);");
    expect(graves).not.toMatch(/unshiftNew\([\s\S]*?"SelectModifierPhase"/u);
    expect(utilities).toContain('makeCoopMeModifierRewardSurfaceProjection("modifier:heal", -1)');
    expect(replay).toContain('"MysteryEncounterRewardsPhase", false, destination.rewardSurfaces');
    expect(replay).not.toContain("destination.rewardShop");
    expect(replay).not.toContain("destination.addHeal");
    const settlementPlanStart = runtime.indexOf("export interface CoopMeBattleSettlementPlan");
    const settlementPlanEnd = runtime.indexOf("\n}\n", settlementPlanStart);
    const settlementPlan = runtime.slice(settlementPlanStart, settlementPlanEnd);
    expect(settlementPlan).toContain("readonly rewardSurfaces: readonly CoopMeRewardSurfaceProjection[];");
    expect(settlementPlan).not.toContain("rewardShop");
    expect(settlementPlan).not.toContain("addHeal");
  });

  it("reconstructs declared surfaces in PhaseTree FIFO order", () => {
    const phaseTree = source("src/phase-tree.ts");
    const rewardsPhase = source("src/phases/mystery-encounter-phases.ts");
    const retainedGuestStart = rewardsPhase.indexOf(
      'coopLog("me", "retained reward continuation: guest opens only the host-stated surfaces"',
    );
    const retainedGuestEnd = rewardsPhase.indexOf("      const guestEncounter", retainedGuestStart);
    const retainedGuest = rewardsPhase.slice(retainedGuestStart, retainedGuestEnd);

    expect(retainedGuestStart).toBeGreaterThanOrEqual(0);
    expect(retainedGuestEnd).toBeGreaterThan(retainedGuestStart);
    expect(phaseTree).toContain("addLevel.push(phase);");
    expect(phaseTree).toContain("return this.levels[this.currentLevel].shift();");
    expect(retainedGuest).toContain("for (const [ordinal, surface] of this.authoritativeRewardSurfaces.entries())");
    expect(retainedGuest).toContain("{ surfaceId: surface.surfaceId, ordinal }");
    expect(retainedGuest).not.toMatch(/authoritativeRewardSurfaces[^\n]*\.(?:reverse|toReversed)\(/u);
  });

  it("threads one immutable surface identity through option and operation addressing", () => {
    const phase = source("src/phases/select-modifier-phase.ts");
    const relay = source("src/data/elite-redux/coop/coop-interaction-relay.ts");
    const operation = source("src/data/elite-redux/coop/coop-reward-operation.ts");
    const envelope = source("src/data/elite-redux/coop/coop-operation-envelope.ts");
    const runtime = source("src/data/elite-redux/coop/coop-runtime.ts");

    expect(phase).toContain("private readonly coopRewardSurface: CoopRewardSurfaceIdentity | undefined;");
    expect(phase).toContain("rewardSurface: this.coopRewardSurface");
    expect(phase).toMatch(/sendRewardOptions\([\s\S]*?this\.coopRewardSurface/u);
    expect(phase).toMatch(/awaitRewardOptions\([\s\S]*?this\.coopRewardSurface/u);
    expect(phase.match(/this\.coopRewardSurface,/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);

    expect(relay).toContain("rewardOptionsKey(seq, reroll, rewardSurface)");
    expect(relay).toContain("rewardOptionsKey(msg.seq, msg.reroll, msg.rewardSurface)");
    expect(relay).toContain("parseCoopRewardOptionsKey(key)");
    expect(operation).toContain("rewardStreamKey(params.surface, params.pinned, params.rewardSurface)");
    expect(operation).toContain("coopRewardOperationActionSlot(params.pinned, ordinal, params.rewardSurface)");
    expect(operation).toContain(
      "rewardSurfaceKey(existing.rewardSurface) === rewardSurfaceKey(prepared.rewardSurface)",
    );
    expect(operation).toContain('return { adopt: false, reason: "reward-surface-mismatch" };');
    expect(runtime).toMatch(/materializeCommittedInteractionChoice\([\s\S]*?payload\.rewardSurface/u);
    expect(envelope).toContain("readonly rewardSurface?: CoopRewardSurfaceIdentity | undefined;");
  });
});
