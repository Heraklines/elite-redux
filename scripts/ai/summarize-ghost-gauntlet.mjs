#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [inputDir, reportJson, reportMarkdown] = process.argv.slice(2);
if (!inputDir || !reportJson || !reportMarkdown) {
  console.error("usage: node scripts/ai/summarize-ghost-gauntlet.mjs INPUT_DIR REPORT.json REPORT.md");
  process.exit(2);
}

const manifests = readdirSync(inputDir)
  .filter(name => name.endsWith("-manifest.json"))
  .sort();
if (manifests.length === 0) {
  throw new Error("no ghost gauntlet manifests found");
}
const legs = [];
for (const manifestName of manifests) {
  const manifest = JSON.parse(readFileSync(join(inputDir, manifestName), "utf8"));
  if (manifest.legs.length !== 2 || manifest.legs[0].playerTeamId !== manifest.legs[1].enemyTeamId) {
    throw new Error(`${manifest.pairId} is missing its inverse leg`);
  }
  if (!Array.isArray(manifest.playerControllers) || manifest.playerControllers.length === 0) {
    throw new Error(`${manifest.pairId} has no player controllers`);
  }
  for (const controller of manifest.playerControllers) {
    for (const leg of manifest.legs) {
      const resultPath = join(inputDir, `${manifest.pairId}-${controller}-leg-${leg.leg}-result.json`);
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      const battleResult = result.waves?.[0]?.result ?? "missing";
      legs.push({
        ...leg,
        pairId: manifest.pairId,
        controller,
        battleResult,
        turns: result.waves?.[0]?.turns ?? null,
      });
    }
  }
}

const controllerReports = {};
for (const controller of [...new Set(legs.map(leg => leg.controller))].sort()) {
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
  };
}
const report = {
  evaluator: "Selected tree and smart-default control as player versus engine trainer AI",
  warning: "Offline imitation scores are not win rates; the rates below come only from these real-engine battles.",
  pairs: manifests.length,
  legs: legs.length,
  controllers: controllerReports,
  results: legs,
};
const lines = [
  "# Ghost winner-team gauntlet",
  "",
  `${report.pairs} actual winning Hell-team pairs. Every controller plays ${report.pairs * 2} mirrored legs (A vs B and B vs A).`,
  "",
  "| Player controller | Wins | Losses | Unresolved | Completed-leg win rate |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...Object.entries(controllerReports).map(
    ([controller, stats]) =>
      `| ${controller} | ${stats.playerWins} | ${stats.playerLosses} | ${stats.unresolved} | ${stats.completedWinRate == null ? "n/a" : `${(stats.completedWinRate * 100).toFixed(1)}%`} |`,
  ),
  "",
  "Offline imitation scores are not win rates; these rates come from the side-balanced real-engine gauntlet.",
  "",
  "| Controller | Pair | Leg | Player team | Enemy team | Result | Turns |",
  "| --- | --- | --- | --- | --- | --- | ---: |",
  ...legs.map(
    leg =>
      `| ${leg.controller} | ${leg.pairId} | ${leg.leg} | ${leg.playerTeamId} | ${leg.enemyTeamId} | ${leg.battleResult} | ${leg.turns ?? "-"} |`,
  ),
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
