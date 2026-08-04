import assert from "node:assert/strict";
import test from "node:test";
import { readGhostFixture } from "./ghost-gauntlet.mjs";
import {
  buildEvaluatorParityBatch,
  EVALUATOR_PARITY_ARMS,
  EVALUATOR_PARITY_FIXED_SEEDS,
  EVALUATOR_PARITY_PAIR_INDICES,
} from "./make-evaluator-parity-batch.mjs";
import { buildEvaluatorParityReport } from "./summarize-evaluator-parity.mjs";

const fixture = readGhostFixture("ml/evaluation/ghost-winner-teams.v3.json");

test("parity batches contain 64 balanced mirrored legs across four shards", () => {
  const shards = Array.from({ length: 4 }, (_, index) => buildEvaluatorParityBatch(fixture, index, 4));
  const manifests = shards.flatMap(shard => shard.manifests);
  const episodes = shards.flatMap(shard => shard.batch.episodes);
  assert.equal(manifests.length, EVALUATOR_PARITY_PAIR_INDICES.length * EVALUATOR_PARITY_FIXED_SEEDS.length);
  assert.equal(episodes.length, 64);
  assert.deepEqual(
    Object.fromEntries(
      ["youngster", "ace", "elite", "hell"].map(difficulty => [
        difficulty,
        manifests.filter(manifest => manifest.difficulty === difficulty).length,
      ]),
    ),
    { youngster: 8, ace: 8, elite: 8, hell: 8 },
  );
  assert.equal(new Set(episodes.map(episode => episode.id)).size, episodes.length);
});

test("parity report accepts exact 50 percent paired outcomes and rejects biased outcomes", () => {
  const shards = Array.from({ length: 4 }, (_, index) => buildEvaluatorParityBatch(fixture, index, 4));
  const manifests = shards.flatMap(shard => shard.manifests);
  const makeBatch = (episodes, playerAlwaysWins) => ({
    version: 1,
    complete: true,
    combatOnly: true,
    hardestTrainerAi: !playerAlwaysWins.customOpponent,
    opponentController: playerAlwaysWins.customOpponent ? "custom-policy" : "engine-hardest-v1",
    progressionPhaseEntries: 0,
    expectedEpisodeCount: episodes.length,
    episodeCount: episodes.length,
    results: episodes.map((episode, index) => ({
      id: episode.id,
      outcome: playerAlwaysWins.draws
        ? "max-turns-reached"
        : playerAlwaysWins.biased || (Math.floor(index / 2) + (index % 2)) % 2 === 0
          ? "victory"
          : "player-wiped",
      progressionPhaseEntries: 0,
      combatMs: 10,
      bootMs: 10,
    })),
  });
  const allEpisodes = shards.flatMap(shard => shard.batch.episodes);
  const balanced = buildEvaluatorParityReport(
    manifests,
    EVALUATOR_PARITY_ARMS.map(arm => ({
      arm,
      batch: makeBatch(allEpisodes, { customOpponent: arm === "random-vs-random", biased: false, draws: false }),
    })),
  );
  assert.equal(balanced.passed, true);
  assert.equal(balanced.arms["random-vs-random"].score, 0.5);
  const biased = buildEvaluatorParityReport(
    manifests,
    EVALUATOR_PARITY_ARMS.map(arm => ({
      arm,
      batch: makeBatch(allEpisodes, { customOpponent: arm === "random-vs-random", biased: true, draws: false }),
    })),
  );
  assert.equal(biased.passed, false);
  const allDraws = buildEvaluatorParityReport(
    manifests,
    EVALUATOR_PARITY_ARMS.map(arm => ({
      arm,
      batch: makeBatch(allEpisodes, { customOpponent: arm === "random-vs-random", biased: false, draws: true }),
    })),
  );
  assert.equal(allDraws.passed, false);
});
