import type { MoodyCoordinatorCommand } from "#data/elite-redux/moody/moody-runtime-coordinator";
import {
  consumeMoodyLivePendingChoice,
  consumeMoodyLiveProjection,
  createMoodyLiveExecutionTarget,
  executeMoodyLiveCommand,
  getHydratedMoodyLiveProjection,
  getMoodyLiveCatchRateMultiplier,
} from "#data/elite-redux/moody/moody-runtime-live-adapter";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { describe, expect, it, vi } from "vitest";

function saveWithOwner(): MoodyModeSaveData {
  return {
    version: 1,
    seed: 1,
    acquisitionRolls: 0,
    draftIndex: 0,
    boons: [{ instanceId: "durable-owner", boonId: "durable-owner", rank: 1, acquiredAtWave: 1 }],
    curses: [],
    recentThreat: [],
  };
}

function addCanonicalApexSegments(save: MoodyModeSaveData, pokemonId: number, segments: readonly number[]): void {
  save.boons.push({
    instanceId: "apex-owner",
    boonId: "apex-plunder",
    rank: 1,
    target: { pokemonIds: [pokemonId] },
    progress: { values: { __moodyRuntimeValuesV1: JSON.stringify({ apexSegments: segments }) } },
    acquiredAtWave: 1,
  });
}

