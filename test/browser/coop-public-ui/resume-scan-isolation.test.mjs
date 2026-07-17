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
  const [gameData, title, starter] = await Promise.all([
    readFile(resolve(root, "src/system/game-data.ts"), "utf8"),
    readFile(resolve(root, "src/phases/title-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
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

  // Maintainer directive (2026-07-17): the launch reclaims the least-recent save automatically
  // (solo new-game parity) through the wrapper; the verified-empty selection and the fail-closed
  // abort remain the inner mechanism and the backstop respectively.
  assert.match(starter, /findCoopLaunchSlotWithOverride\(\)/u);
  assert.match(gameData, /findVerifiedEmptyCoopSessionSlot\(\)/u);
  assert.match(gameData, /deleteSession\(candidate\.slot\)/u);
  assert.match(starter, /confirmPendingFreshCoopSessionSlot\(slot\)/u);
  assert.match(starter, /fresh co-op launch has no verified empty local\+cloud save slot/u);
});
