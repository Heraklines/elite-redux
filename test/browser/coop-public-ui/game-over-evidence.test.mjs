/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");

test("GameOver journey uses visible starters, real command input, and exact retained terminal evidence", async () => {
  const [workflow, registry, transport, harness, journeys] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-webrtc-transport.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
  ]);

  assert.match(workflow, /^\s{10}- game-over$/mu);
  assert.match(workflow, /inputs\.journey == 'game-over' && 'game-over'/u);
  assert.match(workflow, /COOP_UI_GUEST_LOCALE: \$\{\{ inputs\.journey == 'game-over' && 'en' \|\| 'de' \}\}/u);
  assert.match(registry, /getCoopBrowserGameOverFixtureStarters\(\)[\s\S]*SpeciesId\.MAGIKARP[\s\S]*MoveId\.MEMENTO/u);
  assert.match(
    transport,
    /VITE_COOP_BROWSER_FIXTURE !== "game-over"[\s\S]*get\("coopfixture"\) !== "game-over"[\s\S]*pendingOperation\?\.kind !== "WAVE_ADVANCE"[\s\S]*payload\?\.outcome === "gameOver"/u,
  );
  assert.match(
    journeys,
    /GAME_SPEEDS[\s\S]*surfaceId: "title-menu"[\s\S]*targetId: "settings"[\s\S]*browser-render-profile[\s\S]*findGameSpeed\(10, openCursor\)[\s\S]*targetId: "new-game"/u,
  );
  assert.match(
    journeys,
    /async function gameOver\(rig\)[\s\S]*loginBoth\(\)[\s\S]*raiseGameOverSpeed\(rig\)[\s\S]*pair\(rig\.config\.requesterSeat\)[\s\S]*startFreshRun\(\{ gameOverFixture: true \}\)[\s\S]*driveWaveToGameOver\(\)/u,
  );
  assert.match(
    harness,
    /driveWaveToGameOver\(\)[\s\S]*driveSequentialCommandRound\([\s\S]*waitForPostTurnOutcome\([\s\S]*outcome\.kind !== "gameOver"/u,
  );
  for (const exactEvidence of [
    "settled WAVE_ADVANCE committed wave=1",
    "ignore raw waveResolved for correctness wave=1 outcome=gameOver",
    "wave-advance JOURNAL bootstrap wave=1 outcome=gameOver",
    "safe-boundary wake wave=1 unparkedReplay=1",
    "retained WAVE_ADVANCE continuationReady wave=1",
    "host RELEASE contiguous acknowledged authority cls=op:global",
    'record("retained-game-over-race-proof"',
  ]) {
    assert.ok(harness.includes(exactEvidence), `harness retains exact terminal evidence: ${exactEvidence}`);
  }
  assert.doesNotMatch(
    harness.slice(
      harness.indexOf("async driveWaveToGameOver()"),
      harness.indexOf("async driveCommanderWaveToReward()"),
    ),
    /page\.evaluate|globalScene|getCoopRuntime|phaseQueue|RTCPeerConnection|RTCDataChannel/u,
  );
});
