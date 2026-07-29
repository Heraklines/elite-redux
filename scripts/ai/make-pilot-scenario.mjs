#!/usr/bin/env node
/* Build one deterministic combat-only episode from the held-out ghost training pool. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildGhostSelfPlayScenario, readGhostFixture } from "./ghost-gauntlet.mjs";

export const DEFAULT_SELF_PLAY_FIXTURE = "ml/training/ghost-self-play-teams.v1.json";

export function buildPilotScenario(episodeIndex, fixture) {
  const source = fixture ?? readGhostFixture(DEFAULT_SELF_PLAY_FIXTURE);
  return buildGhostSelfPlayScenario(source, episodeIndex);
}

function main() {
  const episodeIndex = Number.parseInt(process.argv[2] ?? "0", 10);
  const output = process.argv[3];
  const fixturePath = process.argv[4] ?? DEFAULT_SELF_PLAY_FIXTURE;
  if (!Number.isInteger(episodeIndex) || episodeIndex < 0 || !output) {
    console.error("usage: node scripts/ai/make-pilot-scenario.mjs EPISODE OUTPUT.json [GHOST_FIXTURE.json]");
    process.exit(2);
  }
  const spec = buildPilotScenario(episodeIndex, readGhostFixture(fixturePath));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(spec, null, 2));
  console.log(
    JSON.stringify({
      episodeIndex,
      output,
      fixturePath,
      wave: spec.run.wave,
      level: spec.run.level,
      format: spec.run.triple ? "triple" : spec.run.double ? "double" : "single",
      player: spec.name.match(/Ghost self-play (.+) vs /)?.[1],
      enemy: spec.name.match(/ vs (.+)$/)?.[1],
    }),
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
