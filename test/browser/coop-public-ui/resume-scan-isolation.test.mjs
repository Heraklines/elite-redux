/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { coopCasUpdateRequestView } from "./evidence.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("captures only valid co-op CAS slot and mode commitments", () => {
  assert.deepEqual(
    coopCasUpdateRequestView("http://127.0.0.1:8788/savedata/session/coop-cas-update?slot=1&coopCasMode=empty"),
    { slot: 1, mode: "empty" },
  );
  assert.equal(
    coopCasUpdateRequestView("http://127.0.0.1:8788/savedata/session/coop-cas-update?slot=0&coopCasMode=unsafe"),
    null,
  );
  assert.equal(coopCasUpdateRequestView("http://127.0.0.1:8788/savedata/session/update?slot=1"), null);
});

test("lobby quarantines one save-slot failure and releases a fresh run only through verified empty-slot CAS", async () => {
  const [gameData, title, battleScene, starter, config, journeys, harness, localWorker, evidence, workflow] =
    await Promise.all([
      readFile(resolve(root, "src/system/game-data.ts"), "utf8"),
      readFile(resolve(root, "src/phases/title-phase.ts"), "utf8"),
      readFile(resolve(root, "src/battle-scene.ts"), "utf8"),
      readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/local-worker-server.ts"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/evidence.mjs"), "utf8"),
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
  assert.match(
    title,
    /stage\.setStatus\("A save conflict was isolated\. Start a separate run\?"\);[\s\S]*await globalScene\.ui\.setMode\(UiMode\.MESSAGE\);[\s\S]*if \(!isCurrentSession\(\)\)[\s\S]*globalScene\.ui\.resetModeChain\(\);[\s\S]*hostStartNew/u,
  );
  assert.match(
    title,
    /Press to start a separate co-op run\. Existing saves will not be overwritten\.`,\s*\/\/[\s\S]*\s0,\s*hostStartNew/u,
  );
  assert.match(title, /hostStartNew/u);

  assert.match(battleScene, /Could not load starter colours; using seeded defaults for this scene/u);
  assert.match(battleScene, /this\.starterColorsLoaded = false;[\s\S]*console\.warn[\s\S]*return;/u);

  assert.match(starter, /findVerifiedEmptyCoopSessionSlot\(\)/u);
  assert.match(starter, /confirmPendingFreshCoopSessionSlot\(slot\)/u);
  assert.match(starter, /fresh co-op launch has no verified empty local\+cloud save slot/u);

  assert.match(config, /"resume-scan-isolation"/u);
  assert.match(journeys, /async function resumeScanIsolation\(rig\)/u);
  assert.match(journeys, /origin\.hostname !== "127\.0\.0\.1" \|\| origin\.port !== "8788"/u);
  assert.match(journeys, /const SLOT_ZERO_FORK_QUARANTINE/u);
  assert.match(journeys, /equal-revision co-op fork in slot 0/u);
  assert.match(journeys, /cloud head ancestry conflict for run \[0-9a-f-\]\{36\}/u);
  assert.match(journeys, /waitFor\(SLOT_ZERO_FORK_QUARANTINE/u);
  assert.match(journeys, /fresh run changed or removed the exact quarantined local slot/u);
  assert.match(journeys, /event\.mode === "empty" && event\.slot !== 0/u);
  assert.match(journeys, /fresh launch mutated quarantined cloud slot zero/u);
  assert.match(harness, /async enterCoopLobby\(\)[\s\S]*surfaceId: "title-menu"[\s\S]*targetId: "new-game"/u);
  assert.doesNotMatch(harness, /async enterCoopLobby\(\)[\s\S]{0,700}titleNewGameKeys/u);
  assert.match(localWorker, /\/__coop-fixture\/fork-session/u);
  assert.match(localWorker, /\/__coop-fixture\/session-status/u);
  assert.match(localWorker, /session\.money = originalMoney \+ 1/u);
  assert.match(localWorker, /createHash\("sha256"\)\.update\(forked\)\.digest\("hex"\)/u);
  assert.match(evidence, /coopCasUpdateRequestView/u);
  assert.match(evidence, /"coop-cas-update-request"/u);
  assert.match(evidence, /\.\.\.\(coopCas \?\? \{\}\)/u);
  assert.match(evidence, /crypto\.subtle\.digest\("SHA-256"/u);
  assert.match(
    localWorker,
    /WHERE user_id = \(SELECT id FROM users WHERE username_lower = \?\) AND slot = \? AND data = \?/u,
  );
  assert.match(workflow, /inputs\.journey == 'resume-scan-isolation'/u);
  assert.match(workflow, /if: inputs\.journey == 'save-mutations' \|\| inputs\.journey == 'resume-scan-isolation'/u);
});
