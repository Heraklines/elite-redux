#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  EVALUATOR_PARITY_ARMS,
  EVALUATOR_PARITY_FIXED_SEEDS,
  EVALUATOR_PARITY_PAIR_INDICES,
} from "./make-evaluator-parity-batch.mjs";

const DIFFICULTIES = ["youngster", "ace", "elite", "hell"];
const EXPECTED_MANIFESTS = EVALUATOR_PARITY_PAIR_INDICES.length * EVALUATOR_PARITY_FIXED_SEEDS.length;
const EXPECTED_LEGS = EXPECTED_MANIFESTS * 2;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seededFraction(state) {
  let next = state.value;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  state.value = next >>> 0;
  return state.value / 0x1_0000_0000;
}

export function pairedBootstrapInterval(values, statistic = mean, samples = 20_000) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const state = { value: 0x45525041 };
  const estimates = [];
  for (let sample = 0; sample < samples; sample++) {
    const resampled = [];
    for (const _value of values) {
      resampled.push(values[Math.floor(seededFraction(state) * values.length)]);
    }
    estimates.push(statistic(resampled));
  }
  estimates.sort((a, b) => a - b);
  return {
    low: estimates[Math.floor(samples * 0.025)],
    high: estimates[Math.ceil(samples * 0.975) - 1],
  };
}

function outcomeScore(result) {
  if (result.timeout === true || result.outcome === "timeout") {
    throw new Error(`unexplained timeout in ${result.id}`);
  }
  if (result.illegalAction === true || /illegal[ -]?action/i.test(result.error ?? "")) {
    throw new Error(`illegal action in ${result.id}`);
  }
  if (result.outcome === "victory") {
    return 1;
  }
  if (result.outcome === "player-wiped") {
    return 0;
  }
  if (["draw", "max-turns", "max-turns-reached"].includes(result.outcome)) {
    return 0.5;
  }
  throw new Error(`unresolved result in ${result.id}: ${result.outcome}`);
}

function validateManifests(manifests) {
  if (manifests.length !== EXPECTED_MANIFESTS) {
    throw new Error(`expected ${EXPECTED_MANIFESTS} parity manifests, found ${manifests.length}`);
  }
  const ids = new Set();
  const difficultyCounts = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, 0]));
  for (const manifest of manifests) {
    if (
      ids.has(manifest.pairId)
      || !EVALUATOR_PARITY_FIXED_SEEDS.includes(manifest.fixedSeed)
      || !DIFFICULTIES.includes(manifest.difficulty)
      || JSON.stringify(manifest.calibrationArms) !== JSON.stringify(EVALUATOR_PARITY_ARMS)
      || manifest.legs?.length !== 2
      || manifest.legs[0].playerTeamId !== manifest.legs[1].enemyTeamId
      || manifest.legs[0].enemyTeamId !== manifest.legs[1].playerTeamId
    ) {
      throw new Error(`invalid parity manifest: ${manifest.pairId ?? "(missing)"}`);
    }
    ids.add(manifest.pairId);
    difficultyCounts[manifest.difficulty]++;
  }
  if (Object.values(difficultyCounts).some(count => count !== EXPECTED_MANIFESTS / DIFFICULTIES.length)) {
    throw new Error(`parity manifests are not difficulty balanced: ${JSON.stringify(difficultyCounts)}`);
  }
}

function validateBatch(arm, batch) {
  const customOpponent = arm === "random-vs-random";
  if (
    batch?.version !== 1
    || batch.complete !== true
    || batch.combatOnly !== true
    || batch.progressionPhaseEntries !== 0
    || batch.hardestTrainerAi !== !customOpponent
    || batch.opponentController !== (customOpponent ? "custom-policy" : "engine-hardest-v1")
    || batch.expectedEpisodeCount !== batch.episodeCount
    || batch.episodeCount < 1
    || !Array.isArray(batch.results)
    || batch.results.length !== batch.episodeCount
  ) {
    throw new Error(`invalid ${arm} combat batch result`);
  }
  for (const result of batch.results) {
    if (result.progressionPhaseEntries !== 0) {
      throw new Error(`${arm} entered a reward or progression phase in ${result.id}`);
    }
    outcomeScore(result);
  }
}

function indexResults(resultFiles) {
  const byArm = new Map(EVALUATOR_PARITY_ARMS.map(arm => [arm, new Map()]));
  for (const { arm, batch } of resultFiles) {
    validateBatch(arm, batch);
    const armResults = byArm.get(arm);
    for (const result of batch.results) {
      if (armResults.has(result.id)) {
        throw new Error(`duplicate ${arm} result: ${result.id}`);
      }
      armResults.set(result.id, result);
    }
  }
  for (const [arm, results] of byArm) {
    if (results.size !== EXPECTED_LEGS) {
      throw new Error(`expected ${EXPECTED_LEGS} ${arm} results, found ${results.size}`);
    }
  }
  return byArm;
}

