/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities, allMoves } from "#data/data-lists";
import type {
  ErCombatCandidate,
  ErCombatCandidateTokenGroups,
  ErCombatEffectObservation,
  ErCombatMonObservation,
  ErCombatMoveObservation,
  ErCombatObservation,
  ErCombatStateField,
} from "#data/elite-redux/ai/combat-contract";

export const ER_COMBAT_FEATURE_SCHEMA_VERSION = 2;

const TYPE_COUNT = 19;
const WEATHER_COUNT = 14;
const TERRAIN_COUNT = 6;
const BATTLE_TYPE_COUNT = 4;
const FORMAT_COUNT = 3;
const MOVE_CATEGORY_COUNT = 3;
const STAT_STAGE_COUNT = 7;
const STAT_COUNT = 6;
const SPECIES_BUCKETS = 256;
const ABILITY_BUCKETS = 256;
const MOVE_BUCKETS = 256;
const ITEM_BUCKETS = 128;
const EFFECT_BUCKETS = 128;
const MODIFIER_BUCKETS = 128;
const SEMANTIC_TOKEN_BUCKETS = 256;

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
  "weather_turns_ratio",
  "weather_suppressed",
  "terrain_turns_ratio",
  "terrain_suppressed",
  "field_effect_count_ratio",
  "positional_effect_count_ratio",
  "global_mechanic_count_ratio",
  "modifier_count_ratio",
  "player_teras_used_ratio",
  "self_alive_ratio",
  "self_bench_alive_ratio",
  "self_mean_hp_ratio",
  "opponent_active_alive_ratio",
  "opponent_mean_hp_ratio",
  "opponent_known_party_ratio",
  "opponent_roster_ratio",
  "actor_hp_ratio",
  "actor_statused",
  "actor_level_ratio",
  "actor_held_item_count_ratio",
  "actor_held_item_stack_ratio",
  "actor_item_charge_ratio",
  "actor_active_item_ratio",
  "actor_suppressed_item_ratio",
  "actor_consumed_item_ratio",
  "actor_innate_count_ratio",
  "actor_active_ability_count_ratio",
  "actor_suppressed_ability_count_ratio",
  "actor_tag_count_ratio",
  "actor_mechanic_count_ratio",
  ...names("actor_stage", STAT_STAGE_COUNT),
  ...names("actor_stat", STAT_COUNT),
  ...names("actor_effective_stat", STAT_COUNT),
  ...names("actor_type", TYPE_COUNT),
  ...names("actor_species_hash", SPECIES_BUCKETS),
  ...names("actor_ability_hash", ABILITY_BUCKETS),
  ...names("actor_item_hash", ITEM_BUCKETS),
  ...names("actor_effect_hash", EFFECT_BUCKETS),
  ...names("actor_semantic_hash", SEMANTIC_TOKEN_BUCKETS),
  ...names("field_effect_hash", EFFECT_BUCKETS),
  ...names("modifier_hash", MODIFIER_BUCKETS),
  ...names("field_semantic_hash", SEMANTIC_TOKEN_BUCKETS),
  "actor_tera_available_known",
  "actor_tera_available",
  "actor_terastallized",
  "actor_form_change_available_known",
  "actor_form_change_available",
  "actor_form_changed",
  "actor_boss_segments_ratio",
  "actor_boss_segment_ratio",
  "action_move",
  "action_switch",
  "action_shift",
  "move_power_ratio",
  "move_accuracy_ratio",
  "move_priority_ratio",
  "move_pp_remaining_ratio",
  ...names("move_category", MOVE_CATEGORY_COUNT),
  ...names("move_type", TYPE_COUNT),
  ...names("move_id_hash", MOVE_BUCKETS),
  "move_current_stab",
  "move_base_effectiveness_ratio",
  "move_tera",
  "move_target_count_ratio",
  "move_random_target",
  "move_effective_priority_ratio",
  "move_status_chance",
  "move_has_drain",
  "move_drain_fraction",
  "move_has_recoil",
  "move_recoil_fraction",
  "move_forces_recharge",
  "move_creates_lock",
  "move_acts_before_known",
  "move_acts_before",
  "move_damage_known",
  "move_expected_min_hp_ratio",
  "move_expected_max_hp_ratio",
  "move_expected_crit_hp_ratio",
  "move_expected_hits_ratio",
  ...names("action_semantic_hash", SEMANTIC_TOKEN_BUCKETS),
  "target_present",
  "target_is_self",
  "target_hp_ratio",
  "target_statused",
  "target_level_delta_ratio",
  ...names("target_stage", STAT_STAGE_COUNT),
  ...names("target_stat", STAT_COUNT),
  ...names("target_type", TYPE_COUNT),
  ...names("target_species_hash", SPECIES_BUCKETS),
  ...names("target_ability_hash", ABILITY_BUCKETS),
  ...names("target_item_hash", ITEM_BUCKETS),
  ...names("target_effect_hash", EFFECT_BUCKETS),
  ...names("target_semantic_hash", SEMANTIC_TOKEN_BUCKETS),
  "switch_hp_ratio",
  "switch_statused",
  "switch_level_delta_ratio",
  "switch_held_item_count_ratio",
  "switch_held_item_stack_ratio",
  "switch_innate_count_ratio",
  ...names("switch_stat", STAT_COUNT),
  ...names("switch_effective_stat", STAT_COUNT),
  ...names("switch_type", TYPE_COUNT),
  ...names("switch_species_hash", SPECIES_BUCKETS),
  ...names("switch_ability_hash", ABILITY_BUCKETS),
  ...names("switch_item_hash", ITEM_BUCKETS),
  ...names("switch_effect_hash", EFFECT_BUCKETS),
  ...names("switch_semantic_hash", SEMANTIC_TOKEN_BUCKETS),
  "switch_baton",
  "shift_distance_ratio",
] as const;

