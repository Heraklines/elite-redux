/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  canonicalCombatCandidateId,
  committedTurnTargetIndices,
  ER_COMBAT_CONTRACT_VERSION,
  ER_NON_POLICY_TARGET_SOURCES,
  type ErCombatDecisionRecord,
  type ErCombatMoveCandidate,
  validateCombatDecisionRecord,
  withCanonicalCombatCandidateId,
} from "#data/elite-redux/ai/combat-contract";
import {
  ER_COMBAT_FEATURE_NAMES,
  ER_COMBAT_FEATURE_SCHEMA_VERSION,
  extractErCombatCandidateFeatures,
  extractErCombatCandidateTokenGroups,
} from "#data/elite-redux/ai/combat-features";
import {
  type ErSingleTreeModelArtifact,
  type ErTreeModelArtifact,
  scoreErTreeModel,
  validateErTreeModel,
} from "#data/elite-redux/ai/combat-tree-model";
import { describe, expect, it } from "vitest";

describe("ER combat AI contract", () => {
  const derived: ErCombatMoveCandidate["derived"] = {
    effectivePriority: 0,
    actsBeforeTargets: null,
    orderAssessment: "opponent-action-unknown",
    engineTypeMultiplier: null,
    targetOutcomes: [],
    expectedDamageMin: null,
    expectedDamageMax: null,
    expectedCriticalDamage: null,
    expectedHits: null,
    minHits: null,
    maxHits: null,
    immunityReason: null,
    hasDrain: false,
    drainFraction: null,
    hasRecoil: false,
    recoilFraction: null,
    statusChance: null,
    requiresCharge: false,
    forcesRecharge: false,
    createsMoveLock: false,
    moveLockReason: null,
    selfFaints: false,
  };

  const tokenRow = (candidateId: string) => ({
    candidateId,
    groups: { actor: [], targets: [], destination: [], field: [], action: ["action:test"] },
  });

  it("keeps diagnostic tree actions outside policy training", () => {
    expect(ER_NON_POLICY_TARGET_SOURCES.has("diagnostic-tree-v1")).toBe(true);
  });

  it("reads resolved interactive targets before move-default targets", () => {
    expect(committedTurnTargetIndices({ targets: [3], move: { move: 1, targets: [], useMode: 1 } })).toEqual([3]);
    expect(committedTurnTargetIndices({ move: { move: 1, targets: [2, 3], useMode: 1 } })).toEqual([2, 3]);
  });

  it("uses semantic target identity rather than target order", () => {
    const base = {
      kind: "move" as const,
      actorSlot: 0,
      moveSlot: 2,
      moveId: 89,
      tera: false,
      targetMode: "resolved" as const,
      baseTypeMultiplier: 2,
      currentStab: true,
      derived,
    };
    const a = canonicalCombatCandidateId({
      ...base,
      targets: [
        { side: "opponent", entityId: 20, activeSlot: 1 },
        { side: "opponent", entityId: 10, activeSlot: 0 },
      ],
    });
    const b = canonicalCombatCandidateId({
      ...base,
      targets: [
        { side: "opponent", entityId: 10, activeSlot: 0 },
        { side: "opponent", entityId: 20, activeSlot: 1 },
      ],
    });
    expect(a).toBe(b);
  });

  it("distinguishes Tera, target, switch mode, and shift destination", () => {
    const target = { side: "opponent" as const, entityId: 20, activeSlot: 0 };
    const normalInput: Omit<ErCombatMoveCandidate, "id"> = {
      kind: "move",
      actorSlot: 0,
      moveSlot: 0,
      moveId: 53,
      tera: false,
      targetMode: "resolved",
      targets: [target],
      baseTypeMultiplier: 1,
      currentStab: false,
      derived,
    };
    const normal = withCanonicalCombatCandidateId(normalInput);
    const tera = withCanonicalCombatCandidateId({ ...normalInput, tera: true });
    const switchNormal = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 4,
      transfer: "normal",
    });
    const switchBaton = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 4,
      transfer: "baton",
    });
    const shift = withCanonicalCombatCandidateId({ kind: "shift", actorSlot: 0, targetActorSlot: 2 });
    expect(new Set([normal.id, tera.id, switchNormal.id, switchBaton.id, shift.id]).size).toBe(5);
  });

  it("fails a row unless its label maps to exactly one canonical candidate", () => {
    const candidate = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 2,
      transfer: "normal",
    });
    const record = {
      kind: "combat_decision",
      schemaVersion: ER_COMBAT_CONTRACT_VERSION,
      candidateScope: "combat-command",
      buildSha: "abc",
      dexHash: "dex",
      dictionaryHash: "dict",
      episodeId: "episode",
      jointActionId: "episode:1:1",
      decisionId: "episode:1:1:0",
      policySource: "scripted",
      policyTarget: false,
      actorSlot: 0,
      earlierCandidateIds: [],
      observation: {
        version: ER_COMBAT_CONTRACT_VERSION,
        perspective: "self",
        wave: 1,
        turn: 1,
        biome: 1,
        battleType: 1,
        format: 1,
        weather: null,
        terrain: null,
        fieldEffects: [],
        positionalEffects: [],
        mechanics: [],
        modifiers: [],
        selfParty: [],
        opponentActive: [],
        opponentKnownParty: [],
        opponentRosterSize: 0,
        playerTerasUsed: 0,
        previousActions: [],
      },
      candidates: [candidate],
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      candidateFeatures: [{ candidateId: candidate.id, values: [0] }],
      candidateTokenGroups: [tokenRow(candidate.id)],
      chosenCandidateId: candidate.id,
    } satisfies ErCombatDecisionRecord;
    expect(validateCombatDecisionRecord(record)).toEqual([]);
    expect(validateCombatDecisionRecord({ ...record, chosenCandidateId: "missing" })).toContain(
      "chosen candidate must map to exactly one legal candidate",
    );
  });

  it("extracts a fixed finite semantic feature vector with hashed runtime identities", () => {
    const candidate = withCanonicalCombatCandidateId({
      kind: "move",
      actorSlot: 0,
      moveSlot: 0,
      moveId: 53,
      tera: false,
      targetMode: "resolved",
      targets: [{ side: "opponent", entityId: 2, activeSlot: 0 }],
      baseTypeMultiplier: 2,
      currentStab: true,
      derived,
    });
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This compact fixture varies every public/private visibility field by side.
    const mon = (entityId: number, activeSlot: number, types: number[]) => ({
      entityId,
      knowledge: entityId === 1 ? ("self" as const) : ("battle-info" as const),
      partyIndex: entityId === 1 ? 0 : null,
      activeSlot,
      species: entityId === 1 ? 6 : 9,
      form: 0,
      originalSpecies: entityId === 1 ? 6 : 9,
      originalForm: 0,
      level: 100,
      nativeTypes: types,
      types,
      hp: entityId === 1 ? 100 : null,
      maxHp: entityId === 1 ? 200 : null,
      hpRatio: 0.5,
      status: null,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      stats: entityId === 1 ? [200, 150, 140, 160, 140, 130] : null,
      effectiveStats: entityId === 1 ? [200, 150, 140, 160, 140, 130] : null,
      abilities:
        entityId === 1
          ? [
              {
                abilityId: 1,
                source: "active" as const,
                slot: null,
                active: true,
                suppressed: false,
                overridden: false,
                revealed: true,
              },
              {
                abilityId: 2,
                source: "innate" as const,
                slot: 0,
                active: true,
                suppressed: false,
                overridden: false,
                revealed: true,
              },
            ]
          : [],
      heldItems:
        entityId === 1
          ? [
              {
                itemId: "LEFTOVERS",
                className: "LeftoversModifier",
                stackCount: 1,
                virtualStackCount: 0,
                charges: null,
                consumed: null,
                active: true,
                suppressed: false,
                revealed: true,
                state: [],
              },
            ]
          : null,
      revealState: {
        abilities: entityId === 1 ? ("complete" as const) : ("unknown" as const),
        items: entityId === 1 ? ("complete" as const) : ("unknown" as const),
        moves: entityId === 1 ? ("complete" as const) : ("unknown" as const),
        revealedAbilityIds: entityId === 1 ? [1, 2] : [],
        revealedItemIds: entityId === 1 ? ["LEFTOVERS"] : [],
        revealedMoveIds: entityId === 1 ? [53] : [],
      },
      tags: [],
      mechanics:
        entityId === 1
          ? [
              {
                effectId: "ability-state:foul-harvest",
                scope: "mechanic" as const,
                side: "self" as const,
                turnsLeft: null,
                maxDuration: null,
                sourceMoveId: null,
                sourceEntityId: null,
                targetSlot: 0,
                state: [{ key: "charges", value: 2 }],
              },
            ]
          : [],
      transformation: {
        teraType: 9,
        terastallized: false,
        teraAvailable: entityId === 1,
        formChanged: false,
        formTransition: null,
      },
      boss: { segments: 0, segmentIndex: 0, phase: null },
      moves:
        entityId === 1
          ? [
              {
                slot: 0,
                moveId: 53,
                baseType: 9,
                type: 9,
                category: 1,
                power: 90,
                accuracy: 100,
                priority: 0,
                ppUsed: 1,
                maxPp: 10,
                usable: true,
                unavailableReasons: [],
                revealed: true,
              },
            ]
          : [],
      fainted: false,
    });
    const observation: ErCombatDecisionRecord["observation"] = {
      version: ER_COMBAT_CONTRACT_VERSION,
      perspective: "self",
      wave: 100,
      turn: 3,
      biome: 1,
      battleType: 1,
      format: 1,
      weather: null,
      terrain: null,
      fieldEffects: [],
      positionalEffects: [],
      mechanics: [],
      modifiers: [],
      selfParty: [mon(1, 0, [9])],
      opponentActive: [mon(2, 0, [11])],
      opponentKnownParty: [],
      opponentRosterSize: 1,
      playerTerasUsed: 0,
      previousActions: [],
    };
    const vector = extractErCombatCandidateFeatures(observation, candidate);
    expect(vector).toHaveLength(ER_COMBAT_FEATURE_NAMES.length);
    expect(vector.every(Number.isFinite)).toBe(true);
    expect(ER_COMBAT_FEATURE_NAMES.some(name => name.includes("species_hash"))).toBe(true);
    expect(ER_COMBAT_FEATURE_NAMES.some(name => name.includes("move_id_hash"))).toBe(true);
    const tokens = extractErCombatCandidateTokenGroups(observation, candidate);
    expect(tokens.actor).toContain("species:6:0");
    expect(tokens.actor).toContain("effect:mechanic:ability-state:foul-harvest:state:charges:2");
    expect(tokens.action).toContain("move:53");

    const knownOpponentObservation = {
      ...observation,
      opponentKnownParty: [{ ...mon(3, 1, [12]), activeSlot: null, hpRatio: null }],
      opponentRosterSize: 2,
    };
    expect(extractErCombatCandidateTokenGroups(knownOpponentObservation, candidate).field).toContain(
      "known-opponent:9:0",
    );

    const spreadObservation = {
      ...observation,
      format: 2,
      opponentActive: [mon(2, 0, [11]), { ...mon(3, 1, [12]), hpRatio: 0.125 }],
      opponentRosterSize: 2,
    };
    const spreadCandidate = withCanonicalCombatCandidateId({
      ...candidate,
      targets: [
        { side: "opponent", entityId: 2, activeSlot: 0 },
        { side: "opponent", entityId: 3, activeSlot: 1 },
      ],
    });
    const reversedCandidate = withCanonicalCombatCandidateId({
      ...candidate,
      targets: [...spreadCandidate.targets].reverse(),
    });
    expect(extractErCombatCandidateFeatures(spreadObservation, spreadCandidate)).toEqual(
      extractErCombatCandidateFeatures(spreadObservation, reversedCandidate),
    );
  });

  it("rejects hidden opponent state while allowing explicitly revealed tokens", () => {
    const candidate = withCanonicalCombatCandidateId({
      kind: "switch",
      actorSlot: 0,
      partyIndex: 1,
      transfer: "normal",
    });
    const opponent = {
      entityId: 2,
      knowledge: "battle-info" as const,
      partyIndex: null,
      activeSlot: 0,
      species: 9,
      form: 0,
      originalSpecies: 9,
      originalForm: 0,
      level: 50,
      nativeTypes: [11],
      types: [11],
      hp: null,
      maxHp: null,
      hpRatio: 1,
      status: null,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      stats: null,
      effectiveStats: null,
      abilities: [],
      heldItems: null,
      revealState: {
        abilities: "unknown" as const,
        items: "unknown" as const,
        moves: "unknown" as const,
        revealedAbilityIds: [],
        revealedItemIds: [],
        revealedMoveIds: [],
      },
      tags: [],
      mechanics: [],
      transformation: {
        teraType: null,
        terastallized: false,
        teraAvailable: null,
        formChanged: false,
        formTransition: null,
      },
      boss: { segments: 0, segmentIndex: 0, phase: null },
      moves: [],
      fainted: false,
    };
    const record = {
      kind: "combat_decision",
      schemaVersion: ER_COMBAT_CONTRACT_VERSION,
      candidateScope: "combat-command",
      buildSha: "abc",
      dexHash: "dex",
      dictionaryHash: "dict",
      episodeId: "episode",
      jointActionId: "episode:1:1",
      decisionId: "episode:1:1:0",
      policySource: "scripted",
      policyTarget: false,
      actorSlot: 0,
      earlierCandidateIds: [],
      observation: {
        version: ER_COMBAT_CONTRACT_VERSION,
        perspective: "self",
        wave: 1,
        turn: 1,
        biome: 1,
        battleType: 1,
        format: 1,
        weather: null,
        terrain: null,
        fieldEffects: [],
        positionalEffects: [],
        mechanics: [],
        modifiers: [],
        selfParty: [],
        opponentActive: [opponent],
        opponentKnownParty: [],
        opponentRosterSize: 1,
        playerTerasUsed: 0,
        previousActions: [],
      },
      candidates: [candidate],
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      candidateFeatures: [{ candidateId: candidate.id, values: [0] }],
      candidateTokenGroups: [tokenRow(candidate.id)],
      chosenCandidateId: candidate.id,
    } satisfies ErCombatDecisionRecord;
    expect(validateCombatDecisionRecord(record)).toEqual([]);
    expect(
      validateCombatDecisionRecord({
        ...record,
        observation: {
          ...record.observation,
          opponentActive: [{ ...opponent, stats: [1, 2, 3, 4, 5, 6] }],
        },
      }),
    ).toContain("hidden opponent stats crossed the visibility boundary for entity 2");
    expect(
      validateCombatDecisionRecord({
        ...record,
        observation: {
          ...record.observation,
          opponentActive: [],
          opponentKnownParty: [{ ...opponent, activeSlot: null }],
        },
      }),
    ).toContain("live hidden bench state crossed the visibility boundary for entity 2");
  });

  it("scores the neutral JSON tree format used by the headless policy", () => {
    const model: ErTreeModelArtifact = {
      schemaVersion: 1,
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      featureCount: ER_COMBAT_FEATURE_NAMES.length,
      modelName: "unit-tree",
      modelType: "sklearn_forest",
      aggregation: "mean",
      baseScore: 0,
      trees: [
        [
          { feature: 0, threshold: 0.5, left: 1, right: 2 },
          { feature: -1, threshold: 0, left: -1, right: -1, value: 0.2 },
          { feature: -1, threshold: 0, left: -1, right: -1, value: 0.8 },
        ],
      ],
    };
    expect(validateErTreeModel(model)).toEqual([]);
    expect(scoreErTreeModel(model, [0, ...new Array(model.featureCount - 1).fill(0)])).toBe(0.2);
    expect(scoreErTreeModel(model, [1, ...new Array(model.featureCount - 1).fill(0)])).toBe(0.8);
  });

  it("scores and validates a stacked neutral tree ensemble", () => {
    const member = (name: string, left: number, right: number): ErSingleTreeModelArtifact => ({
      schemaVersion: 1,
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      featureCount: ER_COMBAT_FEATURE_NAMES.length,
      modelName: name,
      modelType: "sklearn_forest",
      aggregation: "mean",
      baseScore: 0,
      trees: [
        [
          { feature: 0, threshold: 0.5, left: 1, right: 2 },
          { feature: -1, threshold: 0, left: -1, right: -1, value: left },
          { feature: -1, threshold: 0, left: -1, right: -1, value: right },
        ],
      ],
    });
    const model: ErTreeModelArtifact = {
      schemaVersion: 2,
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      featureCount: ER_COMBAT_FEATURE_NAMES.length,
      modelName: "unit-stack",
      modelType: "stacked_tree_ensemble",
      members: [member("first", 0, 1), member("second", 1, 3)],
      memberMeans: [0.5, 2],
      memberScales: [0.5, 1],
      weights: [2, -0.5],
      intercept: 0.25,
    };
    expect(validateErTreeModel(model)).toEqual([]);
    expect(scoreErTreeModel(model, [0, ...new Array(model.featureCount - 1).fill(0)])).toBe(-1.25);
    expect(scoreErTreeModel(model, [1, ...new Array(model.featureCount - 1).fill(0)])).toBe(1.75);
  });

  it("reports malformed stacked artifacts without throwing", () => {
    const malformed = {
      schemaVersion: 2,
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      featureCount: ER_COMBAT_FEATURE_NAMES.length,
      modelName: "malformed-stack",
      modelType: "stacked_tree_ensemble",
      members: null,
      memberMeans: "missing",
      memberScales: null,
      weights: {},
      intercept: 0,
    } as unknown as ErTreeModelArtifact;

    expect(validateErTreeModel(malformed)).toEqual(
      expect.arrayContaining([
        "stacked tree artifact members must be an array",
        "stacked tree artifact member means must be an array",
        "stacked tree artifact member scales must be an array",
        "stacked tree artifact weights must be an array",
      ]),
    );
  });
});
