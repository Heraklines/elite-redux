#!/usr/bin/env node

import { createHash } from "node:crypto";

const SOURCE_SKETCH_BITS = 4096;
const SOURCE_SKETCH_BYTES = SOURCE_SKETCH_BITS / 8;
const BATTLE_OUTCOMES = new Set(["victory", "defeat", "capture", "flee", "abort", "invalid"]);

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function waveBand(wave) {
  if (!Number.isFinite(wave) || wave < 1) {
    return "unknown";
  }
  if (wave <= 10) {
    return "001-010";
  }
  if (wave <= 20) {
    return "011-020";
  }
  if (wave <= 40) {
    return "021-040";
  }
  if (wave <= 60) {
    return "041-060";
  }
  if (wave <= 100) {
    return "061-100";
  }
  if (wave <= 150) {
    return "101-150";
  }
  if (wave <= 200) {
    return "151-200";
  }
  return "201+";
}

function hpBand(ratio) {
  if (!finite(ratio)) {
    return "unknown";
  }
  if (ratio <= 0.1) {
    return "00-10%";
  }
  if (ratio <= 0.25) {
    return "11-25%";
  }
  if (ratio <= 0.5) {
    return "26-50%";
  }
  if (ratio <= 0.75) {
    return "51-75%";
  }
  return "76-100%";
}

function battleTypeName(value) {
  return ["wild", "trainer", "clear", "mystery"][value] ?? `unknown-${value}`;
}

function formatName(value) {
  return ["unknown", "single", "double", "triple"][value] ?? `format-${value}`;
}

function battleId(jointActionId) {
  if (typeof jointActionId !== "string" || !jointActionId.includes(":")) {
    return null;
  }
  return jointActionId.slice(0, jointActionId.lastIndexOf(":"));
}

function sourceBit(sourceId) {
  const digest = createHash("sha256").update(`er-gameplay-analytics-v1:${sourceId}`).digest();
  return digest.readUInt32BE(0) % SOURCE_SKETCH_BITS;
}

export function emptySourceSketch() {
  return new Uint8Array(SOURCE_SKETCH_BYTES);
}

export function addSourceToSketch(sketch, sourceId) {
  if (!sourceId) {
    return;
  }
  const bit = sourceBit(sourceId);
  sketch[bit >> 3] |= 1 << (bit & 7);
}

export function mergeSourceSketch(target, source) {
  if (target.length !== SOURCE_SKETCH_BYTES || source.length !== SOURCE_SKETCH_BYTES) {
    throw new Error("incompatible source sketch");
  }
  for (let index = 0; index < target.length; index++) {
    target[index] |= source[index];
  }
}

export function estimateSourceSketch(sketch) {
  let occupied = 0;
  for (const byte of sketch) {
    let value = byte;
    while (value) {
      occupied += value & 1;
      value >>= 1;
    }
  }
  const empty = SOURCE_SKETCH_BITS - occupied;
  if (empty === 0) {
    return SOURCE_SKETCH_BITS;
  }
  return Math.round(-SOURCE_SKETCH_BITS * Math.log(empty / SOURCE_SKETCH_BITS));
}

function encodeSketch(sketch) {
  return Buffer.from(sketch).toString("base64");
}

export function decodeSourceSketch(encoded) {
  const decoded = new Uint8Array(Buffer.from(encoded ?? "", "base64"));
  if (decoded.length !== SOURCE_SKETCH_BYTES) {
    throw new Error("invalid source sketch encoding");
  }
  return decoded;
}

function createRow(dimensions) {
  return {
    dimensions,
    observations: 0,
    outcomes: {},
    sums: {},
    sourceSketch: emptySourceSketch(),
  };
}

class MetricTable {
  constructor(name) {
    this.name = name;
    this.rows = new Map();
  }

  add(dimensions, sourceId, { observations = 1, outcome = null, sums = {} } = {}) {
    const key = JSON.stringify(dimensions);
    const row = this.rows.get(key) ?? createRow(dimensions);
    row.observations += observations;
    if (outcome != null) {
      increment(row.outcomes, String(outcome));
    }
    for (const [name, value] of Object.entries(sums)) {
      if (finite(value)) {
        increment(row.sums, name, value);
      }
    }
    addSourceToSketch(row.sourceSketch, sourceId);
    this.rows.set(key, row);
  }

  serialize() {
    return [...this.rows.values()]
      .map(row => ({
        dimensions: row.dimensions,
        observations: row.observations,
        outcomes: row.outcomes,
        sums: row.sums,
        approximateSources: estimateSourceSketch(row.sourceSketch),
        sourceSketch: encodeSketch(row.sourceSketch),
      }))
      .sort((left, right) => JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)));
  }
}

function chosenCandidate(decision) {
  return (decision.candidates ?? []).find(candidate => candidate.id === decision.chosenCandidateId) ?? null;
}

function actorObservation(decision) {
  return (decision.observation?.selfParty ?? []).find(mon => mon.activeSlot === decision.actorSlot) ?? null;
}

