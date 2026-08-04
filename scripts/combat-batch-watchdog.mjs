import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function expectedOpponentIdentity(hasCustomOpponent) {
  return {
    hardestTrainerAi: !hasCustomOpponent,
    opponentController: hasCustomOpponent ? "custom-policy" : "engine-hardest-v1",
  };
}

function isExactPrefix(results, episodes) {
  return results.every((result, index) => result?.id === episodes[index]?.id);
}

export function readMatchingCombatCheckpoint(path, batch, hasCustomOpponent) {
  if (!existsSync(path)) {
    return null;
  }
  let checkpoint;
  try {
    checkpoint = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const expectedOpponent = expectedOpponentIdentity(hasCustomOpponent);
  if (
    checkpoint?.version !== 1
    || checkpoint.combatOnly !== true
    || checkpoint.expectedEpisodeCount !== batch.episodes.length
    || checkpoint.hardestTrainerAi !== expectedOpponent.hardestTrainerAi
    || checkpoint.opponentController !== expectedOpponent.opponentController
    || !Array.isArray(checkpoint.results)
    || checkpoint.episodeCount !== checkpoint.results.length
    || checkpoint.results.length > batch.episodes.length
    || !isExactPrefix(checkpoint.results, batch.episodes)
  ) {
    return null;
  }
  return checkpoint;
}

function writeCheckpoint(path, batch, hasCustomOpponent, results, totalMs) {
  const expectedOpponent = expectedOpponentIdentity(hasCustomOpponent);
  const complete = results.length === batch.episodes.length;
  const checkpoint = {
    version: 1,
    complete,
    combatOnly: true,
    ...expectedOpponent,
    progressionPhaseEntries: results.reduce(
      (total, result) => total + (Number(result.progressionPhaseEntries) || 0),
      0,
    ),
    expectedEpisodeCount: batch.episodes.length,
    episodeCount: results.length,
    totalMs,
    averageMsPerEpisode: results.length > 0 ? Math.round(totalMs / results.length) : 0,
    results,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return checkpoint;
}

export function initializeCombatCheckpoint(path, batch, hasCustomOpponent) {
  return writeCheckpoint(path, batch, hasCustomOpponent, [], 0);
}

export function appendCombatTimeout(path, batch, hasCustomOpponent, elapsedMs, timeoutMs) {
  const checkpoint = readMatchingCombatCheckpoint(path, batch, hasCustomOpponent);
  const results = checkpoint ? [...checkpoint.results] : [];
  const episode = batch.episodes[results.length];
  if (!episode) {
    throw new Error("cannot append a timeout after the combat batch is complete");
  }
  const wave = episode.scenario?.run?.wave ?? 1;
  results.push({
    id: episode.id,
    outcome: "timeout",
    timeout: true,
    error: `episode made no checkpoint progress for ${timeoutMs}ms`,
    turns: 0,
    startWave: wave,
    finalWave: wave,
    bootMs: 0,
    combatMs: Math.max(0, Math.round(elapsedMs)),
    decisions: 0,
    enemyMovesUsed: [],
    phaseMs: {},
    slowPhases: [],
    progressionPhaseEntries: 0,
  });
  return writeCheckpoint(
    path,
    batch,
    hasCustomOpponent,
    results,
    Math.max(0, Math.round((checkpoint?.totalMs ?? 0) + elapsedMs)),
  );
}
