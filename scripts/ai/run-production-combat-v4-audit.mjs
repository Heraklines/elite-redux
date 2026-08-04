#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import lzString from "lz-string";
import { createCombatContractV4Audit } from "./combat-contract-v4-audit.mjs";

const { decompressFromBase64 } = lzString;
const DEFAULT_EXPORT_URL = "https://er-ai-telemetry-export.heraklines.workers.dev/v1/export";
const PAGE_SIZE = 100;
const PAGE_TIMEOUT_MS = 120_000;
const MAX_PAGE_ATTEMPTS = 4;

function parseArgs(argv) {
  const args = { output: resolve("ai-report/production-v4-semantic-audit"), maxInvalidObjects: 100 };
  const remaining = [...argv];
  while (remaining.length > 0) {
    const name = remaining.shift();
    const value = remaining.shift();
    if (name === "--out" && value) {
      args.output = resolve(value);
    } else if (name === "--max-invalid-objects" && /^\d+$/u.test(value ?? "")) {
      args.maxInvalidObjects = Number.parseInt(value, 10);
    } else {
      throw new Error(`invalid argument: ${name ?? "<missing>"}`);
    }
  }
  return args;
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

function buildPageUrl(exportUrl, cursor) {
  const url = new URL(exportUrl);
  url.searchParams.set("contractVersion", "4");
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Pagination, decoding, and bounded error accounting share one stream lifecycle.
async function streamAudit(exportUrl, token, maxInvalidObjects) {
  const audit = createCombatContractV4Audit();
  const state = {
    cursor: "",
    listedObjects: 0,
    selectedObjects: 0,
    compressedBytes: 0,
    invalidObjects: 0,
    invalidObjectReasons: {},
  };
  do {
    const { response, rows } = await fetchPage(buildPageUrl(exportUrl, state.cursor), token);
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
      } else {
        audit.ingestBatch(decoded.batch);
      }
    }
    state.cursor =
      response.headers.get("x-er-truncated") === "true" ? (response.headers.get("x-er-next-cursor") ?? "") : "";
    if (state.listedObjects % 1_000 < PAGE_SIZE || !state.cursor) {
      console.error(
        JSON.stringify({
          event: "production-v4-audit-progress",
          listedObjects: state.listedObjects,
          selectedObjects: state.selectedObjects,
          invalidObjects: state.invalidObjects,
        }),
      );
    }
  } while (state.cursor);
  return audit.finish({
    environment: "production",
    bucket: "er-telemetry",
    readTransport: "authenticated-r2-worker-v1",
    listedObjects: state.listedObjects,
    selectedObjects: state.selectedObjects,
    compressedBytes: state.compressedBytes,
    invalidObjects: state.invalidObjects,
    invalidObjectReasons: state.invalidObjectReasons,
  });
}

function markdownReport(report) {
  const corpus = report.corpus;
  const eligibility = report.eligibility;
  const hardFindings = Object.entries(report.findings.hard);
  const incompleteFindings = Object.entries(report.findings.incomplete);
  const lines = [
    "# Production combat contract v4 semantic audit",
    "",
    `Measured at \`${report.generatedAt}\` through the read-only production export Worker.`,
    "Raw telemetry remained inside ephemeral runner memory and was not uploaded.",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.TELEMETRY_EXPORT_TOKEN?.trim();
  const exportUrl = process.env.TELEMETRY_EXPORT_URL?.trim() || DEFAULT_EXPORT_URL;
  if (!token) {
    throw new Error("TELEMETRY_EXPORT_TOKEN is required");
  }
  const report = await streamAudit(exportUrl, token, args.maxInvalidObjects);
  mkdirSync(args.output, { recursive: true });
  writeFileSync(`${args.output}/production-v4-semantic-audit.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${args.output}/production-v4-semantic-audit.md`, markdownReport(report));
  console.log(markdownReport(report));
}

await main();
