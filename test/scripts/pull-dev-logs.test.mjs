/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  buildGithubHeaders,
  classifyGithubHttpError,
  pullDevLogs,
  redactSecrets,
  selectGithubCredential,
} from "../../scripts/pull-dev-logs.mjs";

function response(status, body = "", headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

test("selects documented GitHub credential sources in deterministic precedence order", () => {
  const readPaths = [];
  const options = {
    env: { GH_TOKEN: "  gh-primary  ", GITHUB_TOKEN: "gh-secondary" },
    homeDir: "/home/tester",
    tokenFiles: ["/home/tester/Desktop/github_token.txt"],
    fileExists: () => true,
    readFile: path => {
      readPaths.push(path);
      return "gh-file";
    },
  };

  assert.deepEqual(selectGithubCredential(options), { token: "gh-primary", source: "GH_TOKEN" });
  assert.deepEqual(readPaths, []);

  assert.deepEqual(selectGithubCredential({ ...options, env: { GH_TOKEN: " ", GITHUB_TOKEN: "gh-secondary" } }), {
    token: "gh-secondary",
    source: "GITHUB_TOKEN",
  });

  assert.deepEqual(selectGithubCredential({ ...options, env: {} }), {
    token: "gh-file",
    source: "token file /home/tester/Desktop/github_token.txt",
  });
});

test("adds authentication only when a credential is available", () => {
  assert.equal(buildGithubHeaders(null).Authorization, undefined);
  const headers = buildGithubHeaders({ token: "secret-token", source: "GH_TOKEN" });
  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers.Accept, "application/vnd.github+json");
});

test("classifies unauthenticated and rate-limited 403 responses separately", async () => {
  const unauthenticated = await classifyGithubHttpError(response(403, '{"message":"Forbidden"}'), {
    stage: "reading the dev-logs branch reference",
    credential: null,
  });
  assert.equal(unauthenticated.status, 403);
  assert.equal(unauthenticated.rateLimited, false);
  assert.match(unauthenticated.message, /denied the unauthenticated request/);
  assert.match(unauthenticated.message, /Set GH_TOKEN or GITHUB_TOKEN/);

  const rateLimited = await classifyGithubHttpError(
    response(403, '{"message":"API rate limit exceeded"}', {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1750000000",
    }),
    { stage: "reading the dev-logs tree", credential: { token: "top-secret", source: "GH_TOKEN" } },
  );
  assert.equal(rateLimited.rateLimited, true);
  assert.match(rateLimited.message, /rate limit exhausted/);
  assert.match(rateLimited.message, /credential source: GH_TOKEN/);
  assert.doesNotMatch(rateLimited.message, /top-secret/);
});

