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

function monIdentity(mon) {
  return mon == null ? null : `${mon.species}:${mon.form}`;
}

function activeAbilities(mon) {
  return (mon?.abilities ?? []).filter(ability => ability.active === true && ability.suppressed !== true);
}

function activeItems(mon) {
  return (mon?.heldItems ?? []).filter(item => item.active !== false && item.consumed !== true);
}

function combatContext(difficulty, gameMode, observation, wave = observation?.wave) {
  return [
    difficulty,
    gameMode,
    waveBand(Number(wave ?? 0)),
    battleTypeName(observation?.battleType),
    formatName(observation?.format),
    isBossObservation(observation) ? "boss" : "ordinary",
  ];
}

function tenWaveBand(wave) {
  if (!Number.isFinite(wave) || wave < 1) {
    return "unknown";
  }
  const start = Math.floor((wave - 1) / 10) * 10 + 1;
  return `${String(start).padStart(3, "0")}-${String(start + 9).padStart(3, "0")}`;
}

function itemStackBand(item) {
  const stacks = Math.max(Number(item?.stackCount ?? 0), Number(item?.virtualStackCount ?? 0));
  if (stacks <= 1) {
    return "1";
  }
  if (stacks <= 3) {
    return "2-3";
  }
  if (stacks <= 7) {
    return "4-7";
  }
  return "8+";
}

function ratioBand(value) {
  if (!finite(value)) {
    return "unknown";
  }
  if (value < 0.25) {
    return "low";
  }
  if (value < 0.75) {
    return "medium";
  }
  return "high";
}

function expectedDamage(candidate) {
  if (candidate?.kind !== "move") {
    return 0;
  }
  const targetRows = candidate.derived?.targetOutcomes ?? [];
  if (targetRows.length > 0) {
    return targetRows.reduce((sum, row) => sum + Math.max(0, Number(row.expectedDamageMax ?? 0)), 0);
  }
  return Math.max(0, Number(candidate.derived?.expectedDamageMax ?? 0));
}

function moveObservation(decision, candidate) {
  const actor = actorObservation(decision);
  return (
    (actor?.moves ?? []).find(row => row.moveId === candidate?.moveId && row.slot === candidate?.moveSlot)
    ?? (actor?.moves ?? []).find(row => row.moveId === candidate?.moveId)
    ?? null
  );
}

