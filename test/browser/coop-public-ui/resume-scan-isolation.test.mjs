/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");

test("lobby quarantines one save-slot failure and releases a fresh run only through verified empty-slot CAS", async () => {
  const [gameData, title, starter, config, journeys, localWorker, workflow] = await Promise.all([
    readFile(resolve(root, "src/system/game-data.ts"), "utf8"),
    readFile(resolve(root, "src/phases/title-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/local-worker-server.ts"), "utf8"),
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
  ]);

  assert.match(gameData, /getCoopResumeLobbySnapshot\(\): Promise<CoopResumeLobbySnapshot>/u);
  assert.match(gameData, /sessions: Map<number, CoopResumeLoadedSession \| undefined>/u);
  assert.match(gameData, /failures: Map<number, Error>/u);
  assert.match(
    gameData,
    /for \(let slot = 0; slot < 5; slot\+\+\)[\s\S]*reconcileCoopResumeSlot[\s\S]*recordSlotFailure\(slot, error\)/u,
  );

  assert.match(title, /getCoopResumeLobbySnapshot\(\)/u);
  assert.match(title, /resumeSnapshot\.failures\.get\(slot\)[\s\S]*throw failure/u);
  assert.match(title, /discovery\.kind !== "replica-unavailable"/u);
  assert.match(title, /Press to start a separate co-op run\. Existing saves will not be overwritten\./u);
  assert.match(title, /hostStartNew/u);

  assert.match(starter, /findVerifiedEmptyCoopSessionSlot\(\)/u);
  assert.match(starter, /confirmPendingFreshCoopSessionSlot\(slot\)/u);
  assert.match(starter, /fresh co-op launch has no verified empty local\+cloud save slot/u);

  assert.match(config, /"resume-scan-isolation"/u);
  assert.match(journeys, /async function resumeScanIsolation\(rig\)/u);
  assert.match(journeys, /origin\.hostname !== "127\.0\.0\.1" \|\| origin\.port !== "8788"/u);
  assert.match(journeys, /resume scan slot=0 load failed/u);
  assert.match(journeys, /sessionStorageKeys\(after\)[\s\S]*keys\.length < 2/u);
  assert.match(localWorker, /\/__coop-fixture\/fork-session/u);
  assert.match(localWorker, /session\.money = originalMoney \+ 1/u);
  assert.match(
    localWorker,
    /WHERE user_id = \(SELECT id FROM users WHERE username_lower = \?\) AND slot = \? AND data = \?/u,
  );
  assert.match(workflow, /inputs\.journey == 'resume-scan-isolation'/u);
  assert.match(workflow, /if: inputs\.journey == 'save-mutations' \|\| inputs\.journey == 'resume-scan-isolation'/u);
});
