#!/usr/bin/env node

import { once } from "node:events";
import { createReadStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

async function writeLine(stream, record) {
  if (!stream.write(`${JSON.stringify(record)}\n`)) {
    await once(stream, "drain");
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One streaming pass keeps the 1+ GiB contract cut out of memory.
export async function materializeHumanContractTraining(
  inputPath,
  outputDirectory,
  { requireSingleIdentity = true } = {},
) {
  const input = resolve(inputPath);
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const policy = createWriteStream(`${output}/policy-records.jsonl`, { encoding: "utf8" });
  const transitions = createWriteStream(`${output}/transition-records.jsonl`, { encoding: "utf8" });
  const auxiliary = createWriteStream(`${output}/auxiliary-records.jsonl`, { encoding: "utf8" });
  const summary = {
    input,
    output,
    records: 0,
    kinds: {},
    policySources: {},
    formats: {},
    battleOutcomes: {},
    runOutcomes: {},
    decisions: 0,
    transitions: 0,
    auxiliaryDecisions: 0,
    battleTerminals: 0,
    runTerminals: 0,
    sourcePartitions: 0,
    schemaVersions: [],
    featureSchemaVersions: [],
    buildShas: [],
    dictionaryHashes: [],
  };
  const sourcePartitions = new Set();
  const schemaVersions = new Set();
  const featureSchemaVersions = new Set();
  const buildShas = new Set();
  const dictionaryHashes = new Set();

  const lines = createInterface({
    input: createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const record = JSON.parse(line);
    summary.records++;
    increment(summary.kinds, String(record.kind ?? "unknown"));
    schemaVersions.add(record.schemaVersion);
    if (record.featureSchemaVersion != null) {
      featureSchemaVersions.add(record.featureSchemaVersion);
    }
    if (record.buildSha) {
      buildShas.add(record.buildSha);
    }
    if (record.dictionaryHash) {
      dictionaryHashes.add(record.dictionaryHash);
    }
    if (record.sourcePartitionId) {
      sourcePartitions.add(record.sourcePartitionId);
    }

    switch (record.kind) {
      case "combat_decision": {
        if (record.policySource !== "human-v1" || record.policyTarget !== true) {
          throw new Error(`decision ${record.decisionId ?? "unknown"} is not a human policy target`);
        }
        if (!record.decisionId || !record.episodeId || !record.sourcePartitionId) {
          throw new Error("contract decision is missing stable identity");
        }
        if (record.candidates?.filter(candidate => candidate.id === record.chosenCandidateId).length !== 1) {
          throw new Error(`decision ${record.decisionId} has an invalid chosen candidate`);
        }
        increment(summary.policySources, record.policySource);
        increment(summary.formats, String(record.observation?.format ?? "unknown"));
        summary.decisions++;
        await writeLine(policy, record);
        break;
      }
      case "combat_transition":
        summary.transitions++;
        await writeLine(transitions, record);
        break;
      case "combat_auxiliary_decision":
        if (record.policyTarget !== false) {
          throw new Error(`auxiliary decision ${record.decisionId ?? "unknown"} became a policy target`);
        }
        summary.auxiliaryDecisions++;
        await writeLine(auxiliary, record);
        break;
      case "battle_terminal":
        summary.battleTerminals++;
        increment(summary.battleOutcomes, String(record.outcome ?? "unknown"));
        await writeLine(transitions, record);
        break;
      case "run_terminal":
      case "episode_terminal":
        summary.runTerminals++;
        increment(summary.runOutcomes, String(record.outcome ?? "unknown"));
        await writeLine(policy, record);
        await writeLine(transitions, record);
        break;
      default:
        throw new Error(`unsupported contract record kind ${record.kind}`);
    }
  }

  policy.end();
  transitions.end();
  auxiliary.end();
  await Promise.all([once(policy, "finish"), once(transitions, "finish"), once(auxiliary, "finish")]);

  summary.sourcePartitions = sourcePartitions.size;
  summary.schemaVersions = [...schemaVersions].sort();
  summary.featureSchemaVersions = [...featureSchemaVersions].sort();
  summary.buildShas = [...buildShas].sort();
  summary.dictionaryHashes = [...dictionaryHashes].sort();
  if (requireSingleIdentity) {
    if (summary.schemaVersions.length !== 1 || summary.featureSchemaVersions.length !== 1) {
      throw new Error("training cut mixes contract or feature schemas");
    }
    if (summary.buildShas.length !== 1 || summary.dictionaryHashes.length !== 1) {
      throw new Error("training cut mixes builds or data dictionaries");
    }
  }
  writeFileSync(`${output}/report.json`, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function usage() {
  console.error(
    "Usage: node scripts/ai/materialize-human-contract-training.mjs INPUT_JSONL OUTPUT_DIR [--allow-mixed-identities]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const option = process.argv[4];
  if (process.argv.length === 4 || (process.argv.length === 5 && option === "--allow-mixed-identities")) {
    const summary = await materializeHumanContractTraining(process.argv[2], process.argv[3], {
      requireSingleIdentity: option !== "--allow-mixed-identities",
    });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    usage();
    process.exitCode = 2;
  }
}
