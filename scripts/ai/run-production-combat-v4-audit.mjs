#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync, gzipSync } from "node:zlib";
import lzString from "lz-string";
import { createCombatContractV4Audit, mergeCombatContractV4AuditReports } from "./combat-contract-v4-audit.mjs";
import { createCombatGameplayAnalytics } from "./combat-gameplay-analytics.mjs";

const { decompressFromBase64 } = lzString;
const DEFAULT_EXPORT_URL = "https://er-ai-telemetry-export.heraklines.workers.dev/v1/export";
const PAGE_SIZE = 100;
const PAGE_TIMEOUT_MS = 120_000;
const MAX_PAGE_ATTEMPTS = 8;
const DEFAULT_AUDIT_SHARDS = 128;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Audit CLI validation keeps privacy-sensitive outputs explicit.
function parseArgs(argv) {
  const args = {
    output: resolve("ai-report/production-v4-semantic-audit"),
    maxInvalidObjects: 100,
    maxSelectedObjects: null,
    shards: DEFAULT_AUDIT_SHARDS,
    privatePolicyOutput: null,
    privateEpisodeOutput: null,
    gameplayAnalysisOutput: null,
    prefix: "",
  };
  const remaining = [...argv];
  while (remaining.length > 0) {
    const name = remaining.shift();
    const value = remaining.shift();
    if (name === "--out" && value) {
      args.output = resolve(value);
    } else if (name === "--max-invalid-objects" && /^\d+$/u.test(value ?? "")) {
      args.maxInvalidObjects = Number.parseInt(value, 10);
    } else if (name === "--max-selected-objects" && /^\d+$/u.test(value ?? "") && Number.parseInt(value, 10) > 0) {
      args.maxSelectedObjects = Number.parseInt(value, 10);
    } else if (name === "--shards" && /^\d+$/u.test(value ?? "") && Number.parseInt(value, 10) > 0) {
      args.shards = Number.parseInt(value, 10);
    } else if (name === "--private-policy-out" && value) {
      args.privatePolicyOutput = resolve(value);
    } else if (name === "--private-episode-out" && value) {
      args.privateEpisodeOutput = resolve(value);
    } else if (name === "--gameplay-analysis-out" && value) {
      args.gameplayAnalysisOutput = resolve(value);
    } else if (name === "--prefix" && value != null) {
      args.prefix = value;
    } else {
      throw new Error(`invalid argument: ${name ?? "<missing>"}`);
    }
  }
  return args;
}

function pathWithin(child, parent) {
  const path = relative(parent, child);
  return (
    path === ""
    || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}

function parseRows(payload) {
  if (!payload) {
    return [];
  }
  return payload
    .trimEnd()
    .split("\n")
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error("telemetry export returned malformed NDJSON framing");
      }
    });
}

function numericHeader(response, name) {
  const value = Number.parseInt(response.headers.get(name) ?? "", 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`telemetry export returned invalid ${name}`);
  }
  return value;
}

async function fetchPage(url, token) {
  let finalStatus = null;
  for (let attempt = 0; attempt < MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      finalStatus = response.status;
      if (response.ok) {
        return { response, rows: parseRows(await response.text()) };
      }
    } catch {
      finalStatus = null;
    }
    if (attempt + 1 < MAX_PAGE_ATTEMPTS) {
      await new Promise(done => setTimeout(done, Math.min(8_000, 500 * 2 ** attempt)));
    }
  }
  throw new Error(
    `telemetry export exhausted ${MAX_PAGE_ATTEMPTS} attempts${finalStatus ? ` (HTTP ${finalStatus})` : ""}`,
  );
}

function decodeRow(row) {
  try {
    let json;
    if (row.transferEncoding === "base64-gzip" && typeof row.bodyBase64 === "string") {
      json = gunzipSync(Buffer.from(row.bodyBase64, "base64")).toString("utf8");
    } else if (typeof row.body === "string" && row.customMetadata?.enc === "lz") {
      json = decompressFromBase64(row.body);
    } else if (typeof row.body === "string") {
      json = row.body;
    } else {
      return { batch: null, reason: row.invalidReason ?? "missing" };
    }
    if (!json) {
      return { batch: null, reason: "decode" };
    }
    return { batch: JSON.parse(json), reason: null };
  } catch {
    return { batch: null, reason: "decode" };
  }
}

function buildPageUrl(exportUrl, cursor, prefix) {
  const url = new URL(exportUrl);
  url.searchParams.set("contractVersion", "4");
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (prefix) {
    url.searchParams.set("prefix", prefix);
  }
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shardIndex(sessionId, shardCount) {
  return Number.parseInt(sha256(sessionId).slice(0, 8), 16) % shardCount;
}

function scratchDirectory() {
  const root = process.env.RUNNER_TEMP ? resolve(process.env.RUNNER_TEMP) : tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "er-v4-semantic-audit-"));
}

