#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";
import { auditCombatContractV4Batches, canonicalCandidateId, sourceSplit } from "./combat-contract-v4-audit.mjs";

const SESSION_ID = "session-sensitive-value";
const SOURCE_ID = "source-sensitive-value";
const JOINT_ACTION_ID = `${SESSION_ID}:1:battle-seed:1`;
const DECISION_ID = `${JOINT_ACTION_ID}:0`;
const TRANSITION_ID = `${JOINT_ACTION_ID}:resolved`;

function mon({ self, activeSlot, entityId }) {
  return {
    entityId,
    knowledge: self ? "self" : "battle-info",
    partyIndex: 0,
    activeSlot,
    species: self ? 1 : 4,
    form: 0,
    originalSpecies: self ? 1 : 4,
    originalForm: 0,
    level: 50,
    nativeTypes: [0],
    types: [0],
    hp: self ? 100 : null,
    maxHp: self ? 100 : null,
    hpRatio: 1,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    stats: self ? [100, 100, 100, 100, 100, 100] : null,
    effectiveStats: self ? [100, 100, 100, 100, 100, 100] : null,
    abilities: [
      {
        abilityId: 1,
        source: "active",
        slot: null,
        active: true,
        suppressed: false,
        overridden: false,
        revealed: true,
      },
    ],
    heldItems: [],
    revealState: {
      abilities: "complete",
      items: "complete",
      moves: self ? "complete" : "partial",
      revealedAbilityIds: [1],
      revealedItemIds: [],
      revealedMoveIds: [1],
    },
    tags: [],
    mechanics: [],
    transformation: {
      teraType: 0,
      terastallized: false,
      teraAvailable: self,
      formChanged: false,
      formTransition: null,
    },
    boss: { segments: 0, segmentIndex: 0, phase: null },
    moves: [
      {
        slot: 0,
        moveId: 1,
        baseType: 0,
        type: 0,
        category: 0,
        power: 40,
        accuracy: 100,
        priority: 0,
        ppUsed: 0,
        maxPp: 35,
        usable: true,
        unavailableReasons: [],
        revealed: true,
      },
    ],
    fainted: false,
  };
}

function observation() {
  return {
    version: 4,
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
    selfParty: [mon({ self: true, activeSlot: 0, entityId: 10 })],
    opponentActive: [mon({ self: false, activeSlot: 0, entityId: 20 })],
    opponentKnownParty: [],
    opponentRosterSize: 1,
    playerTerasUsed: 0,
    previousActions: [],
  };
}

function candidate() {
  const value = {
    kind: "move",
    actorSlot: 0,
    moveSlot: 0,
    moveId: 1,
    tera: false,
    targetMode: "resolved",
    targets: [{ side: "opponent", entityId: 20, activeSlot: 0 }],
    baseTypeMultiplier: 1,
    currentStab: true,
    derived: {
      effectivePriority: 0,
      actsBeforeTargets: null,
      orderAssessment: "opponent-action-unknown",
      engineTypeMultiplier: 1,
      targetOutcomes: [
        {
          target: { side: "opponent", entityId: 20, activeSlot: 0 },
          engineTypeMultiplier: 1,
          expectedDamageMin: 10,
          expectedDamageMax: 12,
          expectedCriticalDamage: 18,
          immunityReason: null,
        },
      ],
      expectedDamageMin: 10,
      expectedDamageMax: 12,
      expectedCriticalDamage: 18,
      expectedHits: 1,
      minHits: 1,
      maxHits: 1,
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
    },
  };
  return { ...value, id: canonicalCandidateId(value) };
}

function identity() {
  return { schemaVersion: 4, buildSha: "build-sha", dexHash: "dictionary-hash", dictionaryHash: "dictionary-hash" };
}