function ratio(value: number | null | undefined, scale: number): number {
  return Number.isFinite(value) && scale > 0 ? Number(value) / scale : 0;
}

function hpRatio(mon: ErCombatMonObservation | undefined): number {
  return mon?.hpRatio ?? 0;
}

function oneHot(value: number | null | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => +(value === index));
}

function multiHot(values: readonly number[] | undefined, count: number): number[] {
  const present = new Set(values ?? []);
  return Array.from({ length: count }, (_, index) => +present.has(index));
}

function padded(values: readonly number[] | null | undefined, count: number, scale: number): number[] {
  return Array.from({ length: count }, (_, index) => ratio(values?.[index], scale));
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashedMultiHot(tokens: readonly string[], count: number): number[] {
  const result = new Array<number>(count).fill(0);
  for (const token of new Set(tokens)) {
    result[hashToken(token) % count] = 1;
  }
  return result;
}

function countBucket(value: number | null | undefined): string {
  if (value == null) {
    return "unknown";
  }
  if (value <= 0) {
    return "0";
  }
  if (value <= 3) {
    return String(value);
  }
  if (value <= 7) {
    return "4-7";
  }
  return "8+";
}

function numericStateBucket(value: number): string {
  const magnitude = Math.abs(value);
  const prefix = value < 0 ? "negative-" : "";
  if (magnitude === 0) {
    return "0";
  }
  if (magnitude <= 3) {
    return `${prefix}${magnitude}`;
  }
  if (magnitude <= 7) {
    return `${prefix}4-7`;
  }
  if (magnitude <= 15) {
    return `${prefix}8-15`;
  }
  if (magnitude <= 31) {
    return `${prefix}16-31`;
  }
  if (magnitude <= 63) {
    return `${prefix}32-63`;
  }
  if (magnitude <= 127) {
    return `${prefix}64-127`;
  }
  if (magnitude <= 255) {
    return `${prefix}128-255`;
  }
  return `${prefix}256+`;
}

function preservesExactNumericState(key: string, value: number): boolean {
  if (/entityid$/i.test(key)) {
    return false;
  }
  return (
    Number.isSafeInteger(value)
    && (/id$/i.test(key)
      || /(charge|count|stack|layer|turn|wave|type|slot|stat|phase|duration|remaining|used|gained|flat|elapsed)/i.test(
        key,
      ))
  );
}

function stateTokens(prefix: string, state: readonly ErCombatStateField[]): string[] {
  return state.flatMap(field => {
    const statePrefix = `${prefix}:state:${field.key}`;
    if (typeof field.value === "number") {
      if (!Number.isFinite(field.value)) {
        return [];
      }
      return [
        `${statePrefix}:numeric`,
        `${statePrefix}:bucket:${numericStateBucket(field.value)}`,
        ...(preservesExactNumericState(field.key, field.value) ? [`${statePrefix}:${field.value}`] : []),
      ];
    }
    return [`${statePrefix}:${String(field.value)}`];
  });
}

function effectSemanticTokens(effect: ErCombatEffectObservation, observation?: ErCombatObservation): string[] {
  return [
    `effect:${effect.scope}:${effect.effectId}`,
    `effect-side:${effect.side ?? "none"}`,
    `effect-duration:${countBucket(effect.turnsLeft)}`,
    ...(effect.sourceEntityId == null || !observation
      ? []
      : [`effect-source:${observedEntityRole(observation, effect.sourceEntityId)}`]),
    ...stateTokens(`effect:${effect.scope}:${effect.effectId}`, effect.state),
  ];
}

function monSemanticTokens(mon: ErCombatMonObservation | undefined, observation?: ErCombatObservation): string[] {
  if (!mon) {
    return [];
  }
  const tokens = [
    `species:${mon.species}:${mon.form}`,
    `original-species:${mon.originalSpecies}:${mon.originalForm}`,
    ...mon.types.map(type => `type:${type}`),
    `status:${mon.status ?? "none"}`,
    `ability-knowledge:${mon.revealState.abilities}`,
    `item-knowledge:${mon.revealState.items}`,
    `move-knowledge:${mon.revealState.moves}`,
    `tera:${mon.transformation.terastallized}`,
    `form-changed:${mon.transformation.formChanged}`,
    `boss:${mon.boss.segments > 0}`,
  ];
  for (const ability of mon.abilities) {
    tokens.push(
      `ability:${ability.abilityId}`,
      `ability-source:${ability.source}`,
      `ability-slot:${ability.source}:${ability.slot ?? -1}`,
      `ability-active:${ability.abilityId}:${ability.active}`,
      `ability-suppressed:${ability.abilityId}:${ability.suppressed}`,
      `ability-overridden:${ability.abilityId}:${ability.overridden}`,
    );
    const definition = allAbilities[ability.abilityId];
    if (definition) {
      tokens.push(...definition.attrs.map(attribute => `ability-attr:${attribute.constructor.name}`));
    }
  }
  for (const item of mon.heldItems ?? []) {
    tokens.push(
      `item:${item.itemId}`,
      `item-class:${item.className}`,
      `item-stack:${item.itemId}:${countBucket(item.stackCount + item.virtualStackCount)}`,
      `item-charge:${item.itemId}:${countBucket(item.charges)}`,
      `item-active:${item.itemId}:${item.active}`,
      `item-suppressed:${item.itemId}:${item.suppressed}`,
      `item-consumed:${item.itemId}:${String(item.consumed)}`,
      ...stateTokens(`item:${item.itemId}`, item.state),
    );
  }
  for (const effect of [...mon.tags, ...mon.mechanics]) {
    tokens.push(...effectSemanticTokens(effect, observation));
  }
  return tokens.sort();
}

function fieldSemanticTokens(observation: ErCombatObservation): string[] {
  const tokens = [
    `weather:${observation.weather?.effectId ?? "none"}`,
    `weather-owner:${observation.weather?.owner ?? "none"}`,
    `weather-suppressed:${observation.weather?.suppressed ?? false}`,
    `terrain:${observation.terrain?.effectId ?? "none"}`,
    `terrain-owner:${observation.terrain?.owner ?? "none"}`,
    `terrain-suppressed:${observation.terrain?.suppressed ?? false}`,
  ];
  for (const effect of [...observation.fieldEffects, ...observation.positionalEffects, ...observation.mechanics]) {
    tokens.push(...effectSemanticTokens(effect, observation));
  }
  for (const modifier of observation.modifiers) {
    tokens.push(
      `modifier:${modifier.modifierId}`,
      `modifier-class:${modifier.className}`,
      `modifier-scope:${modifier.scope}`,
      `modifier-stack:${modifier.modifierId}:${countBucket(modifier.stackCount + modifier.virtualStackCount)}`,
      ...stateTokens(`modifier:${modifier.modifierId}`, modifier.state),
    );
  }
  for (const mon of observation.opponentKnownParty) {
    tokens.push(
      `known-opponent:${mon.species}:${mon.form}`,
      ...mon.abilities.map(ability => `known-opponent-ability:${ability.abilityId}`),
      ...(mon.heldItems ?? []).map(item => `known-opponent-item:${item.itemId}`),
      ...mon.moves.map(move => `known-opponent-move:${move.moveId}`),
    );
  }
  return tokens.sort();
}

function actionSemanticTokens(actor: ErCombatMonObservation, candidate: ErCombatCandidate): string[] {
  const tokens = [`action:${candidate.kind}`];
  if (candidate.kind === "move") {
    const move = allMoves[candidate.moveId];
    tokens.push(
      `move:${candidate.moveId}`,
      `move-type:${move?.type ?? "unknown"}`,
      `move-category:${move?.category ?? "unknown"}`,
      `move-target-mode:${candidate.targetMode}`,
      `move-tera:${candidate.tera}`,
      `move-stab:${candidate.currentStab}`,
      `move-drain:${candidate.derived.hasDrain}`,
      `move-recoil:${candidate.derived.hasRecoil}`,
      `move-recharge:${candidate.derived.forcesRecharge}`,
      `move-lock:${candidate.derived.createsMoveLock}`,
    );
    if (candidate.derived.immunityReason) {
      tokens.push(`move-immunity:${candidate.derived.immunityReason}`);
    }
    if (move) {
      tokens.push(...move.attrs.map(attribute => `move-attr:${attribute.constructor.name}`));
    }
    const observedMove = moveForCandidate(actor, candidate);
    if (observedMove) {
      tokens.push(`move-pp:${countBucket((observedMove.maxPp ?? 0) - (observedMove.ppUsed ?? 0))}`);
    }
  } else if (candidate.kind === "switch") {
    tokens.push(`switch-transfer:${candidate.transfer}`);
  } else {
    tokens.push(`shift-distance:${Math.abs(candidate.targetActorSlot - candidate.actorSlot)}`);
  }
  return tokens.sort();
}

/** Role-separated token multisets consumed by the neural policy's permutation-invariant encoders. */
export function extractErCombatCandidateTokenGroups(
  observation: ErCombatObservation,
  candidate: ErCombatCandidate,
): ErCombatCandidateTokenGroups {
  const actor = activeActor(observation, candidate.actorSlot);
  const targets =
    candidate.kind === "move"
      ? candidate.targets
          .map(target => observedEntity(observation, target.entityId))
          .filter((target): target is ErCombatMonObservation => target != null)
      : [];
  const destination =
    candidate.kind === "switch"
      ? observation.selfParty.find(mon => mon.partyIndex === candidate.partyIndex)
      : undefined;
  return {
    actor: monSemanticTokens(actor, observation),
    targets: targets.flatMap(target => monSemanticTokens(target, observation)).sort(),
    destination: monSemanticTokens(destination, observation),
    field: fieldSemanticTokens(observation),
    action: actionSemanticTokens(actor, candidate),
  };
}

function speciesTokens(mons: readonly ErCombatMonObservation[]): string[] {
  return mons.map(mon => `${mon.species}:${mon.form}`);
}

function abilityTokens(mons: readonly ErCombatMonObservation[]): string[] {
  return mons.flatMap(mon =>
    mon.abilities.map(ability => `${ability.source}:${ability.slot ?? -1}:${ability.abilityId}`),
  );
}

function itemTokens(mons: readonly ErCombatMonObservation[]): string[] {
  return mons.flatMap(mon => mon.heldItems?.map(item => item.itemId) ?? []);
}

function effectTokens(mons: readonly ErCombatMonObservation[]): string[] {
  return mons.flatMap(mon => [...mon.tags, ...mon.mechanics].map(effect => `${effect.scope}:${effect.effectId}`));
}

function itemStackCount(mon: ErCombatMonObservation | undefined): number {
  return mon?.heldItems?.reduce((sum, item) => sum + item.stackCount + item.virtualStackCount, 0) ?? 0;
}

function itemChargeCount(mon: ErCombatMonObservation | undefined): number {
  return mon?.heldItems?.reduce((sum, item) => sum + Math.max(0, item.charges ?? 0), 0) ?? 0;
}

function innateCount(mon: ErCombatMonObservation | undefined): number {
  return mon?.abilities.filter(ability => ability.source !== "active").length ?? 0;
}

function activeActor(observation: ErCombatObservation, actorSlot: number): ErCombatMonObservation {
  const actor = observation.selfParty.find(mon => mon.activeSlot === actorSlot);
  if (!actor) {
    throw new Error(`missing active actor for feature slot ${actorSlot}`);
  }
  return actor;
}

function observedEntity(observation: ErCombatObservation, entityId: number): ErCombatMonObservation | undefined {
  return [...observation.selfParty, ...observation.opponentActive, ...observation.opponentKnownParty].find(
    mon => mon.entityId === entityId,
  );
}

function observedEntityRole(observation: ErCombatObservation, entityId: number): string {
  const self = observation.selfParty.find(mon => mon.entityId === entityId);
  if (self) {
    return self.activeSlot == null ? `self-bench:${self.partyIndex ?? "unknown"}` : `self-active:${self.activeSlot}`;
  }
  const activeOpponent = observation.opponentActive.find(mon => mon.entityId === entityId);
  if (activeOpponent) {
    return `opponent-active:${activeOpponent.activeSlot ?? "unknown"}`;
  }
  return observation.opponentKnownParty.some(mon => mon.entityId === entityId) ? "opponent-known" : "unknown";
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
  select: (mon: ErCombatMonObservation) => readonly number[] | null,
  count: number,
  scale: number,
): number[] {
  if (mons.length === 0) {
    return new Array(count).fill(0);
  }
  return Array.from({ length: count }, (_, index) =>
    ratio(
      mons.reduce((sum, mon) => sum + (select(mon)?.[index] ?? 0), 0),
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
    ...oneHot(observation.weather?.effectId ?? 0, WEATHER_COUNT),
    ...oneHot(observation.terrain?.effectId ?? 0, TERRAIN_COUNT),
    ratio(observation.weather?.turnsLeft, 10),
    +(observation.weather?.suppressed === true),
    ratio(observation.terrain?.turnsLeft, 10),
    +(observation.terrain?.suppressed === true),
    ratio(observation.fieldEffects.length, 16),
    ratio(observation.positionalEffects.length, 6),
    ratio(observation.mechanics.length, 24),
    ratio(observation.modifiers.length, 32),
    ratio(observation.playerTerasUsed, 3),
    ratio(selfAlive.length, 6),
    ratio(selfBenchAlive.length, 6),
    aggregateHp(selfAlive),
    ratio(opponentAlive.length, Math.max(1, observation.format)),
    aggregateHp(opponentAlive),
    ratio(observation.opponentKnownParty.length, 6),
    ratio(observation.opponentRosterSize, 6),
    hpRatio(actor),
    +(actor.status != null),
    ratio(actor.level, 200),
    ratio(actor.heldItems?.length ?? 0, 12),
    ratio(itemStackCount(actor), 24),
    ratio(itemChargeCount(actor), 12),
    ratio(actor.heldItems?.filter(item => item.active).length ?? 0, 12),
    ratio(actor.heldItems?.filter(item => item.suppressed).length ?? 0, 12),
    ratio(actor.heldItems?.filter(item => item.consumed === true).length ?? 0, 12),
    ratio(innateCount(actor), 6),
    ratio(actor.abilities.filter(ability => ability.active).length, 6),
    ratio(actor.abilities.filter(ability => ability.suppressed).length, 6),
    ratio(actor.tags.length, 12),
    ratio(actor.mechanics.length, 24),
    ...padded(actor.statStages, STAT_STAGE_COUNT, 6),
    ...padded(actor.stats, STAT_COUNT, 1000),
    ...padded(actor.effectiveStats, STAT_COUNT, 1000),
    ...multiHot(actor.types, TYPE_COUNT),
    ...hashedMultiHot(speciesTokens([actor]), SPECIES_BUCKETS),
    ...hashedMultiHot(abilityTokens([actor]), ABILITY_BUCKETS),
    ...hashedMultiHot(itemTokens([actor]), ITEM_BUCKETS),
    ...hashedMultiHot(effectTokens([actor]), EFFECT_BUCKETS),
    ...hashedMultiHot(monSemanticTokens(actor, observation), SEMANTIC_TOKEN_BUCKETS),
    ...hashedMultiHot(
      [...observation.fieldEffects, ...observation.positionalEffects, ...observation.mechanics].map(
        effect => `${effect.scope}:${effect.effectId}`,
      ),
      EFFECT_BUCKETS,
    ),
    ...hashedMultiHot(
      observation.modifiers.map(modifier => `${modifier.side}:${modifier.modifierId}`),
      MODIFIER_BUCKETS,
    ),
    ...hashedMultiHot(fieldSemanticTokens(observation), SEMANTIC_TOKEN_BUCKETS),
    +(actor.transformation.teraAvailable != null),
    +(actor.transformation.teraAvailable === true),
    +actor.transformation.terastallized,
    +(actor.transformation.formChangeAvailable != null),
    +(actor.transformation.formChangeAvailable === true),
    +actor.transformation.formChanged,
    ratio(actor.boss.segments, 10),
    ratio(actor.boss.segmentIndex, Math.max(1, actor.boss.segments)),
    +(candidate.kind === "move"),
    +(candidate.kind === "switch"),
    +(candidate.kind === "shift"),
  ];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Fixed feature slots intentionally encode nullable move fields independently.
function moveFeatures(actor: ErCombatMonObservation, candidate: ErCombatCandidate): number[] {
  const move = moveForCandidate(actor, candidate);
  return [
    ratio(move?.power, 250),
    ratio(move?.accuracy, 100),
    ratio(move?.priority, 7),
    move?.maxPp != null && move.ppUsed != null ? ratio(move.maxPp - move.ppUsed, Math.max(1, move.maxPp)) : 0,
    ...oneHot(move?.category, MOVE_CATEGORY_COUNT),
    ...oneHot(move?.type, TYPE_COUNT),
    ...hashedMultiHot(move ? [`${move.moveId}`] : [], MOVE_BUCKETS),
    +(candidate.kind === "move" && candidate.currentStab),
    candidate.kind === "move" ? Math.min(4, candidate.baseTypeMultiplier) / 4 : 0,
    +(candidate.kind === "move" && candidate.tera),
    candidate.kind === "move" ? ratio(candidate.targets.length, 6) : 0,
    +(candidate.kind === "move" && candidate.targetMode === "random"),
    candidate.kind === "move" ? ratio(candidate.derived.effectivePriority, 7) : 0,
    candidate.kind === "move" ? (candidate.derived.statusChance ?? 0) : 0,
    +(candidate.kind === "move" && candidate.derived.hasDrain),
    candidate.kind === "move" ? (candidate.derived.drainFraction ?? 0) : 0,
    +(candidate.kind === "move" && candidate.derived.hasRecoil),
    candidate.kind === "move" ? (candidate.derived.recoilFraction ?? 0) : 0,
    +(candidate.kind === "move" && candidate.derived.forcesRecharge),
    +(candidate.kind === "move" && candidate.derived.createsMoveLock),
    +(candidate.kind === "move" && candidate.derived.actsBeforeTargets != null),
    +(candidate.kind === "move" && candidate.derived.actsBeforeTargets === true),
    +(candidate.kind === "move" && candidate.derived.expectedDamageMin != null),
    candidate.kind === "move" ? ratio(candidate.derived.expectedDamageMin, 1000) : 0,
    candidate.kind === "move" ? ratio(candidate.derived.expectedDamageMax, 1000) : 0,
    candidate.kind === "move" ? ratio(candidate.derived.expectedCriticalDamage, 1000) : 0,
    candidate.kind === "move" ? ratio(candidate.derived.expectedHits, 10) : 0,
    ...hashedMultiHot(actionSemanticTokens(actor, candidate), SEMANTIC_TOKEN_BUCKETS),
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
    ...hashedMultiHot(speciesTokens(targets), SPECIES_BUCKETS),
    ...hashedMultiHot(abilityTokens(targets), ABILITY_BUCKETS),
    ...hashedMultiHot(itemTokens(targets), ITEM_BUCKETS),
    ...hashedMultiHot(effectTokens(targets), EFFECT_BUCKETS),
    ...hashedMultiHot(
      targets.flatMap(target => monSemanticTokens(target, observation)),
      SEMANTIC_TOKEN_BUCKETS,
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
    ratio(itemStackCount(destination), 24),
    ratio(innateCount(destination), 6),
    ...padded(destination?.stats, STAT_COUNT, 1000),
    ...padded(destination?.effectiveStats, STAT_COUNT, 1000),
    ...multiHot(destination?.types, TYPE_COUNT),
    ...hashedMultiHot(destination ? speciesTokens([destination]) : [], SPECIES_BUCKETS),
    ...hashedMultiHot(destination ? abilityTokens([destination]) : [], ABILITY_BUCKETS),
    ...hashedMultiHot(destination ? itemTokens([destination]) : [], ITEM_BUCKETS),
    ...hashedMultiHot(destination ? effectTokens([destination]) : [], EFFECT_BUCKETS),
    ...hashedMultiHot(monSemanticTokens(destination, observation), SEMANTIC_TOKEN_BUCKETS),
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

  if (features.length !== ER_COMBAT_FEATURE_NAMES.length) {
    throw new Error(`invalid ER combat feature vector length (${features.length}/${ER_COMBAT_FEATURE_NAMES.length})`);
  }
  const invalidIndex = features.findIndex(value => !Number.isFinite(value));
  if (invalidIndex >= 0) {
    throw new Error(
      `invalid ER combat feature ${ER_COMBAT_FEATURE_NAMES[invalidIndex]} at index ${invalidIndex}: ${String(features[invalidIndex])}`,
    );
  }
  return features;
}
