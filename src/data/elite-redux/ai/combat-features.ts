/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  ErCombatCandidate,
  ErCombatMonObservation,
  ErCombatMoveObservation,
  ErCombatObservation,
} from "#data/elite-redux/ai/combat-contract";

export const ER_COMBAT_FEATURE_SCHEMA_VERSION = 1;

const TYPE_COUNT = 19;
const WEATHER_COUNT = 14;
const TERRAIN_COUNT = 6;
const BATTLE_TYPE_COUNT = 4;
const FORMAT_COUNT = 3;
const MOVE_CATEGORY_COUNT = 3;
const STAT_STAGE_COUNT = 7;
const STAT_COUNT = 6;

function names(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}_${index}`);
}

export const ER_COMBAT_FEATURE_NAMES = [
  "wave_ratio",
  "turn_ratio",
  ...names("format", FORMAT_COUNT),
  ...names("battle_type", BATTLE_TYPE_COUNT),
  ...names("weather", WEATHER_COUNT),
  ...names("terrain", TERRAIN_COUNT),
  "player_teras_used_ratio",
  "self_alive_ratio",
  "self_bench_alive_ratio",
  "self_mean_hp_ratio",
  "opponent_active_alive_ratio",
  "opponent_mean_hp_ratio",
  "opponent_roster_ratio",
  "actor_hp_ratio",
  "actor_statused",
  "actor_level_ratio",
  "actor_held_item_count_ratio",
  "actor_innate_count_ratio",
  ...names("actor_stage", STAT_STAGE_COUNT),
  ...names("actor_stat", STAT_COUNT),
  ...names("actor_type", TYPE_COUNT),
  "action_move",
  "action_switch",
  "action_shift",
  "move_power_ratio",
  "move_accuracy_ratio",
  "move_priority_ratio",
  "move_pp_remaining_ratio",
  ...names("move_category", MOVE_CATEGORY_COUNT),
  ...names("move_type", TYPE_COUNT),
  "move_current_stab",
  "move_base_effectiveness_ratio",
  "move_tera",
  "move_target_count_ratio",
  "move_random_target",
  "target_present",
  "target_is_self",
  "target_hp_ratio",
  "target_statused",
  "target_level_delta_ratio",
  ...names("target_stage", STAT_STAGE_COUNT),
  ...names("target_stat", STAT_COUNT),
  ...names("target_type", TYPE_COUNT),
  "switch_hp_ratio",
  "switch_statused",
  "switch_level_delta_ratio",
  "switch_held_item_count_ratio",
  "switch_innate_count_ratio",
  ...names("switch_stat", STAT_COUNT),
  ...names("switch_type", TYPE_COUNT),
  "switch_baton",
  "shift_distance_ratio",
] as const;

function ratio(value: number | null | undefined, scale: number): number {
  return Number.isFinite(value) && scale > 0 ? Number(value) / scale : 0;
}

function hpRatio(mon: ErCombatMonObservation | undefined): number {
  return mon ? ratio(mon.hp, Math.max(1, mon.maxHp)) : 0;
}

function oneHot(value: number | null | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => +(value === index));
}

function multiHot(values: readonly number[] | undefined, count: number): number[] {
  const present = new Set(values ?? []);
  return Array.from({ length: count }, (_, index) => +present.has(index));
}

function padded(values: readonly number[] | undefined, count: number, scale: number): number[] {
  return Array.from({ length: count }, (_, index) => ratio(values?.[index], scale));
}

function activeActor(observation: ErCombatObservation, actorSlot: number): ErCombatMonObservation {
  const actor = observation.selfParty.find(mon => mon.activeSlot === actorSlot);
  if (!actor) {
    throw new Error(`missing active actor for feature slot ${actorSlot}`);
  }
  return actor;
}

function observedEntity(observation: ErCombatObservation, entityId: number): ErCombatMonObservation | undefined {
  return [...observation.selfParty, ...observation.opponentActive].find(mon => mon.entityId === entityId);
}

function moveForCandidate(
  actor: ErCombatMonObservation,
  candidate: ErCombatCandidate,
): ErCombatMoveObservation | undefined {
  return candidate.kind === "move" ? actor.moves.find(move => move.slot === candidate.moveSlot) : undefined;
}

function aggregateHp(mons: readonly ErCombatMonObservation[]): number {
  return mons.length > 0 ? mons.reduce((sum, mon) => sum + hpRatio(mon), 0) / mons.length : 0;
}

function aggregateValues(
  mons: readonly ErCombatMonObservation[],
  select: (mon: ErCombatMonObservation) => readonly number[],
  count: number,
  scale: number,
): number[] {
  if (mons.length === 0) {
    return new Array(count).fill(0);
  }
  return Array.from({ length: count }, (_, index) =>
    ratio(
      mons.reduce((sum, mon) => sum + (select(mon)[index] ?? 0), 0),
      scale * mons.length,
    ),
  );
}

function baseFeatures(
  observation: ErCombatObservation,
  actor: ErCombatMonObservation,
  candidate: ErCombatCandidate,
): number[] {
  const selfAlive = observation.selfParty.filter(mon => !mon.fainted);
  const selfBenchAlive = selfAlive.filter(mon => mon.activeSlot == null);
  const opponentAlive = observation.opponentActive.filter(mon => !mon.fainted);
  return [
    ratio(observation.wave, 200),
    ratio(observation.turn, 50),
    ...oneHot(observation.format - 1, FORMAT_COUNT),
    ...oneHot(observation.battleType, BATTLE_TYPE_COUNT),
    ...oneHot(observation.weather ?? 0, WEATHER_COUNT),
    ...oneHot(observation.terrain ?? 0, TERRAIN_COUNT),
    ratio(observation.playerTerasUsed, 3),
    ratio(selfAlive.length, 6),
    ratio(selfBenchAlive.length, 6),
    aggregateHp(selfAlive),
    ratio(opponentAlive.length, Math.max(1, observation.format)),
    aggregateHp(opponentAlive),
    ratio(observation.opponentRosterSize, 6),
    hpRatio(actor),
    +(actor.status != null),
    ratio(actor.level, 200),
    ratio(actor.heldItems?.length ?? 0, 12),
    ratio(actor.innates.filter(id => id != null).length, 3),
    ...padded(actor.statStages, STAT_STAGE_COUNT, 6),
    ...padded(actor.stats, STAT_COUNT, 1000),
    ...multiHot(actor.types, TYPE_COUNT),
    +(candidate.kind === "move"),
    +(candidate.kind === "switch"),
    +(candidate.kind === "shift"),
  ];
}

function moveFeatures(actor: ErCombatMonObservation, candidate: ErCombatCandidate): number[] {
  const move = moveForCandidate(actor, candidate);
  return [
    ratio(move?.power, 250),
    ratio(move?.accuracy, 100),
    ratio(move?.priority, 7),
    move ? ratio(move.maxPp - move.ppUsed, Math.max(1, move.maxPp)) : 0,
    ...oneHot(move?.category, MOVE_CATEGORY_COUNT),
    ...oneHot(move?.type, TYPE_COUNT),
    +(candidate.kind === "move" && candidate.currentStab),
    candidate.kind === "move" ? Math.min(4, candidate.baseTypeMultiplier) / 4 : 0,
    +(candidate.kind === "move" && candidate.tera),
    candidate.kind === "move" ? ratio(candidate.targets.length, 6) : 0,
    +(candidate.kind === "move" && candidate.targetMode === "random"),
  ];
}

function targetFeatures(
  observation: ErCombatObservation,
  actor: ErCombatMonObservation,
  candidate: ErCombatCandidate,
): number[] {
  const targetRefs = candidate.kind === "move" ? candidate.targets : [];
  const targets = targetRefs
    .map(targetRef => observedEntity(observation, targetRef.entityId))
    .filter((target): target is ErCombatMonObservation => target !== undefined);
  return [
    +(targets.length > 0),
    targetRefs.length > 0 ? targetRefs.filter(target => target.side === "self").length / targetRefs.length : 0,
    aggregateHp(targets),
    targets.length > 0 ? targets.filter(target => target.status != null).length / targets.length : 0,
    targets.length > 0
      ? ratio(
          targets.reduce((sum, target) => sum + target.level - actor.level, 0),
          200 * targets.length,
        )
      : 0,
    ...aggregateValues(targets, target => target.statStages, STAT_STAGE_COUNT, 6),
    ...aggregateValues(targets, target => target.stats, STAT_COUNT, 1000),
    ...multiHot(
      targets.flatMap(target => target.types),
      TYPE_COUNT,
    ),
  ];
}

function destinationFeatures(
  observation: ErCombatObservation,
  actor: ErCombatMonObservation,
  candidate: ErCombatCandidate,
): number[] {
  const destination =
    candidate.kind === "switch"
      ? observation.selfParty.find(mon => mon.partyIndex === candidate.partyIndex)
      : undefined;
  return [
    hpRatio(destination),
    +(destination?.status != null),
    destination ? ratio(destination.level - actor.level, 200) : 0,
    ratio(destination?.heldItems?.length ?? 0, 12),
    ratio(destination?.innates.filter(id => id != null).length ?? 0, 3),
    ...padded(destination?.stats, STAT_COUNT, 1000),
    ...multiHot(destination?.types, TYPE_COUNT),
    +(candidate.kind === "switch" && candidate.transfer === "baton"),
    candidate.kind === "shift" ? ratio(Math.abs(candidate.targetActorSlot - candidate.actorSlot), 2) : 0,
  ];
}

export function extractErCombatCandidateFeatures(
  observation: ErCombatObservation,
  candidate: ErCombatCandidate,
): number[] {
  const actor = activeActor(observation, candidate.actorSlot);
  const features = [
    ...baseFeatures(observation, actor, candidate),
    ...moveFeatures(actor, candidate),
    ...targetFeatures(observation, actor, candidate),
    ...destinationFeatures(observation, actor, candidate),
  ];

  if (features.length !== ER_COMBAT_FEATURE_NAMES.length || features.some(value => !Number.isFinite(value))) {
    throw new Error(`invalid ER combat feature vector (${features.length}/${ER_COMBAT_FEATURE_NAMES.length})`);
  }
  return features;
}
