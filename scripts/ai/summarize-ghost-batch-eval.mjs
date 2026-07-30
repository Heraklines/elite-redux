#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EXPECTED_GHOST_EVAL_PAIRS, GHOST_EVAL_CONTROLLERS } from "./make-ghost-eval-batch.mjs";

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
  if (manifests.length !== EXPECTED_GHOST_EVAL_PAIRS) {
    throw new Error(`expected ${EXPECTED_GHOST_EVAL_PAIRS} inverse-pair manifests, found ${manifests.length}`);
  }
  const pairIds = manifests.map(manifest => manifest.pairId);
  if (new Set(pairIds).size !== pairIds.length) {
    throw new Error("duplicate inverse-pair manifest id");
  }
  for (const manifest of manifests) {
    if (
      manifest.legs?.length !== 2
      || manifest.legs[0].playerTeamId !== manifest.legs[1].enemyTeamId
      || manifest.legs[0].enemyTeamId !== manifest.legs[1].playerTeamId
    ) {
      throw new Error(`${manifest.pairId} is missing its inverse leg`);
    }
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

function collectLegs(manifests, byController) {
  const legs = [];
  for (const manifest of manifests) {
    for (const controller of GHOST_EVAL_CONTROLLERS) {
      for (const leg of manifest.legs) {
        const result = byController.get(controller).get(`${manifest.pairId}-leg-${leg.leg}`);
        legs.push({
          ...leg,
          pairId: manifest.pairId,
          controller,
          battleResult:
            result.outcome === "victory" ? "won" : result.outcome === "player-wiped" ? "wiped" : "unresolved",
          turns: result.turns,
          combatMs: result.combatMs,
          bootMs: result.bootMs,
        });
      }
    }
  }
  return legs;
}

function summarizeControllers(legs) {
  const controllerReports = {};
  for (const controller of GHOST_EVAL_CONTROLLERS) {
    const controllerLegs = legs.filter(leg => leg.controller === controller);
    const playerWins = controllerLegs.filter(leg => leg.battleResult === "won").length;
    const playerLosses = controllerLegs.filter(leg => leg.battleResult === "wiped").length;
    const unresolved = controllerLegs.length - playerWins - playerLosses;
    const completed = playerWins + playerLosses;
    controllerReports[controller] = {
      legs: controllerLegs.length,
      playerWins,
      playerLosses,
      unresolved,
      completedWinRate: completed === 0 ? null : playerWins / completed,
      meanCombatMs: controllerLegs.reduce((sum, leg) => sum + leg.combatMs, 0) / controllerLegs.length,
      meanResetMs: controllerLegs.reduce((sum, leg) => sum + leg.bootMs, 0) / controllerLegs.length,
    };
  }
  return controllerReports;
}

export function buildGhostBatchReport(manifests, controllerBatches) {
  const expectedEpisodeIds = collectExpectedEpisodeIds(manifests);
  const byController = indexControllerResults(controllerBatches, expectedEpisodeIds);
  const legs = collectLegs(manifests, byController);
  const controllerReports = summarizeControllers(legs);
  return {
    evaluator:
      "Single trees, stacked trees, ER candidate transformer, and smart-default versus hardest engine trainer AI",
    warning: "Offline imitation scores are not win rates; these rates come only from real-engine battles.",
    pairs: manifests.length,
    legs: legs.length,
    controllers: controllerReports,
    results: legs,
  };
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
  const controllerReports = report.controllers;
  const lines = [
    "# Ghost winner-team gauntlet",
    "",
    `${report.pairs} held-out winning Hell-team pairs; every controller plays ${report.pairs * 2} mirrored legs.`,
    "",
    "| Player controller | Wins | Losses | Unresolved | Win rate | Combat ms | Reset ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(controllerReports).map(
      ([controller, stats]) =>
        `| ${controller} | ${stats.playerWins} | ${stats.playerLosses} | ${stats.unresolved} | ${stats.completedWinRate == null ? "n/a" : `${(stats.completedWinRate * 100).toFixed(1)}%`} | ${stats.meanCombatMs.toFixed(0)} | ${stats.meanResetMs.toFixed(0)} |`,
    ),
    "",
    "Offline imitation scores are not win rates; these rates come from the side-balanced real-engine gauntlet.",
    "",
  ];
  writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMarkdown, lines.join("\n"));
  console.log(
    `${basename(reportMarkdown)}: ${Object.entries(controllerReports)
      .map(
        ([controller, stats]) =>
          `${controller} ${stats.playerWins}-${stats.playerLosses} (${stats.unresolved} unresolved)`,
      )
      .join("; ")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
