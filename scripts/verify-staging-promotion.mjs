#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA = /^[0-9a-f]{40}$/u;

function exactSha(value, label) {
  const candidate = String(value ?? "");
  if (!SHA.test(candidate)) {
    throw new Error(`${label} must be a full lowercase Git SHA, got ${JSON.stringify(candidate)}`);
  }
  return candidate;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not readable JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function assertCheckoutIdentity(expectedSha, headSha) {
  const expected = exactSha(expectedSha, "requested promotion SHA");
  const head = exactSha(headSha, "checked-out Git HEAD");
  if (head !== expected) {
    throw new Error(`refusing promotion: requested ${expected}, but checkout HEAD is ${head}`);
  }
  return expected;
}

export function versionIdentitySha(version, label = "version.json") {
  return exactSha(version?.identity?.sha, `${label} identity.sha`);
}

export function assertDistIdentity(expectedSha, version) {
  const expected = exactSha(expectedSha, "promoted SHA");
  const bundled = versionIdentitySha(version, "dist/version.json");
  if (bundled !== expected) {
    throw new Error(`refusing promotion: dist/version.json reports ${bundled}, but Git HEAD is ${expected}`);
  }
  return expected;
}

export function assertCurrentBranchHead(expectedSha, remoteSha) {
  const expected = exactSha(expectedSha, "promoted SHA");
  const remote = exactSha(remoteSha, "current feat/elite-redux-port SHA");
  if (remote !== expected) {
    throw new Error(`refusing stale promotion: requested ${expected}, but feat/elite-redux-port is now ${remote}`);
  }
  return expected;
}

export function assertFastForwardPromotion(liveSha, promotedSha, isAncestor) {
  const live = exactSha(liveSha, "live staging SHA");
  const promoted = exactSha(promotedSha, "promoted SHA");
  if (!isAncestor) {
    throw new Error(`refusing non-fast-forward staging promotion: live ${live} is not an ancestor of ${promoted}`);
  }
  return promoted;
}

export function assertLiveIdentity(expectedSha, pageVersion, workerHealth) {
  const expected = exactSha(expectedSha, "promoted SHA");
  const page = versionIdentitySha(pageVersion, "staging Pages version.json");
  const worker = exactSha(workerHealth?.sourceSha, "staging co-op Worker sourceSha");
  if (workerHealth?.ok !== true || workerHealth?.identityConfigured !== true) {
    throw new Error("staging co-op Worker health did not attest an active configured identity");
  }
  if (page !== expected || worker !== expected || page !== worker) {
    throw new Error(`staging identity split: promoted=${expected}, page=${page}, worker=${worker}`);
  }
  return expected;
}

function assertAncestor(ancestorSha, descendantSha) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status === 0) {
    assertFastForwardPromotion(ancestorSha, descendantSha, true);
    return;
  }
  if (result.status === 1) {
    assertFastForwardPromotion(ancestorSha, descendantSha, false);
    return;
  }
  throw new Error(`could not prove staging ancestry: ${result.stderr?.trim() || `git exited ${result.status}`}`);
}

function usage() {
  throw new Error(
    "usage: verify-staging-promotion.mjs seal <sha> | dist <sha> <version.json> | guard <sha> <remote-ref> <live-version.json> | live <sha> <page-version.json> <worker-health.json>",
  );
}

const [command, expectedArg, firstArg, secondArg] = process.argv.slice(2);
if (command === "seal") {
  const expected = assertCheckoutIdentity(expectedArg, git(["rev-parse", "HEAD"]));
  console.log(`sealed immutable staging promotion source ${expected}`);
} else if (command === "dist") {
  if (!firstArg) {
    usage();
  }
  const expected = assertCheckoutIdentity(expectedArg, git(["rev-parse", "HEAD"]));
  assertDistIdentity(expected, readJson(firstArg, "built version identity"));
  console.log(`verified bundle identity ${expected} equals Git HEAD`);
} else if (command === "guard") {
  if (!firstArg || !secondArg) {
    usage();
  }
  const expected = assertCheckoutIdentity(expectedArg, git(["rev-parse", "HEAD"]));
  assertCurrentBranchHead(expected, git(["rev-parse", firstArg]));
  const liveSha = versionIdentitySha(readJson(secondArg, "live staging version identity"), "live staging version.json");
  assertAncestor(liveSha, expected);
  console.log(`verified current branch head ${expected} is a fast-forward of live staging ${liveSha}`);
} else if (command === "live") {
  if (!firstArg || !secondArg) {
    usage();
  }
  const expected = assertCheckoutIdentity(expectedArg, git(["rev-parse", "HEAD"]));
  assertLiveIdentity(
    expected,
    readJson(firstArg, "staging Pages identity"),
    readJson(secondArg, "staging Worker identity"),
  );
  console.log(`verified staging Pages and co-op Worker both serve ${expected}`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  usage();
}
