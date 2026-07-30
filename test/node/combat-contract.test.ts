/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  canonicalCombatCandidateId,
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatDecisionRecord,
  type ErCombatMoveCandidate,
  validateCombatDecisionRecord,
  withCanonicalCombatCandidateId,
} from "#data/elite-redux/ai/combat-contract";
import {
  ER_COMBAT_FEATURE_NAMES,
  ER_COMBAT_FEATURE_SCHEMA_VERSION,
  extractErCombatCandidateFeatures,
} from "#data/elite-redux/ai/combat-features";
import {
  type ErSingleTreeModelArtifact,
  type ErTreeModelArtifact,
  scoreErTreeModel,
  validateErTreeModel,
} from "#data/elite-redux/ai/combat-tree-model";
import { describe, expect, it } from "vitest";

describe("ER combat AI contract", () => {
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
      sourcePolicy: "scripted",
      actorSlot: 0,
      earlierCandidateIds: [],
      observation: {} as ErCombatDecisionRecord["observation"],
      candidates: [candidate],
      featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      candidateFeatures: [{ candidateId: candidate.id, values: [0] }],
      chosenCandidateId: candidate.id,
    } satisfies ErCombatDecisionRecord;
    expect(validateCombatDecisionRecord(record)).toEqual([]);
    expect(validateCombatDecisionRecord({ ...record, chosenCandidateId: "missing" })).toContain(
      "chosen candidate must map to exactly one legal candidate",
    );
  });

  it("extracts a fixed finite semantic feature vector without species or move ids", () => {
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
    });
    const mon = (entityId: number, activeSlot: number, types: number[]) => ({
      entityId,
      knowledge: entityId === 1 ? ("self" as const) : ("battle-info" as const),
      partyIndex: entityId === 1 ? 0 : null,
      activeSlot,
      species: entityId === 1 ? 6 : 9,
      form: 0,
      level: 100,
      types,
      hp: 100,
      maxHp: 200,
      status: null,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      stats: [200, 150, 140, 160, 140, 130],
      ability: 1,
      innates: [2, 3, null],
      heldItems: entityId === 1 ? ["LEFTOVERS"] : null,
      moves:
        entityId === 1
          ? [{ slot: 0, moveId: 53, type: 9, category: 1, power: 90, accuracy: 100, priority: 0, ppUsed: 1, maxPp: 10 }]
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
      weather: 0,
      terrain: 0,
      selfParty: [mon(1, 0, [9])],
      opponentActive: [mon(2, 0, [11])],
      opponentRosterSize: 1,
      playerTerasUsed: 0,
    };
    const vector = extractErCombatCandidateFeatures(observation, candidate);
    expect(vector).toHaveLength(ER_COMBAT_FEATURE_NAMES.length);
    expect(vector.every(Number.isFinite)).toBe(true);
    expect(ER_COMBAT_FEATURE_NAMES.some(name => name.includes("species") || name.includes("move_id"))).toBe(false);

    const spreadObservation = {
      ...observation,
      format: 2,
      opponentActive: [mon(2, 0, [11]), { ...mon(3, 1, [12]), hp: 25 }],
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
