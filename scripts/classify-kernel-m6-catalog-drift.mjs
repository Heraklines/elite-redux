#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

function fail(message) {
  throw new Error(`M6 catalog drift classifier: ${message}`);
}

function args(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] == null) fail("invalid arguments");
    values.set(argv[index], argv[index + 1]);
  }
  for (const key of ["--legacy", "--fresh", "--oracle-sha", "--output"]) {
    if (!values.has(key)) fail(`missing ${key}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(values.get("--oracle-sha")) || !isAbsolute(values.get("--output"))) {
    fail("oracle SHA or output path is invalid");
  }
  return {
    legacy: resolve(values.get("--legacy")),
    fresh: resolve(values.get("--fresh")),
    oracleSha: values.get("--oracle-sha"),
    output: resolve(values.get("--output")),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function identity(kind, entry) {
  if (kind === "modifier_types") return entry.key;
  return `${entry.enum_name}/${entry.member}`;
}

function difference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    added: [...rightSet].filter(value => !leftSet.has(value)).sort(),
    removed: [...leftSet].filter(value => !rightSet.has(value)).sort(),
  };
}

function changedFiles(left, right) {
  const before = new Map(left.map(entry => [entry.path, entry.sha256]));
  const after = new Map(right.map(entry => [entry.path, entry.sha256]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.filter(path => before.get(path) !== after.get(path));
}

const input = args(process.argv.slice(2));
const legacy = readJson(input.legacy);
const fresh = readJson(input.fresh);
if (legacy.schema_version !== 1 || fresh.schema_version !== 1 || fresh.oracle_sha !== input.oracleSha) {
  fail("catalog identity mismatch");
}
const kinds = [
  "moves",
  "abilities",
  "modifier_types",
  "statuses",
  "weather",
  "terrain",
  "battler_tags",
  "arena_tags",
  "positional_tags",
];
const surfaces = {};
for (const kind of kinds) {
  const before = legacy[kind].map(entry => identity(kind, entry));
  const after = fresh[kind].map(entry => identity(kind, entry));
  surfaces[kind] = {
    before_count: before.length,
    after_count: after.length,
    ...difference(before, after),
  };
}
const report = {
  schema_version: 1,
  legacy_oracle_sha: legacy.oracle_sha,
  candidate_oracle_sha: fresh.oracle_sha,
  candidate_oracle_tree_sha: fresh.oracle_tree_sha,
  surfaces,
  mechanic_class_count_before: legacy.mechanic_classes.length,
  mechanic_class_count_after: fresh.mechanic_classes.length,
  attribute_attachment_count_before: legacy.attribute_attachments.length,
  attribute_attachment_count_after: fresh.attribute_attachments.length,
  dispatch_site_count_before: legacy.dispatch_sites.length,
  dispatch_site_count_after: fresh.dispatch_sites.length,
  rng_site_count_before: legacy.rng_sites.length,
  rng_site_count_after: fresh.rng_sites.length,
  changed_source_files: changedFiles(legacy.source_files, fresh.source_files),
};
mkdirSync(dirname(input.output), { recursive: true });
writeFileSync(input.output, `${JSON.stringify(report)}\n`);
console.log(
  `M6 catalog drift classifier: ${report.changed_source_files.length} changed files; moves ${report.surfaces.moves.before_count}->${report.surfaces.moves.after_count}; abilities ${report.surfaces.abilities.before_count}->${report.surfaces.abilities.after_count}`,
);
