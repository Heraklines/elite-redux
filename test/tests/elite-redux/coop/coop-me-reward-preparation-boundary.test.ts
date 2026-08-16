/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n?/gu, "\n");
}

describe("Mystery battle reward preparation boundary", () => {
  it("keeps reward settlement out of BattleEnd", () => {
    const battleEnd = source("src/phases/battle-end-phase.ts");
    const boundaryStart = battleEnd.indexOf("    let meSettlementRetained = false;");
    const boundaryGuard = battleEnd.indexOf("    if (meSettlementDeferred)", boundaryStart);
    const boundaryEnd = battleEnd.indexOf("    continueMeSettlementTail(meSettlementRetained);", boundaryStart);
    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundaryGuard).toBeGreaterThan(boundaryStart);
    expect(boundaryEnd).toBeGreaterThan(boundaryStart);
    expect(boundaryEnd).toBeGreaterThan(boundaryGuard);
    const boundary = battleEnd.slice(
      boundaryStart,
      boundaryEnd + "    continueMeSettlementTail(meSettlementRetained);".length,
    );
    expect(boundary).toContain('this.meSettlementPlan?.continuation === "rewards"');
    expect(boundary).toContain("shouldDeferCoopMeBattleSettlementUntilRewardPreparation()");
    expect(boundary).toMatch(
      /shouldDeferCoopMeBattleSettlementUntilRewardPreparation\(\)[\s\S]*?\) \{[\s\S]*?meSettlementRetained = true;[\s\S]*?\} else if \(this\.meSettlementPlan != null\) \{[\s\S]*?commitCoopMeBattleSettlementAtBattleEnd/u,
    );
  });

  it("awaits automatic preparation before capture and opens the picker only afterward", () => {
    const rewardsPhase = source("src/phases/mystery-encounter-phases.ts");
    const methodStart = rewardsPhase.indexOf("  async doEncounterRewardsAndContinue(): Promise<void> {");
    const methodEnd = rewardsPhase.indexOf("\n  /** A malformed typed plan", methodStart);
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const method = rewardsPhase.slice(methodStart, methodEnd);

    const prepareCall = method.indexOf("const preparation = rewardPlan.prepareAutomaticEffects();");
    const prepareAwait = method.indexOf("await preparation;");
    const capture = method.search(
      /commitCoopMeBattleSettlementAfterRewardPreparation\(\s*this\.meSettlementPlan,\s*continueAfterSettlement,\s*\(\) => \{\s*settlementDeferred = true;/u,
    );
    const noBattleCapture = method.search(
      /commitCoopMeNoBattleRewardSettlementAfterPreparation\(\s*this\.meSettlementPlan,\s*continueAfterSettlement,\s*\(\) => \{\s*settlementDeferred = true;/u,
    );
    const continuationStart = method.indexOf("const continueAfterSettlement = (): void => {");
    const continuationEnd = method.indexOf("\n    };", continuationStart);
    expect(continuationStart).toBeGreaterThanOrEqual(0);
    expect(continuationEnd).toBeGreaterThan(continuationStart);
    const continuation = method.slice(continuationStart, continuationEnd);
    const deferredGuard = method.indexOf("if (settlementDeferred)");
    const tail = method.indexOf("continueAfterSettlement();", deferredGuard);
    const picker = continuation.indexOf("encounter.doEncounterRewards();");

    expect(prepareCall).toBeGreaterThanOrEqual(0);
    expect(prepareAwait).toBeGreaterThan(prepareCall);
    expect(continuationStart).toBeGreaterThan(prepareAwait);
    expect(picker).toBeGreaterThanOrEqual(0);
    expect(capture).toBeGreaterThan(prepareAwait);
    expect(noBattleCapture).toBeGreaterThan(capture);
    expect(deferredGuard).toBeGreaterThan(noBattleCapture);
    expect(tail).toBeGreaterThan(deferredGuard);
    expect(method.match(/continueAfterSettlement\(\);/gu) ?? []).toHaveLength(1);
    expect(method).not.toContain("setTimeout(");
  });

  it("requires a retained no-battle state image before a typed raw reward carrier can open UI", () => {
    const replay = source("src/phases/coop-replay-me-phase.ts");
    const utilities = source("src/data/mystery-encounters/utils/encounter-phase-utils.ts");
    const runtime = source("src/data/elite-redux/coop/coop-runtime.ts");

    expect(runtime).toContain("export function commitCoopMeNoBattleRewardSettlementAfterPreparation");
    expect(runtime).toContain('terminal: "reward-settled"');
    expect(runtime).toMatch(/battle\.mysteryEncounter\?\.encounterMode\s*!==\s*MysteryEncounterMode\.NO_BATTLE/u);
    expect(runtime).toMatch(/battle\.mysteryEncounter\?\.encounterMode\s*===\s*MysteryEncounterMode\.NO_BATTLE/u);
    expect(utilities).toMatch(
      /encounter\.encounterMode === MysteryEncounterMode\.NO_BATTLE[\s\S]*?mysteryEncounterRewardSurfaces\(encounter, "rewards", addHealPhase\)[\s\S]*?"MysteryEncounterRewardsPhase", addHealPhase, null, settlementPlan/u,
    );
    expect(replay).toContain("typed reward options retained for the declared no-battle reward continuation");
    expect(replay).toContain("private isRewardSettlementSurfaceReady(current: Phase | undefined): boolean");
    expect(replay).toContain('current?.phaseName === "CoopReplayTurnPhase"');
    expect(replay).toContain("this.detachedQuizCompleted");
    expect(replay).toContain('abortActiveCoopReplayTurnPhase("completed mirror quiz retained reward continuation")');
    expect(replay).toMatch(
      /terminal === "reward-settled"[\s\S]*?globalScene\.phaseManager\.clearPhaseQueue\(\)[\s\S]*?"MysteryEncounterRewardsPhase"/u,
    );
  });

  it("keeps every host ME terminal deferral exact, fenced, and legacy-safe", () => {
    const runtime = source("src/data/elite-redux/coop/coop-runtime.ts");
    const helperStart = runtime.indexOf("function continueCoopMeTerminalCommit(");
    const helperEnd = runtime.indexOf(
      "\n/**\n * Production phase terminal proof for an authoritative interaction result.",
      helperStart,
    );
    const registerStart = runtime.indexOf("export function registerCoopMeTerminalRedrive(");
    const registerEnd = runtime.indexOf("\nfunction notifyCoopMeTerminalRedrive", registerStart);
    const redriveStart = runtime.indexOf("function redriveCoopMeTerminal(");
    const redriveEnd = runtime.indexOf("\ntype CoopMeTerminalContinuationResult", redriveStart);
    const handoffStart = runtime.indexOf("export async function coopMeOwnerRelayBattleHandoff(");
    const handoffEnd = runtime.indexOf("\n/**\n * Set up a LOCAL co-op session", handoffStart);
    const battleSettlementStart = runtime.indexOf("export function commitCoopMeBattleSettlementAtBattleEnd(");
    const noBattleSettlementStart = runtime.indexOf(
      "export function commitCoopMeNoBattleRewardSettlementAfterPreparation(",
    );
    const noBattleSettlementEnd = runtime.indexOf(
      "export function holdForCoopMeBattleSettlementAtBattleEnd(",
      noBattleSettlementStart,
    );

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(registerStart).toBeGreaterThanOrEqual(0);
    expect(registerEnd).toBeGreaterThan(registerStart);
    expect(redriveStart).toBeGreaterThanOrEqual(0);
    expect(redriveEnd).toBeGreaterThan(redriveStart);
    expect(handoffStart).toBeGreaterThanOrEqual(0);
    expect(handoffEnd).toBeGreaterThan(handoffStart);
    expect(battleSettlementStart).toBeGreaterThanOrEqual(0);
    expect(noBattleSettlementStart).toBeGreaterThan(battleSettlementStart);
    expect(noBattleSettlementEnd).toBeGreaterThan(noBattleSettlementStart);

    const helper = runtime.slice(helperStart, helperEnd);
    const register = runtime.slice(registerStart, registerEnd);
    const redrive = runtime.slice(redriveStart, redriveEnd);
    const handoff = runtime.slice(handoffStart, handoffEnd);
    const battleSettlement = runtime.slice(battleSettlementStart, noBattleSettlementStart);
    const noBattleSettlement = runtime.slice(noBattleSettlementStart, noBattleSettlementEnd);

    // A malformed/mismatched disposition cannot park anything: operation id, revision, envelope id/kind,
    // and byte identity are all checked before the owning callback is registered.
    expect(helper).toContain("dispositionEnvelope?.revision === dispositionRevision");
    expect(helper).toContain("dispositionEnvelope?.pendingOperation?.id === disposition.operationId");
    expect(helper).toContain("dispositionEnvelope?.pendingOperation?.kind === \"ME_TERMINAL\"");
    expect(helper).toContain("deferred.envelope.revision !== disposition.revision");
    expect(helper).toContain("deferred.envelope.pendingOperation?.id !== disposition.operationId");
    expect(helper).toContain("deferred.envelope.pendingOperation?.kind !== \"ME_TERMINAL\"");
    expect(helper).toContain("JSON.stringify(deferred.envelope) === JSON.stringify(disposition.envelope)");
    const installControl = helper.indexOf("installControl();");
    const validateControl = helper.indexOf("captureCoopActiveMysteryControl()");
    expect(installControl).toBeGreaterThanOrEqual(0);
    expect(validateControl).toBeGreaterThan(installControl);
    expect(helper).toContain("releaseCoopMeDeferredTerminal(fence.operationId)");
    expect(helper).toContain("registerCoopMeTerminalRedrive(");
    expect(helper).not.toContain("setTimeout(");

    // Missing cutover and shared-terminal/runtime/context/battle/pin fences fail closed before a tail can run.
    expect(redrive).toContain("const cutover = coopV2InteractionCutovers.get(runtime);");
    expect(redrive).toContain("if (cutover == null)");
    expect(redrive).toContain("clearCoopMeTerminalRedrive(runtime);");
    expect(helper).toContain("isCoopSharedTerminalFrozen(runtime)");
    expect(helper).toContain("getCoopRuntime() !== runtime");
    expect(helper).toContain("coopSessionGeneration() !== fence.generation");
    expect(helper).toContain("globalScene !== fence.scene");
    expect(helper).toContain("getCoopController() !== fence.controller");
    expect(helper).toContain("globalScene.currentBattle !== fence.battle");
    expect(helper).toContain("coopMeInteractionStartValue() !== fence.pinned");
    expect(helper).toContain("(globalScene.currentBattle?.waveIndex ?? -1) !== fence.wave");

    // Only one exact parked callback is admitted; duplicate registration, authority loss, and an absent
    // deferred envelope cancel/fail closed instead of replacing the owner or inventing a retry.
    expect(register).toContain("operationId.length === 0");
    expect(register).toContain('runtime.controller.authorityRole !== "authority"');
    expect(register).toContain("parked != null && parked.operationId !== operationId");
    expect(register).toContain("refusing duplicate deferred ME terminal wake");
    expect(register).toContain("const deferred = withActiveCoopRuntimeOpState");
    expect(register).toContain("if (deferred == null)");
    expect(register).toContain("onCancel?.();");

    // The host handoff has a Promise-owned deferred branch; raw relay and its compatibility flag are only
    // reached from the validated continuation, while the legacy retry remains restricted to failed commits.
    const deferredHandoffStart = handoff.indexOf('if (disposition.kind === "deferred")');
    const deferredHandoffEnd = handoff.indexOf(
      'if (disposition.kind === "failed" && isCoopMeOperationEnabled())',
      deferredHandoffStart,
    );
    expect(deferredHandoffStart).toBeGreaterThanOrEqual(0);
    expect(deferredHandoffEnd).toBeGreaterThan(deferredHandoffStart);
    const deferredHandoff = handoff.slice(deferredHandoffStart, deferredHandoffEnd);
    expect(deferredHandoff).toContain("new Promise<boolean>");
    expect(deferredHandoff).toContain("return await deferred;");
    expect(deferredHandoff).toContain("relayBattleHandoff();");
    expect(deferredHandoff).not.toContain("setTimeout(");
    expect(handoff).toContain('pump.relayMeBattleHandoff(hostTurn, !isCoopOperationJournalActive());');
    expect(handoff).toContain('if (disposition.kind === "failed" && isCoopMeOperationEnabled())');
    expect(handoff).toContain("await new Promise<void>(resolve => setTimeout(resolve, 250));");

    // The pre-existing disabled/no-journal and non-authoritative paths remain ordinary no-ops/legacy paths;
    // only the live host journal reaches the new typed terminal helper.
    for (const settlement of [battleSettlement, noBattleSettlement]) {
      expect(settlement).toContain("!isCoopMeOperationEnabled()");
      expect(settlement).toContain("!isCoopOperationJournalActive()");
      expect(settlement).toContain('runtime.controller.role !== "host"');
    }
    expect(handoff).toContain("return coopMeInteractionStartValue() < 0;");
    expect(handoff).toContain("isCoopOperationJournalActive() && runtime.controller.role === \"host\"");
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
    expect(settlementPlanStart).toBeGreaterThanOrEqual(0);
    expect(settlementPlanEnd).toBeGreaterThan(settlementPlanStart);
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
    expect(retainedGuestStart).toBeGreaterThanOrEqual(0);
    expect(retainedGuestEnd).toBeGreaterThan(retainedGuestStart);
    const retainedGuest = rewardsPhase.slice(retainedGuestStart, retainedGuestEnd);
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
