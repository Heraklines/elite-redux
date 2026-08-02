/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import {
  committedTurnTargetIndices,
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatCandidate,
  type ErCombatDecisionRecord,
  type ErCombatPolicySource,
  type ErCombatTargetRef,
  validateCombatDecisionRecord,
} from "#data/elite-redux/ai/combat-contract";
import {
  type ErCombatEarlierChoice,
  type ErCombatPerspective,
  enumerateErCombatCandidates,
  snapshotErCombatObservation,
} from "#data/elite-redux/ai/combat-engine-adapter";
import {
  ER_COMBAT_FEATURE_SCHEMA_VERSION,
  extractErCombatCandidateFeatures,
  extractErCombatCandidateTokenGroups,
} from "#data/elite-redux/ai/combat-features";
import { Command } from "#enums/command";

export interface ErCombatDecisionIdentity {
  buildSha: string;
  dexHash: string;
  dictionaryHash: string;
  episodeId: string;
  splitGroupId?: string;
  sourcePartitionId?: string;
}

export interface CaptureCommittedCombatDecisionOptions extends ErCombatDecisionIdentity {
  scene: BattleScene;
  perspective: ErCombatPerspective;
  actorSlot: number;
  jointActionId: string;
  earlier?: readonly ErCombatEarlierChoice[];
  policySource: ErCombatPolicySource;
  policyTarget: boolean;
  knownOpponentEntityIds?: ReadonlySet<number>;
  observation?: ErCombatDecisionRecord["observation"];
  candidates?: ErCombatCandidate[];
}

export interface CapturedCombatDecision {
  record: ErCombatDecisionRecord;
  chosen: ErCombatCandidate;
}

export function perspectiveTargetRef(
  scene: BattleScene,
  perspective: ErCombatPerspective,
  battlerIndex: number,
): ErCombatTargetRef | null {
  const selfField = perspective === "player" ? scene.getPlayerField() : scene.getEnemyField();
  const opponentField = perspective === "player" ? scene.getEnemyField() : scene.getPlayerField();
  const selfSlot = selfField.findIndex(mon => mon.getBattlerIndex() === battlerIndex);
  if (selfSlot >= 0) {
    return { side: "self", entityId: selfField[selfSlot].id, activeSlot: selfSlot };
  }
  const opponentSlot = opponentField.findIndex(mon => mon.getBattlerIndex() === battlerIndex);
  return opponentSlot < 0
    ? null
    : { side: "opponent", entityId: opponentField[opponentSlot].id, activeSlot: opponentSlot };
}

export function sameTargetSet(left: readonly ErCombatTargetRef[], right: readonly ErCombatTargetRef[]): boolean {
  const key = (target: ErCombatTargetRef): string => `${target.side}:${target.entityId}:${target.activeSlot}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((value, index) => value === rightKeys[index]);
}

export function findCommittedCombatCandidate(
  scene: BattleScene,
  perspective: ErCombatPerspective,
  actorSlot: number,
  candidates: readonly ErCombatCandidate[],
): ErCombatCandidate | null {
  const battle = scene.currentBattle;
  const flatSlot = perspective === "enemy" ? battle.arrangement.enemyOffset + actorSlot : actorSlot;
  const command = battle.turnCommands[flatSlot];
  if (command == null || command.skip) {
    return null;
  }
  if (command.command === Command.SHIFT) {
    const matches = candidates.filter(
      candidate => candidate.kind === "shift" && candidate.targetActorSlot === command.cursor,
    );
    return matches.length === 1 ? matches[0] : null;
  }
  if (command.command === Command.POKEMON) {
    const matches = candidates.filter(
      candidate =>
        candidate.kind === "switch"
        && candidate.partyIndex === command.cursor
        && candidate.transfer === (command.args?.[0] ? "baton" : "normal"),
    );
    return matches.length === 1 ? matches[0] : null;
  }
  if (command.command !== Command.FIGHT || command.move == null) {
    return null;
  }
  const committedTargets = committedTurnTargetIndices(command)
    .map(target => perspectiveTargetRef(scene, perspective, target))
    .filter((target): target is ErCombatTargetRef => target != null);
  const tera = battle.preTurnCommands[flatSlot]?.command === Command.TERA;
  const matches = candidates.filter(
    candidate =>
      candidate.kind === "move"
      && candidate.moveId === command.move?.move
      && (command.cursor == null || candidate.moveSlot === command.cursor)
      && candidate.tera === tera
      && (candidate.targetMode === "random" || sameTargetSet(candidate.targets, committedTargets)),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function captureCommittedCombatDecision(
  options: CaptureCommittedCombatDecisionOptions,
): CapturedCombatDecision | null {
  const earlier = options.earlier ?? [];
  const observation =
    options.observation
    ?? snapshotErCombatObservation(options.scene, {
      perspective: options.perspective,
      ...(options.knownOpponentEntityIds == null ? {} : { knownOpponentEntityIds: options.knownOpponentEntityIds }),
    });
  const candidates =
    options.candidates ?? enumerateErCombatCandidates(options.scene, options.actorSlot, earlier, options.perspective);
  const chosen = findCommittedCombatCandidate(options.scene, options.perspective, options.actorSlot, candidates);
  if (chosen == null) {
    return null;
  }
  const record: ErCombatDecisionRecord = {
    kind: "combat_decision",
    schemaVersion: ER_COMBAT_CONTRACT_VERSION,
    candidateScope: "combat-command",
    buildSha: options.buildSha,
    dexHash: options.dexHash,
    dictionaryHash: options.dictionaryHash,
    episodeId: options.episodeId,
    ...(options.splitGroupId ? { splitGroupId: options.splitGroupId } : {}),
    ...(options.sourcePartitionId ? { sourcePartitionId: options.sourcePartitionId } : {}),
    jointActionId: options.jointActionId,
    decisionId: `${options.jointActionId}:${options.actorSlot}`,
    policySource: options.policySource,
    policyTarget: options.policyTarget,
    actorSlot: options.actorSlot,
    earlierCandidateIds: earlier.map(choice => choice.id),
    observation,
    candidates,
    featureSchemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
    candidateFeatures: [],
    candidateTokenGroups: [],
    chosenCandidateId: chosen.id,
  };
  record.candidateFeatures = candidates.map(candidate => ({
    candidateId: candidate.id,
    values: extractErCombatCandidateFeatures(record.observation, candidate),
  }));
  record.candidateTokenGroups = candidates.map(candidate => ({
    candidateId: candidate.id,
    groups: extractErCombatCandidateTokenGroups(record.observation, candidate),
  }));
  const errors = validateCombatDecisionRecord(record);
  if (errors.length > 0) {
    throw new Error(`invalid committed combat decision ${record.decisionId}: ${errors.join("; ")}`);
  }
  return { record, chosen };
}
