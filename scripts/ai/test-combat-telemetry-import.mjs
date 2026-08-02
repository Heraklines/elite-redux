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

console.log("combat telemetry importer tests passed");
