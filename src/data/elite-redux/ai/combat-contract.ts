/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Incompatible observation/candidate changes must bump this version. */
export const ER_COMBAT_CONTRACT_VERSION = 4;

/** The first training slice scores battle commands, not balls, run, or run-management choices. */
export type ErCombatCandidateScope = "combat-command";

export type ErCombatKnowledge = "self" | "battle-info";

export type ErCombatKnowledgeCompleteness = "unknown" | "partial" | "complete";

export type ErCombatStateValue = string | number | boolean | null;

export interface ErCombatStateField {
  key: string;
  value: ErCombatStateValue;
}

export interface ErCombatAbilityObservation {
  abilityId: number;
  source: "active" | "innate" | "gift";
  slot: number | null;
  active: boolean;
  suppressed: boolean;
  overridden: boolean;
  revealed: boolean;
}

export interface ErCombatItemObservation {
  itemId: string;
  className: string;
  stackCount: number;
  virtualStackCount: number;
  charges: number | null;
  consumed: boolean | null;
  active: boolean;
  suppressed: boolean;
  revealed: boolean;
  state: ErCombatStateField[];
}

export interface ErCombatEffectObservation {
  effectId: string;
  scope: "battler" | "side" | "field" | "position" | "mechanic";
  side: "self" | "opponent" | "both" | null;
  turnsLeft: number | null;
  maxDuration: number | null;
  sourceMoveId: number | null;
  sourceEntityId: number | null;
  targetSlot: number | null;
  state: ErCombatStateField[];
}

export interface ErCombatModifierObservation {
  modifierId: string;
  className: string;
  side: "self" | "opponent";
  scope: "pokemon" | "team" | "run";
  ownerEntityId: number | null;
  stackCount: number;
  virtualStackCount: number;
  active: boolean;
  state: ErCombatStateField[];
}

export interface ErCombatTimedFieldObservation {
  effectId: number;
  turnsLeft: number;
  maxDuration: number;
  immutable: boolean;
  suppressed: boolean;
  sourceEntityId: number | null;
  owner: "self" | "opponent" | "field";
}

export interface ErCombatRevealState {
  abilities: ErCombatKnowledgeCompleteness;
  items: ErCombatKnowledgeCompleteness;
  moves: ErCombatKnowledgeCompleteness;
  revealedAbilityIds: number[];
  revealedItemIds: string[];
  revealedMoveIds: number[];
}

export interface ErCombatTransformationObservation {
  teraType: number | null;
  terastallized: boolean;
  teraAvailable: boolean | null;
  formChanged: boolean;
  formTransition: {
    fromSpecies: number;
    fromForm: number;
    toSpecies: number;
    toForm: number;
  } | null;
}

export interface ErCombatBossObservation {
  segments: number;
  segmentIndex: number;
  phase: number | null;
}

export interface ErCombatMoveObservation {
  slot: number | null;
  moveId: number;
  baseType: number;
  type: number;
  category: number;
  power: number;
  accuracy: number;
  priority: number;
  ppUsed: number | null;
  maxPp: number | null;
  usable: boolean | null;
  /** Stable machine-readable codes only; localized/UI text is never telemetry. */
  unavailableReasons: string[];
  revealed: boolean;
}

export interface ErCombatPreviousActionObservation {
  actionId: string;
  jointActionId: string;
  turn: number;
  side: "self" | "opponent";
  actorEntityId: number;
  actorSlot: number;
  phase: "committed" | "resolved";
  kind: "move" | "switch" | "shift" | "ball" | "run" | "forced";
  automatic: boolean;
  moveId: number | null;
  moveSlot: number | null;
  partyIndex: number | null;
  transfer: "normal" | "baton" | null;
  tera: boolean;
  targets: ErCombatTargetRef[];
  /** Numeric engine result enum when known; null for non-moves or unresolved actions. */
  result: number | null;
  /** Zero-based actual move execution order after resolution; null before resolution/non-move. */
  resolutionOrder: number | null;
}

export interface ErCombatMonObservation {
  entityId: number;
  knowledge: ErCombatKnowledge;
  partyIndex: number | null;
  activeSlot: number | null;
  species: number;
  form: number;
  originalSpecies: number;
  originalForm: number;
  level: number;
  /** Permanent species/custom/fusion typing, before Tera and in-battle overrides. */
  nativeTypes: number[];
  /** Live defensive typing, including Tera and temporary additions/removals. */
  types: number[];
  /** Exact HP totals are private for opponents; the public health-bar ratio is always present. */
  hp: number | null;
  maxHp: number | null;
  hpRatio: number | null;
  status: number | null;
  statStages: number[];
  /** Exact opponent stats are hidden; species/form are sufficient to construct a belief state. */
  stats: number[] | null;
  effectiveStats: number[] | null;
  abilities: ErCombatAbilityObservation[];
  /** Null means unrevealed, while an empty array means publicly known to hold nothing. */
  heldItems: ErCombatItemObservation[] | null;
  revealState: ErCombatRevealState;
  tags: ErCombatEffectObservation[];
  mechanics: ErCombatEffectObservation[];
  transformation: ErCombatTransformationObservation;
  boss: ErCombatBossObservation;
  moves: ErCombatMoveObservation[];
  fainted: boolean;
}

