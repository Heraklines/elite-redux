#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeHumanContractTraining } from "./materialize-human-contract-training.mjs";
import { selectLargestContractIdentity } from "./select-largest-contract-identity.mjs";

function decision(id, buildSha, dictionaryHash, sourcePartitionId) {
  return {
    kind: "combat_decision",
    schemaVersion: 4,
    featureSchemaVersion: 4,
    buildSha,
    dictionaryHash,
    decisionId: id,
    episodeId: `episode-${id}`,
    sourcePartitionId,
    policySource: "human-v1",
    policyTarget: true,
    observation: { format: "singles" },
    candidates: [{ id: "move:1" }],
    chosenCandidateId: "move:1",
  };
}

function battleTerminal(id, buildSha, dictionaryHash, sourcePartitionId) {
  return {
    kind: "battle_terminal",
    schemaVersion: 4,
    featureSchemaVersion: 4,
    buildSha,
    dictionaryHash,
    terminalId: `terminal-${id}`,
    episodeId: `episode-${id}`,
    sourcePartitionId,
    outcome: "victory",
  };
}

const root = mkdtempSync(join(tmpdir(), "er-contract-identity-"));
try {
  const input = join(root, "mixed.jsonl");
  writeFileSync(
    input,
    [
      decision("a-1", "build-a", "dictionary-a", "source-a"),
      battleTerminal("a-1", "build-a", "dictionary-a", "source-a"),
      decision("b-1", "build-b", "dictionary-b", "source-b"),
      decision("b-2", "build-b", "dictionary-b", "source-c"),
      battleTerminal("b-1", "build-b", "dictionary-b", "source-b"),
    ]
      .map(record => JSON.stringify(record))
      .join("\n") + "\n",
  );

  await assert.rejects(
    materializeHumanContractTraining(input, join(root, "strict-mixed")),
    /mixes builds or data dictionaries/u,
  );
  const census = await materializeHumanContractTraining(input, join(root, "census"), {
    requireSingleIdentity: false,
  });
  assert.deepEqual(census.buildShas, ["build-a", "build-b"]);
  assert.equal(census.decisions, 3);
  assert.equal(census.battleTerminals, 2);

  const selectedPath = join(root, "selected.jsonl");
  const selection = await selectLargestContractIdentity(input, selectedPath, join(root, "selection.json"));
  assert.equal(selection.selected.buildSha, "build-b");
  assert.equal(selection.selected.decisions, 2);
  assert.equal(readFileSync(selectedPath, "utf8").trim().split("\n").length, 3);

  const selected = await materializeHumanContractTraining(selectedPath, join(root, "strict-selected"));
  assert.deepEqual(selected.buildShas, ["build-b"]);
  assert.deepEqual(selected.dictionaryHashes, ["dictionary-b"]);
} finally {
  if (root.startsWith(tmpdir())) {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("contract identity selection tests passed");