function isBossObservation(observation) {
  return (observation?.opponentActive ?? []).some(
    mon => Number(mon?.boss?.segments ?? 0) > 1 || mon?.boss?.phase != null,
  );
}

function orderedDecisions(decisions) {
  return [...decisions].sort((left, right) => {
    const leftObservation = left.observation ?? {};
    const rightObservation = right.observation ?? {};
    return (
      Number(leftObservation.wave ?? 0) - Number(rightObservation.wave ?? 0)
      || Number(leftObservation.turn ?? 0) - Number(rightObservation.turn ?? 0)
      || String(left.decisionId ?? "").localeCompare(String(right.decisionId ?? ""))
    );
  });
}

function uniqueValues(values) {
  return [...new Set(values.filter(value => value != null && value !== ""))];
}

function entityDimensions(kind, difficulty, dictionaryHash, value, extra = null) {
  return [kind, difficulty, dictionaryHash || "unknown", String(value), extra == null ? "" : String(extra)];
}

function addRosterExposures(tables, decision, difficulty, sourceId, outcome) {
  const observation = decision.observation ?? {};
  const dictionaryHash = decision.dictionaryHash ?? "unknown";
  const party = observation.selfParty ?? [];
  for (const identity of uniqueValues(party.map(mon => `${mon.species}:${mon.form}`))) {
    const [species, form] = identity.split(":");
    tables.speciesRoster.add(entityDimensions("species", difficulty, dictionaryHash, species, form), sourceId, {
      outcome,
    });
  }
  for (const identity of uniqueValues(
    party.flatMap(mon =>
      (mon.abilities ?? [])
        .filter(ability => ability.active === true && ability.suppressed !== true)
        .map(ability => `${ability.abilityId}:${ability.source}`),
    ),
  )) {
    const separator = identity.lastIndexOf(":");
    tables.abilityRoster.add(
      entityDimensions(
        "ability",
        difficulty,
        dictionaryHash,
        identity.slice(0, separator),
        identity.slice(separator + 1),
      ),
      sourceId,
      { outcome },
    );
  }
  for (const itemId of uniqueValues(
    party.flatMap(mon =>
      (mon.heldItems ?? []).filter(item => item.active !== false && item.consumed !== true).map(item => item.itemId),
    ),
  )) {
    tables.itemRoster.add(entityDimensions("item", difficulty, dictionaryHash, itemId), sourceId, { outcome });
  }
  for (const moveId of uniqueValues(party.flatMap(mon => (mon.moves ?? []).map(move => move.moveId)))) {
    tables.moveRoster.add(entityDimensions("move", difficulty, dictionaryHash, moveId), sourceId, { outcome });
  }
}

function chosenMoveQuality(decision, candidate) {
  const actor = actorObservation(decision);
  const move =
    (actor?.moves ?? []).find(row => row.moveId === candidate.moveId && row.slot === candidate.moveSlot)
    ?? (actor?.moves ?? []).find(row => row.moveId === candidate.moveId);
  const damaging = Number(move?.power ?? 0) > 0;
  const outcomes = candidate.derived?.targetOutcomes ?? [];
  const immune =
    outcomes.length > 0 && outcomes.every(row => row.immunityReason != null || row.engineTypeMultiplier === 0);
  const zeroDamage = damaging && outcomes.length > 0 && outcomes.every(row => Number(row.expectedDamageMax ?? 0) <= 0);
  return { damaging, immune, zeroDamage };
}

function createTables() {
  return Object.fromEntries(
    [
      "runOutcome",
      "battleOutcome",
      "actionChoice",
      "switchByHp",
      "teraChoice",
      "moveChoiceQuality",
      "lossPrecursor",
      "speciesRoster",
      "abilityRoster",
      "itemRoster",
      "moveRoster",
      "moveChosenBattle",
    ].map(name => [name, new MetricTable(name)]),
  );
}

