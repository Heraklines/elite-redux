#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EXPECTED_GHOST_EVAL_PAIRS, GHOST_EVAL_CONTROLLERS, GHOST_EVAL_FIXED_SEEDS } from "./make-ghost-eval-batch.mjs";

const DIFFICULTIES = ["youngster", "ace", "elite", "hell"];

function validateBatch(name, batch) {
  if (
    batch?.version !== 1
    || batch.combatOnly !== true
    || batch.hardestTrainerAi !== true
    || batch.progressionPhaseEntries !== 0
    || !Array.isArray(batch.results)
    || batch.episodeCount !== batch.results.length
  ) {
    throw new Error(`invalid hardest-AI combat batch result: ${name}`);
  }
  for (const result of batch.results) {
    if (result.progressionPhaseEntries !== 0) {
      throw new Error(`${name} entered a reward or progression phase in ${result.id}`);
    }
  }
}

function collectExpectedEpisodeIds(manifests) {
  const expectedManifestCount = EXPECTED_GHOST_EVAL_PAIRS * GHOST_EVAL_FIXED_SEEDS.length;
  if (manifests.length !== expectedManifestCount) {
    throw new Error(`expected ${expectedManifestCount} seeded inverse-pair manifests, found ${manifests.length}`);
  }
  const pairIds = manifests.map(manifest => manifest.pairId);
  if (new Set(pairIds).size !== pairIds.length) {
    throw new Error("duplicate seeded inverse-pair manifest id");
  }
  const logicalPairs = new Set();
  for (const manifest of manifests) {
    if (
      manifest.legs?.length !== 2
      || manifest.legs[0].playerTeamId !== manifest.legs[1].enemyTeamId
      || manifest.legs[0].enemyTeamId !== manifest.legs[1].playerTeamId
      || !DIFFICULTIES.includes(manifest.difficulty)
      || !GHOST_EVAL_FIXED_SEEDS.includes(manifest.fixedSeed)
    ) {
      throw new Error(`${manifest.pairId} is not a valid stratified inverse matchup`);
    }
    const teams = manifest.legs.map(leg => leg.playerTeamId).sort();
    logicalPairs.add(`${manifest.difficulty}:${teams.join(":")}`);
  }
  if (logicalPairs.size !== EXPECTED_GHOST_EVAL_PAIRS) {
    throw new Error(`expected ${EXPECTED_GHOST_EVAL_PAIRS} logical roster pairs, found ${logicalPairs.size}`);
  }
  return new Set(pairIds.flatMap(pairId => [`${pairId}-leg-a`, `${pairId}-leg-b`]));
}

function indexControllerResults(controllerBatches, expectedEpisodeIds) {
  const byController = new Map(GHOST_EVAL_CONTROLLERS.map(controller => [controller, new Map()]));
  for (const { name, controller, batch } of controllerBatches) {
    if (!byController.has(controller)) {
      throw new Error(`unrecognized controller result file: ${name}`);
    }
    validateBatch(name, batch);
    const controllerResults = byController.get(controller);
    for (const result of batch.results) {
      if (!expectedEpisodeIds.has(result.id)) {
        throw new Error(`unexpected ${controller} result for ${result.id}`);
      }
      if (controllerResults.has(result.id)) {
        throw new Error(`duplicate ${controller} result for ${result.id}`);
      }
      controllerResults.set(result.id, result);
    }
  }
  for (const [controller, results] of byController) {
    if (results.size !== expectedEpisodeIds.size) {
      throw new Error(`expected ${expectedEpisodeIds.size} ${controller} results, found ${results.size}`);
    }
  }
  return byController;
}

function classifyResult(result) {
  if (result.illegalAction === true || /illegal[ -]?action/i.test(result.error ?? "")) {
    return "illegal-action";
  }
  if (result.timeout === true || result.outcome === "timeout") {
    return "timeout";
  }
  if (result.outcome === "victory") {
    return "won";
  }
  if (result.outcome === "player-wiped") {
    return "wiped";
  }
  if (["draw", "max-turns", "max-turns-reached"].includes(result.outcome)) {
    return "draw";
  }
  return "unresolved";
}

function collectLegs(manifests, byController) {
  const legs = [];
  for (const manifest of manifests) {
    for (const controller of GHOST_EVAL_CONTROLLERS) {
      for (const leg of manifest.legs) {
        const result = byController.get(controller).get(`${manifest.pairId}-leg-${leg.leg}`);
        legs.push({
          ...leg,
          pairId: manifest.pairId,
          difficulty: manifest.difficulty,
          fixedSeed: manifest.fixedSeed,
          controller,
          battleResult: classifyResult(result),
          outcome: result.outcome,
          turns: result.turns ?? null,
          combatMs: result.combatMs ?? null,
          bootMs: result.bootMs ?? null,
          error: result.error ?? null,
        });
      }
    }
  }
  return legs;
}

function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (total === 0) {
    return null;
  }
  const rate = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (rate + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((rate * (1 - rate) + z2 / (4 * total)) / total)) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function meanFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function summarizeLegs(legs) {
  const playerWins = legs.filter(leg => leg.battleResult === "won").length;
  const playerLosses = legs.filter(leg => leg.battleResult === "wiped").length;
  const draws = legs.filter(leg => leg.battleResult === "draw").length;
  const timeouts = legs.filter(leg => leg.battleResult === "timeout").length;
  const illegalActions = legs.filter(leg => leg.battleResult === "illegal-action").length;
  const unresolved = legs.length - playerWins - playerLosses - draws - timeouts - illegalActions;
  const decisive = playerWins + playerLosses;
  return {
    legs: legs.length,
    playerWins,
    playerLosses,
    draws,
    timeouts,
    illegalActions,
    unresolved,
    winRate: legs.length === 0 ? null : playerWins / legs.length,
    winRate95: wilsonInterval(playerWins, legs.length),
    decisiveWinRate: decisive === 0 ? null : playerWins / decisive,
    decisiveWinRate95: wilsonInterval(playerWins, decisive),
    meanCombatMs: meanFinite(legs.map(leg => leg.combatMs)),
    meanResetMs: meanFinite(legs.map(leg => leg.bootMs)),
  };
}

