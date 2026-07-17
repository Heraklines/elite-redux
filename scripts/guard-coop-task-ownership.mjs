#!/usr/bin/env node

/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_MANIFEST_DIR = ".github/coop-task-ownership";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TASK_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/u;

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Files whose modification changes the frozen P33 wire/address contract. Focused surface tasks cannot own them. */
export const LOCKED_P33_SCHEMA_FILES = Object.freeze([
  "src/data/elite-redux/coop/coop-capabilities.ts",
  "src/data/elite-redux/coop/coop-membership.ts",
  "src/data/elite-redux/coop/coop-operation-envelope.ts",
  "src/data/elite-redux/coop/coop-session-binding.ts",
  "src/data/elite-redux/coop/coop-transport.ts",
]);

function fail(message) {
  throw new Error(`co-op task ownership: ${message}`);
}

function normalizedRepoPath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty repository-relative path`);
  }
  if (
    value.includes("\\")
    || value.startsWith("/")
    || value.startsWith("./")
    || value.endsWith("/")
    || value.split("/").some(part => part.length === 0 || part === "." || part === "..")
  ) {
    fail(`${label} is not a normalized repository-relative path: ${value}`);
  }
  return value;
}

function validBranchRef(value, label) {
  const invalidCharacter =
    typeof value === "string"
    && [...value].some(
      character => "\\~^:?*[".includes(character) || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    );
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 240
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("@{")
    || invalidCharacter
    || value.split("/").some(part => part.length === 0 || part === "." || part === ".." || part.endsWith(".lock"))
  ) {
    fail(`${label} is not a safe branch ref: ${String(value)}`);
  }
  return value;
}

function normalizedAllowedPattern(value, index) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`allowedFiles[${index}] must be a non-empty string`);
  }
  const wildcard = value.endsWith("/**");
  const prefix = wildcard ? value.slice(0, -3) : value;
  normalizedRepoPath(prefix, `allowedFiles[${index}]`);
  if (value.includes("*") && !wildcard) {
    fail(`allowedFiles[${index}] supports only an exact path or a trailing /** prefix: ${value}`);
  }
  return value;
}

function sortedUnique(values, label) {
  const sorted = [...values].sort(lexicalCompare);
  if (new Set(values).size !== values.length) {
    fail(`${label} must not contain duplicates`);
  }
  if (values.some((value, index) => value !== sorted[index])) {
    fail(`${label} must be lexically sorted for deterministic review`);
  }
}

export function pathIsAllowed(file, allowedFiles) {
  return allowedFiles.some(pattern => {
    if (!pattern.endsWith("/**")) {
      return file === pattern;
    }
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  });
}

export function validateOwnershipManifest(raw, manifestPath) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`${manifestPath} must contain one JSON object`);
  }
  const keys = Object.keys(raw).sort();
  const expectedKeys = ["allowedFiles", "baseSha", "branch", "taskId", "trainRef", "version"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(`${manifestPath} keys must be exactly: ${expectedKeys.join(", ")}`);
  }
  if (raw.version !== 1) {
    fail(`${manifestPath} version must be 1`);
  }
  if (typeof raw.taskId !== "string" || !TASK_PATTERN.test(raw.taskId)) {
    fail(`${manifestPath} taskId must match ${TASK_PATTERN}`);
  }
  const branch = validBranchRef(raw.branch, `${manifestPath} branch`);
  const trainRef = validBranchRef(raw.trainRef, `${manifestPath} trainRef`);
  if (typeof raw.baseSha !== "string" || !SHA_PATTERN.test(raw.baseSha)) {
    fail(`${manifestPath} baseSha must be one exact lowercase 40-character commit SHA`);
  }
  if (!Array.isArray(raw.allowedFiles) || raw.allowedFiles.length === 0) {
    fail(`${manifestPath} allowedFiles must be a non-empty array`);
  }
  const allowedFiles = raw.allowedFiles.map(normalizedAllowedPattern);
  sortedUnique(allowedFiles, `${manifestPath} allowedFiles`);
  const normalizedManifestPath = normalizedRepoPath(manifestPath.replaceAll("\\", "/"), "manifest path");
  if (!pathIsAllowed(normalizedManifestPath, allowedFiles)) {
    fail(`${manifestPath} must own itself in allowedFiles`);
  }
  return Object.freeze({
    version: 1,
    taskId: raw.taskId,
    branch,
    trainRef,
    baseSha: raw.baseSha,
    allowedFiles: Object.freeze(allowedFiles),
    manifestPath: normalizedManifestPath,
  });
}

function readManifest(repoRoot, manifestPath) {
  const absolute = resolve(repoRoot, manifestPath);
  let raw;
  try {
    raw = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${manifestPath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateOwnershipManifest(raw, manifestPath);
}

export function findOwnershipManifest(repoRoot, branch, manifestDir = DEFAULT_MANIFEST_DIR) {
  validBranchRef(branch, "requested branch");
  const absoluteDir = resolve(repoRoot, manifestDir);
  if (!existsSync(absoluteDir)) {
    fail(`manifest directory is missing: ${manifestDir}`);
  }
  const matches = [];
  for (const name of readdirSync(absoluteDir)
    .filter(file => file.endsWith(".json"))
    .sort(lexicalCompare)) {
    const manifestPath = `${manifestDir}/${name}`.replaceAll("\\", "/");
    const manifest = readManifest(repoRoot, manifestPath);
    if (manifest.branch === branch) {
      matches.push(manifest);
    }
  }
  if (matches.length === 0) {
    fail(`no manifest declares branch ${branch}`);
  }
  if (matches.length !== 1) {
    fail(`multiple manifests declare branch ${branch}: ${matches.map(item => item.manifestPath).join(", ")}`);
  }
  return matches[0];
}

function git(repoRoot, args, { allowStatus = [] } = {}) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 && !allowStatus.includes(result.status)) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return result;
}

function gitLines(repoRoot, args) {
  return git(repoRoot, args)
    .stdout.split(/\r?\n/gu)
    .map(value => value.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

export function evaluateOwnership({ manifest, branch, expectedBase, headSha, changedFiles }) {
  if (manifest.branch !== branch) {
    fail(`manifest branch ${manifest.branch} does not match workflow branch ${branch}`);
  }
  if (!SHA_PATTERN.test(expectedBase ?? "")) {
    fail(`resolved train base is not an exact commit SHA: ${String(expectedBase)}`);
  }
  if (manifest.baseSha !== expectedBase) {
    fail(`declared base ${manifest.baseSha} does not match resolved train base ${expectedBase}`);
  }
  if (!SHA_PATTERN.test(headSha ?? "")) {
    fail(`HEAD is not an exact commit SHA: ${String(headSha)}`);
  }
  const normalizedChanges = [
    ...new Set(changedFiles.map((file, index) => normalizedRepoPath(file, `changedFiles[${index}]`))),
  ].sort(lexicalCompare);
  const locked = normalizedChanges.filter(file => LOCKED_P33_SCHEMA_FILES.includes(file));
  if (locked.length > 0) {
    fail(`locked P33 schema files changed: ${locked.join(", ")}`);
  }
  const outside = normalizedChanges.filter(file => !pathIsAllowed(file, manifest.allowedFiles));
  if (outside.length > 0) {
    fail(`changed files outside allowedFiles: ${outside.join(", ")}`);
  }
  return {
    version: 1,
    status: "passed",
    taskId: manifest.taskId,
    branch,
    trainRef: manifest.trainRef,
    baseSha: manifest.baseSha,
    headSha,
    manifestPath: manifest.manifestPath,
    manifestSha256: createHash("sha256")
      .update(
        JSON.stringify({
          version: manifest.version,
          taskId: manifest.taskId,
          branch: manifest.branch,
          trainRef: manifest.trainRef,
          baseSha: manifest.baseSha,
          allowedFiles: manifest.allowedFiles,
        }),
      )
      .digest("hex"),
    allowedFiles: [...manifest.allowedFiles],
    changedFiles: normalizedChanges,
    lockedSchemaFiles: [...LOCKED_P33_SCHEMA_FILES],
  };
}

export function verifyOwnershipRepository({ repoRoot, manifest, branch, expectedBase, trainTipSha }) {
  if (!SHA_PATTERN.test(trainTipSha ?? "")) {
    fail(`resolved train tip is not an exact commit SHA: ${String(trainTipSha)}`);
  }
  git(repoRoot, ["cat-file", "-e", `${manifest.baseSha}^{commit}`]);
  git(repoRoot, ["cat-file", "-e", `${trainTipSha}^{commit}`]);
  const ancestor = git(repoRoot, ["merge-base", "--is-ancestor", manifest.baseSha, "HEAD"], { allowStatus: [1] });
  if (ancestor.status !== 0) {
    fail(`declared base ${manifest.baseSha} is not an ancestor of HEAD`);
  }
  const trainAncestor = git(repoRoot, ["merge-base", "--is-ancestor", manifest.baseSha, trainTipSha], {
    allowStatus: [1],
  });
  if (trainAncestor.status !== 0) {
    fail(`declared base ${manifest.baseSha} is not in declared train ${manifest.trainRef} at ${trainTipSha}`);
  }
  const [headSha] = gitLines(repoRoot, ["rev-parse", "HEAD"]);
  const changedFiles = gitLines(repoRoot, ["diff", "--no-renames", "--name-only", manifest.baseSha, "HEAD", "--"]);
  return {
    ...evaluateOwnership({ manifest, branch, expectedBase, headSha, changedFiles }),
    trainTipSha,
  };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function writeJson(path, value) {
  if (!path) {
    return;
  }
  writeFileSync(resolve(REPO_ROOT, path), `${JSON.stringify(value, null, 2)}\n`);
}

function writeGitHubOutput(path, manifest) {
  if (!path) {
    return;
  }
  appendFileSync(
    path,
    `manifest_path=${manifest.manifestPath}\ntrain_ref=${manifest.trainRef}\nbase_sha=${manifest.baseSha}\n`,
  );
}

function usage() {
  return [
    "usage:",
    "  node scripts/guard-coop-task-ownership.mjs resolve --branch <ref> [--output <json>] [--github-output <path>]",
    "  node scripts/guard-coop-task-ownership.mjs verify --branch <ref> --manifest <path> --expected-base <sha> --train-tip <sha> [--output <json>]",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const branch = argValue(args, "--branch");
  const output = argValue(args, "--output");
  if (!branch || (command !== "resolve" && command !== "verify")) {
    fail(usage());
  }
  if (command === "resolve") {
    const manifest = findOwnershipManifest(REPO_ROOT, branch);
    const resolution = {
      version: 1,
      status: "resolved",
      taskId: manifest.taskId,
      branch: manifest.branch,
      trainRef: manifest.trainRef,
      baseSha: manifest.baseSha,
      manifestPath: manifest.manifestPath,
    };
    writeJson(output, resolution);
    writeGitHubOutput(argValue(args, "--github-output"), manifest);
    process.stdout.write(`${JSON.stringify(resolution)}\n`);
    return;
  }
  const manifestPath = argValue(args, "--manifest");
  const expectedBase = argValue(args, "--expected-base");
  const trainTipSha = argValue(args, "--train-tip");
  if (!manifestPath || !expectedBase || !trainTipSha) {
    fail(usage());
  }
  const manifest = readManifest(REPO_ROOT, manifestPath);
  try {
    const evidence = verifyOwnershipRepository({ repoRoot: REPO_ROOT, manifest, branch, expectedBase, trainTipSha });
    writeJson(output, evidence);
    process.stdout.write(
      `co-op ownership PASS task=${evidence.taskId} base=${evidence.baseSha} files=${evidence.changedFiles.length}\n`,
    );
  } catch (error) {
    writeJson(output, {
      version: 1,
      status: "failed",
      branch,
      expectedBase,
      trainTipSha,
      manifestPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

if (resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
