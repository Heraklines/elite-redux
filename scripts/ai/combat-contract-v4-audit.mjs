#!/usr/bin/env node

import { createHash } from "node:crypto";

const CONTRACT_VERSION = 4;
const TELEMETRY_SCHEMA_VERSION = 2;
const TOKEN_GROUPS = ["actor", "targets", "destination", "field", "action"];
const BATTLE_TERMINALS = new Set(["victory", "defeat", "capture", "flee", "abort", "invalid"]);
const RUN_TERMINALS = new Set(["victory", "player-wiped", "abandonment"]);
const POLICY_SOURCE = "human-v1";
const SPLIT_SEED = "er-human-telemetry-split-v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function auditId(value) {
  return sha256(`er-v4-semantic-audit:${String(value)}`).slice(0, 16);
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalTarget(target) {
  return `${target?.side === "self" ? "s" : "o"}${target?.entityId}@${target?.activeSlot}`;
}

export function canonicalCandidateId(candidate) {
  if (candidate?.kind === "move") {
    const targets = [...(candidate.targets ?? [])].map(canonicalTarget).sort().join(",");
    return [
      "move",
      `actor=${candidate.actorSlot}`,
      `slot=${candidate.moveSlot}`,
      `id=${candidate.moveId}`,
      `tera=${+candidate.tera}`,
      `targetMode=${candidate.targetMode}`,
      `targets=${targets}`,
    ].join(":");
  }
  if (candidate?.kind === "switch") {
    return `switch:actor=${candidate.actorSlot}:party=${candidate.partyIndex}:transfer=${candidate.transfer}`;
  }
  if (candidate?.kind === "shift") {
    return `shift:actor=${candidate.actorSlot}:target=${candidate.targetActorSlot}`;
  }
  return "invalid-candidate";
}

export function sourceSplit(sourcePartitionId) {
  const digest = createHash("sha256").update(`${SPLIT_SEED}:${sourcePartitionId}`).digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  return bucket < 0.7 ? "train" : bucket < 0.85 ? "validation" : "test";
}

function makeFindingStore() {
  return new Map();
}

function addFinding(store, code, example, amount = 1) {
  const finding = store.get(code) ?? { count: 0, examples: [] };
  finding.count += amount;
  const safeExample = example == null ? null : auditId(example);
  if (safeExample && finding.examples.length < 5 && !finding.examples.includes(safeExample)) {
    finding.examples.push(safeExample);
  }
  store.set(code, finding);
}

