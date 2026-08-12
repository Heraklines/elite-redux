import {
  buildMoodyContractRelicChoices,
  buildMoodyRecruiterTraitPlan,
  resolveMoodyCommittedEnemyTargetIndices,
  toMoodyRewardOptionPort,
} from "#data/elite-redux/moody/moody-runtime-game-adapter";
import {
  createMoodyLiveExecutionTarget,
  executeMoodyLiveCommand,
  type MoodyLiveRewardOptionPort,
} from "#data/elite-redux/moody/moody-runtime-live-adapter";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { ModifierTier } from "#enums/modifier-tier";
import { getModifierTypeFuncById, ModifierTypeOption } from "#modifiers/modifier-type";
import { describe, expect, it, vi } from "vitest";

const emptySave = (): MoodyModeSaveData => ({
  version: 1,
  seed: 1,
  acquisitionRolls: 0,
  draftIndex: 0,
  boons: [],
  curses: [],
  recentThreat: [],
  fieldRuntime: {
    version: 1,
    cursor: { battleId: "", waveIndex: 0, turn: 0, segmentIndex: 0, biomeId: -1, biomeEpoch: 0 },
    numbers: [],
    values: [],
    lists: [],
  },
});

describe("Moody live reward adapters", () => {
  it("keeps Borrowed Future commitments bound to field slots after party reorder", () => {
    const currentLead = { id: 22, isActive: () => true, getBattlerIndex: () => 0 };
    const formerLead = { id: 11, isActive: () => false, getBattlerIndex: () => 4 };
    expect(
      resolveMoodyCommittedEnemyTargetIndices({ targetBattlerIndices: [0], targetPokemonIds: ["11"] }, [
        currentLead,
        undefined,
        undefined,
        undefined,
        formerLead,
      ]),
    ).toEqual([0]);
  });

  it("builds deterministic actual relic choices for Relic Hunter contracts", () => {
    const first = buildMoodyContractRelicChoices(91);
    const second = buildMoodyContractRelicChoices(91);

    expect(first).toHaveLength(3);
    expect(second.map(option => option.type.id)).toEqual(first.map(option => option.type.id));
    expect(new Set(first.map(option => option.type.id)).size).toBe(3);
    expect(first.every(option => option.type.id.startsWith("ER_RELIC_"))).toBe(true);
  });

  it("preserves reward identity and records the actual tier delta", () => {
    const type = getModifierTypeFuncById("POTION")();
    type.setTier(ModifierTier.COMMON);
    const option = new ModifierTypeOption(type, 1);
    const originalId = option.type.id;

    toMoodyRewardOptionPort(option).setTier(ModifierTier.ULTRA);

    expect(option.type.id).toBe(originalId);
    expect(option.type.tier).toBe(ModifierTier.ULTRA);
    expect(option.upgradeCount).toBe(3);
  });

  it("hides through the boon-offer contract without mutating item reward IDs", () => {
    const setHidden = vi.fn();
    const itemOption: MoodyLiveRewardOptionPort = {
      id: "POTION",
      getTier: () => ModifierTier.COMMON,
      setTier: vi.fn(),
      getQuantity: () => 1,
      setQuantity: vi.fn(),
      reroll: vi.fn(),
    };
    const target = createMoodyLiveExecutionTarget({
      reward: {
        options: [itemOption],
        boonOffers: [{ id: "offer:1", setHidden }],
        contractIds: [],
        grantedContractRewards: [],
        replacementDisabled: false,
        replacementCost: 0,
        replacementSacrifices: 0,
      },
    });

    executeMoodyLiveCommand(emptySave(), target, {
      domain: "reward",
      effectId: "cursed-draft",
      kind: "hide-beneficial-boon-offer",
      data: { offerId: "offer:1" },
    });

    expect(setHidden).toHaveBeenCalledWith(true);
    expect(itemOption.id).toBe("POTION");
  });

  it("hydrates every queued projection after the live target is recreated", () => {
    const save = emptySave();
    save.boons.push({
      instanceId: "durable-owner",
      boonId: "durable-owner",
      rank: 1,
      acquiredAtWave: 1,
    });
    const target = createMoodyLiveExecutionTarget();
    const execute = (kind: Parameters<typeof executeMoodyLiveCommand>[2]["kind"], data: Record<string, unknown>) => {
      executeMoodyLiveCommand(save, target, {
        domain: kind === "offer-feasible-contracts" || kind === "grant-contract-reward" ? "reward" : "progression",
        effectId: "durable-owner",
        kind,
        data,
      } as Parameters<typeof executeMoodyLiveCommand>[2]);
    };

    execute("ledger-mark-earned", { mark: 3 });
    execute("queue-post-battle-hunter-choice", { amount: 2 });
    execute("choose-progression-imprints", { eligibleImprints: ["speed", "ability"], capacity: 2 });
    execute("store-apex-segment", { pokemonId: "42", hpFractions: [0.5, 0.25] });
    save.boons.push({
      instanceId: "apex-owner",
      boonId: "apex-plunder",
      rank: 1,
      target: { pokemonIds: [42] },
      progress: { values: { __moodyRuntimeValuesV1: JSON.stringify({ apexSegments: [0.5, 0.25] }) } },
      acquiredAtWave: 1,
    });
    execute("reveal-cursed-stack", { pokemonId: "42", itemStackId: "LEFTOVERS" });
    execute("set-trainer-roster-size", { size: 8 });
    execute("set-counter-weight", { value: 4, targetPokemonId: "42" });
    execute("set-future-enemy-stat-multiplier", { multiplier: 1.2 });
    execute("apply-item-set-bonuses", { activeSets: [{ setId: "harvest", pieces: 5 }] });
    execute("offer-feasible-contracts", { contractIds: ["no-items", "flawless"] });
    execute("grant-contract-reward", { contractId: "flawless", tier: "rogue", relicChoice: true });

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

  it("never restores a stale market price over a newly calculated shop price", () => {
    const save = emptySave();
    save.curses.push({
      curseId: "thin-wallet",
      acquiredAtWave: 1,
    });
    const previous = createMoodyLiveExecutionTarget({
      market: {
        price: 0,
        itemEffectValue: 0,
        automaticBiomeHealing: false,
        paidWithBloodDebt: false,
        enhancedPurchase: false,
      },
    });
    executeMoodyLiveCommand(save, previous, {
      domain: "economy",
      effectId: "thin-wallet",
      kind: "set-market-price",
      data: { price: 0 },
    });

    const recreated = createMoodyLiveExecutionTarget(
      {
        market: {
          price: 420,
          itemEffectValue: 1,
          automaticBiomeHealing: true,
          paidWithBloodDebt: false,
          enhancedPurchase: false,
        },
      },
      structuredClone(save),
    );

    expect(recreated.market.price).toBe(420);
    expect(recreated.market.itemEffectValue).toBe(1);
    expect(recreated.market.automaticBiomeHealing).toBe(false);
  });
});

describe("Recruiter's Eye collection planning", () => {
  it("deterministically offers only traits missing from account collection data", () => {
    const collection = { abilityAttr: 1, eggMoveAttr: 1, natureAttr: 1 << 1 };
    const species = {
      abilityIds: [10, 20, 30],
      eggMoveIds: [101, 102, 103, 104],
      natureCount: 4,
    };

    const first = buildMoodyRecruiterTraitPlan(collection, species, 17);
    const second = buildMoodyRecruiterTraitPlan(collection, species, 17);

    expect(second).toEqual(first);
    expect(first.missingTraits.filter(trait => trait.startsWith("ability:"))).toHaveLength(1);
    expect(first.missingTraits).not.toContain("ability:0");
    expect(first.missingTraits).not.toContain("egg-move:0:101");
    expect(first.missingTraits).toEqual(expect.arrayContaining(["egg-move:1:102", "egg-move:2:103", "egg-move:3:104"]));
    expect(first.missingTraits.filter(trait => trait.startsWith("nature:"))).toHaveLength(1);
    expect(first.missingTraits).not.toContain("nature:0");
  });

  it("does not offer duplicate ability slots or already completed traits", () => {
    const plan = buildMoodyRecruiterTraitPlan(
      { abilityAttr: 7, eggMoveAttr: 15, natureAttr: 0b11110 },
      { abilityIds: [10, 10, 30], eggMoveIds: [101, 102, 103, 104], natureCount: 4 },
      3,
    );

    expect(plan.missingTraits).toEqual([]);
    expect(plan.traitRarity).toEqual({});
  });
});
