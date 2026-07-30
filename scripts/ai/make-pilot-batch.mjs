#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readGhostFixture } from "./ghost-gauntlet.mjs";
import { buildPilotScenario, DEFAULT_SELF_PLAY_FIXTURE } from "./make-pilot-scenario.mjs";

export function buildPilotBatch(startEpisode, count, fixture) {
  return {
    version: 1,
    episodes: Array.from({ length: count }, (_, offset) => {
      const episodeIndex = startEpisode + offset;
      return {
        id: `pilot-${episodeIndex}`,
        splitGroupId: `pilot-pair-${Math.floor(episodeIndex / 2)}`,
        scenario: buildPilotScenario(episodeIndex, fixture),
      };
    }),
  };
}

function main() {
  const startEpisode = Number.parseInt(process.argv[2] ?? "0", 10);
  const count = Number.parseInt(process.argv[3] ?? "0", 10);
  const output = process.argv[4];
  const fixturePath = process.argv[5] ?? DEFAULT_SELF_PLAY_FIXTURE;
  if (!Number.isInteger(startEpisode) || startEpisode < 0 || !Number.isInteger(count) || count < 1 || !output) {
    console.error("usage: node scripts/ai/make-pilot-batch.mjs START_EPISODE COUNT OUTPUT.json [GHOST_FIXTURE.json]");
    process.exit(2);
  }

  const fixture = readGhostFixture(fixturePath);
  const batch = buildPilotBatch(startEpisode, count, fixture);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(batch, null, 2));
  console.log(JSON.stringify({ startEpisode, count, output, fixturePath, fixtureTeams: fixture.teams.length }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
