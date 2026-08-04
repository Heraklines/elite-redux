import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendCombatTimeout,
  initializeCombatCheckpoint,
  readMatchingCombatCheckpoint,
} from "./combat-batch-watchdog.mjs";

const batch = {
  version: 1,
  episodes: [
    { id: "episode-a", scenario: { run: { wave: 145 } } },
    { id: "episode-b", scenario: { run: { wave: 190 } } },
  ],
};

test("timeout checkpoints remain an exact resumable batch prefix", () => {
  const path = join(mkdtempSync(join(tmpdir(), "combat-watchdog-")), "results.json");
  initializeCombatCheckpoint(path, batch, false);
  const first = appendCombatTimeout(path, batch, false, 300_125, 300_000);
  assert.equal(first.complete, false);
  assert.equal(first.episodeCount, 1);
  assert.deepEqual(first.results[0], {
    id: "episode-a",
    outcome: "timeout",
    timeout: true,
    error: "episode made no checkpoint progress for 300000ms",
    turns: 0,
    startWave: 145,
    finalWave: 145,
    bootMs: 0,
    combatMs: 300_125,
    decisions: 0,
    enemyMovesUsed: [],
    phaseMs: {},
    slowPhases: [],
    progressionPhaseEntries: 0,
  });
  assert.deepEqual(readMatchingCombatCheckpoint(path, batch, false), first);

  const second = appendCombatTimeout(path, batch, false, 300_250, 300_000);
  assert.equal(second.complete, true);
  assert.equal(second.episodeCount, 2);
  assert.equal(second.totalMs, 600_375);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), second);
});

test("checkpoint matching rejects another opponent contract", () => {
  const path = join(mkdtempSync(join(tmpdir(), "combat-watchdog-")), "results.json");
  initializeCombatCheckpoint(path, batch, true);
  assert.equal(readMatchingCombatCheckpoint(path, batch, false), null);
  assert.equal(readMatchingCombatCheckpoint(path, { ...batch, episodes: [batch.episodes[1]] }, true), null);
});
