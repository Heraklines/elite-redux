#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertInversePair, buildGhostPair, readGhostFixture } from "./ghost-gauntlet.mjs";

const [fixturePath, pairIndexRaw, outputDir] = process.argv.slice(2);
if (!fixturePath || pairIndexRaw === undefined || !outputDir) {
  console.error("usage: node scripts/ai/make-ghost-gauntlet.mjs FIXTURE.json PAIR_INDEX OUTPUT_DIR");
  process.exit(2);
}

const pair = buildGhostPair(readGhostFixture(fixturePath), Number(pairIndexRaw));
assertInversePair(pair);
mkdirSync(outputDir, { recursive: true });
const base = pair.manifest.pairId;
writeFileSync(join(outputDir, `${base}-manifest.json`), `${JSON.stringify(pair.manifest, null, 2)}\n`);
writeFileSync(join(outputDir, `${base}-leg-a.json`), `${JSON.stringify(pair.legA, null, 2)}\n`);
writeFileSync(join(outputDir, `${base}-leg-b.json`), `${JSON.stringify(pair.legB, null, 2)}\n`);
console.log(`${base}: ${pair.manifest.legs[0].playerTeamId} <-> ${pair.manifest.legs[1].playerTeamId}`);
