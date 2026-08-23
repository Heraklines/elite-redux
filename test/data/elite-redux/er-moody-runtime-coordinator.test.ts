import {
  coordinateMoodyRuntime,
  decodeMoodyCoordinatorCommand,
  executeMoodyCoordinatorCommands,
  hydrateMoodyCoordinatorState,
  MOODY_COORDINATOR_OVERLAP_POLICY,
  MOODY_COORDINATOR_PARENT_HOOKS,
  MOODY_COORDINATOR_RESET_RULES,
  MOODY_COORDINATOR_SAVE_CONTRACT,
  type MoodyCoordinatorCommand,
  type MoodyCoordinatorEvent,
  type MoodyCoordinatorExecutors,
  type MoodyCoordinatorState,
  persistMoodyCoordinatorState,
  resetMoodyCoordinatorCadence,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { describe, expect, it, vi } from "vitest";

const waveEvent: MoodyCoordinatorEvent = {
  type: "wave-completed",
  seed: 77,
  waveIndex: 100,
  victory: true,
  isBoss: true,
  alliedFaintCount: 0,
  partySize: 6,
  money: 1000,
  compoundInterestCapRemaining: 1000,
  biomeFailureShieldAvailable: true,
  activeBoonInstanceIds: ["boon:a", "boon:b", "boon:c"],
};

describe("Moody runtime coordinator", () => {
  it("routes one canonical wave event through progression and economy effects deterministically", () => {
    const state: MoodyCoordinatorState = {
      effects: [
        { effectId: "compound-interest", stage: "rank-two" },
        { effectId: "flawless-ledger", stage: "base", state: { counters: { ledgerProgress: 1 } } },
        { effectId: "hollow-victory", stage: "base", state: { counters: { hollowPenalty: 1 } } },
        { effectId: "reverse-snowball", stage: "base", state: { counters: { flawlessWinStreak: 2 } } },
        { effectId: "mood-swing", stage: "base" },
      ],
    };
    const before = structuredClone(state);
    const first = coordinateMoodyRuntime(state, waveEvent, { overlapMode: "coordinator-owned" });
    const second = coordinateMoodyRuntime(state, waveEvent, { overlapMode: "coordinator-owned" });

    expect(first).toEqual(second);
    expect(state).toEqual(before);
    expect(first.commands.map(command => [command.domain, command.kind])).toEqual([
      ["economy", "grant-money"],
      ["progression", "ledger-mark-earned"],
      ["progression", "set-future-enemy-stat-multiplier"],
      ["progression", "set-dormant-boons"],
    ]);
    expect(first.state.effects[1].state?.counters).toMatchObject({ ledgerMarks: 1, ledgerProgress: 0 });
    expect(first.state.effects[2].state?.counters?.hollowPenalty).toBe(0);
    expect(first.state.effects[3].state?.counters?.flawlessWinStreak).toBe(3);
  });

  it("composes market price commands in active-effect order", () => {
    const result = coordinateMoodyRuntime(
      {
        effects: [
          { effectId: "thin-wallet", stage: "base" },
          { effectId: "the-long-night", stage: "base" },
        ],
      },
      { type: "market-price-query", seed: 1, price: 100, isHealingItem: true },
    );
    expect(result.commands).toEqual([
      { domain: "economy", effectId: "thin-wallet", kind: "set-market-price", data: { price: 130 } },
      { domain: "economy", effectId: "the-long-night", kind: "set-market-price", data: { price: 260 } },
    ]);
  });

  it("coordinates pre-Luck reward changes and a neutral Cursed Draft card", () => {
    const result = coordinateMoodyRuntime(
      {
        effects: [
          { effectId: "flawless-ledger", stage: "base", state: { counters: { ledgerMarks: 6 } } },
          { effectId: "hollow-victory", stage: "base", state: { counters: { hollowPenalty: 1 } } },
          { effectId: "cursed-draft", stage: "base" },
        ],
      },
      { type: "reward-generated", seed: 12, slotCount: 3, offerIds: ["a", "b", "c"] },
      { overlapMode: "coordinator-owned" },
    );
    expect(result.commands.map(command => command.kind)).toEqual([
      "apply-pre-luck-rarity-uplifts",
      "apply-pre-luck-rarity-penalty",
      "hide-beneficial-boon-offer",
    ]);
    expect(result.commands.every(command => command.domain === "reward")).toBe(true);
  });

  it("emits a typed capture command from Recruiter's Eye", () => {
    const result = coordinateMoodyRuntime(
      { effects: [{ effectId: "recruiter-s-eye", stage: "completionist" }] },
      {
        type: "wild-encounter-generated",
        seed: 5,
        missingTraits: ["ability:2", "nature:timid", "egg-move:7"],
        traitRarity: { "ability:2": 0.2, "nature:timid": 0.8, "egg-move:7": 0.1 },
        completionistCatchMultiplier: 1.15,
      },
    );
    expect(result.commands).toEqual([
      {
        domain: "capture",
        effectId: "recruiter-s-eye",
        kind: "guarantee-collectible-traits",
        data: {
          traits: ["egg-move:7", "ability:2"],
          revealIvsOnFirstCaptureAttempt: true,
        },
      },
    ]);
  });

  it("owns Compound Interest in the coordinator while preventing duplicate capture effects", () => {
    const compoundState: MoodyCoordinatorState = {
      effects: [{ effectId: "compound-interest", stage: "rank-two" }],
    };
    const legacyMoney = coordinateMoodyRuntime(compoundState, waveEvent);
    const coordinatorMoney = coordinateMoodyRuntime(compoundState, waveEvent, {
      overlapMode: "coordinator-owned",
    });
    expect(legacyMoney.commands.filter(command => command.kind === "grant-money")).toHaveLength(1);
    expect(legacyMoney.state.effects[0].state?.counters?.accumulatedInterest).toBe(75);
    expect(coordinatorMoney.commands.filter(command => command.kind === "grant-money")).toHaveLength(1);

    const captureEvent: MoodyCoordinatorEvent = {
      type: "wild-encounter-generated",
      seed: 5,
      missingTraits: ["ability:2"],
      traitRarity: { "ability:2": 0.2 },
      completionistCatchMultiplier: 1.15,
    };
    const recruiterState: MoodyCoordinatorState = {
      effects: [{ effectId: "recruiter-s-eye", stage: "completionist" }],
    };
    expect(coordinateMoodyRuntime(recruiterState, captureEvent).commands.map(command => command.kind)).toEqual([
      "guarantee-collectible-traits",
    ]);
    expect(
      coordinateMoodyRuntime(recruiterState, captureEvent, { overlapMode: "coordinator-owned" }).commands.map(
        command => command.kind,
      ),
    ).toEqual(["guarantee-collectible-traits", "set-capture-rate-multiplier"]);
    expect(MOODY_COORDINATOR_OVERLAP_POLICY.overlappingPaths).toHaveLength(3);

    const cursedDraftState: MoodyCoordinatorState = {
      effects: [{ effectId: "cursed-draft", stage: "base" }],
    };
    const boonDraft: MoodyCoordinatorEvent = {
      type: "reward-generated",
      seed: 12,
      slotCount: 3,
      offerIds: ["a", "b", "c"],
    };
    expect(coordinateMoodyRuntime(cursedDraftState, boonDraft).commands).toEqual([]);
    expect(
      coordinateMoodyRuntime(cursedDraftState, boonDraft, { overlapMode: "coordinator-owned" }).commands,
    ).toHaveLength(1);
  });

  it("routes Set Collector inventory snapshots into active bonuses", () => {
    const result = coordinateMoodyRuntime(
      { effects: [{ effectId: "set-collector", stage: "rank-two" }] },
      {
        type: "item-set-query",
        seed: 8,
        ownedDistinctItemIds: ["QUICK_CLAW", "WIDE_LENS"],
        chosenSetId: "tacticians-tools",
      },
    );
    expect(result.commands).toEqual([
      expect.objectContaining({
        domain: "progression",
        effectId: "set-collector",
        kind: "apply-item-set-bonuses",
      }),
    ]);
    expect(result.state.effects[0].state?.values?.activeItemSets).toEqual([
      expect.objectContaining({ setId: "tacticians-tools", pieceCount: 2, tier: 3, accuracyMultiplier: 1.1 }),
    ]);
  });

  it("routes biome progression without losing effect-local state", () => {
    const result = coordinateMoodyRuntime(
      {
        effects: [
          { effectId: "compound-interest", stage: "patient-capital" },
          { effectId: "cursed-inventory", stage: "base" },
          { effectId: "entropy", stage: "base" },
          { effectId: "mortal-wounds", stage: "base", state: { flags: { reviveBlocked: true } } },
          { effectId: "the-long-night", stage: "base" },
        ],
      },
      {
        type: "biome-transition",
        seed: 10,
        waveIndex: 51,
        money: 1000,
        compoundInterestCapRemaining: 500,
        patientCapitalRate: 0.025,
        usageRanking: ["101"],
        eligibleStacksByPokemon: { "101": ["vitamin:atk"] },
        partyMoves: { "101": ["53"] },
        eligibleReplacementsByMove: { "53": ["58"] },
      },
      { overlapMode: "coordinator-owned" },
    );
    expect(result.commands.map(command => command.kind)).toEqual([
      "grant-money",
      "reveal-cursed-stack",
      "replace-party-moves-until-next-biome",
      "disable-automatic-biome-healing",
    ]);
    expect(result.state.effects[3].state?.values?.mortallyWoundedPokemonIds).toEqual([]);
  });

  it("rejects runtime commands without a typed execution contract", () => {
    expect(() => decodeMoodyCoordinatorCommand("unknown", { kind: "untyped-command", data: {} })).toThrow(
      "Moody coordinator has no typed executor contract for unknown:untyped-command",
    );
  });

  it("executes typed command domains sequentially", async () => {
    const order: string[] = [];
    const executors: MoodyCoordinatorExecutors = {
      progression: vi.fn(async command => {
        order.push(`p:${command.kind}`);
      }),
      economy: vi.fn(async command => {
        order.push(`e:${command.kind}`);
      }),
      reward: vi.fn(async command => {
        order.push(`r:${command.kind}`);
      }),
      capture: vi.fn(async command => {
        order.push(`c:${command.kind}`);
      }),
    };
    const commands: MoodyCoordinatorCommand[] = [
      { domain: "economy", effectId: "compound-interest", kind: "grant-money", data: { amount: 50 } },
      { domain: "reward", effectId: "bounty-board", kind: "grant-contract-reward", data: {} },
      { domain: "capture", effectId: "recruiter-s-eye", kind: "guarantee-collectible-traits", data: {} },
    ];
    await executeMoodyCoordinatorCommands(commands, executors);
    expect(order).toEqual(["e:grant-money", "r:grant-contract-reward", "c:guarantee-collectible-traits"]);
  });

  it("publishes exact current parent hook sites without editing them", () => {
    expect(MOODY_COORDINATOR_PARENT_HOOKS.map(hook => `${hook.file}:${hook.currentLine}`)).toEqual([
      "src/phases/battle-end-phase.ts:232",
      "src/phases/victory-phase.ts:342",
      "src/phases/new-biome-encounter-phase.ts:238",
      "src/phases/biome-shop-phase.ts:482",
      "src/phases/biome-shop-phase.ts:1662",
      "src/battle-scene.ts:3876",
      "src/battle-scene.ts:4408",
      "src/phases/select-modifier-phase.ts:1922",
      "src/phases/select-modifier-phase.ts:1023",
      "src/phases/encounter-phase.ts:1247",
      "src/phases/attempt-capture-phase.ts:493",
    ]);
    expect(new Set(MOODY_COORDINATOR_PARENT_HOOKS.map(hook => hook.event))).toEqual(
      new Set([
        "wave-completed",
        "contract-draft",
        "biome-transition",
        "market-price-query",
        "market-purchase",
        "item-set-query",
        "reward-generated",
        "reward-replacement-query",
        "wild-encounter-generated",
        "capture-commit",
      ]),
    );
  });

  it("round-trips counters, flags, primitive values, and structured values through MoodyModeSaveData", () => {
    const save: MoodyModeSaveData = {
      version: 1,
      seed: 5,
      acquisitionRolls: 2,
      draftIndex: 1,
      recentThreat: [],
      boons: [
        {
          instanceId: "compound-interest:10",
          boonId: "compound-interest",
          rank: 3,
          evolutionId: "patient-capital",
          acquiredAtWave: 10,
          progress: { values: { authoredValue: "preserved" } },
        },
        {
          instanceId: "set-collector:20",
          boonId: "set-collector",
          rank: 3,
          evolutionId: "complete-collection",
          acquiredAtWave: 20,
        },
      ],
      curses: [{ curseId: "entropy", acquiredAtWave: 1 }],
    };
    const coordinator: MoodyCoordinatorState = {
      effects: [
        {
          effectId: "compound-interest",
          stage: "patient-capital",
          state: {
            counters: { accumulatedInterest: 125 },
            flags: { active: true },
            values: { authoredValue: "preserved", debts: [{ pokemonId: "101", amount: 20 }] },
          },
        },
        {
          effectId: "set-collector",
          stage: "complete-collection",
          state: {
            values: {
              activeItemSets: [
                {
                  setId: "complete-nutrition",
                  pieceCount: 5,
                  tier: "complete",
                  effect: { statMultipliers: { hp: 1.15, atk: 1.15 } },
                },
              ],
            },
          },
        },
        {
          effectId: "entropy",
          stage: "base",
          state: {
            values: { entropyAssignments: [{ pokemonId: "101", originalMoveId: "53", replacementMoveId: "58" }] },
          },
        },
      ],
    };
    const before = structuredClone(save);
    const persisted = persistMoodyCoordinatorState(save, coordinator);
    const hydrated = hydrateMoodyCoordinatorState(persisted);

    expect(save).toEqual(before);
    expect(persisted.boons[0].progress?.counters?.accumulatedInterest).toBe(125);
    expect(persisted.boons[0].progress?.flags?.active).toBe(true);
    expect(persisted.boons[0].progress?.values?.authoredValue).toBe("preserved");
    expect(hydrated.effects.find(effect => effect.effectId === "compound-interest")).toMatchObject(
      coordinator.effects[0],
    );
    expect(hydrated.effects.find(effect => effect.effectId === "set-collector")?.state?.values).toEqual(
      coordinator.effects[1].state?.values,
    );
    expect(hydrated.effects.find(effect => effect.effectId === "entropy")?.state?.values).toEqual(
      coordinator.effects[2].state?.values,
    );
    expect(MOODY_COORDINATOR_SAVE_CONTRACT.moduleGlobalState).toBe(false);
    expect(MOODY_COORDINATOR_SAVE_CONTRACT.values).toContain("__moodyRuntimeValuesV1");
  });

  it("resets only paths assigned to the requested cadence", () => {
    const state: MoodyCoordinatorState = {
      effects: [
        {
          effectId: "flawless-ledger",
          stage: "rank-two",
          state: {
            counters: { ledgerMarks: 4, ledgerProgress: 2 },
            flags: { ledgerFailureShieldUsed: true },
          },
        },
        {
          effectId: "cursed-draft",
          stage: "base",
          state: { values: { hiddenOfferId: "offer:b" } },
        },
      ],
    };
    const biome = resetMoodyCoordinatorCadence(state, "biome");
    expect(biome.effects[0].state).toEqual({
      counters: { ledgerMarks: 4, ledgerProgress: 2 },
      flags: {},
      values: {},
    });
    expect(biome.effects[1]).toEqual(state.effects[1]);

    const reward = resetMoodyCoordinatorCadence(biome, "reward-screen");
    expect(reward.effects[1].state?.values).toEqual({});
    expect(MOODY_COORDINATOR_RESET_RULES.every(rule => rule.paths.length > 0)).toBe(true);
  });
});
