#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const VOLATILE_KEYS = new Set([
  "oracle_game_sha",
  "m3_parity_oracle_sha",
  "m4_oracle_sha",
  "oracle_tree_sha",
  "exporter_commit_sha",
  "content_hash",
  "content_pack_hash",
  "battle_content_hash",
  "run_content_hash",
]);

function fail(message) {
  console.error(`M5 oracle refresh classifier: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      fail("usage: node scripts/classify-kernel-m5-oracle-refresh.mjs --oracle-sha <40-hex> --legacy-m3 <directory> --fresh-m3 <directory> --legacy-m4 <directory> --fresh-m4 <directory> --output <absolute-json-path>");
    }
    values.set(argv[index], argv[index + 1]);
  }
  const required = ["--oracle-sha", "--legacy-m3", "--fresh-m3", "--legacy-m4", "--fresh-m4", "--output"];
  if (values.size !== required.length || required.some(key => !values.has(key))) {
    fail("missing or unexpected arguments");
  }
  if (!/^[0-9a-f]{40}$/u.test(values.get("--oracle-sha")) || !isAbsolute(values.get("--output"))) {
    fail("--oracle-sha must be lowercase 40-hex and --output must be absolute");
  }
  return {
    oracle_sha: values.get("--oracle-sha"),
    legacy_m3: resolve(values.get("--legacy-m3")),
    fresh_m3: resolve(values.get("--fresh-m3")),
    legacy_m4: resolve(values.get("--legacy-m4")),
    fresh_m4: resolve(values.get("--fresh-m4")),
    output: resolve(values.get("--output")),
  };
}

function inventory(root) {
  if (!statSync(root).isDirectory()) {
    fail(`${root} is not a directory`);
  }
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(relative(root, path).replaceAll("\\", "/"));
      }
    }
  };
  visit(root);
  return files.sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (!VOLATILE_KEYS.has(key)) {
        output[key] = normalize(value[key]);
      }
    }
    return output;
  }
  return value;
}

function firstDifference(left, right, path = "$") {
  if (Object.is(left, right)) {
    return null;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length || index >= right.length) {
        return { path: `${path}[${index}]`, expected: index < left.length ? left[index] : "<missing>", actual: index < right.length ? right[index] : "<missing>" };
      }
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) {
        return difference;
      }
    }
    return null;
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) {
        return { path: `${path}.${key}`, expected: key in left ? left[key] : "<missing>", actual: key in right ? right[key] : "<missing>" };
      }
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) {
        return difference;
      }
    }
    return null;
  }
  return { path, expected: left, actual: right };
}

function classifyTree(legacyRoot, freshRoot) {
  const legacy = inventory(legacyRoot);
  const fresh = inventory(freshRoot);
  const paths = [...new Set([...legacy, ...fresh])].sort();
  return paths.map(path => {
    if (!legacy.includes(path)) {
      return { path, classification: "ADDED", first_difference: null };
    }
    if (!fresh.includes(path)) {
      return { path, classification: "MISSING", first_difference: null };
    }
    const before = readJson(resolve(legacyRoot, path));
    const after = readJson(resolve(freshRoot, path));
    const exactDifference = firstDifference(before, after);
    if (!exactDifference) {
      return { path, classification: "IDENTICAL", first_difference: null };
    }
    const semanticDifference = firstDifference(normalize(before), normalize(after));
    return {
      path,
      classification: semanticDifference ? "SEMANTIC_CHANGE" : "PROVENANCE_ONLY",
      first_difference: semanticDifference ?? exactDifference,
    };
  });
}

function counts(entries) {
  const output = {};
  for (const entry of entries) {
    output[entry.classification] = (output[entry.classification] ?? 0) + 1;
  }
  return output;
}

const args = parseArgs(process.argv.slice(2));
const m3 = classifyTree(args.legacy_m3, args.fresh_m3);
const m4 = classifyTree(args.legacy_m4, args.fresh_m4);
const report = {
  schema_version: 1,
  candidate_oracle_sha: args.oracle_sha,
  legacy_m3_oracle_sha: "3b534099919efae827019d4a3f3c4ab0ecd6d67b",
  legacy_m4_oracle_sha: "45c89493e7edec9c4da247a98cd7858b1f015c09",
  inventory_policy: "EXACT_PATH_AND_FIRST_STRUCTURAL_DIFFERENCE",
  normalization_policy: [...VOLATILE_KEYS].sort(),
  m3: { counts: counts(m3), files: m3 },
  m4: { counts: counts(m4), files: m4 },
};
mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(report)}\n`);
console.log(`M5 oracle refresh classifier: M3 ${JSON.stringify(report.m3.counts)}; M4 ${JSON.stringify(report.m4.counts)}`);
if ([...m3, ...m4].some(entry => entry.classification === "ADDED" || entry.classification === "MISSING")) {
  fail("fresh fixture inventory does not match the frozen M3/M4 inventory");
}
