#!/usr/bin/env node

import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import {
  createTelemetryImportAccumulator,
  decodeTelemetryObjectPayload,
  TELEMETRY_SOURCES,
} from "./combat-telemetry-import.mjs";

const PAGE_TIMEOUT_MS = 120_000;
const MAX_PAGE_ATTEMPTS = 4;
const DEFAULT_PAGE_SIZE = 100;
const MAX_INVALID_OBJECTS = 10_000;

function parseArgs(argv) {
  const args = {
    output: resolve("ai-work/production-human-telemetry"),
    contractVersion: "4",
    maxInvalidObjects: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    prefix: "",
  };
  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    const value = remaining.shift();
    applyArgument(args, arg, value);
  }
  if (args.output.toLowerCase().includes("staging")) {
    throw new Error("production telemetry cannot be written to a staging-named output");
  }
  return args;
}

function parseBoundedInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function applyArgument(args, name, value) {
  switch (name) {
    case "--out":
      if (!value) {
        break;
      }
      args.output = resolve(value);
      return;
    case "--contract-version":
      if (value && /^\d+$/u.test(value)) {
        args.contractVersion = value;
        return;
      }
      break;
    case "--max-invalid-objects":
      args.maxInvalidObjects = parseBoundedInteger(value, name, 0, MAX_INVALID_OBJECTS);
      return;
    case "--page-size":
      args.pageSize = parseBoundedInteger(value, name, 1, DEFAULT_PAGE_SIZE);
      return;
    case "--prefix":
      if (value != null) {
        args.prefix = value;
        return;
      }
      break;
  }
  throw new Error(`invalid argument: ${name ?? "<missing>"}`);
}

function numericHeader(response, name) {
  const parsed = Number.parseInt(response.headers.get(name) ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`telemetry export returned invalid ${name}`);
  }
  return parsed;
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

async function fetchPage(url, token) {
  let lastStatus = null;
  for (let attempt = 0; attempt < MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (response.ok) {
        const payload = await response.text();
        return { response, rows: parseRows(payload) };
      }
    } catch {
      lastStatus = null;
    }
    if (attempt + 1 < MAX_PAGE_ATTEMPTS) {
      await new Promise(done => setTimeout(done, Math.min(8_000, 500 * 2 ** attempt)));
    }
  }
  throw new Error(
    `telemetry export exhausted ${MAX_PAGE_ATTEMPTS} attempts${lastStatus ? ` (HTTP ${lastStatus})` : ""}`,
  );
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function openOutputDescriptors(output) {
  return {
    legacyDecision: openSync(`${output}/legacy-decisions.jsonl`, "w"),
    legacyTurnOutcome: openSync(`${output}/legacy-turn-outcomes.jsonl`, "w"),
    contractRecord: openSync(`${output}/contract-records.jsonl`, "w"),
  };
}

function buildPageUrl(exportUrl, args, cursor) {
  const url = new URL(exportUrl);
  url.searchParams.set("contractVersion", args.contractVersion);
  url.searchParams.set("limit", String(args.pageSize));
  if (args.prefix) {
    url.searchParams.set("prefix", args.prefix);
  }
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url;
}

function ingestRows(rows, args, state, accumulator) {
  for (const row of rows) {
    const decoded =
      row.body == null
        ? { batch: null, invalidReason: row.invalidReason ?? "missing" }
        : decodeTelemetryObjectPayload(row.body, row.customMetadata?.enc === "lz");
    if (decoded.batch == null) {
      state.invalidObjects++;
      increment(state.invalidObjectReasons, decoded.invalidReason ?? "unknown");
      if (state.invalidObjects > args.maxInvalidObjects) {
        throw new Error(
          `telemetry contained ${state.invalidObjects} invalid object(s), exceeding --max-invalid-objects `
            + `${args.maxInvalidObjects}; reasons=${JSON.stringify(state.invalidObjectReasons)}`,
        );
      }
      continue;
    }
    accumulator.ingestBatch(decoded.batch);
    state.importedObjects++;
    state.importedBytes += row.size ?? 0;
  }
}

async function streamTelemetry(exportUrl, exportToken, args, accumulator) {
  const state = {
    cursor: "",
    listedObjects: 0,
    selectedObjects: 0,
    selectedBytes: 0,
    importedObjects: 0,
    importedBytes: 0,
    invalidObjects: 0,
    invalidObjectReasons: {},
  };
  do {
    const { response, rows } = await fetchPage(buildPageUrl(exportUrl, args, state.cursor), exportToken);
    const pageListed = numericHeader(response, "x-er-listed-objects");
    const pageSelected = numericHeader(response, "x-er-selected-objects");
    if (rows.length !== pageSelected) {
      throw new Error(`telemetry export selected ${pageSelected} objects but returned ${rows.length}`);
    }
    state.listedObjects += pageListed;
    state.selectedObjects += pageSelected;
    state.selectedBytes += numericHeader(response, "x-er-selected-bytes");
    ingestRows(rows, args, state, accumulator);
    state.cursor =
      response.headers.get("x-er-truncated") === "true" ? (response.headers.get("x-er-next-cursor") ?? "") : "";
    if (state.listedObjects % 1_000 < args.pageSize || !state.cursor) {
      console.error(
        JSON.stringify({
          event: "telemetry-export-progress",
          listedObjects: state.listedObjects,
          selectedObjects: state.selectedObjects,
          invalidObjects: state.invalidObjects,
        }),
      );
    }
  } while (state.cursor);
  return state;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exportUrl = process.env.TELEMETRY_EXPORT_URL?.trim();
  const exportToken = process.env.TELEMETRY_EXPORT_TOKEN?.trim();
  if (!exportUrl || !exportToken) {
    throw new Error("TELEMETRY_EXPORT_URL and TELEMETRY_EXPORT_TOKEN are required");
  }

  mkdirSync(args.output, { recursive: true });
  const descriptors = openOutputDescriptors(args.output);
  const writeRecord = descriptor => record => writeSync(descriptor, `${JSON.stringify(record)}\n`);
  const source = TELEMETRY_SOURCES.production;
  const accumulator = createTelemetryImportAccumulator(
    { environment: "production", bucket: source.bucket },
    {
      legacyDecision: writeRecord(descriptors.legacyDecision),
      legacyTurnOutcome: writeRecord(descriptors.legacyTurnOutcome),
      contractRecord: writeRecord(descriptors.contractRecord),
    },
  );

  let state;
  try {
    state = await streamTelemetry(exportUrl, exportToken, args, accumulator);
  } finally {
    Object.values(descriptors).forEach(closeSync);
  }

  const imported = accumulator.finish();
  Object.assign(imported.report, {
    bytes: state.selectedBytes,
    contractVersionFilter: args.contractVersion,
    importedBytes: state.importedBytes,
    importedObjects: state.importedObjects,
    invalidObjectReasons: state.invalidObjectReasons,
    invalidObjects: state.invalidObjects,
    listedObjects: state.listedObjects,
    maxInvalidObjects: args.maxInvalidObjects,
    objects: state.selectedObjects,
    prefix: args.prefix,
    readTransport: "authenticated-r2-worker-v1",
  });
  writeFileSync(`${args.output}/source-splits.json`, `${JSON.stringify(imported.sourcePartitions, null, 2)}\n`);
  writeFileSync(`${args.output}/report.json`, `${JSON.stringify(imported.report, null, 2)}\n`);
  writeFileSync(
    `${args.output}/SOURCE.json`,
    `${JSON.stringify({ environment: "production", bucket: source.bucket, readOnly: true }, null, 2)}\n`,
  );
  console.log(JSON.stringify(imported.report, null, 2));
}

await main();
