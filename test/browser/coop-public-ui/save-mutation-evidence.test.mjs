/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { coopRunStatusView, exactCoopDeleteRequestView } from "./evidence.mjs";

test("accepts only a complete exact tombstone proof", () => {
  const valid = {
    state: "tombstoned",
    runId: "run-public-browser-123456789",
    slot: 0,
    checkpointRevision: 4,
    digest: "a".repeat(64),
  };
  assert.deepEqual(coopRunStatusView(valid), valid);
  assert.equal(coopRunStatusView({ ...valid, digest: "a".repeat(63) }), null);
  assert.equal(coopRunStatusView({ ...valid, runId: "short" }), null);
  assert.equal(coopRunStatusView({ ...valid, slot: 5 }), null);
  assert.equal(coopRunStatusView({ ...valid, state: "deleted-ish" }), null);
});

test("requires every exact-delete URL commitment field", () => {
  const query = new URLSearchParams({
    slot: "0",
    coopCasRunId: "run-public-browser-123456789",
    coopCasCheckpointRevision: "4",
    coopCasDigest: "b".repeat(64),
  });
  const valid = exactCoopDeleteRequestView(`https://save.test/savedata/session/coop-cas-delete?${query}`);
  assert.deepEqual(valid, {
    slot: 0,
    runId: "run-public-browser-123456789",
    checkpointRevision: 4,
    digest: "b".repeat(64),
  });
  query.delete("coopCasDigest");
  assert.equal(exactCoopDeleteRequestView(`https://save.test/savedata/session/coop-cas-delete?${query}`), null);
});

test("save journey requires public UI, exact CAS ACK ordering, and a brand-new context", async () => {
  const [journeys, harness, workflow] = await Promise.all([
    readFile(new URL("journeys.mjs", import.meta.url), "utf8"),
    readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/coop-public-ui-journey.yml", import.meta.url), "utf8"),
  ]);
  assert.match(journeys, /targetId: "delete-run"/u);
  assert.match(journeys, /surfaceId: "save-slot",[\s\S]*?targetId: "cursor:0",[\s\S]*?submit: false/u);
  assert.match(journeys, /"\/savedata\/session\/coop-cas-delete"/u);
  assert.match(journeys, /soloWrite\.index <= deleteResponse\.index/u);
  assert.match(journeys, /sessionStorageKeys\(deletedCold\)/u);
  assert.match(harness, /browser\.createBrowserContext\(\)/u);
  assert.match(harness, /brand-new cookie jar and local storage/u);
  assert.match(workflow, /local-worker-server\.ts/u);
  assert.match(workflow, /local-worker-vite\.config\.mjs/u);
  assert.match(workflow, /inputs\.journey == 'save-mutations'/u);
});
