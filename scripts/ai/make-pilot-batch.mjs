#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readGhostFixture } from "./ghost-gauntlet.mjs";
import { buildPilotScenario, DEFAULT_SELF_PLAY_FIXTURE } from "./make-pilot-scenario.mjs";

const startShard = Number.parseInt(process.argv[2] ?? "0", 10);
const count = Number.parseInt(process.argv[3] ?? "0", 10);
const output = process.argv[4];
const fixturePath = process.argv[5] ?? DEFAULT_SELF_PLAY_FIXTURE;
if (!Number.isInteger(startShard) || startShard < 0 || !Number.isInteger(count) || count < 1 || !output) {
  console.error("usage: node scripts/ai/make-pilot-batch.mjs START_EPISODE COUNT OUTPUT.json [GHOST_FIXTURE.json]");
  process.exit(2);
}

const fixture = readGhostFixture(fixturePath);
const episodes = Array.from({ length: count }, (_, offset) => {
  const shard = startShard + offset;
  return {
    id: `pilot-${shard}`,
    scenario: buildPilotScenario(shard, fixture),
  };
});
const batch = { version: 1, episodes };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(batch, null, 2));
console.log(JSON.stringify({ startShard, count, output, fixturePath, fixtureTeams: fixture.teams.length }));