function openShardSpool(scratch, shardCount) {
  const paths = Array.from({ length: shardCount }, (_, index) => join(scratch, `shard-${index}.jsonl`));
  return { paths, descriptors: paths.map(path => openSync(path, "w")) };
}

async function auditShard(path, crossShardRepeatedSessions, onEpisodeFinished) {
  const audit = createCombatContractV4Audit({ onEpisodeFinished });
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (line.trim()) {
      const decoded = decodeRow(JSON.parse(line));
      if (decoded.batch == null) {
        throw new Error("a previously validated telemetry row failed during shard replay");
      }
      audit.ingestBatch(decoded.batch);
    }
  }
  for (const sessionId of crossShardRepeatedSessions) {
    if (!audit.markEpisodeFinding(sessionId, "payload_repeated_across_shards")) {
      throw new Error("cross-shard repeated payload lost its owning episode");
    }
  }
  return audit.finish();
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Pagination, ephemeral sharding, and bounded error accounting share one lifecycle.
async function streamAudit({
  exportUrl,
  token,
  maxInvalidObjects,
  maxSelectedObjects,
  shardCount,
  privatePolicyOutput,
  privateEpisodeOutput,
  gameplayAnalytics,
  prefix,
}) {
  const scratch = scratchDirectory();
  const spool = openShardSpool(scratch, shardCount);
  let privatePolicyDescriptor = null;
  let privateEpisodeDescriptor = null;
  let policyDiagnosticDecisionsWritten = 0;
  let privateEpisodesWritten = 0;
  if (privatePolicyOutput != null) {
    mkdirSync(dirname(privatePolicyOutput), { recursive: true });
    privatePolicyDescriptor = openSync(privatePolicyOutput, "w");
  }
  if (privateEpisodeOutput != null) {
    mkdirSync(dirname(privateEpisodeOutput), { recursive: true });
    privateEpisodeDescriptor = openSync(privateEpisodeOutput, "w");
  }
  const state = {
    cursor: "",
    listedObjects: 0,
    selectedObjects: 0,
    compressedBytes: 0,
    expandedBytes: 0,
    spooledBytes: 0,
    spooledBatches: 0,
    invalidObjects: 0,
    invalidObjectReasons: {},
  };
  const sourcePartitionIds = new Set();
  const payloadIdentities = new Map();
  const crossShardRepeatedSessions = Array.from({ length: shardCount }, () => []);
  let crossShardRepeatedPayloads = 0;
  try {
    try {
      do {
        const { response, rows } = await fetchPage(buildPageUrl(exportUrl, state.cursor, prefix), token);
        const selected = numericHeader(response, "x-er-selected-objects");
        if (rows.length !== selected) {
          throw new Error(`telemetry export selected ${selected} objects but returned ${rows.length}`);
        }
        state.listedObjects += numericHeader(response, "x-er-listed-objects");
        state.selectedObjects += selected;
        state.compressedBytes += numericHeader(response, "x-er-selected-bytes");
        for (const row of rows) {
          const decoded = decodeRow(row);
          if (decoded.batch == null) {
            state.invalidObjects++;
            state.invalidObjectReasons[decoded.reason] = (state.invalidObjectReasons[decoded.reason] ?? 0) + 1;
            if (state.invalidObjects > maxInvalidObjects) {
              throw new Error(`invalid telemetry objects exceeded ${maxInvalidObjects}`);
            }
            continue;
          }
          const batch = decoded.batch;
          const sessionId = String(batch?.envelope?.sessionId ?? `invalid-batch-${state.spooledBatches}`);
          const sourcePartitionId = batch?.envelope?.playerIdHash;
          if (typeof sourcePartitionId === "string" && sourcePartitionId) {
            sourcePartitionIds.add(sourcePartitionId);
          }
          const index = shardIndex(sessionId, shardCount);
          const json = JSON.stringify(batch);
          const digest = sha256(json);
          const identity = `${sessionId}:${batch?.seq}`;
          const prior = payloadIdentities.get(digest);
          if (prior == null) {
            payloadIdentities.set(digest, { identity, shard: index });
          } else if (prior.identity !== identity && prior.shard !== index) {
            crossShardRepeatedPayloads++;
            crossShardRepeatedSessions[index].push(sessionId);
          }
          state.expandedBytes += Buffer.byteLength(json) + 1;
          state.spooledBatches++;
          const spooled = `${JSON.stringify(row)}\n`;
          state.spooledBytes += Buffer.byteLength(spooled);
          writeSync(spool.descriptors[index], spooled);
        }
        state.cursor =
          response.headers.get("x-er-truncated") === "true" ? (response.headers.get("x-er-next-cursor") ?? "") : "";
        if (maxSelectedObjects != null && state.selectedObjects >= maxSelectedObjects) {
          state.cursor = "";
          state.truncatedByObjectLimit = true;
        }
        if (state.listedObjects % 1_000 < PAGE_SIZE || !state.cursor) {
          console.error(
            JSON.stringify({
              event: "production-v4-audit-progress",
              stage: "spool",
              listedObjects: state.listedObjects,
              selectedObjects: state.selectedObjects,
              invalidObjects: state.invalidObjects,
            }),
          );
        }
      } while (state.cursor);
    } finally {
      spool.descriptors.forEach(closeSync);
    }
    const reports = [];
    const writePrivateOutputs = episode => {
      gameplayAnalytics?.ingestEpisode(episode);
      const { split, decisions, result } = episode;
      if (privateEpisodeDescriptor != null) {
        writeSync(privateEpisodeDescriptor, gzipSync(`${JSON.stringify(episode)}\n`));
        privateEpisodesWritten++;
      }
      if (privatePolicyDescriptor != null && split !== "test" && result.policyDiagnosticEligible) {
        for (const decision of decisions) {
          if (
            decision.policySource === "human-v1"
            && decision.policyTarget === true
            && decision.candidates.length > 1
          ) {
            writeSync(privatePolicyDescriptor, `${JSON.stringify(decision)}\n`);
            policyDiagnosticDecisionsWritten++;
          }
        }
      }
    };
    for (let index = 0; index < spool.paths.length; index++) {
      reports.push(await auditShard(spool.paths[index], crossShardRepeatedSessions[index], writePrivateOutputs));
      if ((index + 1) % 16 === 0 || index + 1 === spool.paths.length) {
        console.error(
          JSON.stringify({ event: "production-v4-audit-progress", stage: "audit", completedShards: index + 1 }),
        );
      }
    }
    const report = mergeCombatContractV4AuditReports(reports, sourcePartitionIds, {
      environment: "production",
      bucket: "er-telemetry",
      readTransport: "authenticated-r2-worker-v1",
      listedObjects: state.listedObjects,
      selectedObjects: state.selectedObjects,
      compressedBytes: state.compressedBytes,
      expandedBytes: state.expandedBytes,
      spooledBytes: state.spooledBytes,
      auditShards: shardCount,
      invalidObjects: state.invalidObjects,
      invalidObjectReasons: state.invalidObjectReasons,
      policyDiagnosticDecisionsWritten,
      privateEpisodesWritten,
      truncatedByObjectLimit: state.truncatedByObjectLimit === true,
      prefix,
    });
    report.corpus.repeatedPayloads += crossShardRepeatedPayloads;
    return report;
  } finally {
    if (privatePolicyDescriptor != null) {
      closeSync(privatePolicyDescriptor);
    }
    if (privateEpisodeDescriptor != null) {
      closeSync(privateEpisodeDescriptor);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

function markdownReport(report) {
  const corpus = report.corpus;
  const eligibility = report.eligibility;
  const hardFindings = Object.entries(report.findings.hard);
  const incompleteFindings = Object.entries(report.findings.incomplete);
  const diagnosticFindings = Object.entries(report.findings.diagnostic);
  const lines = [
    "# Production combat contract v4 semantic audit",
    "",
    `Measured at \`${report.generatedAt}\` through the read-only production export Worker.`,
    "Raw telemetry remained on ephemeral runner storage, was deleted after reduction, and was not uploaded.",
    "",
    "## Corpus",
    "",
    `- R2 objects selected: ${corpus.selectedObjects.toLocaleString()}`,
    `- Compressed bytes: ${corpus.compressedBytes.toLocaleString()}`,
    `- Decoded batches: ${corpus.batches.toLocaleString()}`,
    `- Events: ${corpus.events.toLocaleString()}`,
    `- Episodes: ${corpus.episodes.toLocaleString()}`,
    `- Source partitions: ${corpus.sourcePartitions.toLocaleString()}`,
    `- Invalid objects: ${corpus.invalidObjects.toLocaleString()}`,
    "",
    "## Eligibility",
    "",
    `- Hard-quarantined episodes: ${eligibility.hardQuarantinedEpisodes.toLocaleString()}`,
    `- Incomplete episodes: ${eligibility.incompleteEpisodes.toLocaleString()}`,
    `- Structurally valid BC episodes: ${eligibility.policyDiagnosticEligibleEpisodes.toLocaleString()}`,
    `- Sequence-complete episodes: ${eligibility.trajectoryEligibleEpisodes.toLocaleString()}`,
    `- Completed-outcome episodes: ${eligibility.completedOutcomeEligibleEpisodes.toLocaleString()}`,
    `- Completed winning policy episodes: ${eligibility.winningPolicyEligibleEpisodes.toLocaleString()}`,
    "",
    "## Hard Findings",
    "",
    ...(hardFindings.length === 0
      ? ["None."]
      : hardFindings.map(([code, finding]) => `- \`${code}\`: ${finding.count.toLocaleString()}`)),
    "",
    "## Incomplete Findings",
    "",
    ...(incompleteFindings.length === 0
      ? ["None."]
      : incompleteFindings.map(([code, finding]) => `- \`${code}\`: ${finding.count.toLocaleString()}`)),
    "",
    "## Diagnostic Findings",
    "",
    ...(diagnosticFindings.length === 0
      ? ["None."]
      : diagnosticFindings.map(([code, finding]) => `- \`${code}\`: ${finding.count.toLocaleString()}`)),
    "",
    "## Audit limits",
    "",
    `- Upload sequence completeness: ${report.coverageLimitations.uploadSequenceCompleteness}`,
    `- Decision capture completeness: ${report.coverageLimitations.decisionCaptureCompleteness}`,
    "",
    "## Stratification",
    "",
    "```json",
    JSON.stringify(
      {
        difficulties: corpus.difficulties,
        gameModes: corpus.gameModes,
        battleTypes: corpus.battleTypes,
        formats: corpus.formats,
        buildShas: corpus.buildShas,
        dictionaryHashes: corpus.dictionaryHashes,
        battleOutcomes: corpus.battleOutcomes,
        runOutcomes: corpus.runOutcomes,
        actionHistoryRelations: corpus.actionHistoryRelations,
        sourceSplits: eligibility.sourceSplits,
      },
      null,
      2,
    ),
    "```",
    "",
  ];
  return lines.join("\n");
}

function validatePrivateOutput(path, outputDirectory, label, suffix = null) {
  if (path == null) {
    return;
  }
  if (suffix != null && !path.endsWith(suffix)) {
    throw new Error(`${label} must use a ${suffix} suffix`);
  }
  if (pathWithin(path, outputDirectory)) {
    throw new Error(`${label} must be outside the sanitized report directory`);
  }
  if (process.env.RUNNER_TEMP && !pathWithin(path, resolve(process.env.RUNNER_TEMP))) {
    throw new Error(`${label} must remain under RUNNER_TEMP`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.TELEMETRY_EXPORT_TOKEN?.trim();
  const exportUrl = process.env.TELEMETRY_EXPORT_URL?.trim() || DEFAULT_EXPORT_URL;
  if (!token) {
    throw new Error("TELEMETRY_EXPORT_TOKEN is required");
  }
  validatePrivateOutput(args.privatePolicyOutput, args.output, "private policy output");
  validatePrivateOutput(args.privateEpisodeOutput, args.output, "private episode output", ".gz");
  validatePrivateOutput(args.gameplayAnalysisOutput, args.output, "gameplay analysis output", ".json");
  const gameplayAnalytics = args.gameplayAnalysisOutput == null ? null : createCombatGameplayAnalytics();
  const report = await streamAudit({
    exportUrl,
    token,
    maxInvalidObjects: args.maxInvalidObjects,
    maxSelectedObjects: args.maxSelectedObjects,
    shardCount: args.shards,
    privatePolicyOutput: args.privatePolicyOutput,
    privateEpisodeOutput: args.privateEpisodeOutput,
    gameplayAnalytics,
    prefix: args.prefix,
  });
  mkdirSync(args.output, { recursive: true });
  writeFileSync(`${args.output}/production-v4-semantic-audit.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${args.output}/production-v4-semantic-audit.md`, markdownReport(report));
  if (args.gameplayAnalysisOutput != null) {
    mkdirSync(dirname(args.gameplayAnalysisOutput), { recursive: true });
    writeFileSync(
      args.gameplayAnalysisOutput,
      `${JSON.stringify(
        gameplayAnalytics.finish(
          {
            prefix: args.prefix,
            listedObjects: report.corpus.listedObjects,
            selectedObjects: report.corpus.selectedObjects,
            compressedBytes: report.corpus.compressedBytes,
          },
          { minimumTableObservations: 2 },
        ),
      )}\n`,
    );
  }
  console.log(markdownReport(report));
}

await main();