describe("Moody live projection persistence", () => {
  it("survives save/reload and recreation of the live target", () => {
    const save = saveWithOwner();
    const target = createMoodyLiveExecutionTarget();
    const execute = (command: MoodyCoordinatorCommand): void => executeMoodyLiveCommand(save, target, command);
    const progression = (
      kind: Extract<MoodyCoordinatorCommand, { domain: "progression" }>["kind"],
      data: MoodyCoordinatorCommand["data"],
    ) => execute({ domain: "progression", effectId: "durable-owner", kind, data });

    progression("ledger-mark-earned", { mark: 3 });
    progression("queue-post-battle-hunter-choice", { amount: 2 });
    progression("choose-progression-imprints", { eligibleImprints: ["speed", "ability"], capacity: 2 });
    progression("store-apex-segment", { pokemonId: "42", hpFractions: [0.5, 0.25] });
    addCanonicalApexSegments(save, 42, [0.5, 0.25]);
    progression("reveal-cursed-stack", { pokemonId: "42", itemStackId: "LEFTOVERS" });
    progression("set-trainer-roster-size", { size: 8 });
    progression("set-counter-weight", { value: 4, targetPokemonId: "42" });
    progression("set-future-enemy-stat-multiplier", { multiplier: 1.2 });
    progression("apply-item-set-bonuses", { activeSets: [{ setId: "harvest", pieces: 5 }] });
    execute({
      domain: "reward",
      effectId: "durable-owner",
      kind: "offer-feasible-contracts",
      data: { contractIds: ["no-items", "flawless"] },
    });
    execute({
      domain: "reward",
      effectId: "durable-owner",
      kind: "grant-contract-reward",
      data: { contractId: "flawless", tier: "rogue", relicChoice: true },
    });

    const recreated = createMoodyLiveExecutionTarget({}, structuredClone(save));

    expect(recreated.progression).toMatchObject({
      notifications: ["ledger:3"],
      selectedImprints: ["speed", "ability"],
      apexSegmentsByPokemon: { "42": [0.5, 0.25] },
      cursedStack: { pokemonId: "42", itemStackId: "LEFTOVERS" },
      trainerRosterSize: 8,
      counterWeight: 4,
      counterTargetPokemonId: "42",
      futureEnemyStatMultiplier: 1.2,
      activeItemSets: [{ setId: "harvest", pieces: 5 }],
    });
    expect(recreated.progression.pendingChoices).toEqual([
      { kind: "queue-post-battle-hunter-choice", data: { amount: 2 } },
    ]);
    expect(recreated.reward.contractIds).toEqual(["no-items", "flawless"]);
    expect(recreated.reward.grantedContractRewards).toEqual([
      { contractId: "flawless", tier: "rogue", relicChoice: true },
    ]);
    expect(recreated.mutationReceipts).toContain("progression:apply-item-set-bonuses");
  });

  it("returns detached typed snapshots and consumes only the requested queue", () => {
    const save = saveWithOwner();
    const target = createMoodyLiveExecutionTarget();
    executeMoodyLiveCommand(save, target, {
      domain: "progression",
      effectId: "durable-owner",
      kind: "ledger-mark-earned",
      data: { mark: 2 },
    });
    executeMoodyLiveCommand(save, target, {
      domain: "progression",
      effectId: "durable-owner",
      kind: "queue-post-battle-hunter-choice",
      data: { amount: 1 },
    });

    const snapshot = getHydratedMoodyLiveProjection(structuredClone(save));
    snapshot.progression.notifications.push("local-only");
    expect(getHydratedMoodyLiveProjection(save).progression.notifications).toEqual(["ledger:2"]);

    expect(consumeMoodyLiveProjection(save, "notifications")).toEqual(["ledger:2"]);
    const remaining = getHydratedMoodyLiveProjection(save);
    expect(remaining.progression.notifications).toEqual([]);
    expect(remaining.progression.pendingChoices).toHaveLength(1);
  });

  it("consumes one matching pending choice without deleting siblings", () => {
    const save = saveWithOwner();
    const target = createMoodyLiveExecutionTarget();
    for (const [kind, amount] of [
      ["offer-partial-vitamin-transfer", 1],
      ["queue-post-battle-hunter-choice", 2],
      ["offer-partial-vitamin-transfer", 3],
    ] as const) {
      executeMoodyLiveCommand(save, target, {
        domain: "progression",
        effectId: "durable-owner",
        kind,
        data: { amount },
      });
    }
    const before = getHydratedMoodyLiveProjection(save).progression.pendingChoices;
    expect(before).toHaveLength(3);
    expect(consumeMoodyLivePendingChoice(save, "queue-post-battle-hunter-choice")).toEqual(before[1]);
    expect(getHydratedMoodyLiveProjection(save).progression.pendingChoices).toEqual([before[0], before[2]]);
  });

  it("hydrates and consumes capture traits only for the matching encounter", () => {
    const save = saveWithOwner();
    const addGuaranteedTrait = vi.fn();
    const multiplyCatchRate = vi.fn();
    const target = createMoodyLiveExecutionTarget({
      capture: {
        encounterId: "wild:42",
        guaranteedTraits: [],
        catchRateMultiplier: 1,
        addGuaranteedTrait,
        multiplyCatchRate,
      },
    });
    executeMoodyLiveCommand(save, target, {
      domain: "capture",
      effectId: "durable-owner",
      kind: "guarantee-collectible-traits",
      data: { traits: ["egg-move:3:104"] },
    });
    executeMoodyLiveCommand(save, target, {
      domain: "capture",
      effectId: "durable-owner",
      kind: "set-capture-rate-multiplier",
      data: { multiplier: 1.15 },
    });

    expect(getMoodyLiveCatchRateMultiplier(save, "wild:42")).toBeCloseTo(1.15);
    expect(getMoodyLiveCatchRateMultiplier(save, "wild:99")).toBe(1);

    const reapplyTrait = vi.fn();
    const reapplyMultiplier = vi.fn();
    createMoodyLiveExecutionTarget(
      {
        capture: {
          encounterId: "wild:42",
          guaranteedTraits: [],
          catchRateMultiplier: 1,
          addGuaranteedTrait: reapplyTrait,
          multiplyCatchRate: reapplyMultiplier,
        },
      },
      structuredClone(save),
    );
    expect(reapplyTrait).toHaveBeenCalledWith("egg-move:3:104");
    expect(reapplyMultiplier).toHaveBeenCalledWith(1.15);

    expect(consumeMoodyLiveProjection(save, "captureTraits", "wild:99")).toEqual([]);
    expect(getHydratedMoodyLiveProjection(save, "wild:42").capture.guaranteedTraits).toEqual(["egg-move:3:104"]);
    expect(consumeMoodyLiveProjection(save, "captureTraits", "wild:42")).toEqual(["egg-move:3:104"]);
    expect(getHydratedMoodyLiveProjection(save, "wild:42").capture.guaranteedTraits).toEqual([]);
  });
});
