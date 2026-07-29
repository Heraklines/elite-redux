#!/usr/bin/env node
import assert from "node:assert/strict";
import { assertInversePair, buildGhostPair, buildGhostSelfPlayScenario, readGhostFixture } from "./ghost-gauntlet.mjs";

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
assert.equal(fixture.sourceAccountCount, 28);

const trainingFixture = readGhostFixture("ml/training/ghost-self-play-teams.v1.json");
assert.equal(trainingFixture.teams.length, 163);
assert.equal(trainingFixture.sourceAccountCount, 45);
const evaluationRosters = new Set(fixture.teams.map(team => JSON.stringify(team.members)));
for (const team of trainingFixture.teams) {
  assert.equal(evaluationRosters.has(JSON.stringify(team.members)), false, `${team.id} leaked into evaluation`);
}
const forward = buildGhostSelfPlayScenario(trainingFixture, 0);
const reverse = buildGhostSelfPlayScenario(trainingFixture, 1);
const withoutEnemyLevel = member => {
  const { level: _level, ...rest } = member;
  return rest;
};
assert.equal(forward.run.seed, reverse.run.seed);
assert.deepEqual(forward.party, reverse.enemy.party.map(withoutEnemyLevel));
assert.deepEqual(reverse.party, forward.enemy.party.map(withoutEnemyLevel));
assert.ok(
  forward.party.every(member => member.moves.length === 4),
  "saved ghost movesets must be retained",
);

const firstBatchAppearances = new Map(trainingFixture.teams.map(team => [team.id, 0]));
for (let episode = 0; episode < 576; episode += 2) {
  const firstLeg = buildGhostSelfPlayScenario(trainingFixture, episode);
  const secondLeg = buildGhostSelfPlayScenario(trainingFixture, episode + 1);
  assert.equal(firstLeg.run.seed, secondLeg.run.seed);
  assert.deepEqual(firstLeg.party, secondLeg.enemy.party.map(withoutEnemyLevel));
  assert.deepEqual(secondLeg.party, firstLeg.enemy.party.map(withoutEnemyLevel));
  for (const name of [firstLeg.name, secondLeg.name]) {
    const playerId = name.match(/Ghost self-play (.+) vs /)?.[1];
    firstBatchAppearances.set(playerId, (firstBatchAppearances.get(playerId) ?? 0) + 1);
  }
}
const appearanceCounts = [...firstBatchAppearances.values()];
assert.ok(Math.min(...appearanceCounts) >= 3, "the first 576 episodes must cover every training team");
assert.ok(Math.max(...appearanceCounts) <= 4, "the first 576 episodes must remain roster-balanced");

console.log(
  `${fixture.teams.length} held-out ghost teams form ${fixture.teams.length / 2} strict inverse pairs; ${trainingFixture.teams.length} source-disjoint teams feed self-play`,
);
