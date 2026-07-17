#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, process.env.COOP_BROWSER_DIST ?? "dist-coop-browser");
const manifestPath = resolve(dist, "coop-browser-artifact.json");
const verifyOnly = process.argv.includes("--verify");
const entryContract = process.env.COOP_BROWSER_ENTRY_CONTRACT?.trim() || "transport-v1";
const assetShaPattern = /^[0-9a-f]{40}$/u;
const assetTargetPattern = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Heraklines\/er-assets@([0-9a-f]{40})\//u;

function productionAssetRules(contents) {
  const rules = [];
  const sources = new Set();
  for (const rawLine of contents.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const [source, target, status, ...extra] = line.split(/\s+/gu);
    const targetMatch = assetTargetPattern.exec(target ?? "");
    if (extra.length > 0 || status !== "302" || !source?.startsWith("/") || targetMatch == null) {
      throw new Error(`unsupported production asset redirect: ${line}`);
    }
    sources.add(source);
    rules.push({ source, pin: targetMatch[1] });
  }
  if (rules.length === 0 || !sources.has("/images/*") || !sources.has("/fonts/*")) {
    throw new Error("production asset redirects must include pinned image and font surfaces");
  }
  return rules;
}

function productionAssetPins(contents) {
  return productionAssetRules(contents).map(rule => rule.pin);
}

/**
 * The beta Vite plugin copies the full vendored asset tree even though this sealed browser
 * surface deliberately exercises staging's immutable CDN redirects. Keeping those duplicate
 * files made each fan-out runner transfer 522 MB and caused the local preview to serve them
 * instead of the CDN. Remove only paths validated by the production redirect contract; all
 * hashed application chunks and non-redirected runtime data remain sealed in the artifact.
 */
function pruneRedirectedProductionAssets(rules) {
  const pruned = [];
  for (const { source } of rules) {
    const relativePath = source.endsWith("/*") ? source.slice(1, -2) : source.slice(1);
    if (
      relativePath.length === 0
      || relativePath.includes("..")
      || relativePath.includes("\\")
      || relativePath.includes("*")
    ) {
      throw new Error(`unsafe production asset redirect source: ${source}`);
    }
    const target = resolve(dist, relativePath);
    const inside = relative(dist, target).replaceAll("\\", "/");
    if (inside !== relativePath) {
      throw new Error(`production asset redirect escapes browser artifact: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    pruned.push(relativePath);
  }
  process.stdout.write(`pruned ${pruned.length} production-CDN path(s): ${pruned.join(", ")}\n`);
}

function preparePublicUiProductionSurface() {
  const assetSha = process.env.COOP_BROWSER_ASSET_SHA?.trim() ?? "";
  if (!assetShaPattern.test(assetSha)) {
    throw new Error(`COOP_BROWSER_ASSET_SHA must be a 40-character lowercase hex SHA, got "${assetSha}"`);
  }
  const redirectTemplate = readFileSync(resolve(root, "deploy", "cloudflare", "_redirects"), "utf8");
  const redirectRules = productionAssetRules(redirectTemplate);
  const redirects = redirectTemplate.replace(/er-assets@[0-9a-f]{40}/gu, `er-assets@${assetSha}`);
  if (productionAssetPins(redirects).some(pin => pin !== assetSha)) {
    throw new Error("failed to rewrite every production asset redirect to the resolved asset SHA");
  }
  pruneRedirectedProductionAssets(redirectRules);
  writeFileSync(resolve(dist, "_redirects"), redirects);
  writeFileSync(resolve(dist, "manifest.json"), '{"manifest":{}}\n');
  return assetSha;
}

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

const assetSha = !verifyOnly && entryContract === "public-ui-v1" ? preparePublicUiProductionSurface() : null;
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
  if (expected.entryContract !== entryContract) {
    throw new Error(
      `co-op browser artifact entry contract mismatch: expected ${expected.entryContract}, got ${entryContract}`,
    );
  }
  if (entryContract === "public-ui-v1") {
    if (!assetShaPattern.test(expected.assetSha ?? "")) {
      throw new Error(`sealed public-UI artifact has invalid asset SHA: ${expected.assetSha}`);
    }
    const redirects = readFileSync(resolve(dist, "_redirects"), "utf8");
    if (productionAssetPins(redirects).some(pin => pin !== expected.assetSha)) {
      throw new Error("sealed public-UI redirects do not all match the artifact asset SHA");
    }
    if (readFileSync(resolve(dist, "manifest.json"), "utf8") !== '{"manifest":{}}\n') {
      throw new Error("sealed public-UI artifact does not contain staging's inert manifest.json");
    }
  }
  process.stdout.write(`verified immutable co-op browser artifact ${actualDigest} (${files.length} files)\n`);
} else {
  const manifest = {
    version: 1,
    sha: process.env.GITHUB_SHA ?? "local",
    apiOrigin: process.env.COOP_BROWSER_API_ORIGIN ?? process.env.VITE_SERVER_URL ?? null,
    signalOrigin: process.env.VITE_COOP_SERVER_URL ?? "http://127.0.0.1:4174",
    entryContract,
    assetSha,
    digest: aggregateDigest(files),
    files,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`sealed co-op browser artifact ${manifest.digest} (${files.length} files)\n`);
}
