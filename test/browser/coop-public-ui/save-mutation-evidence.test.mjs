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
  const [journeys, harness, workflow, saveHandler, gameData, campaignNav, browserEntry] = await Promise.all([
    readFile(new URL("journeys.mjs", import.meta.url), "utf8"),
    readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/coop-public-ui-journey.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../src/ui/handlers/save-slot-select-ui-handler.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/system/game-data.ts", import.meta.url), "utf8"),
    readFile(new URL("campaign-nav.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    journeys,
    /async function saveMutations\(rig\) \{[\s\S]*?rig\.loginBoth\(\);[\s\S]*?rig\.pair\([\s\S]*?rig\.startFreshRun\(\);/u,
  );
  assert.doesNotMatch(journeys, /async function saveMutations\(rig\) \{\s*await freshThroughWave2\(rig\)/u);
  assert.match(journeys, /targetId: "delete-run"/u);
  assert.match(journeys, /findLastSemanticSurface\(client\.pageCursor, "save-slot"\)/u);
  assert.match(journeys, /event\.observation\.selectedOptionId === "occupied-slot:0"/u);
  assert.doesNotMatch(journeys, /surfaceId: "save-slot",[\s\S]*?targetId: "cursor:0"/u);
  assert.match(journeys, /waitForReadyYesConfirmation[\s\S]*?ready\.inputBlocked === false/u);
  assert.doesNotMatch(journeys, /pressUntilExactDeleteRequest|attempt <= 3/u);
  assert.match(journeys, /"\/savedata\/session\/coop-cas-delete"/u);
  assert.match(journeys, /soloWrite\.index <= deleteResponse\.index/u);
  assert.match(journeys, /client\.waitForLocalCommand\(mutationCursor\)/u);
  assert.match(journeys, /sessionStorageKeys\(deletedCold\)/u);
  assert.match(harness, /browser\.createBrowserContext\(\)/u);
  assert.match(harness, /brand-new cookie jar and local storage/u);
  assert.match(workflow, /local-worker-server\.ts/u);
  assert.match(workflow, /local-worker-vite\.config\.mjs/u);
  assert.match(workflow, /inputs\.journey == 'save-mutations'/u);
  assert.doesNotMatch(saveHandler, /isBeta \|\| isDev \? 300 : 2000/u);
  assert.match(gameData, /COOP_COMMITTED_DELETE_LOCK_ACQUIRE_TIMEOUT_MS = 30_000/u);
  assert.match(
    gameData,
    /!protectedLocalCoop && deletedCoopRunId == null[\s\S]*?withCommittedCoopDeletePersistenceLease/u,
  );
  assert.match(gameData, /if \(coopClear\) \{[\s\S]*?withCommittedCoopDeletePersistenceLease/u);
  assert.match(saveHandler, /deleteSession\(cursor, true\)/u);
  assert.match(
    gameData,
    /overwriteCloudSyncApplies[\s\S]*?forceSync \|\| overwriteCloudSyncApplies \|\| this\.shouldAttemptCloudSync\(\)/u,
  );
  assert.match(gameData, /this\.pendingOverwriteCloudSync === pendingOverwriteCloudSync[\s\S]*?= null/u);
  assert.match(workflow, /src\/system\/game-data/u);
  assert.match(workflow, /src\/ui\/handlers\/save-slot-select-ui-handler\.ts/u);
  assert.match(
    campaignNav,
    /confirmDefaultStarterTeam[\s\S]*?fromCursor = client\.pageCursor[\s\S]*?waitForActionableSemanticSurface\(client, "starter-select", \{ fromCursor/u,
  );
  assert.match(journeys, /confirmDefaultStarterTeam\(client, \{[\s\S]*?fromCursor: starterPhase\.index/u);
  assert.match(browserEntry, /inputBlockedRaw[\s\S]*?typeof inputBlockedRaw === "boolean"/u);
  assert.match(browserEntry, /case "LOGIN_OR_REGISTER":[\s\S]*?surfaceId: "auth:login-or-register"/u);
  assert.match(
    harness,
    /waitForSemanticSurface\(this, "auth:login-or-register",[\s\S]*?handlerActive !== true[\s\S]*?press\("Enter", "open-login-form"\)/u,
  );
  assert.doesNotMatch(harness, /keyboard\.press\("Control\+A"\)/u);
  assert.doesNotMatch(harness, /keyboard\.type\(this\.credentials\.(?:username|password),\s*\{\s*delay:/u);
  assert.match(
    harness,
    /selectAllFocusedText\(\)[\s\S]*?keyboard\.down\("Control"\)[\s\S]*?keyboard\.press\("a"\)[\s\S]*?keyboard\.up\("Control"\)/u,
  );
  assert.match(
    harness,
    /observation != null[\s\S]*?observation\.coop === false[\s\S]*?ownerModel === "local"[\s\S]*?seatsWithInput\?\.includes\(0\)/u,
  );
});