export function createCombatGameplayAnalytics() {
  const tables = createTables();
  const overallSources = emptySourceSketch();
  const counts = {
    episodes: 0,
    hardQuarantinedEpisodes: 0,
    incompleteEpisodes: 0,
    completedOutcomeEpisodes: 0,
    decisions: 0,
    battleTerminals: 0,
    battlesWithDecisions: 0,
    battlesWithoutDecisions: 0,
    runTerminals: 0,
  };
  const dictionaryHashes = new Set();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Episode reduction keeps related battle joins in one pass.
  function ingestEpisode(episode) {
    const sourceId = String(episode.sourcePartitionId ?? "");
    const difficulty = String(episode.envelope?.difficulty ?? "unknown");
    const gameMode = String(episode.envelope?.gameModeId ?? "unknown");
    const result = episode.result ?? {};
    counts.episodes++;
    counts.hardQuarantinedEpisodes += Number(result.hardQuarantined === true);
    counts.incompleteEpisodes += Number(result.incomplete === true);
    counts.completedOutcomeEpisodes += Number(result.completedOutcomeEligible === true);
    addSourceToSketch(overallSources, sourceId);

    const runTerminals = episode.runTerminals ?? [];
    counts.runTerminals += runTerminals.length;
    for (const terminal of runTerminals) {
      tables.runOutcome.add([difficulty, gameMode, waveBand(Number(terminal.finalWave ?? 0))], sourceId, {
        outcome: terminal.outcome,
        sums: { wavesCleared: Number(terminal.wavesCleared ?? 0) },
      });
    }

    const decisions = orderedDecisions(episode.decisions ?? []);
    counts.decisions += decisions.length;
    for (const decision of decisions) {
      if (decision.dictionaryHash) {
        dictionaryHashes.add(decision.dictionaryHash);
      }
    }
    const decisionsByBattle = new Map();
    for (const decision of decisions) {
      const id = battleId(decision.jointActionId);
      if (id == null) {
        continue;
      }
      const rows = decisionsByBattle.get(id) ?? [];
      rows.push(decision);
      decisionsByBattle.set(id, rows);
    }

    const terminals = new Map((episode.battleTerminals ?? []).map(terminal => [terminal.battleId, terminal]));
    counts.battleTerminals += terminals.size;
    for (const [id, terminal] of terminals) {
      if (!BATTLE_OUTCOMES.has(terminal.outcome)) {
        continue;
      }
      const battleDecisions = orderedDecisions(decisionsByBattle.get(id) ?? []);
      if (battleDecisions.length === 0) {
        counts.battlesWithoutDecisions++;
        continue;
      }
      counts.battlesWithDecisions++;
      const first = battleDecisions[0];
      const last = battleDecisions.at(-1);
      const observation = first.observation ?? {};
      const dimensions = [
        difficulty,
        gameMode,
        waveBand(Number(terminal.wave ?? observation.wave ?? 0)),
        battleTypeName(observation.battleType),
        formatName(observation.format),
        isBossObservation(observation) ? "boss" : "ordinary",
      ];
      tables.battleOutcome.add(dimensions, sourceId, {
        outcome: terminal.outcome,
        sums: { turns: Number(terminal.turn ?? 0) },
      });
      addRosterExposures(tables, first, difficulty, sourceId, terminal.outcome);

      const chosenMoves = uniqueValues(
        battleDecisions.map(decision => {
          const chosen = chosenCandidate(decision);
          return chosen?.kind === "move" ? `${decision.dictionaryHash ?? "unknown"}:${chosen.moveId}` : null;
        }),
      );
      for (const identity of chosenMoves) {
        const separator = identity.lastIndexOf(":");
        tables.moveChosenBattle.add(
          entityDimensions("move", difficulty, identity.slice(0, separator), identity.slice(separator + 1)),
          sourceId,
          { outcome: terminal.outcome },
        );
      }

      if (terminal.outcome === "defeat" && last != null) {
        const actor = actorObservation(last);
        const living = (last.observation?.selfParty ?? []).filter(
          mon => mon.fainted !== true && Number(mon.hpRatio ?? 0) > 0,
        ).length;
        tables.lossPrecursor.add(
          [difficulty, formatName(last.observation?.format), hpBand(actor?.hpRatio), String(living)],
          sourceId,
        );
      }
    }

    for (const decision of decisions) {
      const chosen = chosenCandidate(decision);
      if (chosen == null) {
        continue;
      }
      const terminal = terminals.get(battleId(decision.jointActionId));
      const outcome = terminal?.outcome ?? "unknown";
      const observation = decision.observation ?? {};
      const actor = actorObservation(decision);
      const common = [difficulty, formatName(observation.format), waveBand(Number(observation.wave ?? 0))];
      tables.actionChoice.add([...common, chosen.kind], sourceId, { outcome });
      tables.switchByHp.add(
        [...common, hpBand(actor?.hpRatio), chosen.kind === "switch" ? "switch" : "stay"],
        sourceId,
        {
          outcome,
        },
      );
      tables.teraChoice.add([...common, chosen.kind === "move" && chosen.tera ? "tera" : "no-tera"], sourceId, {
        outcome,
      });
      if (chosen.kind === "move") {
        const quality = chosenMoveQuality(decision, chosen);
        const qualityLabel = quality.immune
          ? "immune-target"
          : quality.zeroDamage
            ? "zero-damage"
            : quality.damaging
              ? "damaging"
              : "status";
        tables.moveChoiceQuality.add([...common, qualityLabel], sourceId, { outcome });
      }
    }
  }

  function finish(metadata = {}) {
    return {
      reportVersion: 1,
      contractVersion: 4,
      generatedAt: new Date().toISOString(),
      privacy: {
        rawRecordsIncluded: false,
        rawIdentifiersIncluded: false,
        sourceRepresentation: "4096-bit one-way aggregate cardinality sketch",
      },
      metadata,
      counts,
      approximateSources: estimateSourceSketch(overallSources),
      sourceSketch: encodeSketch(overallSources),
      dictionaryHashes: [...dictionaryHashes].sort(),
      tables: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.serialize()])),
    };
  }

  return { ingestEpisode, finish };
}

export const gameplayAnalyticsInternals = {
  battleId,
  battleTypeName,
  formatName,
  hpBand,
  waveBand,
};
