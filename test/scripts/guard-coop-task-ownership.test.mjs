/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  evaluateOwnership,
  findOwnershipManifest,
  LOCKED_P33_SCHEMA_FILES,
  pathIsAllowed,
  validateOwnershipManifest,
  verifyOwnershipRepository,
} from "../../scripts/guard-coop-task-ownership.mjs";

const BRANCH = "ci/coop/p33-example";
const TRAIN = "ci/coop/p33-mystery-public-transition";
const MANIFEST_PATH = ".github/coop-task-ownership/p33-example.json";

function git(repo, ...args) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function tempRepository() {
  const repo = mkdtempSync(resolve(tmpdir(), "coop-ownership-"));
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "ci@example.invalid");
  git(repo, "config", "user.name", "Co-op CI Test");
  writeFileSync(resolve(repo, "owned.txt"), "base\n");
  git(repo, "add", "owned.txt");
  git(repo, "commit", "-m", "base");
  return { repo, baseSha: git(repo, "rev-parse", "HEAD") };
}

function manifest(baseSha, allowedFiles = [MANIFEST_PATH, "owned.txt"]) {
  return validateOwnershipManifest(
    {
      version: 1,
      taskId: "p33-example",
      branch: BRANCH,
      trainRef: TRAIN,
      baseSha,
      allowedFiles,
    },
    MANIFEST_PATH,
  );
}

test("exact paths and trailing directory prefixes have deterministic matching", () => {
  assert.equal(pathIsAllowed("owned.txt", ["owned.txt"]), true);
  assert.equal(pathIsAllowed("src/example/file.ts", ["src/example/**"]), true);
  assert.equal(pathIsAllowed("src/example", ["src/example/**"]), true);
  assert.equal(pathIsAllowed("src/examples/file.ts", ["src/example/**"]), false);
});

test("manifest validation rejects unsorted ownership and unsupported wildcard syntax", () => {
  const baseSha = "0".repeat(40);
  assert.throws(() => manifest(baseSha, ["owned.txt", MANIFEST_PATH]), /allowedFiles must be lexically sorted/u);
  assert.throws(
    () => manifest(baseSha, [MANIFEST_PATH, "src/**/file.ts"]),
    /supports only an exact path or a trailing/u,
  );
});

test("repository verification accepts an owned base-to-HEAD change", t => {
  const { repo, baseSha } = tempRepository();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(resolve(repo, "owned.txt"), "changed\n");
  git(repo, "add", "owned.txt");
  git(repo, "commit", "-m", "owned change");
  const trainTipSha = git(repo, "rev-parse", "HEAD");
  const evidence = verifyOwnershipRepository({
    repoRoot: repo,
    manifest: manifest(baseSha),
    branch: BRANCH,
    expectedBase: baseSha,
    trainTipSha,
  });
  assert.equal(evidence.status, "passed");
  assert.deepEqual(evidence.changedFiles, ["owned.txt"]);
  assert.equal(evidence.baseSha, baseSha);
});

test("repository verification rejects an unowned base-to-HEAD change", t => {
  const { repo, baseSha } = tempRepository();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(resolve(repo, "outside.txt"), "not owned\n");
  git(repo, "add", "outside.txt");
  git(repo, "commit", "-m", "outside change");
  const trainTipSha = git(repo, "rev-parse", "HEAD");
  assert.throws(
    () =>
      verifyOwnershipRepository({
        repoRoot: repo,
        manifest: manifest(baseSha),
        branch: BRANCH,
        expectedBase: baseSha,
        trainTipSha,
      }),
    /changed files outside allowedFiles: outside\.txt/u,
  );
});

test("rename detection is disabled so an unowned source cannot disappear into an allowed destination", t => {
  const { repo } = tempRepository();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(resolve(repo, "unowned.txt"), "source\n");
  git(repo, "add", "unowned.txt");
  git(repo, "commit", "-m", "rename base");
  const baseSha = git(repo, "rev-parse", "HEAD");
  mkdirSync(resolve(repo, "allowed"));
  git(repo, "mv", "unowned.txt", "allowed/moved.txt");
  git(repo, "commit", "-m", "rename into ownership");
  const trainTipSha = git(repo, "rev-parse", "HEAD");
  assert.throws(
    () =>
      verifyOwnershipRepository({
        repoRoot: repo,
        manifest: manifest(baseSha, [MANIFEST_PATH, "allowed/**"]),
        branch: BRANCH,
        expectedBase: baseSha,
        trainTipSha,
      }),
    /changed files outside allowedFiles: unowned\.txt/u,
  );
});

test("frozen schema changes fail even when a broad prefix claims them", () => {
  const baseSha = "1".repeat(40);
  const schemaFile = LOCKED_P33_SCHEMA_FILES[0];
  const guarded = validateOwnershipManifest(
    {
      version: 1,
      taskId: "p33-example",
      branch: BRANCH,
      trainRef: TRAIN,
      baseSha,
      allowedFiles: [MANIFEST_PATH, "src/data/elite-redux/coop/**"],
    },
    MANIFEST_PATH,
  );
  assert.throws(
    () =>
      evaluateOwnership({
        manifest: guarded,
        branch: BRANCH,
        expectedBase: baseSha,
        headSha: "2".repeat(40),
        changedFiles: [schemaFile],
      }),
    /locked P33 schema files changed/u,
  );
});

