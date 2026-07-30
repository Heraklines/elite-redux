#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeRunResult } from "./compare-run-results.mjs";
import { assertInversePair, buildGhostPair, buildGhostSelfPlayScenario, readGhostFixture } from "./ghost-gauntlet.mjs";
import { buildGhostEvalBatch, EXPECTED_GHOST_EVAL_PAIRS, GHOST_EVAL_CONTROLLERS } from "./make-ghost-eval-batch.mjs";
import { buildPilotBatch } from "./make-pilot-batch.mjs";
import { buildGhostBatchReport } from "./summarize-ghost-batch-eval.mjs";

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
const evalBatch = buildGhostEvalBatch(fixture, 0, 3);
assert.equal(evalBatch.manifests.length, 3);
assert.equal(evalBatch.batch.episodes.length, 6);
assert.deepEqual(evalBatch.manifests[0].playerControllers, GHOST_EVAL_CONTROLLERS);
assert.ok(evalBatch.batch.episodes.every(episode => episode.scenario.eggs === undefined));
assert.deepEqual(
  evalBatch.batch.episodes.map(episode => episode.splitGroupId),
  ["pair-01", "pair-01", "pair-02", "pair-02", "pair-03", "pair-03"],
);
const fullEval = buildGhostEvalBatch(fixture, 0, EXPECTED_GHOST_EVAL_PAIRS);
const controllerBatches = GHOST_EVAL_CONTROLLERS.map(controller => ({
  name: `shard-0-${controller}-results.json`,
  controller,
  batch: {
    version: 1,
    combatOnly: true,
    hardestTrainerAi: true,
    progressionPhaseEntries: 0,
    episodeCount: fullEval.batch.episodes.length,
    results: fullEval.batch.episodes.map(episode => ({
      id: episode.id,
      outcome: "victory",
      turns: 1,
      bootMs: 1,
      combatMs: 1,
      progressionPhaseEntries: 0,
    })),
  },
}));
const fullReport = buildGhostBatchReport(fullEval.manifests, controllerBatches);
assert.equal(fullReport.pairs, EXPECTED_GHOST_EVAL_PAIRS);
assert.equal(fullReport.legs, EXPECTED_GHOST_EVAL_PAIRS * 2 * GHOST_EVAL_CONTROLLERS.length);
assert.throws(
  () => buildGhostBatchReport(fullEval.manifests.slice(1), controllerBatches),
  /expected 50 inverse-pair manifests/,
);

const timingOnlyDifference = structuredClone(controllerBatches[0].batch);
timingOnlyDifference.totalMs = 200;
timingOnlyDifference.averageMsPerEpisode = 2;
timingOnlyDifference.results[0].bootMs = 30;
timingOnlyDifference.results[0].combatMs = 170;
timingOnlyDifference.results[0].decisions = 4;
timingOnlyDifference.results[0].phaseMs = { EnemyCommandPhase: 12 };
timingOnlyDifference.results[0].slowPhases = [{ phase: "EnemyCommandPhase", ms: 12 }];
assert.deepEqual(normalizeRunResult(timingOnlyDifference), normalizeRunResult(controllerBatches[0].batch));
const weakened = structuredClone(controllerBatches);
weakened[0].batch.hardestTrainerAi = false;
assert.throws(() => buildGhostBatchReport(fullEval.manifests, weakened), /invalid hardest-AI combat batch result/);

const trainingFixture = readGhostFixture("ml/training/ghost-self-play-teams.v1.json");
assert.equal(trainingFixture.teams.length, 163);
assert.equal(trainingFixture.sourceAccountCount, 45);
const evaluationRosters = new Set(fixture.teams.map(team => JSON.stringify(team.members)));
for (const team of trainingFixture.teams) {
  assert.equal(evaluationRosters.has(JSON.stringify(team.members)), false, `${team.id} leaked into evaluation`);
}
const forward = buildGhostSelfPlayScenario(trainingFixture, 0);
const reverse = buildGhostSelfPlayScenario(trainingFixture, 1);
const splitBatch = buildPilotBatch(0, 4, trainingFixture);
assert.deepEqual(
  splitBatch.episodes.map(episode => episode.splitGroupId),
  ["pilot-pair-0", "pilot-pair-0", "pilot-pair-1", "pilot-pair-1"],
);
assert.deepEqual(
  splitBatch.episodes.map(episode => episode.sourcePartitionId),
  ["pilot-source-fold-0", "pilot-source-fold-0", "pilot-source-fold-1", "pilot-source-fold-1"],
);
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
const sourcePartitionsByTeam = new Map();
const firstTrainingBatch = buildPilotBatch(0, 576, trainingFixture);
for (let episode = 0; episode < 576; episode += 2) {
  const first = firstTrainingBatch.episodes[episode];
  const second = firstTrainingBatch.episodes[episode + 1];
  const firstLeg = first.scenario;
  const secondLeg = second.scenario;
  assert.equal(firstLeg.run.seed, secondLeg.run.seed);
  assert.equal(first.sourcePartitionId, second.sourcePartitionId);
  assert.deepEqual(firstLeg.party, secondLeg.enemy.party.map(withoutEnemyLevel));
  assert.deepEqual(secondLeg.party, firstLeg.enemy.party.map(withoutEnemyLevel));
  for (const name of [firstLeg.name, secondLeg.name]) {
    const playerId = name.match(/Ghost self-play (.+) vs /)?.[1];
    firstBatchAppearances.set(playerId, (firstBatchAppearances.get(playerId) ?? 0) + 1);
    const previousPartition = sourcePartitionsByTeam.get(playerId);
    assert.ok(previousPartition === undefined || previousPartition === first.sourcePartitionId);
    sourcePartitionsByTeam.set(playerId, first.sourcePartitionId);
  }
}
const appearanceCounts = [...firstBatchAppearances.values()];
assert.ok(Math.min(...appearanceCounts) >= 3, "the first 576 episodes must cover every training team");
assert.ok(Math.max(...appearanceCounts) <= 4, "the first 576 episodes must remain roster-balanced");

console.log(
  `${fixture.teams.length} held-out ghost teams form ${fixture.teams.length / 2} strict inverse pairs; ${trainingFixture.teams.length} source-disjoint teams feed self-play`,
);
