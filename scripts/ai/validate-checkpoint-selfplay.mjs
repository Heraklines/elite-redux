#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [decisionsPath, resultPath, expectedEpisodesArg, expectedPolicySource = "checkpoint-neural-v4"] =
  process.argv.slice(2);
const expectedEpisodes = Number.parseInt(expectedEpisodesArg ?? "", 10);
if (!decisionsPath || !resultPath || !Number.isInteger(expectedEpisodes) || expectedEpisodes < 1) {
  console.error(
    "usage: node scripts/ai/validate-checkpoint-selfplay.mjs DECISIONS.jsonl RESULT.json EXPECTED_EPISODES [POLICY_SOURCE]",
  );
  process.exit(2);
}

const records = readFileSync(decisionsPath, "utf8")
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => JSON.parse(line));
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const decisions = records.filter(record => record.kind === "combat_decision");
const terminals = records.filter(record => record.kind === "episode_terminal");
const expectedTerminals = expectedEpisodes * 2;

if (!result.complete || !result.combatOnly || result.opponentController !== "custom-policy") {
  throw new Error("self-play result did not preserve the complete combat-only custom-policy boundary");
}
if (result.episodeCount !== expectedEpisodes || result.progressionPhaseEntries !== 0) {
  throw new Error(
    `self-play result episode/progression mismatch: ${result.episodeCount}/${result.progressionPhaseEntries}`,
  );
}
if (terminals.length !== expectedTerminals) {
  throw new Error(`expected ${expectedTerminals} seat terminals, found ${terminals.length}`);
}
if (decisions.length === 0) {
  throw new Error("self-play shard emitted no committed decisions");
}

const decisionsBySeat = { player: 0, enemy: 0 };
for (const decision of decisions) {
  const seat = decision.episodeId.endsWith(":seat-player")
    ? "player"
    : decision.episodeId.endsWith(":seat-enemy")
      ? "enemy"
      : null;
  if (seat === null) {
    throw new Error(`decision has no seat identity: ${decision.episodeId}`);
  }
  decisionsBySeat[seat]++;
  if (decision.policySource !== expectedPolicySource || decision.policyTarget !== true) {
    throw new Error(`decision crossed the checkpoint policy firewall: ${decision.decisionId}`);
  }
  if (!decision.candidates.some(candidate => candidate.id === decision.chosenCandidateId)) {
    throw new Error(`committed action is absent from its legal set: ${decision.decisionId}`);
  }
}
if (decisionsBySeat.player === 0 || decisionsBySeat.enemy === 0) {
  throw new Error(`both seats must emit decisions: ${JSON.stringify(decisionsBySeat)}`);
}

const terminalsByBaseEpisode = new Map();
for (const terminal of terminals) {
  const match = /^(.*):seat-(player|enemy)$/u.exec(terminal.episodeId);
  if (!match) {
    throw new Error(`terminal has no seat identity: ${terminal.episodeId}`);
  }
  const pair = terminalsByBaseEpisode.get(match[1]) ?? {};
  pair[match[2]] = terminal;
  terminalsByBaseEpisode.set(match[1], pair);
}
if (terminalsByBaseEpisode.size !== expectedEpisodes) {
  throw new Error(`expected ${expectedEpisodes} terminal pairs, found ${terminalsByBaseEpisode.size}`);
}
for (const [episodeId, pair] of terminalsByBaseEpisode) {
  if (!pair.player || !pair.enemy) {
    throw new Error(`episode ${episodeId} is missing one seat terminal`);
  }
  const expectedEnemyOutcome =
    pair.player.outcome === "victory"
      ? "player-wiped"
      : pair.player.outcome === "player-wiped"
        ? "victory"
        : pair.player.outcome;
  if (pair.enemy.outcome !== expectedEnemyOutcome) {
    throw new Error(`episode ${episodeId} terminal outcomes are not mirrored`);
  }
}

console.log(
  JSON.stringify({
    episodes: expectedEpisodes,
    decisions: decisions.length,
    decisionsBySeat,
    terminals: terminals.length,
  }),
);