test("only the integration train may declare the exact locked schema files changed by one batch", () => {
  const baseSha = "1".repeat(40);
  const schemaFile = LOCKED_P33_SCHEMA_FILES[0];
  assert.throws(
    () =>
      validateOwnershipManifest(
        {
          version: 2,
          taskId: "p33-example",
          branch: BRANCH,
          trainRef: TRAIN,
          baseSha,
          allowedFiles: [MANIFEST_PATH, schemaFile],
          lockedSchemaFiles: [schemaFile],
        },
        MANIFEST_PATH,
      ),
    /only an integration train may declare lockedSchemaFiles/u,
  );

  const integration = validateOwnershipManifest(
    {
      version: 2,
      taskId: "p33-example",
      branch: BRANCH,
      trainRef: BRANCH,
      baseSha,
      allowedFiles: [MANIFEST_PATH, schemaFile],
      lockedSchemaFiles: [schemaFile],
    },
    MANIFEST_PATH,
  );
  const evidence = evaluateOwnership({
    manifest: integration,
    branch: BRANCH,
    expectedBase: baseSha,
    headSha: "2".repeat(40),
    changedFiles: [schemaFile],
  });
  assert.deepEqual(evidence.approvedLockedSchemaFiles, [schemaFile]);
});

test("an integration schema declaration is exact and single-batch, never a reusable waiver", () => {
  const baseSha = "1".repeat(40);
  const schemaFile = LOCKED_P33_SCHEMA_FILES[0];
  const integration = validateOwnershipManifest(
    {
      version: 2,
      taskId: "p33-example",
      branch: BRANCH,
      trainRef: BRANCH,
      baseSha,
      allowedFiles: [MANIFEST_PATH, schemaFile],
      lockedSchemaFiles: [schemaFile],
    },
    MANIFEST_PATH,
  );
  assert.throws(
    () =>
      evaluateOwnership({
        manifest: integration,
        branch: BRANCH,
        expectedBase: baseSha,
        headSha: "2".repeat(40),
        changedFiles: [MANIFEST_PATH],
      }),
    /declared locked P33 schema files were unchanged/u,
  );
});

test("resolved train base must exactly equal the declared base", () => {
  const baseSha = "3".repeat(40);
  assert.throws(
    () =>
      evaluateOwnership({
        manifest: manifest(baseSha),
        branch: BRANCH,
        expectedBase: "4".repeat(40),
        headSha: "5".repeat(40),
        changedFiles: ["owned.txt"],
      }),
    /does not match resolved train base/u,
  );
});

test("repository verification rejects a declared base commit that is missing locally", t => {
  const { repo } = tempRepository();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const missingBase = "7".repeat(40);
  const trainTipSha = git(repo, "rev-parse", "HEAD");
  assert.throws(
    () =>
      verifyOwnershipRepository({
        repoRoot: repo,
        manifest: manifest(missingBase),
        branch: BRANCH,
        expectedBase: missingBase,
        trainTipSha,
      }),
    /git cat-file -e/u,
  );
});

test("repository verification rejects a task base outside the declared train lineage", t => {
  const { repo, baseSha: commonBase } = tempRepository();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(resolve(repo, "owned.txt"), "task base\n");
  git(repo, "add", "owned.txt");
  git(repo, "commit", "-m", "task base");
  const taskBase = git(repo, "rev-parse", "HEAD");
  writeFileSync(resolve(repo, "owned.txt"), "task head\n");
  git(repo, "add", "owned.txt");
  git(repo, "commit", "-m", "task head");

  git(repo, "branch", "train", commonBase);
  git(repo, "switch", "train");
  writeFileSync(resolve(repo, "train.txt"), "unrelated train\n");
  git(repo, "add", "train.txt");
  git(repo, "commit", "-m", "divergent train");
  const trainTipSha = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "main");

  assert.throws(
    () =>
      verifyOwnershipRepository({
        repoRoot: repo,
        manifest: manifest(taskBase),
        branch: BRANCH,
        expectedBase: taskBase,
        trainTipSha,
      }),
    /is not in declared train/u,
  );
});

test("manifest discovery fails closed for missing and duplicate branch contracts", t => {
  const repo = mkdtempSync(resolve(tmpdir(), "coop-ownership-manifests-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const directory = resolve(repo, ".github", "coop-task-ownership");
  mkdirSync(directory, { recursive: true });
  assert.throws(() => findOwnershipManifest(repo, BRANCH), /no manifest declares branch/u);

  const base = {
    version: 1,
    taskId: "p33-example",
    branch: BRANCH,
    trainRef: TRAIN,
    baseSha: "6".repeat(40),
  };
  writeFileSync(
    resolve(directory, "one.json"),
    JSON.stringify({ ...base, allowedFiles: [".github/coop-task-ownership/one.json"] }),
  );
  writeFileSync(
    resolve(directory, "two.json"),
    JSON.stringify({ ...base, taskId: "p33-example-two", allowedFiles: [".github/coop-task-ownership/two.json"] }),
  );
  assert.throws(() => findOwnershipManifest(repo, BRANCH), /multiple manifests declare branch/u);
});
