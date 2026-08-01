#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import lzString from "lz-string";

const { decompressFromBase64 } = lzString;

const BUCKET = "er-telemetry-staging";
const API_ROOT = "https://api.cloudflare.com/client/v4";

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: node scripts/ai/download-staging-combat-telemetry.mjs --out DIR [--prefix YYYY-MM-DD/]\n"
      + "Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Reads staging R2 only.",
  );
  process.exit(1);
}

let outDir = "ai-work/staging-human-contract";
let prefix = "";
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--out") {
    outDir = process.argv[++index] ?? usage("--out requires a directory");
  } else if (arg === "--prefix") {
    prefix = process.argv[++index] ?? usage("--prefix requires a value");
  } else if (arg === "--help" || arg === "-h") {
    usage();
  } else {
    usage(`Unknown argument: ${arg}`);
  }
}

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
if (!token || !accountId) {
  usage("Cloudflare read credentials are missing");
}

const headers = { Authorization: `Bearer ${token}` };
const objectBase = `${API_ROOT}/accounts/${accountId}/r2/buckets/${BUCKET}/objects`;

async function listObjects() {
  const objects = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({ per_page: "1000" });
    if (prefix) {
      params.set("prefix", prefix);
    }
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await fetch(`${objectBase}?${params}`, { headers });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) {
      throw new Error(`R2 object list failed: ${response.status} ${JSON.stringify(payload.errors ?? [])}`);
    }
    objects.push(...payload.result);
    cursor = payload.result_info?.is_truncated ? (payload.result_info.cursor ?? "") : "";
  } while (cursor);
  return objects;
}

async function readBatch(object) {
  const response = await fetch(`${objectBase}/${object.key}`, { headers });
  if (!response.ok) {
    throw new Error(`R2 object read failed: ${response.status} ${object.key}`);
  }
  const encoded = await response.text();
  const json = object.custom_metadata?.enc === "lz" ? decompressFromBase64(encoded) : encoded;
  if (!json) {
    throw new Error(`R2 object decode failed: ${object.key}`);
  }
  return JSON.parse(json);
}

const objects = await listObjects();
const recordsByKey = new Map();
const sourcePartitions = new Set();
const episodes = new Set();
const report = {
  bucket: BUCKET,
  prefix,
  objects: objects.length,
  bytes: objects.reduce((sum, object) => sum + (object.size ?? 0), 0),
  batches: 0,
  legacyDecisions: 0,
  contractDecisions: 0,
  terminals: 0,
  duplicateRecords: 0,
  invalidContractEvents: 0,
  sourcePartitions: 0,
  episodes: 0,
  outcomes: {},
  policySources: {},
  schemaVersions: {},
};

for (let offset = 0; offset < objects.length; offset += 16) {
  const batches = await Promise.all(objects.slice(offset, offset + 16).map(readBatch));
  for (const batch of batches) {
    report.batches++;
    const schema = String(batch.envelope?.schemaVersion ?? "unknown");
    report.schemaVersions[schema] = (report.schemaVersions[schema] ?? 0) + 1;
    for (const event of batch.events ?? []) {
      if (event.kind === "battle_decision") {
        report.legacyDecisions++;
        continue;
      }
      if (event.kind === "combat_contract_decision" && event.record?.kind === "combat_decision") {
        const record = event.record;
        if (!record.decisionId || !record.sourcePartitionId || record.policySource !== "human-v1") {
          report.invalidContractEvents++;
          continue;
        }
        if (recordsByKey.has(`decision:${record.decisionId}`)) {
          report.duplicateRecords++;
          continue;
        }
        recordsByKey.set(`decision:${record.decisionId}`, record);
        report.contractDecisions++;
        report.policySources[record.policySource] = (report.policySources[record.policySource] ?? 0) + 1;
        sourcePartitions.add(record.sourcePartitionId);
        episodes.add(record.episodeId);
        continue;
      }
      if (event.kind === "run_outcome" && event.record?.kind === "episode_terminal") {
        const record = event.record;
        const key = `terminal:${record.episodeId}:${record.outcome}`;
        if (recordsByKey.has(key)) {
          report.duplicateRecords++;
          continue;
        }
        recordsByKey.set(key, record);
        report.terminals++;
        report.outcomes[record.outcome] = (report.outcomes[record.outcome] ?? 0) + 1;
        if (record.sourcePartitionId) {
          sourcePartitions.add(record.sourcePartitionId);
        }
        episodes.add(record.episodeId);
      }
    }
  }
}

report.sourcePartitions = sourcePartitions.size;
report.episodes = episodes.size;
const output = resolve(outDir);
mkdirSync(output, { recursive: true });
writeFileSync(
  `${output}/records.jsonl`,
  `${[...recordsByKey.values()].map(record => JSON.stringify(record)).join("\n")}\n`,
);
writeFileSync(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