export interface ErCombatObservation {
  version: typeof ER_COMBAT_CONTRACT_VERSION;
  perspective: "self";
  wave: number;
  turn: number;
  biome: number;
  battleType: number;
  format: number;
  weather: ErCombatTimedFieldObservation | null;
  terrain: ErCombatTimedFieldObservation | null;
  fieldEffects: ErCombatEffectObservation[];
  positionalEffects: ErCombatEffectObservation[];
  /** Battle-wide ER counters and other public/self-owned mechanics not attached to an arena tag. */
  mechanics: ErCombatEffectObservation[];
  modifiers: ErCombatModifierObservation[];
  selfParty: ErCombatMonObservation[];
  opponentActive: ErCombatMonObservation[];
  /** Previously fielded opponent party members; no unrevealed bench identity or live hidden stats. */
  opponentKnownParty: ErCombatMonObservation[];
  /** Public roster size only. No unobserved opponent bench entity is serialized. */
  opponentRosterSize: number;
  playerTerasUsed: number;
  /** Bounded, structured history. It never contains UI text or unrevealed opponent state. */
  previousActions: ErCombatPreviousActionObservation[];
}

export interface ErCombatTargetRef {
  side: "self" | "opponent";
  entityId: number;
  activeSlot: number;
}

interface ErCombatCandidateBase {
  id: string;
  actorSlot: number;
}

export interface ErCombatMoveCandidate extends ErCombatCandidateBase {
  kind: "move";
  moveSlot: number;
  moveId: number;
  tera: boolean;
  targetMode: "resolved" | "random";
  targets: ErCombatTargetRef[];
  /** Public, engine-derived baseline features; neither participates in candidate identity. */
  baseTypeMultiplier: number;
  currentStab: boolean;
  /** Derived only from information available to the player; unknown values stay null. */
  derived: {
    effectivePriority: number;
    actsBeforeTargets: boolean | null;
    orderAssessment: "before" | "after" | "tie" | "opponent-action-unknown" | "not-applicable";
    engineTypeMultiplier: number | null;
    /** One engine-derived consequence row per resolved/possible target. */
    targetOutcomes: {
      target: ErCombatTargetRef;
      engineTypeMultiplier: number | null;
      expectedDamageMin: number | null;
      expectedDamageMax: number | null;
      expectedCriticalDamage: number | null;
      immunityReason: string | null;
    }[];
    expectedDamageMin: number | null;
    expectedDamageMax: number | null;
    expectedCriticalDamage: number | null;
    expectedHits: number | null;
    minHits: number | null;
    maxHits: number | null;
    immunityReason: string | null;
    hasDrain: boolean;
    drainFraction: number | null;
    hasRecoil: boolean;
    recoilFraction: number | null;
    statusChance: number | null;
    requiresCharge: boolean;
    forcesRecharge: boolean;
    createsMoveLock: boolean;
    moveLockReason: string | null;
    selfFaints: boolean;
  };
}

export interface ErCombatSwitchCandidate extends ErCombatCandidateBase {
  kind: "switch";
  partyIndex: number;
  transfer: "normal" | "baton";
}

export interface ErCombatShiftCandidate extends ErCombatCandidateBase {
  kind: "shift";
  targetActorSlot: number;
}

export type ErCombatCandidate = ErCombatMoveCandidate | ErCombatSwitchCandidate | ErCombatShiftCandidate;
export type ErCombatCandidateInput = ErCombatCandidate extends infer Candidate
  ? Candidate extends ErCombatCandidate
    ? Omit<Candidate, "id">
    : never
  : never;

export const ER_COMBAT_TOKEN_GROUP_NAMES = ["actor", "targets", "destination", "field", "action"] as const;
export type ErCombatTokenGroupName = (typeof ER_COMBAT_TOKEN_GROUP_NAMES)[number];
export type ErCombatCandidateTokenGroups = Record<ErCombatTokenGroupName, string[]>;

export interface ErCombatCandidateTokenRow {
  candidateId: string;
  groups: ErCombatCandidateTokenGroups;
}

