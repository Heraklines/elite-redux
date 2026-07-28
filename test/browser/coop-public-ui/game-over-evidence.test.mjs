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
  const [workflow, registry, runtime, replay, transport, harness, journeys, duoRegression, gameOverPhase] =
    await Promise.all([
      readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
      readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
      readFile(resolve(root, "src/data/elite-redux/coop/coop-runtime.ts"), "utf8"),
      readFile(resolve(root, "src/phases/coop-replay-turn-phase.ts"), "utf8"),
      readFile(resolve(root, "src/data/elite-redux/coop/coop-webrtc-transport.ts"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
      readFile(resolve(root, "test/tests/elite-redux/coop/coop-duo-wave-operation.test.ts"), "utf8"),
      readFile(resolve(root, "src/phases/game-over-phase.ts"), "utf8"),
    ]);

  assert.match(workflow, /^\s{10}- game-over$/mu);
  assert.match(workflow, /inputs\.journey == 'game-over' && 'game-over'/u);
  assert.match(workflow, /COOP_UI_GUEST_LOCALE: \$\{\{ inputs\.journey == 'game-over' && 'en' \|\| 'de' \}\}/u);
  assert.match(
    workflow,
    /Verify retained GameOver two-engine operation regression[\s\S]*coop-duo-wave-operation\.test\.ts/u,
  );
  assert.match(
    registry,
    /getCoopBrowserGameOverFixtureStarters\(\)[\s\S]*SpeciesId\.CROBAT[\s\S]*abilityIndex: 0[\s\S]*Nature\.JOLLY[\s\S]*MoveId\.MEMENTO/u,
    "the public terminal fixture uses Crobat's primary Inner Focus slot plus maximum practical wave-1 speed",
  );
  assert.match(
    harness,
    /const CROBAT_SPECIES_ID = 169;[\s\S]*gameOverFixture[\s\S]*\? \[CROBAT_SPECIES_ID\]/u,
    "the public driver must attest the same Crobat party that the fixture materializes",
  );
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
  assert.match(
    replayPump,
    /coopRetainedGameOverSupersedesReplay[\s\S]*supersedeTurnWait\(this\.turn, this\.sourceWave\)[\s\S]*coopRetainedWinSupersedesReplay[\s\S]*supersedeTurnWait\(this\.turn, this\.sourceWave\)/u,
    "both terminal successors retire every joined turn-wait consumer instead of leaking one into the stall watchdog",
  );
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(7, 1\)[\s\S]*toBe\(true\)/u);
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(6, 1\)[\s\S]*toBe\(false\)/u);
  assert.match(duoRegression, /coopRetainedGameOverSupersedesReplay\(7, 0\)[\s\S]*toBe\(false\)/u);
  assert.match(
    journeys,
    /async function prepareCoopJourneySettings\(rig\)[\s\S]*loginBoth\(\)[\s\S]*async function gameOver\(rig\)[\s\S]*pair\(rig\.config\.requesterSeat\)[\s\S]*startFreshRun\(\{ gameOverFixture: true \}\)[\s\S]*driveWaveToGameOver\(\)[\s\S]*export async function runJourney\(rig, name\)[\s\S]*prepareCoopJourneySettings\(rig\)[\s\S]*await journey\(rig\)/u,
  );
  assert.match(
    harness,
    /driveWaveToGameOver\(\)[\s\S]*driveSequentialCommandRound\([\s\S]*waitForPostTurnOutcome\([\s\S]*outcome\.kind !== "gameOver"/u,
  );
  assert.match(
    gameOverPhase,
    /const completedBattle = globalScene\.currentBattle;[\s\S]*const preWaveSessionData = await globalScene\.gameData\.getSession[\s\S]*waveIndex: completedBattle\.waveIndex/u,
    "run history must survive the retained terminal clearing currentBattle during its cloud await",
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
  assert.match(
    gameOverDriver,
    /expectSharedTerminalAfterPairedGameOver[\s\S]*POST_GAME_OVER_PHASE[\s\S]*stable post-GameOver visual boundary[\s\S]*stable-post-game-over-visual-proof[\s\S]*paired-post-game-over-stable/u,
    "the final screenshot must follow both completed GameOver fades, not the transient faint narration",
  );
  for (const exactEvidence of [
    "PARITY kind=TERMINAL_COMMIT rev=",
    "settled WAVE_ADVANCE committed wave=1",
    "kind=TERMINAL_COMMIT result=admitted",
    "bootstrap wave=1 outcome=gameOver wake=1",
    "ignore raw waveResolved for correctness wave=1 outcome=gameOver",
    "retained gameOver terminal supersedes unresolved replay at safe event boundary",
    "DATA applied rev=",
    "kind=TERMINAL_COMMIT .* outcome=applied control=TERMINAL/",
    "stage=controlInstalled sender=\\\\d+ generation=\\\\d+ advanced retired=true",
    'record("retained-game-over-race-proof"',
  ]) {
    assert.ok(harness.includes(exactEvidence), `harness retains exact terminal evidence: ${exactEvidence}`);
  }
  assert.doesNotMatch(
    gameOverDriver,
    /page\.evaluate|globalScene|getCoopRuntime|phaseQueue|RTCPeerConnection|RTCDataChannel/u,
  );
});
