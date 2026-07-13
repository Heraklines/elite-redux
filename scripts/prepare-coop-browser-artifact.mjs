#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, process.env.COOP_BROWSER_DIST ?? "dist-coop-browser");
const manifestPath = resolve(dist, "coop-browser-artifact.json");
const verifyOnly = process.argv.includes("--verify");

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesBelow(path));
    } else if (path !== manifestPath) {
      files.push(path);
    }
  }
  return files.sort();
}

function fileRecord(path) {
  const contents = readFileSync(path);
  return {
    path: relative(dist, path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

function aggregateDigest(records) {
  const hash = createHash("sha256");
  for (const file of records) {
    hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  }
  return hash.digest("hex");
}

const files = filesBelow(dist).map(fileRecord);
if (files.length === 0 || !files.some(file => file.path === "index.html")) {
  throw new Error(`co-op browser artifact at ${dist} is empty or lacks index.html`);
}

if (verifyOnly) {
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actualDigest = aggregateDigest(files);
  if (expected.version !== 1 || expected.digest !== actualDigest) {
    throw new Error(`co-op browser artifact digest mismatch: expected ${expected.digest}, got ${actualDigest}`);
  }
  process.stdout.write(`verified immutable co-op browser artifact ${actualDigest} (${files.length} files)\n`);
} else {
  const manifest = {
    version: 1,
    sha: process.env.GITHUB_SHA ?? "local",
    signalOrigin: process.env.VITE_COOP_SERVER_URL ?? "http://127.0.0.1:4174",
    digest: aggregateDigest(files),
    files,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`sealed co-op browser artifact ${manifest.digest} (${files.length} files)\n`);
}