export type ErCombatPolicySource =
  | "human-v1"
  | "smart-default-v1"
  | "scripted"
  | "forced-move"
  | "first-usable"
  | "random-v1"
  | "tree-model-v1"
  | "epsilon-tree-v1"
  | "diagnostic-tree-v1"
  | "checkpoint-tree-v1"
  | "engine-hardest-v1"
  | "neural-model-v2"
  | "epsilon-neural-v2"
  | "trajectory-neural-v3"
  | "epsilon-trajectory-neural-v3"
  | "checkpoint-neural-v4"
  | "search-relabel-v1"
  | "advantage-relabel-v1";

/** Sources that are useful as opponents/baselines but must never become policy labels. */
export const ER_NON_POLICY_TARGET_SOURCES: ReadonlySet<ErCombatPolicySource> = new Set([
  "smart-default-v1",
  "scripted",
  "forced-move",
  "first-usable",
  "random-v1",
  "tree-model-v1",
  "epsilon-tree-v1",
  "diagnostic-tree-v1",
  "engine-hardest-v1",
]);

export interface ErCombatDecisionRecord {
  kind: "combat_decision";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  candidateScope: ErCombatCandidateScope;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  /** Matchup-level split identity; inverse legs must share this value. */
  splitGroupId?: string;
  /** Roster-disjoint partition identity used for honest offline train/test and OOF splits. */
  sourcePartitionId?: string;
  jointActionId: string;
  decisionId: string;
  policySource: ErCombatPolicySource;
  /** False keeps the row available to value learning and evaluation while excluding it from policy loss. */
  policyTarget: boolean;
  actorSlot: number;
  earlierCandidateIds: string[];
  observation: ErCombatObservation;
  candidates: ErCombatCandidate[];
  featureSchemaVersion: number;
  candidateFeatures: { candidateId: string; values: number[] }[];
  candidateTokenGroups: ErCombatCandidateTokenRow[];
  chosenCandidateId: string;
}

export type ErCombatAuxiliaryAction =
  | { kind: "ball"; ballIndex: number; targets: ErCombatTargetRef[] }
  | { kind: "run" };

/** Human battle input retained for transitions/value work but deliberately excluded from policy loss. */
export interface ErCombatAuxiliaryDecisionRecord {
  kind: "combat_auxiliary_decision";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  candidateScope: "non-policy-battle-command";
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  sourcePartitionId?: string;
  jointActionId: string;
  decisionId: string;
  actorSlot: number;
  policyTarget: false;
  observation: ErCombatObservation;
  action: ErCombatAuxiliaryAction;
}

export interface ErCombatTerminalRecord {
  kind: "run_terminal";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  splitGroupId?: string;
  sourcePartitionId?: string;
  outcome: string;
  startWave: number;
  finalWave: number;
  wavesCleared: number;
  truncated: boolean;
}

export type ErCombatBattleTerminal = "victory" | "defeat" | "capture" | "flee" | "abort" | "invalid";

/** One stable terminal row per solo battle, independent of whether its last action was a policy target. */
export interface ErCombatBattleTerminalRecord {
  kind: "battle_terminal";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  battleId: string;
  terminalId: string;
  wave: number;
  turn: number;
  outcome: ErCombatBattleTerminal;
  jointActionId: string | null;
  transitionId: string | null;
}

export interface ErCombatRewardComponents {
  damageDealtRatio: number;
  damageTaken: number;
  healingDealtRatio: number;
  healingReceived: number;
  statusChanges: number;
  selfFaints: number;
  opponentFaints: number;
  shieldSegmentsBroken: number;
  terminal: number;
}

/** Resolved successor for a committed joint action. */
export interface ErCombatTransitionRecord {
  kind: "combat_transition";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  jointActionId: string;
  transitionId: string;
  decisionIds: string[];
  resolvedObservation: ErCombatObservation;
  rewards: ErCombatRewardComponents;
  battleTerminal: ErCombatBattleTerminal | null;
}

export type ErCombatDatasetRecord =
  | ErCombatDecisionRecord
  | ErCombatAuxiliaryDecisionRecord
  | ErCombatTransitionRecord
  | ErCombatBattleTerminalRecord
  | ErCombatTerminalRecord;

function targetKey(target: ErCombatTargetRef): string {
  return `${target.side[0]}${target.entityId}@${target.activeSlot}`;
}

