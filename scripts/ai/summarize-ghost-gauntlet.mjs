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
  for (const leg of manifest.legs) {
    const resultPath = join(inputDir, `${manifest.pairId}-leg-${leg.leg}-result.json`);
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const battleResult = result.waves?.[0]?.result ?? "missing";
    legs.push({ ...leg, pairId: manifest.pairId, battleResult, turns: result.waves?.[0]?.turns ?? null });
  }
}

const playerWins = legs.filter(leg => leg.battleResult === "won").length;
const playerLosses = legs.filter(leg => leg.battleResult === "wiped").length;
const unresolved = legs.length - playerWins - playerLosses;
const completed = playerWins + playerLosses;
const report = {
  evaluator: "smart-default-v1 as player versus engine trainer AI",
  warning: "This is a side-balanced engine benchmark, not an ML-policy win rate.",
  pairs: manifests.length,
  legs: legs.length,
  playerWins,
  playerLosses,
  unresolved,
  completedWinRate: completed === 0 ? null : playerWins / completed,
  results: legs,
};
const lines = [
  "# Ghost winner-team gauntlet",
  "",
  `${report.pairs} actual winning Hell-team pairs, ${report.legs} mirrored legs (A vs B and B vs A).`,
  "",
  `- Player controller: ${report.evaluator}`,
  `- Player wins: ${playerWins}`,
  `- Player losses: ${playerLosses}`,
  `- Unresolved: ${unresolved}`,
  `- Completed-leg win rate: ${report.completedWinRate == null ? "n/a" : `${(report.completedWinRate * 100).toFixed(1)}%`}`,
  "- Scope: side-balanced engine benchmark only; not an ML-policy win rate.",
  "",
  "| Pair | Leg | Player team | Enemy team | Result | Turns |",
  "| --- | --- | --- | --- | --- | ---: |",
  ...legs.map(
    leg =>
      `| ${leg.pairId} | ${leg.leg} | ${leg.playerTeamId} | ${leg.enemyTeamId} | ${leg.battleResult} | ${leg.turns ?? "-"} |`,
  ),
  "",
];
writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(reportMarkdown, lines.join("\n"));
console.log(`${basename(reportMarkdown)}: ${playerWins}-${playerLosses}, ${unresolved} unresolved`);
