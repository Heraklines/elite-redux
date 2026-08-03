#!/usr/bin/env node

import { once } from "node:events";
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

function recordIdentity(record) {
  const identity = {
    schemaVersion: record.schemaVersion,
    buildSha: record.buildSha,
    dictionaryHash: record.dictionaryHash,
  };
  return Object.values(identity).every(value => value != null && String(value).length > 0) ? identity : null;
}

function identityKey(identity) {
  return JSON.stringify([identity.schemaVersion, identity.buildSha, identity.dictionaryHash]);
}

function readRecord(line, lineNumber) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`contract identity input contains malformed JSON at line ${lineNumber}`);
  }
}

async function forEachRecord(input, visit) {
  const lines = createInterface({
    input: createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (line.trim()) {
      await visit(readRecord(line, lineNumber));
    }
  }
}

function compareCandidates(left, right) {
  return (
    right.decisions - left.decisions
    || right.battleTerminals - left.battleTerminals
    || right.records - left.records
    || left.key.localeCompare(right.key)
  );
}

export async function selectLargestContractIdentity(inputPath, outputPath, reportPath) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  const candidates = new Map();
  await forEachRecord(input, record => {
    const identity = recordIdentity(record);
    if (!identity) {
      throw new Error("contract record is missing schema, build, or dictionary identity");
    }
    const key = identityKey(identity);
    let candidate = candidates.get(key);
    if (!candidate) {
      candidate = {
        ...identity,
        key,
        records: 0,
        decisions: 0,
        battleTerminals: 0,
        runTerminals: 0,
        sourcePartitions: new Set(),
      };
      candidates.set(key, candidate);
    }
    candidate.records++;
    candidate.decisions += record.kind === "combat_decision" ? 1 : 0;
    candidate.battleTerminals += record.kind === "battle_terminal" ? 1 : 0;
    candidate.runTerminals += record.kind === "episode_terminal" || record.kind === "run_terminal" ? 1 : 0;
    if (record.sourcePartitionId) {
      candidate.sourcePartitions.add(record.sourcePartitionId);
    }
  });

  const ranked = [...candidates.values()].sort(compareCandidates);
  const selected = ranked.find(candidate => candidate.decisions > 0 && candidate.battleTerminals > 0);
  if (!selected) {
    throw new Error("no contract identity contains both policy decisions and battle terminals");
  }

  const outputStream = createWriteStream(output, { encoding: "utf8" });
  await forEachRecord(input, async record => {
    const identity = recordIdentity(record);
    if (identity && identityKey(identity) === selected.key && !outputStream.write(`${JSON.stringify(record)}\n`)) {
      await once(outputStream, "drain");
    }
  });
  outputStream.end();
  await once(outputStream, "finish");

  const summarize = candidate => ({
    schemaVersion: candidate.schemaVersion,
    buildSha: candidate.buildSha,
    dictionaryHash: candidate.dictionaryHash,
    records: candidate.records,
    decisions: candidate.decisions,
    battleTerminals: candidate.battleTerminals,
    runTerminals: candidate.runTerminals,
    sourcePartitions: candidate.sourcePartitions.size,
  });
  const report = {
    selectionRule: "require decisions and battle terminals; then most decisions, battle terminals, and records",
    selected: summarize(selected),
    candidates: ranked.map(summarize),
  };
  writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function usage() {
  console.error("Usage: node scripts/ai/select-largest-contract-identity.mjs INPUT_JSONL OUTPUT_JSONL REPORT_JSON");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.length === 5) {
    const report = await selectLargestContractIdentity(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify(report, null, 2));
  } else {
    usage();
    process.exitCode = 2;
  }
}