function batch() {
  const move = candidate();
  const decision = {
    kind: "combat_decision",
    ...identity(),
    candidateScope: "combat-command",
    episodeId: SESSION_ID,
    splitGroupId: SESSION_ID,
    sourcePartitionId: SOURCE_ID,
    jointActionId: JOINT_ACTION_ID,
    decisionId: DECISION_ID,
    policySource: "human-v1",
    policyTarget: true,
    actorSlot: 0,
    earlierCandidateIds: [],
    observation: observation(),
    candidates: [move],
    featureSchemaVersion: 1,
    candidateFeatures: [{ candidateId: move.id, values: [1, 2, 3] }],
    candidateTokenGroups: [
      {
        candidateId: move.id,
        groups: {
          actor: ["species:1"],
          targets: ["species:4"],
          destination: [],
          field: ["format:1"],
          action: ["move:1"],
        },
      },
    ],
    chosenCandidateId: move.id,
  };
  const transition = {
    kind: "combat_transition",
    ...identity(),
    episodeId: SESSION_ID,
    jointActionId: JOINT_ACTION_ID,
    transitionId: TRANSITION_ID,
    decisionIds: [DECISION_ID],
    resolvedObservation: observation(),
    rewards: {
      damageDealtRatio: 1,
      damageTaken: 0,
      healingDealtRatio: 0,
      healingReceived: 0,
      statusChanges: 0,
      selfFaints: 0,
      opponentFaints: 1,
      shieldSegmentsBroken: 0,
      terminal: 1,
    },
    battleTerminal: "victory",
  };
  const battleTerminal = {
    kind: "battle_terminal",
    ...identity(),
    episodeId: SESSION_ID,
    battleId: `${SESSION_ID}:1:battle-seed`,
    terminalId: `${SESSION_ID}:1:battle-seed:terminal`,
    wave: 1,
    turn: 1,
    outcome: "victory",
    jointActionId: JOINT_ACTION_ID,
    transitionId: TRANSITION_ID,
  };
  const runTerminal = {
    kind: "run_terminal",
    ...identity(),
    episodeId: SESSION_ID,
    splitGroupId: SESSION_ID,
    sourcePartitionId: SOURCE_ID,
    outcome: "victory",
    startWave: 1,
    finalWave: 1,
    wavesCleared: 1,
    truncated: false,
  };
  return {
    envelope: {
      schemaVersion: 2,
      combatContractVersion: 4,
      sessionId: SESSION_ID,
      playerIdHash: SOURCE_ID,
      build: "1.0.0",
      erVersion: "test",
      mode: "solo",
      gameModeId: 0,
      seed: "run-seed",
      startWave: 1,
      difficulty: "hell",
      startedAt: 1,
    },
    seq: 0,
    events: [
      { kind: "combat_contract_decision", t: 1, wave: 1, record: decision },
      { kind: "combat_contract_transition", t: 2, wave: 1, record: transition },
      { kind: "battle_terminal", t: 3, wave: 1, outcome: "victory", record: battleTerminal },
      { kind: "run_outcome", t: 4, wave: 1, outcome: "victory", record: runTerminal },
    ],
  };
}

test("a complete source-owned v4 episode passes every hard gate", () => {
  const report = auditCombatContractV4Batches([batch()]);
  assert.deepEqual(report.findings.hard, {});
  assert.equal(report.eligibility.hardQuarantinedEpisodes, 0);
  assert.equal(report.eligibility.completedOutcomeEligibleEpisodes, 1);
  assert.equal(report.eligibility.winningPolicyEligibleEpisodes, 1);
  assert.equal(report.corpus.records.combat_decision, 1);
});

test("an identical duplicate batch is counted without double-counting records", () => {
  const fixture = batch();
  const report = auditCombatContractV4Batches([fixture, structuredClone(fixture)]);
  assert.equal(report.corpus.exactDuplicateBatches, 1);
  assert.equal(report.corpus.records.combat_decision, 1);
  assert.equal(report.eligibility.hardQuarantinedEpisodes, 0);
});

test("invalid labels and broken joins quarantine the episode without exposing raw ids", () => {
  const fixture = batch();
  fixture.events[0].record.chosenCandidateId = "not-legal";
  fixture.events = fixture.events.filter(event => event.kind !== "combat_contract_transition");
  const report = auditCombatContractV4Batches([fixture]);
  assert.equal(report.eligibility.hardQuarantinedEpisodes, 1);
  assert.ok(report.findings.hard.chosen_candidate_not_exactly_once);
  assert.ok(report.findings.hard.decision_missing_transition);
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes(SESSION_ID), false);
  assert.equal(encoded.includes(SOURCE_ID), false);
});

test("source-account splitting is stable and disjoint by construction", () => {
  assert.equal(sourceSplit(SOURCE_ID), sourceSplit(SOURCE_ID));
  assert.ok(new Set(["train", "validation", "test"]).has(sourceSplit(SOURCE_ID)));
});
