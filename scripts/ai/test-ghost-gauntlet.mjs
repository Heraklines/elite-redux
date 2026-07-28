#!/usr/bin/env node
import assert from "node:assert/strict";
import { assertInversePair, buildGhostPair, readGhostFixture } from "./ghost-gauntlet.mjs";

const fixturePath = process.argv[2] ?? "ml/evaluation/ghost-winner-teams.v2.json";
const fixture = readGhostFixture(fixturePath);
const seen = new Set();
for (let pairIndex = 0; pairIndex < fixture.teams.length / 2; pairIndex++) {
  const pair = buildGhostPair(fixture, pairIndex);
  assertInversePair(pair);
  for (const team of pair.manifest.legs.map(leg => leg.playerTeamId)) {
    assert.equal(seen.has(team), false, `${team} appears in multiple pairs`);
    seen.add(team);
  }
  assert.equal(pair.legA.run.seed, pair.legB.run.seed);
  assert.equal(pair.legA.run.level, pair.legB.run.level);
  assert.equal(pair.legA.run.double, true);
  assert.deepEqual(pair.manifest.playerControllers, ["selected-tree-v1", "smart-default-v1"]);
}
assert.equal(seen.size, fixture.teams.length);
assert.equal(fixture.teams.length, 100);
assert.equal(fixture.sourceAccountCount, 73);
console.log(`${fixture.teams.length} ghost teams form ${fixture.teams.length / 2} strict inverse pairs`);