function summarizeControllers(legs) {
  const controllerReports = {};
  for (const controller of GHOST_EVAL_CONTROLLERS) {
    const controllerLegs = legs.filter(leg => leg.controller === controller);
    const byDifficulty = Object.fromEntries(
      DIFFICULTIES.map(difficulty => [
        difficulty,
        summarizeLegs(controllerLegs.filter(leg => leg.difficulty === difficulty)),
      ]),
    );
    const difficultyWinRates = Object.values(byDifficulty)
      .map(stats => stats.winRate)
      .filter(Number.isFinite);
    controllerReports[controller] = {
      ...summarizeLegs(controllerLegs),
      macroWinRate:
        difficultyWinRates.length === 0
          ? null
          : difficultyWinRates.reduce((sum, value) => sum + value, 0) / difficultyWinRates.length,
      byDifficulty,
    };
  }
  return controllerReports;
}

export function buildGhostBatchReport(manifests, controllerBatches) {
  const expectedEpisodeIds = collectExpectedEpisodeIds(manifests);
  const byController = indexControllerResults(controllerBatches, expectedEpisodeIds);
  const legs = collectLegs(manifests, byController);
  return {
    evaluator:
      "Random-init transformer, Showdown-transfer transformer, tree ensemble, smart-default, and hardest engine baseline versus hardest engine trainer AI",
    warning: "Offline imitation scores are not win rates; these rates come only from real-engine battles.",
    rosterPairs: EXPECTED_GHOST_EVAL_PAIRS,
    fixedSeeds: GHOST_EVAL_FIXED_SEEDS,
    seededMatchups: manifests.length,
    legs: legs.length,
    controllers: summarizeControllers(legs),
    results: legs,
  };
}

function percent(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function main() {
  const [inputDir, reportJson, reportMarkdown] = process.argv.slice(2);
  if (!inputDir || !reportJson || !reportMarkdown) {
    console.error("usage: node scripts/ai/summarize-ghost-batch-eval.mjs INPUT_DIR REPORT.json REPORT.md");
    process.exit(2);
  }
  const manifests = readdirSync(inputDir)
    .filter(name => name.endsWith("-manifest.json"))
    .sort()
    .map(name => JSON.parse(readFileSync(join(inputDir, name), "utf8")));
  const controllerBatches = readdirSync(inputDir)
    .filter(fileName => fileName.endsWith("-results.json"))
    .sort()
    .map(name => {
      const match = name.match(/^shard-\d+-(.+)-results\.json$/);
      if (!match) {
        throw new Error(`unrecognized controller result file: ${name}`);
      }
      return { name, controller: match[1], batch: JSON.parse(readFileSync(join(inputDir, name), "utf8")) };
    });
  const report = buildGhostBatchReport(manifests, controllerBatches);
  const lines = [
    "# Ghost winner-team gauntlet",
    "",
    `${report.rosterPairs} source-account-held-out roster pairs across four difficulties, ${report.fixedSeeds.length} seeds, and both mirrored orientations.`,
    "",
    "| Player controller | Wins | Losses | Draws | Timeouts | Illegal | Other | Win rate (95% CI) | Macro | Combat ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.controllers).map(([controller, stats]) => {
      const interval = stats.winRate95;
      const ci = interval ? `${percent(stats.winRate)} (${percent(interval.low)}-${percent(interval.high)})` : "n/a";
      return `| ${controller} | ${stats.playerWins} | ${stats.playerLosses} | ${stats.draws} | ${stats.timeouts} | ${stats.illegalActions} | ${stats.unresolved} | ${ci} | ${percent(stats.macroWinRate)} | ${stats.meanCombatMs?.toFixed(0) ?? "n/a"} |`;
    }),
    "",
    "## Per difficulty",
    "",
    "| Controller | Difficulty | Wins | Losses | Draws | Timeouts | Illegal | Win rate (95% CI) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.controllers).flatMap(([controller, stats]) =>
      DIFFICULTIES.map(difficulty => {
        const tier = stats.byDifficulty[difficulty];
        const interval = tier.winRate95;
        const ci = interval ? `${percent(tier.winRate)} (${percent(interval.low)}-${percent(interval.high)})` : "n/a";
        return `| ${controller} | ${difficulty} | ${tier.playerWins} | ${tier.playerLosses} | ${tier.draws} | ${tier.timeouts} | ${tier.illegalActions} | ${ci} |`;
      }),
    ),
    "",
    "Offline imitation scores are not win rates; these rates come from the source-disjoint mirrored real-engine gauntlet.",
    "",
  ];
  writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMarkdown, lines.join("\n"));
  console.log(
    `${basename(reportMarkdown)}: ${Object.entries(report.controllers)
      .map(
        ([controller, stats]) =>
          `${controller} ${stats.playerWins}-${stats.playerLosses}, macro ${percent(stats.macroWinRate)}`,
      )
      .join("; ")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
