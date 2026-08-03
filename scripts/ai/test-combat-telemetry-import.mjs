#!/usr/bin/env node

import assert from "node:assert/strict";
import { importTelemetryBatches, sourceSplit, TELEMETRY_SOURCES } from "./combat-telemetry-import.mjs";

const envelope = {
  schemaVersion: 1,
  sessionId: "session-a",
  playerIdHash: "account-a",
  build: "build-a",
  erVersion: "er-a",
  mode: "solo",
  gameModeId: 0,
  difficulty: "hell",
};
const battleDecision = {
  kind: "battle_decision",
  t: 1,
  wave: 2,
  actor: "self",
  slotFieldIndex: 0,
  state: { turn: 1, player: [], enemy: [] },
  action: { kind: "move", moveIndex: 0, moveId: 1 },
};
const turnOutcome = {
  kind: "turn_outcome",
  t: 2,
  wave: 2,
  turn: 1,
  state: { turn: 1, player: [], enemy: [] },
  faints: [],
};
const imported = importTelemetryBatches(
  [
    { envelope, seq: 0, events: [battleDecision, turnOutcome] },
    { envelope, seq: 0, events: [battleDecision, turnOutcome] },
    {
      envelope: { ...envelope, sessionId: "session-b" },
      seq: 0,
      events: [battleDecision],
    },
  ],
  { environment: "production", bucket: TELEMETRY_SOURCES.production.bucket },
);

assert.equal(imported.report.environment, "production");
assert.equal(imported.report.bucket, "er-telemetry");
assert.equal(imported.report.legacyDecisions, 2);
assert.equal(imported.report.legacyTurnOutcomes, 1);
assert.equal(imported.report.duplicateRecords, 2);
assert.equal(imported.report.sourcePartitions, 1);
assert.equal(imported.legacyDecisions[0].policySource, "human-v1");
assert.equal(imported.legacyDecisions[0].policyTarget, true);
assert.equal(imported.legacyDecisions[0].terminalOutcomeKnown, false);
assert.equal(imported.legacyDecisions[0].terminalOutcome, "unknown");
assert.equal(imported.legacyDecisions[0].sourcePartitionId, "account-a");
assert.equal(imported.legacyDecisions[0].splitGroupId, "account-a");
assert.equal(imported.legacyDecisions[0].sourceSplit, sourceSplit("account-a"));
assert.deepEqual(new Set(imported.sourcePartitions.map(row => row.sourcePartitionId)), new Set(["account-a"]));
assert.equal(imported.contractRecords.length, 0);
assert.match(imported.report.terminalOutcomePolicy, /no terminal labels are inferred/);

const contractEnvelope = {
  ...envelope,
  schemaVersion: 2,
  combatContractVersion: 4,
  sessionId: "contract-session",
};
const contractIdentity = {
  schemaVersion: 4,
  buildSha: "build-sha",
  dexHash: "dictionary-hash",
  dictionaryHash: "dictionary-hash",
  episodeId: "contract-session",
  sourcePartitionId: "account-a",
};
const contractDecision = {
  ...contractIdentity,
  kind: "combat_decision",
  decisionId: "decision-a",
  policySource: "human-v1",
};
const auxiliaryDecision = {
  ...contractIdentity,
  kind: "combat_auxiliary_decision",
  decisionId: "auxiliary-a",
  policyTarget: false,
};
const transition = {
  ...contractIdentity,
  kind: "combat_transition",
  transitionId: "transition-a",
};
const battleTerminal = {
  ...contractIdentity,
  kind: "battle_terminal",
  terminalId: "battle-terminal-a",
  outcome: "victory",
};
const runTerminal = {
  ...contractIdentity,
  kind: "run_terminal",
  outcome: "player-wiped",
};
const contractImported = importTelemetryBatches(
  [
    {
      envelope: contractEnvelope,
      seq: 0,
      events: [
        { kind: "combat_contract_decision", record: contractDecision },
        { kind: "combat_auxiliary_decision", record: auxiliaryDecision },
        { kind: "combat_contract_transition", record: transition },
        { kind: "battle_terminal", record: battleTerminal },
        { kind: "run_outcome", record: runTerminal },
      ],
    },
  ],
  { environment: "production", bucket: TELEMETRY_SOURCES.production.bucket },
);
assert.equal(contractImported.report.contractDecisions, 1);
assert.equal(contractImported.report.contractAuxiliaryDecisions, 1);
assert.equal(contractImported.report.contractTransitions, 1);
assert.equal(contractImported.report.battleTerminals, 1);
assert.equal(contractImported.report.terminals, 1);
assert.deepEqual(
  new Set(contractImported.contractRecords.map(record => record.kind)),
  new Set(["combat_decision", "combat_auxiliary_decision", "combat_transition", "battle_terminal", "run_terminal"]),
);

console.log("combat telemetry importer tests passed");
