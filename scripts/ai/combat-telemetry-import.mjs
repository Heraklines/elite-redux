#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import lzString from "lz-string";

const { decompressFromBase64 } = lzString;
const API_ROOT = "https://api.cloudflare.com/client/v4";
const SPLIT_SEED = "er-human-telemetry-split-v1";
const READ_CONCURRENCY = 4;
const MAX_READ_ATTEMPTS = 6;

export const TELEMETRY_SOURCES = Object.freeze({
  staging: Object.freeze({
    bucket: "er-telemetry-staging",
    defaultOutDir: "ai-work/staging-human-telemetry",
  }),
  production: Object.freeze({
    bucket: "er-telemetry",
    defaultOutDir: "ai-work/production-human-telemetry",
  }),
});

function usage(environment, message) {
  if (message) {
    console.error(message);
  }
  const source = TELEMETRY_SOURCES[environment];
  console.error(
    `Usage: node scripts/ai/download-${environment}-combat-telemetry.mjs [--out DIR] [--prefix YYYY-MM-DD/]\n`
      + `Reads ${environment} R2 bucket ${source.bucket} only. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.`,
  );
}

export function sourceSplit(playerIdHash) {
  if (typeof playerIdHash !== "string" || playerIdHash.trim() === "") {
    throw new Error("telemetry envelope is missing playerIdHash");
  }
  const digest = createHash("sha256").update(`${SPLIT_SEED}:${playerIdHash}`).digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  if (bucket < 0.7) {
    return "train";
  }
  if (bucket < 0.85) {
    return "validation";
  }
  return "test";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI flags are intentionally parsed without a dependency.
function parseArgs(environment, argv) {
  const source = TELEMETRY_SOURCES[environment];
  let outDir = source.defaultOutDir;
  let prefix = "";
  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    if (arg === "--out") {
      outDir = remaining.shift();
      if (!outDir) {
        throw new Error("--out requires a directory");
      }
    } else if (arg === "--prefix") {
      prefix = remaining.shift();
      if (prefix == null) {
        throw new Error("--prefix requires a value");
      }
    } else if (arg === "--help" || arg === "-h") {
      usage(environment);
      return null;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  const output = resolve(outDir);
  const outputName = basename(output).toLowerCase();
  const conflictingName = environment === "production" ? "staging" : "production";
  if (outputName.includes(conflictingName)) {
    throw new Error(`${environment} telemetry cannot be written to an output named ${outputName}`);
  }
  return { output, prefix };
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function baseImportedRecord(environment, bucket, envelope, batch, eventIndex) {
  const sourcePartitionId = envelope.playerIdHash;
  const sourceSplitName = sourceSplit(sourcePartitionId);
  return {
    sourceEnvironment: environment,
    sourceBucket: bucket,
    sourceSchemaVersion: envelope.schemaVersion ?? null,
    sessionId: envelope.sessionId,
    episodeId: envelope.sessionId,
    sourcePartitionId,
    splitGroupId: sourcePartitionId,
    sourceSplit: sourceSplitName,
    batchSequence: batch.seq,
    eventIndex,
    build: envelope.build ?? null,
    erVersion: envelope.erVersion ?? null,
    gameModeId: envelope.gameModeId ?? null,
    mode: envelope.mode ?? null,
    difficulty: envelope.difficulty ?? "unknown",
    terminalOutcomeKnown: false,
    terminalOutcome: "unknown",
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One pass classifies every supported wire event.
export function importTelemetryBatches(batches, options) {
  const { environment, bucket } = options;
  const legacyDecisions = new Map();
  const legacyTurnOutcomes = new Map();
  const contractRecords = new Map();
  const sourcePartitions = new Map();
  const episodes = new Set();
  const sessionModes = {};
  const sessionGameModes = {};
  const sessionDifficulties = {};
  const report = {
    environment,
    bucket,
    batches: 0,
    events: 0,
    legacyDecisions: 0,
    legacyTurnOutcomes: 0,
    contractDecisions: 0,
    terminals: 0,
    duplicateRecords: 0,
    invalidRecords: 0,
    sourcePartitions: 0,
    episodes: 0,
    sessionModes,
    sessionGameModes,
    sessionDifficulties,
    policySources: {},
    schemaVersions: {},
    sourceSplits: { train: 0, validation: 0, test: 0 },
    terminalOutcomePolicy: "legacy records are terminal-outcome-unknown; no terminal labels are inferred",
  };

  for (const batch of batches) {
    report.batches++;
    const envelope = batch?.envelope;
    if (!envelope?.sessionId || !envelope?.playerIdHash || !Array.isArray(batch?.events)) {
      report.invalidRecords++;
      continue;
    }
    const partition = envelope.playerIdHash;
    if (!sourcePartitions.has(partition)) {
      sourcePartitions.set(partition, sourceSplit(partition));
    }
    const firstBatchForSession = !episodes.has(envelope.sessionId);
    episodes.add(envelope.sessionId);
    increment(report.schemaVersions, String(envelope.schemaVersion ?? "unknown"));
    if (firstBatchForSession) {
      increment(sessionModes, String(envelope.mode ?? "unknown"));
      increment(sessionGameModes, String(envelope.gameModeId ?? "unknown"));
      increment(sessionDifficulties, String(envelope.difficulty ?? "unknown"));
    }

    for (const [eventIndex, event] of batch.events.entries()) {
      report.events++;
      const recordBase = baseImportedRecord(environment, bucket, envelope, batch, eventIndex);
      const identity = `${envelope.sessionId}:${batch.seq}:${eventIndex}`;
      if (event?.kind === "battle_decision") {
        const decisionId = `legacy-decision:${identity}`;
        if (legacyDecisions.has(decisionId)) {
          report.duplicateRecords++;
          continue;
        }
        legacyDecisions.set(decisionId, {
          ...recordBase,
          recordType: "legacy_battle_decision",
          decisionId,
          policySource: "human-v1",
          policyTarget: true,
          event,
        });
        report.legacyDecisions++;
      } else if (event?.kind === "turn_outcome") {
        const transitionId = `legacy-turn-outcome:${identity}`;
        if (legacyTurnOutcomes.has(transitionId)) {
          report.duplicateRecords++;
          continue;
        }
        legacyTurnOutcomes.set(transitionId, {
          ...recordBase,
          recordType: "legacy_turn_outcome",
          transitionId,
          event,
        });
        report.legacyTurnOutcomes++;
      } else if (event?.kind === "combat_contract_decision" && event.record?.kind === "combat_decision") {
        const record = event.record;
        const key = `decision:${record.decisionId}`;
        if (!record.decisionId || !record.sourcePartitionId || contractRecords.has(key)) {
          report[contractRecords.has(key) ? "duplicateRecords" : "invalidRecords"]++;
          continue;
        }
        contractRecords.set(key, record);
        report.contractDecisions++;
        increment(report.policySources, String(record.policySource ?? "unknown"));
      } else if (event?.kind === "run_outcome" && event.record?.kind === "episode_terminal") {
        const record = event.record;
        const key = `terminal:${record.episodeId}:${record.outcome}`;
        if (!record.episodeId || contractRecords.has(key)) {
          report[contractRecords.has(key) ? "duplicateRecords" : "invalidRecords"]++;
          continue;
        }
        contractRecords.set(key, record);
        report.terminals++;
      }
    }
  }

  for (const split of sourcePartitions.values()) {
    report.sourceSplits[split]++;
  }
  report.sourcePartitions = sourcePartitions.size;
  report.episodes = episodes.size;
  return {
    legacyDecisions: [...legacyDecisions.values()],
    legacyTurnOutcomes: [...legacyTurnOutcomes.values()],
    contractRecords: [...contractRecords.values()],
    sourcePartitions: [...sourcePartitions.entries()]
      .map(([sourcePartitionId, split]) => ({ sourcePartitionId, split }))
      .sort((left, right) => left.sourcePartitionId.localeCompare(right.sourcePartitionId)),
    report,
  };
}

function writeJsonLines(path, records) {
  writeFileSync(path, records.length > 0 ? `${records.map(record => JSON.stringify(record)).join("\n")}\n` : "");
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(10_000, 500 * 2 ** attempt);
}

async function readOnlyFetch(url, headers) {
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    const response = await fetch(url, { headers, method: "GET" });
    if (response.ok || (response.status !== 429 && response.status < 500)) {
      return response;
    }
    if (attempt + 1 < MAX_READ_ATTEMPTS) {
      await new Promise(done => setTimeout(done, retryDelayMs(response, attempt)));
    }
  }
  throw new Error(`R2 GET exhausted ${MAX_READ_ATTEMPTS} attempts: ${url}`);
}

export async function runCombatTelemetryImport(environment, argv = process.argv.slice(2)) {
  const source = TELEMETRY_SOURCES[environment];
  if (!source) {
    throw new Error(`unsupported telemetry environment: ${environment}`);
  }
  let args;
  try {
    args = parseArgs(environment, argv);
  } catch (error) {
    usage(environment, error instanceof Error ? error.message : String(error));
    throw error;
  }
  if (!args) {
    return null;
  }

  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    throw new Error("Cloudflare read credentials are missing");
  }
  const headers = { Authorization: `Bearer ${token}` };
  const objectBase = `${API_ROOT}/accounts/${accountId}/r2/buckets/${source.bucket}/objects`;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Cursor pagination has explicit failure handling.
  async function listObjects() {
    const objects = [];
    let cursor = "";
    do {
      const params = new URLSearchParams({ per_page: "1000" });
      if (args.prefix) {
        params.set("prefix", args.prefix);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      const response = await readOnlyFetch(`${objectBase}?${params}`, headers);
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
    const response = await readOnlyFetch(`${objectBase}/${encodeURIComponent(object.key)}`, headers);
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
  const batches = [];
  for (let offset = 0; offset < objects.length; offset += READ_CONCURRENCY) {
    batches.push(...(await Promise.all(objects.slice(offset, offset + READ_CONCURRENCY).map(readBatch))));
  }
  const imported = importTelemetryBatches(batches, { environment, bucket: source.bucket });
  imported.report.prefix = args.prefix;
  imported.report.objects = objects.length;
  imported.report.bytes = objects.reduce((sum, object) => sum + (object.size ?? 0), 0);

  mkdirSync(args.output, { recursive: true });
  writeJsonLines(`${args.output}/legacy-decisions.jsonl`, imported.legacyDecisions);
  writeJsonLines(`${args.output}/legacy-turn-outcomes.jsonl`, imported.legacyTurnOutcomes);
  writeJsonLines(`${args.output}/contract-records.jsonl`, imported.contractRecords);
  writeFileSync(`${args.output}/source-splits.json`, `${JSON.stringify(imported.sourcePartitions, null, 2)}\n`);
  writeFileSync(`${args.output}/report.json`, `${JSON.stringify(imported.report, null, 2)}\n`);
  writeFileSync(
    `${args.output}/SOURCE.json`,
    `${JSON.stringify({ environment, bucket: source.bucket, prefix: args.prefix, readOnly: true }, null, 2)}\n`,
  );
  console.log(JSON.stringify(imported.report, null, 2));
  return imported.report;
}
