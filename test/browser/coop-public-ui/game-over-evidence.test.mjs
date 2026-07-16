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
  const [workflow, registry, runtime, replay, transport, harness, journeys, duoRegression] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-runtime.ts"), "utf8"),
    readFile(resolve(root, "src/phases/coop-replay-turn-phase.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-webrtc-transport.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
    readFile(resolve(root, "test/tests/elite-redux/coop/coop-duo-wave-operation.test.ts"), "utf8"),
  ]);

  assert.match(workflow, /^\s{10}- game-over$/mu);
  assert.match(workflow, /inputs\.journey == 'game-over' && 'game-over'/u);
  assert.match(workflow, /COOP_UI_GUEST_LOCALE: \$\{\{ inputs\.journey == 'game-over' && 'en' \|\| 'de' \}\}/u);
  assert.match(
    workflow,
    /Verify retained GameOver two-engine operation regression[\s\S]*coop-duo-wave-operation\.test\.ts/u,
  );
  assert.match(registry, /getCoopBrowserGameOverFixtureStarters\(\)[\s\S]*SpeciesId\.MAGIKARP[\s\S]*MoveId\.MEMENTO/u);
  assert.match(
    transport,
    /VITE_COOP_BROWSER_FIXTURE !== "game-over"[\s\S]*get\("coopfixture"\) !== "game-over"[\s\S]*pendingOperation\?\.kind !== "WAVE_ADVANCE"[\s\S]*payload\?\.outcome === "gameOver"/u,
  );
  assert.match(
    runtime,
    /coopRetainedGameOverSupersedesReplay\(wave: number, turn: number\)[\s\S]*pendingWaveAdvance\?\.wave === wave[\s\S]*pendingWaveAdvance\.outcome === "gameOver"[\s\S]*turn >= pendingWaveAdvance\.settledTurn/u,
  );
  const replayPump = replay.slice(
    replay.indexOf("private async pump("),
    replay.indexOf("private handleAuthorityFailure("),
  );
  assert.ok(
    replayPump.indexOf("consumeLiveEventsFrom") < replayPump.indexOf("coopRetainedGameOverSupersedesReplay"),
    "terminal cannot truncate already-buffered ordered presentation",
  );
  assert.ok(
    replayPump.indexOf("coopRetainedGameOverSupersedesReplay") < replayPump.indexOf("awaitTurnOrLiveEvent"),
    "terminal releases the impossible resolution wait only at the empty event boundary",
  );
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(7, 1\)[\s\S]*toBe\(true\)/u);
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(6, 1\)[\s\S]*toBe\(false\)/u);
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(7, 0\)[\s\S]*toBe\(false\)/u);
  assert.match(
    journeys,
    /async function gameOver\(rig\)[\s\S]*loginBoth\(\)[\s\S]*pair\(rig\.config\.requesterSeat\)[\s\S]*startFreshRun\(\{ gameOverFixture: true \}\)[\s\S]*driveWaveToGameOver\(\)/u,
  );
  assert.match(
    harness,
    /driveWaveToGameOver\(\)[\s\S]*driveSequentialCommandRound\([\s\S]*waitForPostTurnOutcome\([\s\S]*outcome\.kind !== "gameOver"/u,
  );
  assert.match(
    harness,
    /GAME_OVER_POST_TURN_PROGRESS_ALLOWANCE_MS = 180_000[\s\S]*GAME_OVER_POST_TURN_HARD_CEILING_MS = 900_000[\s\S]*progressAllowanceMs: GAME_OVER_POST_TURN_PROGRESS_ALLOWANCE_MS[\s\S]*hardCeilingMs: GAME_OVER_POST_TURN_HARD_CEILING_MS/u,
  );
  const gameOverDriver = harness.slice(
    harness.indexOf("async driveWaveToGameOver()"),
    harness.indexOf("async driveCommanderWaveToReward()"),
  );
  assert.doesNotMatch(
    gameOverDriver,
    /assertRetainedContinuation/u,
    "GameOver is released by its WAVE_ADVANCE DATA/continuation proof, not a nonexistent normal turn ACK",
  );
  for (const exactEvidence of [
    "settled WAVE_ADVANCE committed wave=1",
    "ignore raw waveResolved for correctness wave=1 outcome=gameOver",
    "wave-advance JOURNAL bootstrap wave=1 outcome=gameOver",
    "safe-boundary wake wave=1 unparkedReplay=([01])",
    "retained gameOver terminal supersedes unresolved replay at safe event boundary",
    "retained WAVE_ADVANCE continuationReady wave=1",
    "host RELEASE contiguous acknowledged authority cls=op:global",
    'record("retained-game-over-race-proof"',
  ]) {
    assert.ok(harness.includes(exactEvidence), `harness retains exact terminal evidence: ${exactEvidence}`);
  }
  assert.doesNotMatch(
    gameOverDriver,
    /page\.evaluate|globalScene|getCoopRuntime|phaseQueue|RTCPeerConnection|RTCDataChannel/u,
  );
});