function summarizeArm(manifests, results) {
  const pairs = manifests.map(manifest => {
    const legA = results.get(`${manifest.pairId}-leg-a`);
    const legB = results.get(`${manifest.pairId}-leg-b`);
    if (!legA || !legB) {
      throw new Error(`missing mirrored leg for ${manifest.pairId}`);
    }
    const scoreA = outcomeScore(legA);
    const scoreB = outcomeScore(legB);
    return {
      pairId: manifest.pairId,
      difficulty: manifest.difficulty,
      fixedSeed: manifest.fixedSeed,
      scoreA,
      scoreB,
      pairedScore: (scoreA + scoreB) / 2,
      orientationBias: scoreA - scoreB,
      draws: Number(scoreA === 0.5) + Number(scoreB === 0.5),
      combatMs: (legA.combatMs ?? 0) + (legB.combatMs ?? 0),
      bootMs: (legA.bootMs ?? 0) + (legB.bootMs ?? 0),
    };
  });
  const pairedScores = pairs.map(pair => pair.pairedScore);
  const orientationBiases = pairs.map(pair => pair.orientationBias);
  const score = mean(pairedScores);
  const score95 = pairedBootstrapInterval(pairedScores);
  const orientationBias = mean(orientationBiases);
  const orientationBias95 = pairedBootstrapInterval(orientationBiases);
  const perDifficulty = Object.fromEntries(
    DIFFICULTIES.map(difficulty => {
      const difficultyScores = pairs.filter(pair => pair.difficulty === difficulty).map(pair => pair.pairedScore);
      return [difficulty, { score: mean(difficultyScores), pairedScore95: pairedBootstrapInterval(difficultyScores) }];
    }),
  );
  const smokeGate = {
    pointWithin20pp: Math.abs(score - 0.5) <= 0.2,
    pairedCiContains50: score95.low <= 0.5 && score95.high >= 0.5,
    orientationCiContainsZero: orientationBias95.low <= 0 && orientationBias95.high >= 0,
    decisiveRateAtLeast75: pairs.reduce((total, pair) => total + pair.draws, 0) / (pairs.length * 2) <= 0.25,
  };
  return {
    legs: pairs.length * 2,
    seededPairs: pairs.length,
    score,
    pairedScore95: score95,
    orientationBias,
    orientationBias95,
    draws: pairs.reduce((total, pair) => total + pair.draws, 0),
    meanCombatMsPerLeg: pairs.reduce((total, pair) => total + pair.combatMs, 0) / (pairs.length * 2),
    meanBootMsPerLeg: pairs.reduce((total, pair) => total + pair.bootMs, 0) / (pairs.length * 2),
    perDifficulty,
    smokeGate,
    passed: Object.values(smokeGate).every(Boolean),
    pairs,
  };
}

export function buildEvaluatorParityReport(manifests, resultFiles) {
  validateManifests(manifests);
  const byArm = indexResults(resultFiles);
  const arms = Object.fromEntries(EVALUATOR_PARITY_ARMS.map(arm => [arm, summarizeArm(manifests, byArm.get(arm))]));
  return {
    evaluator: "neutral mirrored evaluator parity smoke gate",
    pairIndices: EVALUATOR_PARITY_PAIR_INDICES,
    fixedSeeds: EVALUATOR_PARITY_FIXED_SEEDS,
    rosterPairs: EVALUATOR_PARITY_PAIR_INDICES.length,
    legsPerArm: EXPECTED_LEGS,
    progressionPhaseEntries: 0,
    illegalActions: 0,
    routingErrors: 0,
    unexplainedTimeouts: 0,
    arms,
    passed: Object.values(arms).every(arm => arm.passed),
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function interval(value) {
  return `${percent(value.low)} to ${percent(value.high)}`;
}

function main() {
  const [inputDir, reportJson, reportMarkdown] = process.argv.slice(2);
  if (!inputDir || !reportJson || !reportMarkdown) {
    console.error("usage: node scripts/ai/summarize-evaluator-parity.mjs INPUT_DIR REPORT.json REPORT.md");
    process.exit(2);
  }
  const manifests = readdirSync(inputDir)
    .filter(name => name.endsWith("-manifest.json"))
    .sort()
    .map(name => JSON.parse(readFileSync(join(inputDir, name), "utf8")));
  const resultFiles = readdirSync(inputDir)
    .filter(name => name.endsWith("-results.json"))
    .sort()
    .map(name => {
      const match = name.match(/^shard-\d+-(random-vs-random|engine-hardest-vs-native)-results\.json$/);
      if (!match) {
        throw new Error(`unrecognized parity result file: ${name}`);
      }
      return { arm: match[1], batch: JSON.parse(readFileSync(join(inputDir, name), "utf8")) };
    });
  const report = buildEvaluatorParityReport(manifests, resultFiles);
  const lines = [
    "# Evaluator parity smoke gate",
    "",
    `${report.rosterPairs} balanced held-out roster pairs, ${report.fixedSeeds.length} seeds, `
      + `${report.legsPerArm} mirrored battle legs per arm.`,
    "",
    "| Arm | Score | Paired 95% CI | Orientation bias | Bias 95% CI | Draws | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...Object.entries(report.arms).map(
      ([arm, stats]) =>
        `| ${arm} | ${percent(stats.score)} | ${interval(stats.pairedScore95)} | `
        + `${percent(stats.orientationBias)} | ${interval(stats.orientationBias95)} | ${stats.draws} | `
        + `${stats.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    `Illegal actions: ${report.illegalActions}; routing errors: ${report.routingErrors}; `
      + `unexplained timeouts: ${report.unexplainedTimeouts}; progression phases: ${report.progressionPhaseEntries}.`,
    "",
    `Overall smoke gate: ${report.passed ? "PASS" : "FAIL"}.`,
    "",
  ];
  writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMarkdown, lines.join("\n"));
  console.log(`${basename(reportMarkdown)}: ${report.passed ? "PASS" : "FAIL"}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
