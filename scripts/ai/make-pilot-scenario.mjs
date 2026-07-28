#!/usr/bin/env node
/*
 * Build one deterministic, format-varied scenario for the non-production AI pilot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const shard = Number.parseInt(process.argv[2] ?? "0", 10);
const output = process.argv[3];
if (!Number.isInteger(shard) || shard < 0 || !output) {
  console.error("usage: node scripts/ai/make-pilot-scenario.mjs SHARD OUTPUT.json");
  process.exit(2);
}

const party = [
  { species: "SNORLAX", moves: ["BODY_SLAM", "EARTHQUAKE", "CRUNCH", "REST"] },
  { species: "CHARIZARD", moves: ["FLAMETHROWER", "AIR_SLASH", "DRAGON_PULSE", "ROOST"] },
  { species: "BLASTOISE", moves: ["SURF", "ICE_BEAM", "AURA_SPHERE", "PROTECT"] },
  { species: "VENUSAUR", moves: ["GIGA_DRAIN", "SLUDGE_BOMB", "EARTH_POWER", "SYNTHESIS"] },
  { species: "GARCHOMP", moves: ["EARTHQUAKE", "DRAGON_CLAW", "STONE_EDGE", "SWORDS_DANCE"] },
  { species: "GARDEVOIR", moves: ["PSYCHIC", "MOONBLAST", "SHADOW_BALL", "CALM_MIND"] },
];
const waveBands = [1, 41, 81, 121, 151, 181];
const formats = ["single", "double", "triple"];
const format = formats[shard % formats.length];
const wave = waveBands[shard % waveBands.length];
const level = Math.min(200, wave + 20);
const activeCount = format === "triple" ? 3 : format === "double" ? 2 : 1;
const enemy = [...party]
  .reverse()
  .slice(0, activeCount)
  .map(mon => ({ ...mon, level }));
const spec = {
  v: 1,
  name: `AI baseline pilot shard ${shard}`,
  notes: "Synthetic GitHub-runner episode. Never deployed or uploaded as player telemetry.",
  run: {
    wave,
    level,
    seed: `er-ai-pilot-v1-${shard}`,
    difficulty: "hell",
    enemyAi: "hardest",
    ...(format === "double" ? { double: true } : {}),
    ...(format === "triple" ? { triple: true } : {}),
  },
  party,
  enemy: { kind: "party", party: enemy },
  rewards: Array.from({ length: 50 }, () => "FIRST"),
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(spec, null, 2));
console.log(JSON.stringify({ shard, output, wave, level, format }));