/** Stable semantic identity: candidate order may change without changing a label. */
export function canonicalCombatCandidateId(candidate: ErCombatCandidateInput): string {
  switch (candidate.kind) {
    case "move": {
      const targets = [...candidate.targets].map(targetKey).sort().join(",");
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
    case "switch":
      return `switch:actor=${candidate.actorSlot}:party=${candidate.partyIndex}:transfer=${candidate.transfer}`;
    case "shift":
      return `shift:actor=${candidate.actorSlot}:target=${candidate.targetActorSlot}`;
  }
}

export function withCanonicalCombatCandidateId<T extends ErCombatCandidateInput>(candidate: T): T & { id: string } {
  return { ...candidate, id: canonicalCombatCandidateId(candidate) };
}

export function committedTurnTargetIndices(command: {
  targets?: readonly number[] | undefined;
  move?:
    | {
        move?: number | undefined;
        targets?: readonly number[] | undefined;
        useMode?: number | undefined;
      }
    | undefined;
}): readonly number[] {
  return command.targets ?? command.move?.targets ?? [];
}

/** Fail closed before a malformed row becomes training data. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each branch independently validates one contract invariant.
export function validateCombatDecisionRecord(record: ErCombatDecisionRecord): string[] {
  const errors: string[] = [];
  if (record.schemaVersion !== ER_COMBAT_CONTRACT_VERSION) {
    errors.push(`unsupported schema version ${record.schemaVersion}`);
  }
  if (record.observation.version !== ER_COMBAT_CONTRACT_VERSION) {
    errors.push(`unsupported observation version ${record.observation.version}`);
  }
  if (record.policyTarget && ER_NON_POLICY_TARGET_SOURCES.has(record.policySource)) {
    errors.push(`${record.policySource} cannot be a policy target`);
  }
  for (const opponent of [...record.observation.opponentActive, ...record.observation.opponentKnownParty]) {
    if (opponent.heldItems?.some(item => !item.revealed)) {
      errors.push(`unrevealed opponent held item crossed the visibility boundary for entity ${opponent.entityId}`);
    }
    if (opponent.abilities.some(ability => !ability.revealed)) {
      errors.push(`unrevealed opponent ability crossed the visibility boundary for entity ${opponent.entityId}`);
    }
    if (opponent.hp != null || opponent.maxHp != null || opponent.stats != null || opponent.effectiveStats != null) {
      errors.push(`hidden opponent stats crossed the visibility boundary for entity ${opponent.entityId}`);
    }
  }
  for (const opponent of record.observation.opponentKnownParty) {
    if (opponent.activeSlot != null || opponent.hpRatio != null) {
      errors.push(`live hidden bench state crossed the visibility boundary for entity ${opponent.entityId}`);
    }
  }
  if (record.observation.modifiers.some(modifier => modifier.side === "opponent")) {
    errors.push("hidden opponent modifiers crossed the visibility boundary");
  }
  const ids = record.candidates.map(candidate => candidate.id);
  if (new Set(ids).size !== ids.length) {
    errors.push("candidate ids are not unique");
  }
  for (const candidate of record.candidates) {
    const { id: _id, ...semantic } = candidate;
    if (canonicalCombatCandidateId(semantic as ErCombatCandidateInput) !== candidate.id) {
      errors.push(`non-canonical candidate id ${candidate.id}`);
    }
    if (candidate.actorSlot !== record.actorSlot) {
      errors.push(`candidate ${candidate.id} belongs to actor slot ${candidate.actorSlot}`);
    }
  }
  if (ids.filter(id => id === record.chosenCandidateId).length !== 1) {
    errors.push("chosen candidate must map to exactly one legal candidate");
  }
  if (record.earlierCandidateIds.some(id => ids.includes(id))) {
    errors.push("earlier same-turn choices cannot be candidates for the current slot");
  }
  const featureIds = record.candidateFeatures.map(row => row.candidateId);
  if (
    featureIds.length !== ids.length
    || new Set(featureIds).size !== ids.length
    || ids.some(id => !featureIds.includes(id))
  ) {
    errors.push("candidate features must map exactly once to every legal candidate");
  }
  if (
    record.candidateFeatures.some(row => row.values.length === 0 || row.values.some(value => !Number.isFinite(value)))
  ) {
    errors.push("candidate feature vectors must be finite and non-empty");
  }
  const tokenRows = Array.isArray(record.candidateTokenGroups) ? record.candidateTokenGroups : [];
  const tokenIds = tokenRows.map(row => row.candidateId);
  if (
    tokenIds.length !== ids.length
    || new Set(tokenIds).size !== ids.length
    || ids.some(id => !tokenIds.includes(id))
  ) {
    errors.push("candidate token groups must map exactly once to every legal candidate");
  }
  for (const row of tokenRows) {
    for (const group of ER_COMBAT_TOKEN_GROUP_NAMES) {
      if (!Array.isArray(row.groups[group]) || row.groups[group].some(token => typeof token !== "string" || !token)) {
        errors.push(`candidate ${row.candidateId} has invalid ${group} tokens`);
      }
    }
    if (row.groups.action.length === 0) {
      errors.push(`candidate ${row.candidateId} has no action tokens`);
    }
  }
  return errors;
}
