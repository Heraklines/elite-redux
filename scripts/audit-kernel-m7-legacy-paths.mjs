#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const FORBIDDEN = [
  "project_legacy_state",
  "merge_legacy_state",
  "LegacyResolver",
  "selected_content_pack",
  "BattleStartV1",
  "GameKernel::new_battle",
  "er_state::snapshot::GameState",
  "er_content::pack::ContentPack",
];

function fail(message) {
  throw new Error(`M7 legacy-path audit: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("invalid arguments");
    }
    values.set(key, value);
  }
  for (const key of ["--root", "--output"]) {
    if (!values.has(key)) {
      fail(`missing ${key}`);
    }
  }
  if (!isAbsolute(values.get("--root")) || !isAbsolute(values.get("--output"))) {
    fail("root and output paths must be absolute");
  }
  return { root: resolve(values.get("--root")), output: resolve(values.get("--output")) };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rustFilesBelow(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(path);
      }
    }
  }
  return files;
}

function rustSources(root) {
  const cratesRoot = join(root, "rust", "crates");
  return readdirSync(cratesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => rustFilesBelow(join(cratesRoot, entry.name, "src")))
    .sort(compareText);
}

const input = parseArgs(process.argv.slice(2));
const occurrences = [];
for (const path of rustSources(input.root)) {
  const source = readFileSync(path, "utf8").replace(/\r\n?/gu, "\n");
  for (const [index, line] of source.split("\n").entries()) {
    for (const identifier of FORBIDDEN) {
      if (!line.includes(identifier)) {
        continue;
      }
      occurrences.push({
        identifier,
        line: index + 1,
        path: relative(input.root, path).replaceAll("\\", "/"),
        line_sha256: createHash("sha256").update(line.trim()).digest("hex"),
      });
    }
  }
}
occurrences.sort(
  (left, right) =>
    compareText(left.path, right.path) || left.line - right.line || compareText(left.identifier, right.identifier),
);
const byIdentifier = {};
for (const identifier of FORBIDDEN) {
  byIdentifier[identifier] = occurrences.filter(entry => entry.identifier === identifier).length;
}
const report = {
  schema_version: 1,
  policy: "production-rust-source-must-not-reference-legacy-m3-battle-paths",
  forbidden_identifiers: FORBIDDEN,
  occurrence_count: occurrences.length,
  by_identifier: byIdentifier,
  occurrences,
};
mkdirSync(dirname(input.output), { recursive: true });
writeFileSync(input.output, `${JSON.stringify(report)}\n`);
console.log(`M7 legacy-path audit: ${occurrences.length} production occurrences`);