test("a raw-log 403 fails the pull instead of reporting zero new logs", async () => {
  const messages = [];
  const fetches = [
    response(200, JSON.stringify({ object: { sha: "tree-sha" } })),
    response(200, JSON.stringify({ tree: [{ type: "blob", path: "remote/2026-07-15/report.log" }] })),
    response(403, JSON.stringify({ message: "Resource not accessible by token secret-value" })),
  ];

  await assert.rejects(
    pullDevLogs({
      fetchImpl: async () => fetches.shift(),
      credential: { token: "secret-value", source: "GITHUB_TOKEN" },
      fileExists: () => false,
      log: message => messages.push(message),
    }),
    error => {
      assert.equal(error.status, 403);
      assert.match(error.message, /downloading remote\/2026-07-15\/report\.log/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    },
  );
  assert.deepEqual(messages, ["1 new log(s) queued from 1 total; downloading with concurrency 1."]);
});

test("redacts explicit, header, query, and JSON credential forms", () => {
  const secret = "github_pat_123456789";
  const input =
    `value=${secret} Bearer opaque-token? token abc.def `
    + `https://example.test/?access_token=query-secret&ok=1 {"authorization":"json-secret"}`;
  const output = redactSecrets(input, [secret]);

  for (const leaked of [secret, "opaque-token", "abc.def", "query-secret", "json-secret"]) {
    assert.doesNotMatch(output, new RegExp(leaked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(output, /<redacted>/);
});

test("downloads 1,001 reports with bounded concurrency and deterministic progress", async () => {
  const paths = Array.from(
    { length: 1_001 },
    (_, index) => `remote/2026-07-15/report-${String(index).padStart(4, "0")}.log`,
  ).reverse();
  const files = new Map();
  const messages = [];
  let activeRawRequests = 0;
  let maxActiveRawRequests = 0;
  let rawRequestCount = 0;

  const fetchImpl = async url => {
    if (url.includes("git/ref/heads")) {
      return response(200, JSON.stringify({ object: { sha: "tree-sha" } }));
    }
    if (url.includes("git/trees")) {
      return response(200, JSON.stringify({ tree: paths.map(path => ({ type: "blob", path })) }));
    }
    activeRawRequests++;
    rawRequestCount++;
    maxActiveRawRequests = Math.max(maxActiveRawRequests, activeRawRequests);
    const reportIndex = Number(/report-(\d+)\.log$/.exec(url)?.[1] ?? 0);
    if (reportIndex % 2 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    } else {
      await Promise.resolve();
    }
    activeRawRequests--;
    return response(200, `report ${reportIndex}`);
  };

  const result = await pullDevLogs({
    fetchImpl,
    credential: { token: "test-token", source: "GH_TOKEN" },
    concurrency: 7,
    progressSteps: 4,
    requestTimeoutMs: 2_000,
    fileExists: path => files.has(path),
    makeDirectory: () => {},
    writeFile: (path, contents) => files.set(path, contents),
    renameFile: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    log: message => messages.push(message),
  });

  assert.deepEqual(result, { downloaded: 1_001, total: 1_001, credentialSource: "GH_TOKEN" });
  assert.equal(rawRequestCount, 1_001);
  assert.equal(maxActiveRawRequests, 7);
  assert.equal(
    [...files.keys()].some(path => path.endsWith(".partial")),
    false,
  );

  const progress = messages.filter(message => message.startsWith("Progress:"));
  assert.deepEqual(
    progress.map(message => Number(/Progress: (\d+)\//.exec(message)?.[1])),
    [251, 502, 753, 1_001],
  );
  assert.match(progress[0], /report-0250\.log/);
  assert.match(progress[1], /report-0501\.log/);
  assert.match(progress[2], /report-0752\.log/);
  assert.match(progress[3], /report-1000\.log/);
});

test("times out a stuck raw request without exposing the credential", async () => {
  const secret = "github_pat_timeout_secret";
  const startedAt = Date.now();

  await assert.rejects(
    pullDevLogs({
      fetchImpl: async (url, { signal } = {}) => {
        if (url.includes("git/ref/heads")) {
          return response(200, JSON.stringify({ object: { sha: "tree-sha" } }));
        }
        if (url.includes("git/trees")) {
          return response(200, JSON.stringify({ tree: [{ type: "blob", path: "remote/2026-07-15/stuck.log" }] }));
        }
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error(`aborted ${secret}`)), { once: true });
        });
      },
      credential: { token: secret, source: "GH_TOKEN" },
      requestTimeoutMs: 25,
      fileExists: () => false,
      log: () => {},
    }),
    error => {
      assert.equal(error.name, "GithubRequestTimeoutError");
      assert.equal(error.timeoutMs, 25);
      assert.match(error.message, /timed out after 25ms/);
      assert.match(error.message, /downloading remote\/2026-07-15\/stuck\.log/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 500);
});

test("resumes an interrupted atomic write and preserves final and DONE skips", async () => {
  const resumablePath = "remote/2026-07-15/resumable.log";
  const existingPath = "remote/2026-07-15/existing.log";
  const donePath = "remote/2026-07-15/triaged.log";
  const entries = [resumablePath, existingPath, donePath].map(path => ({ type: "blob", path }));
  const outRoot = "test-output";
  const resumableOutput = join(outRoot, resumablePath);
  const existingOutput = join(outRoot, existingPath);
  const triagedOutput = join(outRoot, donePath).replace(/\.log$/, ".DONE.log");
  const files = new Map([
    [existingOutput, "already present"],
    [triagedOutput, "already triaged"],
  ]);
  let rawRequestCount = 0;

  const fetchImpl = async url => {
    if (url.includes("git/ref/heads")) {
      return response(200, JSON.stringify({ object: { sha: "tree-sha" } }));
    }
    if (url.includes("git/trees")) {
      return response(200, JSON.stringify({ tree: entries }));
    }
    rawRequestCount++;
    return response(200, `download ${rawRequestCount}`);
  };
  const common = {
    fetchImpl,
    outRoot,
    fileExists: path => files.has(path),
    makeDirectory: () => {},
    writeFile: (path, contents) => files.set(path, contents),
    log: () => {},
  };

  await assert.rejects(
    pullDevLogs({
      ...common,
      renameFile: () => {
        throw new Error("simulated interruption before atomic rename");
      },
    }),
    /simulated interruption/,
  );
  assert.equal(files.has(resumableOutput), false);
  assert.equal(files.get(`${resumableOutput}.partial`), "download 1");

  const result = await pullDevLogs({
    ...common,
    renameFile: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  });

  assert.deepEqual(result, { downloaded: 1, total: 3, credentialSource: "none" });
  assert.equal(rawRequestCount, 2);
  assert.equal(files.get(resumableOutput), "download 2");
  assert.equal(files.has(`${resumableOutput}.partial`), false);
  assert.equal(files.get(existingOutput), "already present");
  assert.equal(files.get(triagedOutput), "already triaged");
});
