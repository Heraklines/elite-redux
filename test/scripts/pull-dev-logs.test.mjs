/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
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
  assert.deepEqual(messages, []);
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
