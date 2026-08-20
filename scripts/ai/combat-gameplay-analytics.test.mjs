#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";
import { createCombatGameplayAnalytics } from "./combat-gameplay-analytics.mjs";
import { mergeCombatGameplayAnalytics } from "./merge-combat-gameplay-analytics.mjs";

function mon(species, form = 0) {
  return {
    entityId: species,
    species,
    form,
    activeSlot: 0,
    hpRatio: 0.8,
    fainted: false,
    boss: { segments: 0, phase: null },
    abilities: [{ abilityId: 10, source: "active", active: true, suppressed: false }],
    heldItems: [{ itemId: "LEFTOVERS", active: true, consumed: false }],
    moves: [{ slot: 0, moveId: 20, power: 80 }],
  };
}

function decision(episodeId, species, chosenKind = "move") {
  const move = {
    id: "move",
    kind: "move",
    actorSlot: 0,
    moveSlot: 0,
    moveId: 20,
    tera: false,
    derived: {
      targetOutcomes: [{ engineTypeMultiplier: 1, expectedDamageMax: 30, immunityReason: null }],
    },
  };
  const switching = { id: "switch", kind: "switch", actorSlot: 0, partyIndex: 1, transfer: "normal" };
  return {
    kind: "combat_decision",
    dictionaryHash: "dictionary-a",
    decisionId: `${episodeId}:1:1:0`,
    jointActionId: `${episodeId}:1:1`,
    actorSlot: 0,
    chosenCandidateId: chosenKind === "move" ? "move" : "switch",
    candidates: [move, switching],
    observation: {
      wave: 1,
      turn: 1,
      battleType: 1,
      format: 1,
      selfParty: [mon(species), { ...mon(species + 100), entityId: species + 100, activeSlot: null }],
      opponentActive: [{ ...mon(999), boss: { segments: 0, phase: null } }],
    },
  };
}

function episode(index, outcome = "victory", species = 1, source = `source-${index}`) {
  const episodeId = `episode-${index}`;
  return {
    episodeId,
    sourcePartitionId: source,
    envelope: { difficulty: "hell", gameModeId: "classic" },
    decisions: [decision(episodeId, species, index % 4 === 0 ? "switch" : "move")],
    battleTerminals: [{ battleId: `${episodeId}:1`, wave: 1, turn: 1, outcome }],
    runTerminals: [{ outcome: outcome === "victory" ? "victory" : "player-wiped", finalWave: 1, wavesCleared: 1 }],
    result: {
      hardQuarantined: false,
      incomplete: false,
      completedOutcomeEligible: true,
    },
  };
}

test("streaming analytics retains only aggregate source sketches", () => {
  const analytics = createCombatGameplayAnalytics();
  analytics.ingestEpisode(episode(1));
  const report = analytics.finish({ prefix: "2026-08-20/" });
  assert.equal(report.counts.episodes, 1);
  assert.equal(report.counts.decisions, 1);
  assert.equal(report.counts.battleTerminals, 1);
  assert.equal(report.approximateSources, 1);
  assert.equal(report.tables.speciesRoster.length, 2);
  assert.ok(!JSON.stringify(report).includes("source-1"));
  assert.ok(!JSON.stringify(report).includes("episode-1"));
});

test("merge suppresses cohorts below both support gates", () => {
  const analytics = createCombatGameplayAnalytics();
  analytics.ingestEpisode(episode(1));
  const merged = mergeCombatGameplayAnalytics([analytics.finish()], {
    minObservations: 2,
    minSources: 2,
    includeSketches: false,
  });
  assert.equal(merged.tables.battleOutcome.length, 0);
  assert.equal(merged.privacy.sourceSketchesIncluded, false);
  assert.equal("sourceSketch" in merged, false);
});

test("entity rankings use dictionary names and supported battle exposures", () => {
  const analytics = createCombatGameplayAnalytics();
  for (let index = 0; index < 120; index++) {
    analytics.ingestEpisode(episode(index, "victory", 1, `winner-source-${index % 12}`));
    analytics.ingestEpisode(episode(`loss-${index}`, "defeat", 2, `loser-source-${index % 12}`));
  }
  const merged = mergeCombatGameplayAnalytics([analytics.finish()], {
    minObservations: 1,
    minSources: 1,
    dictionaries: {
      "dictionary-a": {
        speciesForms: {
          "1:0": { name: "Winner", formKey: "" },
          "2:0": { name: "Loser", formKey: "" },
        },
        moves: { 20: { name: "Test Move" } },
        abilities: { 10: { name: "Test Ability" } },
        items: { LEFTOVERS: { name: "Leftovers" } },
      },
    },
  });
  assert.equal(merged.insights.associations.species.hell.positive[0].name, "Winner");
  assert.equal(merged.insights.associations.species.hell.negative[0].name, "Loser");
  assert.equal(merged.insights.battleOutcomesByDifficulty.hell.resolvedWinRate, 0.5);
});