function serializeFindings(store) {
  return Object.fromEntries([...store.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function makeEpisode(envelope) {
  return {
    id: envelope.sessionId,
    sourcePartitionId: envelope.playerIdHash,
    split: sourceSplit(envelope.playerIdHash),
    envelopeIdentities: new Set(),
    contractIdentities: new Set(),
    batchDigests: new Map(),
    events: [],
    decisions: new Map(),
    auxiliaryDecisions: new Map(),
    transitions: new Map(),
    battleTerminals: new Map(),
    runTerminals: new Map(),
    hardFindings: makeFindingStore(),
    incompleteFindings: makeFindingStore(),
  };
}

function episodeFinding(episode, code, hard = true, example = episode.id) {
  addFinding(hard ? episode.hardFindings : episode.incompleteFindings, code, example);
}

function recordIdentity(record) {
  return [record?.schemaVersion, record?.buildSha, record?.dexHash, record?.dictionaryHash].join(":");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Independent schema invariants stay visible in one validator.
function validateObservation(observation, episode, context) {
  if (observation?.version !== CONTRACT_VERSION || observation?.perspective !== "self") {
    episodeFinding(episode, "invalid_observation_header", true, context);
    return;
  }
  if (!Array.isArray(observation.selfParty) || observation.selfParty.length === 0) {
    episodeFinding(episode, "missing_self_party", true, context);
  }
  if (!Array.isArray(observation.opponentActive) || observation.opponentActive.length === 0) {
    episodeFinding(episode, "missing_opponent_active", true, context);
  }
  const selfEntities = new Set();
  for (const mon of observation.selfParty ?? []) {
    if (selfEntities.has(mon.entityId)) {
      episodeFinding(episode, "duplicate_self_entity", true, context);
    }
    selfEntities.add(mon.entityId);
    if (mon.knowledge !== "self" || mon.stats == null || mon.effectiveStats == null || mon.heldItems == null) {
      episodeFinding(episode, "incomplete_self_state", true, context);
    }
  }
  const opponents = [...(observation.opponentActive ?? []), ...(observation.opponentKnownParty ?? [])];
  const opponentEntities = new Set();
  for (const mon of opponents) {
    if (opponentEntities.has(mon.entityId)) {
      episodeFinding(episode, "duplicate_opponent_entity", true, context);
    }
    opponentEntities.add(mon.entityId);
    if (
      mon.knowledge !== "battle-info"
      || mon.hp != null
      || mon.maxHp != null
      || mon.stats != null
      || mon.effectiveStats != null
    ) {
      episodeFinding(episode, "opponent_private_state_leak", true, context);
    }
    if (
      mon.abilities?.some(ability => ability.revealed !== true)
      || mon.heldItems?.some(item => item.revealed !== true)
    ) {
      episodeFinding(episode, "opponent_unrevealed_identity_leak", true, context);
    }
  }
  for (const mon of observation.opponentActive ?? []) {
    if (mon.heldItems == null || mon.revealState?.abilities !== "complete" || mon.revealState?.items !== "complete") {
      episodeFinding(episode, "incomplete_active_opponent_reveal", true, context);
    }
  }
  for (const mon of observation.opponentKnownParty ?? []) {
    if (mon.activeSlot != null || mon.hpRatio != null) {
      episodeFinding(episode, "opponent_bench_live_state_leak", true, context);
    }
  }
  if (observation.modifiers?.some(modifier => modifier.side === "opponent")) {
    episodeFinding(episode, "opponent_modifier_leak", true, context);
  }
  for (const action of observation.previousActions ?? []) {
    if (!Number.isInteger(action.turn) || action.turn > observation.turn) {
      episodeFinding(episode, "future_action_history", true, context);
    }
  }
}

function validateCandidateTargets(record, candidate, episode) {
  if (candidate.kind !== "move") {
    return;
  }
  const activeTargets = new Set([
    ...(record.observation.selfParty ?? [])
      .filter(mon => mon.activeSlot != null)
      .map(mon => `self:${mon.entityId}:${mon.activeSlot}`),
    ...(record.observation.opponentActive ?? []).map(mon => `opponent:${mon.entityId}:${mon.activeSlot}`),
  ]);
  for (const target of candidate.targets ?? []) {
    if (!activeTargets.has(`${target.side}:${target.entityId}:${target.activeSlot}`)) {
      episodeFinding(episode, "candidate_targets_non_active_entity", true, record.decisionId);
    }
  }
  const outcomeTargets = candidate.derived?.targetOutcomes ?? [];
  if (candidate.targetMode === "resolved" && outcomeTargets.length !== (candidate.targets ?? []).length) {
    episodeFinding(episode, "candidate_target_outcomes_incomplete", true, record.decisionId);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A training row is admitted only after every contract invariant passes.
function validateDecision(record, envelope, episode) {
  const context = record?.decisionId ?? episode.id;
  if (record?.schemaVersion !== CONTRACT_VERSION || record?.candidateScope !== "combat-command") {
    episodeFinding(episode, "invalid_decision_header", true, context);
  }
  if (record?.episodeId !== envelope.sessionId || record?.sourcePartitionId !== envelope.playerIdHash) {
    episodeFinding(episode, "decision_ownership_mismatch", true, context);
  }
  if (record?.splitGroupId !== envelope.sessionId) {
    episodeFinding(episode, "decision_split_group_mismatch", true, context);
  }
  if (record?.policySource !== POLICY_SOURCE || record?.policyTarget !== true) {
    episodeFinding(episode, "invalid_human_policy_target", true, context);
  }
  if (record?.decisionId !== `${record?.jointActionId}:${record?.actorSlot}`) {
    episodeFinding(episode, "unstable_decision_id", true, context);
  }
  if (typeof record?.jointActionId !== "string" || !record.jointActionId.startsWith(`${record.episodeId}:`)) {
    episodeFinding(episode, "unstable_joint_action_id", true, context);
  }
  validateObservation(record?.observation, episode, context);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  const candidateIds = candidates.map(candidate => candidate?.id);
  const candidateSet = new Set(candidateIds);
  if (candidates.length === 0 || candidateSet.size !== candidates.length) {
    episodeFinding(episode, "invalid_candidate_set", true, context);
  }
  for (const candidate of candidates) {
    if (candidate?.id !== canonicalCandidateId(candidate) || candidate?.actorSlot !== record.actorSlot) {
      episodeFinding(episode, "noncanonical_candidate", true, context);
    }
    validateCandidateTargets(record, candidate, episode);
  }
  if (candidateIds.filter(candidateId => candidateId === record?.chosenCandidateId).length !== 1) {
    episodeFinding(episode, "chosen_candidate_not_exactly_once", true, context);
  }
  if ((record?.earlierCandidateIds ?? []).some(candidateId => candidateSet.has(candidateId))) {
    episodeFinding(episode, "same_turn_candidate_reuse", true, context);
  }
  const featureRows = Array.isArray(record?.candidateFeatures) ? record.candidateFeatures : [];
  const featureIds = featureRows.map(row => row?.candidateId);
  if (
    featureRows.length !== candidates.length
    || new Set(featureIds).size !== candidates.length
    || candidateIds.some(candidateId => !featureIds.includes(candidateId))
    || featureRows.some(
      row => !Array.isArray(row?.values) || row.values.length === 0 || row.values.some(value => !finiteNumber(value)),
    )
  ) {
    episodeFinding(episode, "candidate_feature_mapping_invalid", true, context);
  }
  const tokenRows = Array.isArray(record?.candidateTokenGroups) ? record.candidateTokenGroups : [];
  const tokenIds = tokenRows.map(row => row?.candidateId);
  if (
    tokenRows.length !== candidates.length
    || new Set(tokenIds).size !== candidates.length
    || candidateIds.some(candidateId => !tokenIds.includes(candidateId))
  ) {
    episodeFinding(episode, "candidate_token_mapping_invalid", true, context);
  }
  for (const row of tokenRows) {
    for (const group of TOKEN_GROUPS) {
      if (
        !Array.isArray(row?.groups?.[group])
        || row.groups[group].some(token => typeof token !== "string" || token === "")
      ) {
        episodeFinding(episode, "candidate_token_group_invalid", true, context);
      }
    }
    if ((row?.groups?.action ?? []).length === 0) {
      episodeFinding(episode, "candidate_action_tokens_missing", true, context);
    }
  }
}

function validateAuxiliaryDecision(record, envelope, episode) {
  const context = record?.decisionId ?? episode.id;
  if (
    record?.schemaVersion !== CONTRACT_VERSION
    || record?.candidateScope !== "non-policy-battle-command"
    || record?.policyTarget !== false
  ) {
    episodeFinding(episode, "invalid_auxiliary_header", true, context);
  }
  if (record?.episodeId !== envelope.sessionId || record?.sourcePartitionId !== envelope.playerIdHash) {
    episodeFinding(episode, "auxiliary_ownership_mismatch", true, context);
  }
  if (record?.decisionId !== `${record?.jointActionId}:${record?.actorSlot}`) {
    episodeFinding(episode, "unstable_auxiliary_id", true, context);
  }
  if (!new Set(["ball", "run"]).has(record?.action?.kind)) {
    episodeFinding(episode, "invalid_auxiliary_action", true, context);
  }
  validateObservation(record?.observation, episode, context);
}

function validateTransition(record, envelope, episode) {
  const context = record?.transitionId ?? episode.id;
  if (record?.schemaVersion !== CONTRACT_VERSION || record?.episodeId !== envelope.sessionId) {
    episodeFinding(episode, "invalid_transition_header", true, context);
  }
  if (record?.transitionId !== `${record?.jointActionId}:resolved`) {
    episodeFinding(episode, "unstable_transition_id", true, context);
  }
  if (
    !Array.isArray(record?.decisionIds)
    || record.decisionIds.length === 0
    || new Set(record.decisionIds).size !== record.decisionIds.length
  ) {
    episodeFinding(episode, "invalid_transition_decision_ids", true, context);
  }
  if (record?.battleTerminal != null && !BATTLE_TERMINALS.has(record.battleTerminal)) {
    episodeFinding(episode, "invalid_transition_terminal", true, context);
  }
  const rewards = record?.rewards ?? {};
  const rewardKeys = [
    "damageDealtRatio",
    "damageTaken",
    "healingDealtRatio",
    "healingReceived",
    "statusChanges",
    "selfFaints",
    "opponentFaints",
    "shieldSegmentsBroken",
    "terminal",
  ];
  if (rewardKeys.some(key => !finiteNumber(rewards[key]))) {
    episodeFinding(episode, "nonfinite_transition_reward", true, context);
  }
  const expectedTerminalReward = new Set(["victory", "capture", "flee"]).has(record?.battleTerminal)
    ? 1
    : record?.battleTerminal === "defeat"
      ? -1
      : 0;
  if (rewards.terminal !== expectedTerminalReward) {
    episodeFinding(episode, "terminal_reward_mismatch", true, context);
  }
  validateObservation(record?.resolvedObservation, episode, context);
}

function validateBattleTerminal(record, event, envelope, episode) {
  const context = record?.terminalId ?? episode.id;
  if (
    record?.schemaVersion !== CONTRACT_VERSION
    || record?.episodeId !== envelope.sessionId
    || !BATTLE_TERMINALS.has(record?.outcome)
    || event?.outcome !== record?.outcome
  ) {
    episodeFinding(episode, "invalid_battle_terminal", true, context);
  }
  if (record?.terminalId !== `${record?.battleId}:terminal`) {
    episodeFinding(episode, "unstable_battle_terminal_id", true, context);
  }
}

function validateRunTerminal(record, event, envelope, episode) {
  const context = record?.episodeId ?? episode.id;
  if (
    record?.schemaVersion !== CONTRACT_VERSION
    || record?.episodeId !== envelope.sessionId
    || record?.sourcePartitionId !== envelope.playerIdHash
    || record?.splitGroupId !== envelope.sessionId
    || !RUN_TERMINALS.has(record?.outcome)
    || event?.outcome !== record?.outcome
    || record?.truncated !== false
  ) {
    episodeFinding(episode, "invalid_run_terminal", true, context);
  }
}

function addUniqueRecord(map, key, record, episode, duplicateCode, conflictCode) {
  const digest = sha256(JSON.stringify(record));
  const previous = map.get(key);
  if (previous == null) {
    map.set(key, { record, digest, references: 0 });
    return true;
  }
  episodeFinding(episode, previous.digest === digest ? duplicateCode : conflictCode, true, key);
  return false;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Corpus joins are intentionally audited together at the episode boundary.
function finishEpisode(episode, globalFindings) {
  if (episode.envelopeIdentities.size !== 1) {
    episodeFinding(episode, "mixed_envelope_identity");
  }
  if (episode.contractIdentities.size !== 1) {
    episodeFinding(episode, "mixed_contract_identity");
  }
  const orderedEvents = [...episode.events].sort((left, right) => left.seq - right.seq || left.index - right.index);
  for (let index = 1; index < orderedEvents.length; index++) {
    if (orderedEvents[index].t < orderedEvents[index - 1].t) {
      episodeFinding(episode, "nonmonotonic_event_time", false, episode.id);
      break;
    }
  }
  const allDecisions = new Map([...episode.decisions, ...episode.auxiliaryDecisions]);
  for (const { record: transition } of episode.transitions.values()) {
    for (const decisionId of transition.decisionIds ?? []) {
      const decision = allDecisions.get(decisionId);
      if (decision == null) {
        episodeFinding(episode, "transition_references_missing_decision", true, transition.transitionId);
        continue;
      }
      decision.references++;
      if (decision.record.jointActionId !== transition.jointActionId) {
        episodeFinding(episode, "transition_joint_action_mismatch", true, transition.transitionId);
      }
    }
  }
  for (const [decisionId, decision] of allDecisions) {
    if (decision.references === 0) {
      episodeFinding(episode, "decision_missing_transition", true, decisionId);
    } else if (decision.references > 1) {
      episodeFinding(episode, "decision_joined_multiple_times", true, decisionId);
    }
  }
  for (const { record: terminal } of episode.battleTerminals.values()) {
    if (terminal.transitionId != null) {
      const transition = episode.transitions.get(terminal.transitionId)?.record;
      if (transition == null) {
        episodeFinding(episode, "battle_terminal_missing_transition", true, terminal.terminalId);
      } else if (transition.battleTerminal !== terminal.outcome) {
        episodeFinding(episode, "battle_terminal_transition_mismatch", true, terminal.terminalId);
      }
    }
  }
  if (episode.runTerminals.size === 0) {
    episodeFinding(episode, "missing_run_terminal", false, episode.id);
  } else if (episode.runTerminals.size > 1) {
    episodeFinding(episode, "multiple_run_terminals", true, episode.id);
  }
  for (const [code, finding] of episode.hardFindings) {
    addFinding(globalFindings.hard, code, episode.id, finding.count);
  }
  for (const [code, finding] of episode.incompleteFindings) {
    addFinding(globalFindings.incomplete, code, episode.id, finding.count);
  }
  const hardQuarantined = episode.hardFindings.size > 0;
  const terminalComplete = episode.runTerminals.size === 1;
  const runOutcome = terminalComplete ? [...episode.runTerminals.values()][0].record.outcome : null;
  return {
    hardQuarantined,
    terminalComplete,
    policyDiagnosticEligible: !hardQuarantined,
    completedOutcomeEligible: !hardQuarantined && terminalComplete,
    winningPolicyEligible: !hardQuarantined && terminalComplete && runOutcome === "victory",
    runOutcome,
  };
}

export function createCombatContractV4Audit() {
  const episodes = new Map();
  const sourcePartitions = new Map();
  const globalPayloads = new Map();
  const globalFindings = { hard: makeFindingStore(), incomplete: makeFindingStore() };
  const counts = {
    batches: 0,
    events: 0,
    ignoredEvents: 0,
    records: {},
    modes: {},
    difficulties: {},
    gameModes: {},
    envelopeSchemas: {},
    contractVersions: {},
    builds: {},
    buildShas: {},
    dictionaryHashes: {},
    dexHashes: {},
    featureSchemaVersions: {},
    policySources: {},
    battleTypes: {},
    formats: {},
    battleOutcomes: {},
    runOutcomes: {},
    exactDuplicateBatches: 0,
    conflictingBatchSequences: 0,
    repeatedPayloads: 0,
  };

  function invalidBatch(code, batch, example) {
    addFinding(globalFindings.hard, code, example ?? batch?.envelope?.sessionId ?? "invalid-batch");
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One streaming pass classifies every supported wire event.
  function ingestBatch(batch) {
    counts.batches++;
    const envelope = batch?.envelope;
    if (
      !envelope?.sessionId
      || !envelope?.playerIdHash
      || !Array.isArray(batch?.events)
      || !Number.isInteger(batch?.seq)
    ) {
      invalidBatch("invalid_batch_envelope", batch);
      return;
    }
    let episode = episodes.get(envelope.sessionId);
    if (episode == null) {
      episode = makeEpisode(envelope);
      episodes.set(envelope.sessionId, episode);
      sourcePartitions.set(envelope.playerIdHash, sourceSplit(envelope.playerIdHash));
      increment(counts.modes, String(envelope.mode ?? "unknown"));
      increment(counts.difficulties, String(envelope.difficulty ?? "unknown"));
      increment(counts.gameModes, String(envelope.gameModeId ?? "unknown"));
      increment(counts.envelopeSchemas, String(envelope.schemaVersion ?? "unknown"));
      increment(counts.contractVersions, String(envelope.combatContractVersion ?? "unknown"));
      increment(counts.builds, String(envelope.build ?? "unknown"));
    }
    if (episode.sourcePartitionId !== envelope.playerIdHash) {
      episodeFinding(episode, "session_source_partition_changed");
    }
    episode.envelopeIdentities.add(
      [
        envelope.schemaVersion,
        envelope.combatContractVersion,
        envelope.playerIdHash,
        envelope.mode,
        envelope.gameModeId,
        envelope.build,
        envelope.erVersion,
        envelope.seed,
        envelope.difficulty,
      ].join(":"),
    );
    if (envelope.schemaVersion !== TELEMETRY_SCHEMA_VERSION || envelope.combatContractVersion !== CONTRACT_VERSION) {
      episodeFinding(episode, "unsupported_envelope_version");
    }
    if (envelope.mode !== "solo") {
      episodeFinding(episode, "non_solo_contract_capture");
    }
    const payloadDigest = sha256(JSON.stringify(batch));
    const priorPayload = globalPayloads.get(payloadDigest);
    if (priorPayload != null && priorPayload !== `${envelope.sessionId}:${batch.seq}`) {
      counts.repeatedPayloads++;
      episodeFinding(episode, "payload_repeated_across_batch_identity");
    } else {
      globalPayloads.set(payloadDigest, `${envelope.sessionId}:${batch.seq}`);
    }
    const priorBatchDigest = episode.batchDigests.get(batch.seq);
    if (priorBatchDigest != null) {
      if (priorBatchDigest === payloadDigest) {
        counts.exactDuplicateBatches++;
        return;
      }
      counts.conflictingBatchSequences++;
      episodeFinding(episode, "conflicting_batch_sequence");
      return;
    }
    episode.batchDigests.set(batch.seq, payloadDigest);

    for (const [eventIndex, event] of batch.events.entries()) {
      counts.events++;
      episode.events.push({ seq: batch.seq, index: eventIndex, t: finiteNumber(event?.t) ? event.t : -1 });
      if (!finiteNumber(event?.t) || !Number.isInteger(event?.wave)) {
        episodeFinding(episode, "invalid_event_anchor", true, `${envelope.sessionId}:${batch.seq}:${eventIndex}`);
      }
      const record = event?.record;
      if (record?.schemaVersion === CONTRACT_VERSION) {
        episode.contractIdentities.add(recordIdentity(record));
        increment(counts.buildShas, String(record.buildSha ?? "unknown"));
        increment(counts.dictionaryHashes, String(record.dictionaryHash ?? "unknown"));
        increment(counts.dexHashes, String(record.dexHash ?? "unknown"));
      }
      if (event?.kind === "combat_contract_decision" && record?.kind === "combat_decision") {
        increment(counts.records, "combat_decision");
        increment(counts.policySources, String(record.policySource ?? "unknown"));
        increment(counts.featureSchemaVersions, String(record.featureSchemaVersion ?? "unknown"));
        increment(counts.battleTypes, String(record.observation?.battleType ?? "unknown"));
        increment(counts.formats, String(record.observation?.format ?? "unknown"));
        validateDecision(record, envelope, episode);
        addUniqueRecord(
          episode.decisions,
          record.decisionId,
          record,
          episode,
          "duplicate_decision",
          "conflicting_decision",
        );
      } else if (event?.kind === "combat_auxiliary_decision" && record?.kind === "combat_auxiliary_decision") {
        increment(counts.records, "combat_auxiliary_decision");
        validateAuxiliaryDecision(record, envelope, episode);
        addUniqueRecord(
          episode.auxiliaryDecisions,
          record.decisionId,
          record,
          episode,
          "duplicate_auxiliary_decision",
          "conflicting_auxiliary_decision",
        );
      } else if (event?.kind === "combat_contract_transition" && record?.kind === "combat_transition") {
        increment(counts.records, "combat_transition");
        validateTransition(record, envelope, episode);
        addUniqueRecord(
          episode.transitions,
          record.transitionId,
          record,
          episode,
          "duplicate_transition",
          "conflicting_transition",
        );
      } else if (event?.kind === "battle_terminal" && record?.kind === "battle_terminal") {
        increment(counts.records, "battle_terminal");
        increment(counts.battleOutcomes, String(record.outcome ?? "unknown"));
        validateBattleTerminal(record, event, envelope, episode);
        addUniqueRecord(
          episode.battleTerminals,
          record.terminalId,
          record,
          episode,
          "duplicate_battle_terminal",
          "conflicting_battle_terminal",
        );
      } else if (event?.kind === "run_outcome" && record?.kind === "run_terminal") {
        increment(counts.records, "run_terminal");
        increment(counts.runOutcomes, String(record.outcome ?? "unknown"));
        validateRunTerminal(record, event, envelope, episode);
        addUniqueRecord(
          episode.runTerminals,
          `${record.episodeId}:${record.outcome}`,
          record,
          episode,
          "duplicate_run_terminal",
          "conflicting_run_terminal",
        );
      } else {
        counts.ignoredEvents++;
      }
    }
  }

  function finish(extra = {}) {
    const eligibility = {
      hardQuarantinedEpisodes: 0,
      incompleteEpisodes: 0,
      policyDiagnosticEligibleEpisodes: 0,
      completedOutcomeEligibleEpisodes: 0,
      winningPolicyEligibleEpisodes: 0,
      completedOutcomes: {},
      sourceSplits: { train: 0, validation: 0, test: 0 },
    };
    for (const split of sourcePartitions.values()) {
      eligibility.sourceSplits[split]++;
    }
    for (const episode of episodes.values()) {
      const result = finishEpisode(episode, globalFindings);
      eligibility.hardQuarantinedEpisodes += Number(result.hardQuarantined);
      eligibility.incompleteEpisodes += Number(!result.terminalComplete);
      eligibility.policyDiagnosticEligibleEpisodes += Number(result.policyDiagnosticEligible);
      eligibility.completedOutcomeEligibleEpisodes += Number(result.completedOutcomeEligible);
      eligibility.winningPolicyEligibleEpisodes += Number(result.winningPolicyEligible);
      if (result.runOutcome != null) {
        increment(eligibility.completedOutcomes, result.runOutcome);
      }
    }
    const report = {
      reportVersion: 1,
      contractVersion: CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      privacy: {
        rawCorpusUploaded: false,
        rawIdentifiersIncluded: false,
        exampleIds: "salted SHA-256 prefixes only",
      },
      corpus: {
        ...extra,
        ...counts,
        episodes: episodes.size,
        sourcePartitions: sourcePartitions.size,
      },
      eligibility,
      findings: {
        hard: serializeFindings(globalFindings.hard),
        incomplete: serializeFindings(globalFindings.incomplete),
      },
    };
    return report;
  }

  return { ingestBatch, finish };
}

export function auditCombatContractV4Batches(batches, extra = {}) {
  const audit = createCombatContractV4Audit();
  for (const batch of batches) {
    audit.ingestBatch(batch);
  }
  return audit.finish(extra);
}