// biome-ignore lint/complexity/useMaxParams: Aggregate dimensions stay explicit at the privacy boundary.
function addContextEntity(table, context, dictionaryHash, kind, value, extra, sourceId, outcome) {
  table.add(
    [...context, kind, dictionaryHash || "unknown", String(value), extra == null ? "" : String(extra)],
    sourceId,
    {
      outcome,
    },
  );
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The signature intentionally combines orthogonal tactics.
function battleStrategyLabels(decisions) {
  let switches = 0;
  let moves = 0;
  let damaging = 0;
  let status = 0;
  let drains = 0;
  let priority = 0;
  let spread = 0;
  let tera = 0;
  let setupThenAttack = false;
  const statusActors = new Set();
  for (const decision of decisions) {
    const chosen = chosenCandidate(decision);
    if (chosen?.kind === "switch") {
      switches++;
      continue;
    }
    if (chosen?.kind !== "move") {
      continue;
    }
    moves++;
    const move = moveObservation(decision, chosen);
    const actor = actorObservation(decision);
    const actorId = actor?.entityId ?? decision.actorSlot;
    if (Number(move?.power ?? 0) > 0) {
      damaging++;
      setupThenAttack ||= statusActors.has(actorId);
    } else {
      status++;
      statusActors.add(actorId);
    }
    drains += Number(chosen.derived?.hasDrain === true);
    priority += Number(Number(chosen.derived?.effectivePriority ?? move?.priority ?? 0) > 0);
    spread += Number((chosen.targets ?? []).length > 1);
    tera += Number(chosen.tera === true);
  }
  const labels = [];
  if (moves > 0 && damaging / moves >= 0.75 && switches === 0) {
    labels.push("direct-offense");
  }
  if (status >= 2 && status / Math.max(moves, 1) >= 0.35) {
    labels.push("status-heavy");
  }
  if (setupThenAttack) {
    labels.push("status-then-attack");
  }
  if (switches > 0) {
    labels.push(switches >= 2 ? "switch-heavy" : "one-switch");
  } else {
    labels.push("no-switch");
  }
  if (drains >= 2) {
    labels.push("drain-sustain");
  }
  if (priority >= 2) {
    labels.push("priority-heavy");
  }
  if (spread >= 2) {
    labels.push("spread-offense");
  }
  labels.push(tera > 0 ? "tera-used" : "no-tera");
  return uniqueValues(labels.length > 0 ? labels : ["mixed"]);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One battle pass prevents outcome and exposure double-counting.
function addDeepBattleExposures(tables, decisions, terminal, difficulty, gameMode, sourceId) {
  const first = decisions[0];
  if (first == null) {
    return;
  }
  const observation = first.observation ?? {};
  const context = combatContext(difficulty, gameMode, observation, terminal.wave);
  const dictionaryHash = first.dictionaryHash ?? "unknown";
  const outcome = terminal.outcome;
  const party = observation.selfParty ?? [];
  const species = uniqueValues(party.map(monIdentity)).sort();

  for (const identity of species) {
    const [speciesId, form] = identity.split(":");
    addContextEntity(tables.entityContext, context, dictionaryHash, "species", speciesId, form, sourceId, outcome);
  }
  for (const moveId of uniqueValues(
    decisions.map(decision => {
      const chosen = chosenCandidate(decision);
      return chosen?.kind === "move" ? chosen.moveId : null;
    }),
  )) {
    addContextEntity(tables.entityContext, context, dictionaryHash, "chosen-move", moveId, "", sourceId, outcome);
  }
  for (const mon of party) {
    const identity = monIdentity(mon);
    if (identity == null) {
      continue;
    }
    const [speciesId, form] = identity.split(":");
    for (const ability of activeAbilities(mon)) {
      addContextEntity(
        tables.entityContext,
        context,
        dictionaryHash,
        "ability",
        ability.abilityId,
        ability.source,
        sourceId,
        outcome,
      );
      tables.speciesAbilityContext.add(
        [...context, dictionaryHash, speciesId, form, String(ability.abilityId), ability.source],
        sourceId,
        { outcome },
      );
    }
    for (const item of activeItems(mon)) {
      addContextEntity(tables.entityContext, context, dictionaryHash, "item", item.itemId, "", sourceId, outcome);
      tables.itemStackContext.add([...context, dictionaryHash, item.itemId, itemStackBand(item)], sourceId, {
        outcome,
      });
      tables.speciesItemContext.add(
        [...context, dictionaryHash, speciesId, form, item.itemId, itemStackBand(item)],
        sourceId,
        { outcome },
      );
    }
    for (const move of mon.moves ?? []) {
      addContextEntity(
        tables.entityContext,
        context,
        dictionaryHash,
        "roster-move",
        move.moveId,
        "",
        sourceId,
        outcome,
      );
    }
  }

  for (let left = 0; left < species.length; left++) {
    for (let right = left + 1; right < species.length; right++) {
      const [leftSpecies, leftForm] = species[left].split(":");
      const [rightSpecies, rightForm] = species[right].split(":");
      tables.speciesPairContext.add(
        [...context, dictionaryHash, leftSpecies, leftForm, rightSpecies, rightForm],
        sourceId,
        { outcome },
      );
    }
  }

  const opponents = uniqueValues(
    decisions.flatMap(decision => (decision.observation?.opponentActive ?? []).map(monIdentity)),
  );
  for (const identity of opponents) {
    const [speciesId, form] = identity.split(":");
    tables.opponentThreatContext.add([...context, dictionaryHash, speciesId, form], sourceId, { outcome });
  }

  const matchups = uniqueValues(
    decisions.flatMap(decision => {
      const actor = actorObservation(decision);
      const self = monIdentity(actor);
      if (self == null) {
        return [];
      }
      return (decision.observation?.opponentActive ?? []).map(opponent => `${self}|${monIdentity(opponent)}`);
    }),
  );
  for (const matchup of matchups) {
    const [self, opponent] = matchup.split("|");
    const [selfSpecies, selfForm] = self.split(":");
    const [opponentSpecies, opponentForm] = opponent.split(":");
    tables.matchupContext.add(
      [...context, dictionaryHash, selfSpecies, selfForm, opponentSpecies, opponentForm],
      sourceId,
      { outcome },
    );
  }

  const nativeTypes = party.flatMap(mon => mon.nativeTypes ?? mon.types ?? []);
  const typeCounts = new Map();
  for (const type of nativeTypes) {
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const maxTypeShare = party.length > 0 ? Math.max(0, ...typeCounts.values()) / party.length : 0;
  const rosterMoves = party.flatMap(mon => mon.moves ?? []);
  const statusShare =
    rosterMoves.length > 0 ? rosterMoves.filter(move => Number(move.power ?? 0) <= 0).length / rosterMoves.length : 0;
  for (const [feature, value] of [
    ["party-size", String(party.length)],
    ["type-diversity", String(new Set(nativeTypes).size)],
    ["shared-type-concentration", ratioBand(maxTypeShare)],
    ["status-move-share", ratioBand(statusShare)],
    ["held-item-count", String(party.reduce((sum, mon) => sum + activeItems(mon).length, 0))],
  ]) {
    tables.teamShapeContext.add([...context, feature, value], sourceId, { outcome });
  }

  const fieldStates = uniqueValues(
    decisions.flatMap(decision => {
      const current = decision.observation ?? {};
      return [
        current.weather == null ? null : `weather:${current.weather.effectId}`,
        current.terrain == null ? null : `terrain:${current.terrain.effectId}`,
        ...(current.fieldEffects ?? []).map(effect => `field:${effect.effectId}:${effect.side ?? "field"}`),
        ...(current.positionalEffects ?? []).map(effect => `position:${effect.effectId}:${effect.side ?? "field"}`),
      ];
    }),
  );
  for (const state of fieldStates) {
    const [kind, effectId, side = "field"] = state.split(":");
    tables.fieldContext.add([...context, kind, effectId, side], sourceId, { outcome });
  }

  for (const label of battleStrategyLabels(decisions)) {
    tables.strategyContext.add([...context, label], sourceId, { outcome });
  }
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
      "entityContext",
      "opponentThreatContext",
      "speciesPairContext",
      "speciesItemContext",
      "speciesAbilityContext",
      "matchupContext",
      "itemStackContext",
      "teamShapeContext",
      "fieldContext",
      "strategyContext",
      "moveExecution",
      "moveTactic",
      "damageOpportunity",
      "lossSequence",
      "runProgress",
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
      tables.runProgress.add([difficulty, gameMode, tenWaveBand(Number(terminal.finalWave ?? 0))], sourceId, {
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
    const decisionsByJointAction = new Map();
    for (const decision of decisions) {
      const id = battleId(decision.jointActionId);
      if (id == null) {
        continue;
      }
      const rows = decisionsByBattle.get(id) ?? [];
      rows.push(decision);
      decisionsByBattle.set(id, rows);
      const jointRows = decisionsByJointAction.get(decision.jointActionId) ?? [];
      jointRows.push(decision);
      decisionsByJointAction.set(decision.jointActionId, jointRows);
    }
    const transitions = new Map((episode.transitions ?? []).map(transition => [transition.jointActionId, transition]));

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
      addDeepBattleExposures(tables, battleDecisions, terminal, difficulty, gameMode, sourceId);

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
        const sequence = battleDecisions
          .slice(-3)
          .map(decision => chosenCandidate(decision)?.kind ?? "missing")
          .join(">");
        tables.lossSequence.add(
          [difficulty, gameMode, formatName(last.observation?.format), waveBand(Number(terminal.wave ?? 0)), sequence],
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
      const context = combatContext(difficulty, gameMode, observation);
      const transition = transitions.get(decision.jointActionId);
      const cleanTransition =
        (decisionsByJointAction.get(decision.jointActionId) ?? []).length === 1 ? transition : null;
      const reward = cleanTransition?.rewards ?? {};
      const transitionSums = {
        damageDealtRatio: Number(reward.damageDealtRatio ?? 0),
        damageTaken: Number(reward.damageTaken ?? 0),
        healingDealtRatio: Number(reward.healingDealtRatio ?? 0),
        healingReceived: Number(reward.healingReceived ?? 0),
        statusChanges: Number(reward.statusChanges ?? 0),
        selfFaints: Number(reward.selfFaints ?? 0),
        opponentFaints: Number(reward.opponentFaints ?? 0),
        shieldSegmentsBroken: Number(reward.shieldSegmentsBroken ?? 0),
      };
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
        const move = moveObservation(decision, chosen);
        const qualityLabel = quality.immune
          ? "immune-target"
          : quality.zeroDamage
            ? "zero-damage"
            : quality.damaging
              ? "damaging"
              : "status";
        tables.moveChoiceQuality.add([...common, qualityLabel], sourceId, { outcome });

        if (cleanTransition != null) {
          tables.moveExecution.add(
            [...context, decision.dictionaryHash ?? "unknown", String(chosen.moveId)],
            sourceId,
            {
              outcome,
              sums: {
                ...transitionSums,
                expectedDamage: expectedDamage(chosen),
                targetCount: (chosen.targets ?? []).length,
              },
            },
          );
        }
        const tactics = [
          quality.damaging ? "damaging" : "status",
          ...(chosen.derived?.hasDrain ? ["drain"] : []),
          ...(chosen.derived?.hasRecoil ? ["recoil"] : []),
          ...(Number(chosen.derived?.effectivePriority ?? move?.priority ?? 0) > 0 ? ["priority"] : []),
          ...((chosen.targets ?? []).length > 1 ? ["spread"] : []),
          ...(chosen.derived?.requiresCharge ? ["charge"] : []),
          ...(chosen.derived?.forcesRecharge ? ["recharge"] : []),
          ...(chosen.derived?.createsMoveLock ? ["move-lock"] : []),
          ...(chosen.derived?.selfFaints ? ["self-faint"] : []),
          ...(chosen.currentStab ? ["stab"] : ["non-stab"]),
          ...(chosen.derived?.actsBeforeTargets === true ? ["acts-first"] : []),
        ];
        for (const tactic of uniqueValues(tactics)) {
          tables.moveTactic.add([...context, tactic], sourceId, {
            outcome,
            sums: cleanTransition == null ? {} : transitionSums,
          });
        }
      }

      const bestDamage = Math.max(0, ...(decision.candidates ?? []).map(expectedDamage));
      const chosenDamage = expectedDamage(chosen);
      let opportunity = "no-damage-option";
      if (bestDamage > 0) {
        if (chosen.kind === "switch") {
          opportunity = "switch-over-damage";
        } else if (chosen.kind !== "move" || Number(moveObservation(decision, chosen)?.power ?? 0) <= 0) {
          opportunity = "status-over-damage";
        } else if (chosenMoveQuality(decision, chosen).immune && chosenDamage < bestDamage) {
          opportunity = "immune-with-alternative";
        } else if (chosenDamage >= bestDamage * 0.9) {
          opportunity = "top-damage";
        } else if (chosenDamage < bestDamage * 0.25) {
          opportunity = "very-low-damage";
        } else {
          opportunity = "lower-damage";
        }
      }
      tables.damageOpportunity.add([...context, opportunity], sourceId, {
        outcome,
        sums: {
          chosenExpectedDamage: chosenDamage,
          bestExpectedDamage: bestDamage,
          ...(cleanTransition == null ? {} : transitionSums),
        },
      });
    }
  }

  function finish(metadata = {}) {
    return {
      reportVersion: 2,
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
