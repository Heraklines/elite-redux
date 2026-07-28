/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Incompatible observation/candidate changes must bump this version. */
export const ER_COMBAT_CONTRACT_VERSION = 2;

/** The first training slice scores battle commands, not balls, run, or run-management choices. */
export type ErCombatCandidateScope = "combat-command";

export type ErCombatKnowledge = "self" | "battle-info";

export interface ErCombatMoveObservation {
  slot: number;
  moveId: number;
  type: number;
  category: number;
  power: number;
  accuracy: number;
  priority: number;
  ppUsed: number;
  maxPp: number;
}

export interface ErCombatMonObservation {
  entityId: number;
  knowledge: ErCombatKnowledge;
  partyIndex: number | null;
  activeSlot: number | null;
  species: number;
  form: number;
  level: number;
  types: number[];
  hp: number;
  maxHp: number;
  status: number | null;
  statStages: number[];
  stats: number[];
  ability: number;
  innates: (number | null)[];
  /** Opponent held items are deliberately hidden because Battle Info does not expose them. */
  heldItems: string[] | null;
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
  weather: number | null;
  terrain: number | null;
  selfParty: ErCombatMonObservation[];
  opponentActive: ErCombatMonObservation[];
  /** Public roster size only. No unobserved opponent bench entity is serialized. */
  opponentRosterSize: number;
  playerTerasUsed: number;
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

export interface ErCombatDecisionRecord {
  kind: "combat_decision";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  candidateScope: ErCombatCandidateScope;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  jointActionId: string;
  decisionId: string;
  sourcePolicy: "smart-default-v1" | "scripted" | "forced-move" | "first-usable" | "tree-model-v1" | "epsilon-tree-v1";
  actorSlot: number;
  earlierCandidateIds: string[];
  observation: ErCombatObservation;
  candidates: ErCombatCandidate[];
  featureSchemaVersion: number;
  candidateFeatures: { candidateId: string; values: number[] }[];
  chosenCandidateId: string;
}

export interface ErCombatTerminalRecord {
  kind: "episode_terminal";
  schemaVersion: typeof ER_COMBAT_CONTRACT_VERSION;
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  outcome: string;
  startWave: number;
  finalWave: number;
  wavesCleared: number;
  truncated: boolean;
}

export type ErCombatDatasetRecord = ErCombatDecisionRecord | ErCombatTerminalRecord;

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

export function withCanonicalCombatCandidateId(candidate: ErCombatCandidateInput): ErCombatCandidate {
  return { ...candidate, id: canonicalCombatCandidateId(candidate) } as ErCombatCandidate;
}

/** Fail closed before a malformed row becomes training data. */
export function validateCombatDecisionRecord(record: ErCombatDecisionRecord): string[] {
  const errors: string[] = [];
  if (record.schemaVersion !== ER_COMBAT_CONTRACT_VERSION) {
    errors.push(`unsupported schema version ${record.schemaVersion}`);
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
  return errors;
}
