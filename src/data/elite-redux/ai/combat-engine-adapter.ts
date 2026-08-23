/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { erIsHeldItemDisabled, MoveRestrictionBattlerTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { erHeldItemSuppressionState, erIsHeldItemSuppressed } from "#data/elite-redux/abilities/item-suppression";
import {
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatAbilityObservation,
  type ErCombatCandidate,
  type ErCombatEffectObservation,
  type ErCombatItemObservation,
  type ErCombatModifierObservation,
  type ErCombatMonObservation,
  type ErCombatMoveCandidate,
  type ErCombatMoveObservation,
  type ErCombatObservation,
  type ErCombatPreviousActionObservation,
  type ErCombatStateField,
  type ErCombatTargetRef,
  withCanonicalCombatCandidateId,
} from "#data/elite-redux/ai/combat-contract";
import { snapshotErCombatPrivateMechanics } from "#data/elite-redux/ai/combat-private-state";
import { getErDamagePreview } from "#data/elite-redux/er-damage-preview";
import { getErRelicBattleState } from "#data/elite-redux/er-relic-battle-state";
import { getTypeDamageMultiplier } from "#data/type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { Stat } from "#enums/stat";
import {
  type EnemyPokemon,
  type PlayerPokemon,
  type Pokemon,
  withPokemonActiveAbilitySourceCache,
} from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import { canTerastallize } from "#utils/pokemon-utils";

export interface ErCombatEarlierChoice {
  kind: ErCombatCandidate["kind"];
  id: string;
  partyIndex?: number;
  tera?: boolean;
}

export type ErCombatPerspective = "player" | "enemy";

export interface ErCombatObservationOptions {
  perspective?: ErCombatPerspective;
  /** Opponent entities already exposed to this acting side earlier in the episode. */
  knownOpponentEntityIds?: ReadonlySet<number>;
  previousActions?: readonly ErCombatPreviousActionObservation[];
}

function normalizedSide(isActualPlayer: boolean, perspective: ErCombatPerspective): "self" | "opponent" {
  return isActualPlayer === (perspective === "player") ? "self" : "opponent";
}

function selfField(scene: BattleScene, perspective: ErCombatPerspective): Pokemon[] {
  return perspective === "player" ? scene.getPlayerField() : scene.getEnemyField();
}

function opponentField(scene: BattleScene, perspective: ErCombatPerspective): Pokemon[] {
  return perspective === "player" ? scene.getEnemyField() : scene.getPlayerField();
}

function selfParty(scene: BattleScene, perspective: ErCombatPerspective): Pokemon[] {
  return perspective === "player" ? scene.getPlayerParty() : scene.getEnemyParty();
}

function opponentParty(scene: BattleScene, perspective: ErCombatPerspective): Pokemon[] {
  return perspective === "player" ? scene.getEnemyParty() : scene.getPlayerParty();
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

const STATE_KEYS = [
  "appliedTag",
  "battleCount",
  "berryType",
  "charges",
  "chosenWeather",
  "consumed",
  "damage",
  "healHp",
  "kind",
  "layers",
  "lastMoveId",
  "maxLayers",
  "moveId",
  "moveSlot",
  "sourceCount",
  "spent",
  "turnCount",
  "turnsRemaining",
  "useCount",
  "used",
  "waveProgress",
] as const;

function stateFields(value: object, keys: readonly string[] = STATE_KEYS): ErCombatStateField[] {
  const record = value as Record<string, unknown>;
  return keys
    .flatMap(key => {
      const state = safe(() => record[key], undefined);
      return typeof state === "string" || typeof state === "number" || typeof state === "boolean" || state === null
        ? [{ key, value: state }]
        : [];
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function sortEffects(effects: ErCombatEffectObservation[]): ErCombatEffectObservation[] {
  return effects.sort((a, b) =>
    [a.scope, a.effectId, a.side ?? "", a.targetSlot ?? -1, a.sourceEntityId ?? -1]
      .join(":")
      .localeCompare([b.scope, b.effectId, b.side ?? "", b.targetSlot ?? -1, b.sourceEntityId ?? -1].join(":")),
  );
}

function abilitySourceName(source: { passive: boolean; passiveSlot?: number }): ErCombatAbilityObservation["source"] {
  return source.passive ? ((source.passiveSlot ?? 0) >= 3 ? "gift" : "innate") : "active";
}

function abilitySourceKey(source: { ability: { id: number }; passive: boolean; passiveSlot?: number }): string {
  return `${abilitySourceName(source)}:${source.passive ? (source.passiveSlot ?? 0) : -1}:${source.ability.id}`;
}

function abilitySourceOverridden(mon: Pokemon, source: { passive: boolean; passiveSlot?: number }): boolean {
  if (!source.passive) {
    return mon.summonData.ability != null || mon.customPokemonData.ability !== -1;
  }
  const slot = source.passiveSlot ?? 0;
  if (slot >= 3) {
    return false;
  }
  const custom = [mon.customPokemonData.passive, mon.customPokemonData.passive2, mon.customPokemonData.passive3][slot];
  return (
    mon.summonData.passiveAbility != null
    || mon.summonData.passiveAbilities?.[slot] != null
    || (custom != null && custom !== -1)
  );
}

function snapshotAbilities(
  mon: Pokemon,
  knowledge: ErCombatMonObservation["knowledge"],
  completeBattleInfo = false,
): ErCombatAbilityObservation[] {
  const sources = safe(() => mon.getAbilitySources(), []);
  const activeKeys = new Set(safe(() => mon.getActiveAbilitySources().map(abilitySourceKey), []));
  if (knowledge === "battle-info") {
    const revealedKeys = new Set(mon.waveData.revealedAbilityKeys);
    if (completeBattleInfo || mon.waveData.seenInBattle) {
      sources.forEach(source => revealedKeys.add(abilitySourceKey(source)));
    }
    if (revealedKeys.size === 0 && mon.waveData.abilityRevealed) {
      const primary = sources.find(source => !source.passive);
      if (primary) {
        revealedKeys.add(abilitySourceKey(primary));
      }
    }
    return sources
      .filter(source => revealedKeys.has(abilitySourceKey(source)))
      .map(source => {
        const slot = source.passive ? (source.passiveSlot ?? 0) : null;
        const active = activeKeys.has(abilitySourceKey(source));
        return {
          abilityId: source.ability.id,
          source: abilitySourceName(source),
          slot,
          active,
          suppressed: !active,
          overridden: abilitySourceOverridden(mon, source),
          revealed: true,
        } satisfies ErCombatAbilityObservation;
      })
      .sort((a, b) =>
        `${a.source}:${a.slot ?? -1}:${a.abilityId}`.localeCompare(`${b.source}:${b.slot ?? -1}:${b.abilityId}`),
      );
  }

  return sources
    .map(source => {
      const slot = source.passive ? (source.passiveSlot ?? 0) : null;
      const active = activeKeys.has(abilitySourceKey(source));
      return {
        abilityId: source.ability.id,
        source: abilitySourceName(source),
        slot,
        active,
        suppressed: !active,
        overridden: abilitySourceOverridden(mon, source),
        revealed: true,
      } satisfies ErCombatAbilityObservation;
    })
    .sort((a, b) =>
      `${a.source}:${a.slot ?? -1}:${a.abilityId}`.localeCompare(`${b.source}:${b.slot ?? -1}:${b.abilityId}`),
    );
}

function snapshotItem(mon: Pokemon, item: PokemonHeldItemModifier): ErCombatItemObservation {
  const record = item as unknown as Record<string, unknown>;
  const suppressed = erIsHeldItemDisabled(mon, item.type?.id) || erIsHeldItemSuppressed(mon, item.type?.id);
  const consumed =
    typeof record.consumed === "boolean" ? record.consumed : typeof record.spent === "boolean" ? record.spent : null;
  const charges = typeof record.charges === "number" ? record.charges : null;
  const suppression = erHeldItemSuppressionState(mon, item.type.id);
  return {
    itemId: item.type.id,
    className: item.constructor.name,
    stackCount: item.stackCount,
    virtualStackCount: item.virtualStackCount,
    charges,
    consumed,
    active: !suppressed && consumed !== true && charges !== 0,
    suppressed,
    revealed: true,
    state: [
      ...stateFields(item),
      ...(suppression
        ? [
            { key: "suppressionExpiryTurn", value: suppression.expiryTurn },
            { key: "suppressionTurnsLeft", value: suppression.turnsLeft },
          ]
        : []),
    ].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function snapshotItems(
  mon: Pokemon,
  knowledge: ErCombatMonObservation["knowledge"],
  completeBattleInfo = false,
): ErCombatItemObservation[] | null {
  const items = safe(() => mon.getHeldItems().map(item => snapshotItem(mon, item)), []).sort((a, b) =>
    `${a.itemId}:${a.className}`.localeCompare(`${b.itemId}:${b.className}`),
  );
  if (knowledge === "battle-info") {
    if (completeBattleInfo) {
      return items;
    }
    const revealed = mon.waveData.revealedHeldItemIds;
    if (!mon.waveData.seenInBattle && !mon.waveData.heldItemKnowledgeComplete && revealed.size === 0) {
      return null;
    }
    return items.filter(
      item => mon.waveData.seenInBattle || mon.waveData.heldItemKnowledgeComplete || revealed.has(item.itemId),
    );
  }
  return items;
}

function sideName(side: ArenaTagSide, perspective: ErCombatPerspective): ErCombatEffectObservation["side"] {
  switch (side) {
    case ArenaTagSide.PLAYER:
      return normalizedSide(true, perspective);
    case ArenaTagSide.ENEMY:
      return normalizedSide(false, perspective);
    default:
      return "both";
  }
}

function snapshotBattlerTags(mon: Pokemon, perspective: ErCombatPerspective): ErCombatEffectObservation[] {
  return sortEffects(
    safe(() => mon.summonData.tags, []).map(tag => ({
      effectId: tag.tagType,
      scope: "battler",
      side: normalizedSide(mon.isPlayer(), perspective),
      turnsLeft: tag.turnCount,
      maxDuration: null,
      sourceMoveId: tag.sourceMove ?? null,
      sourceEntityId: tag.sourceId ?? null,
      targetSlot: mon.isActive(true) ? mon.getBattlerIndex() : null,
      state: stateFields(tag),
    })),
  );
}

function mechanicToken(
  effectId: string,
  value: string | number | boolean,
  side: "self" | "opponent",
): ErCombatEffectObservation {
  return {
    effectId,
    scope: "mechanic",
    side,
    turnsLeft: null,
    maxDuration: null,
    sourceMoveId: null,
    sourceEntityId: null,
    targetSlot: null,
    state: [{ key: "value", value }],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The projection independently serializes each persistent mechanic family.
function snapshotMechanics(
  mon: Pokemon,
  knowledge: ErCombatMonObservation["knowledge"],
  perspective: ErCombatPerspective,
): ErCombatEffectObservation[] {
  const side = normalizedSide(mon.isPlayer(), perspective);
  const effects: ErCombatEffectObservation[] = [];
  const recentMoves = mon.summonData.moveHistory.slice(-8).reverse();
  for (const [offset, move] of recentMoves.entries()) {
    effects.push({
      ...mechanicToken(`move-history:${offset}`, true, side),
      sourceMoveId: move.move,
      state: [
        { key: "moveId", value: move.move },
        { key: "result", value: move.result ?? null },
        { key: "targets", value: move.targets.join(",") },
        { key: "useMode", value: move.useMode },
      ],
    });
  }
  for (const [index, move] of mon.getMoveQueue().entries()) {
    if (knowledge === "battle-info" && !mon.waveData.revealedMoveIds.has(move.move)) {
      continue;
    }
    effects.push({
      ...mechanicToken(`move-queue:${index}`, true, side),
      sourceMoveId: move.move,
      state: [
        { key: "moveId", value: move.move },
        { key: "targets", value: move.targets.join(",") },
        { key: "useMode", value: move.useMode },
      ],
    });
  }
  if (knowledge === "battle-info") {
    return sortEffects(effects);
  }
  for (const mechanic of snapshotErCombatPrivateMechanics(mon)) {
    effects.push({
      effectId: mechanic.effectId,
      scope: "mechanic",
      side,
      turnsLeft: null,
      maxDuration: null,
      sourceMoveId: mechanic.sourceMoveId ?? null,
      sourceEntityId: mechanic.sourceEntityId ?? null,
      targetSlot: mon.isActive(true) ? mon.getBattlerIndex() : null,
      state: mechanic.state.map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key)),
    });
  }
  const flagSources: readonly [string, object, readonly string[]][] = [
    [
      "summon",
      mon.summonData,
      [
        "abilitySuppressed",
        "chuckusterReductionUsed",
        "forceAttackerOutUsed",
        "erCommandedUsedThisSwitchIn",
        "erImposterCopiedAttackBoost",
      ],
    ],
    ["entry", mon.tempSummonData, ["turnCount", "waveTurnCount", "erPoisonWeakness", "erTelekineticStruggle"]],
    [
      "battle",
      mon.battleData,
      ["hitCount", "hasEatenBerry", "anticipationDodgeUsed", "rudeAwakeningTriggered", "cowardProtectUsed"],
    ],
    ["wave", mon.waveData, ["endured", "firstDefendConsumed"]],
    [
      "turn",
      mon.turnData,
      ["acted", "switchedInThisTurn", "summonedThisTurn", "pendingStatus", "failedRunAway", "joinedRound"],
    ],
  ];
  for (const [scope, source, keys] of flagSources) {
    for (const field of stateFields(source, keys)) {
      if (field.value !== false && field.value !== 0 && field.value !== null) {
        effects.push(mechanicToken(`${scope}:${field.key}`, field.value, side));
      }
    }
  }
  for (const [scope, values] of [
    ["summon-provenance", mon.summonData.erAbilityProvenance],
    ["turn-provenance", mon.turnData.erAbilityProvenance],
    ["entry-window", [...mon.tempSummonData.abilityEntryWindows]],
    ["entry-fired", [...mon.waveData.entryEffectsFired]],
  ] as const) {
    for (const value of values) {
      effects.push(mechanicToken(`${scope}:${value}`, true, side));
    }
  }
  for (const suppression of mon.summonData.erTimedAbilitySuppressions) {
    effects.push({
      ...mechanicToken(`ability-suppression:${suppression.abilityId}`, true, side),
      state: stateFields(suppression),
    });
  }
  mon.summonData.erSuppressedInnateSlots.forEach((suppressed, slot) => {
    if (suppressed) {
      effects.push(mechanicToken(`innate-slot-suppression:${slot}`, true, side));
    }
  });
  return sortEffects(effects);
}

function snapshotMove(
  mon: Pokemon,
  move: ReturnType<Pokemon["getMoveset"]>[number],
  slot: number,
): ErCombatMoveObservation {
  const data = move.getMove();
  const unavailableReasons: string[] = [];
  if (mon.tempSummonData.erTelekineticStruggle && move.moveId !== MoveId.STRUGGLE) {
    unavailableReasons.push("telekinetic-struggle");
  }
  if (move.moveId === MoveId.NONE || data.name.endsWith(" (N)")) {
    unavailableReasons.push("not-implemented");
  }
  if (move.isOutOfPp()) {
    unavailableReasons.push("no-pp");
  }
  for (const tag of mon.summonData.tags) {
    if (tag instanceof MoveRestrictionBattlerTag && safe(() => tag.isMoveRestricted(move.moveId, mon), false)) {
      unavailableReasons.push(`battler-tag:${tag.tagType}`);
    }
  }
  if (mon.getTag(BattlerTagType.RECHARGING)) {
    unavailableReasons.push(`battler-tag:${BattlerTagType.RECHARGING}`);
  }
  const usable = safe(() => move.isUsable(mon, false, true)[0], false);
  if (!usable && unavailableReasons.length === 0) {
    unavailableReasons.push("other-engine-restriction");
  }
  return {
    slot,
    moveId: move.moveId,
    baseType: data.type,
    type: safe(() => mon.getMoveType(data), data.type),
    category: data.category,
    power: data.power,
    accuracy: data.accuracy,
    priority: data.priority,
    ppUsed: move.ppUsed,
    maxPp: move.getMovePp(),
    usable,
    unavailableReasons: [...new Set(unavailableReasons)].sort(),
    revealed: true,
  };
}

function snapshotPublicOpponentMoves(mon: Pokemon): ErCombatMoveObservation[] {
  return [...mon.waveData.revealedMoveIds]
    .sort((a, b) => a - b)
    .flatMap(moveId => {
      const data = allMoves[moveId];
      return data
        ? [
            {
              slot: null,
              moveId,
              baseType: data.type,
              type: data.type,
              category: data.category,
              power: data.power,
              accuracy: data.accuracy,
              priority: data.priority,
              ppUsed: null,
              maxPp: null,
              usable: null,
              unavailableReasons: [],
              revealed: true,
            },
          ]
        : [];
    });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Visibility-aware fields are assembled independently and fail closed.
function snapshotMon(
  scene: BattleScene,
  mon: Pokemon,
  knowledge: ErCombatMonObservation["knowledge"],
  partyIndex: number | null,
  activeSlot: number | null,
  perspective: ErCombatPerspective,
): ErCombatMonObservation {
  const currentSpecies = safe(() => mon.getSpeciesForm(), mon.species);
  const selfKnowledge = knowledge === "self";
  const knownOpponentBench = knowledge === "battle-info" && activeSlot == null;
  const completeBattleInfo = knowledge === "battle-info" && activeSlot != null;
  const maxHp = safe(() => mon.getMaxHp(), 0);
  const stats = selfKnowledge
    ? safe(
        () => ([Stat.HP, Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const).map(stat => mon.getStat(stat)),
        [],
      )
    : null;
  const effectiveStats = selfKnowledge
    ? safe(
        () =>
          ([Stat.HP, Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const).map(stat =>
            stat === Stat.HP ? mon.getMaxHp() : mon.getEffectiveStat(stat),
          ),
        [],
      )
    : null;
  const formTransition =
    currentSpecies.speciesId !== mon.species.speciesId || currentSpecies.formIndex !== mon.formIndex
      ? {
          fromSpecies: mon.species.speciesId,
          fromForm: mon.formIndex,
          toSpecies: currentSpecies.speciesId,
          toForm: currentSpecies.formIndex,
        }
      : null;
  const boss = mon as Pokemon & { bossSegments?: number; bossSegmentIndex?: number };
  const abilities = snapshotAbilities(mon, knowledge, completeBattleInfo);
  const allAbilitySourceKeys = safe(() => mon.getAbilitySources().map(abilitySourceKey), []);
  const abilityKnowledgeComplete =
    completeBattleInfo
    || mon.waveData.seenInBattle
    || allAbilitySourceKeys.every(key => mon.waveData.revealedAbilityKeys.has(key));
  const heldItems = snapshotItems(mon, knowledge, completeBattleInfo);
  const moves = selfKnowledge
    ? safe(() => mon.getMoveset().map((move, slot) => snapshotMove(mon, move, slot)), [])
    : snapshotPublicOpponentMoves(mon);
  return {
    entityId: mon.id,
    knowledge,
    partyIndex,
    activeSlot,
    species: currentSpecies.speciesId,
    form: currentSpecies.formIndex,
    originalSpecies: mon.species.speciesId,
    originalForm: mon.formIndex,
    level: mon.level,
    nativeTypes: safe(() => [...mon.getTypes(false, false, true)], []),
    types: safe(() => [...mon.getTypes()], []),
    hp: selfKnowledge ? mon.hp : null,
    maxHp: selfKnowledge ? maxHp : null,
    hpRatio: knownOpponentBench ? null : maxHp > 0 ? mon.hp / maxHp : 0,
    status: safe(() => mon.status?.effect ?? null, null),
    statStages: knownOpponentBench ? [] : safe(() => [...mon.getStatStages()], []),
    stats,
    effectiveStats,
    abilities,
    heldItems,
    revealState: {
      abilities: selfKnowledge || abilityKnowledgeComplete ? "complete" : abilities.length > 0 ? "partial" : "unknown",
      items: selfKnowledge
        ? "complete"
        : completeBattleInfo || mon.waveData.seenInBattle || mon.waveData.heldItemKnowledgeComplete
          ? "complete"
          : mon.waveData.revealedHeldItemIds.size > 0
            ? "partial"
            : "unknown",
      moves: selfKnowledge ? "complete" : mon.waveData.revealedMoveIds.size > 0 ? "partial" : "unknown",
      revealedAbilityIds: selfKnowledge
        ? abilities.map(ability => ability.abilityId)
        : [...new Set(abilities.map(ability => ability.abilityId))].sort((a, b) => a - b),
      revealedItemIds: selfKnowledge
        ? (heldItems ?? []).map(item => item.itemId)
        : completeBattleInfo || mon.waveData.seenInBattle || mon.waveData.heldItemKnowledgeComplete
          ? (heldItems ?? []).map(item => item.itemId).sort()
          : [...mon.waveData.revealedHeldItemIds].sort(),
      revealedMoveIds: selfKnowledge
        ? safe(() => mon.getMoveset().map(move => move.moveId), []).sort((a, b) => a - b)
        : [...mon.waveData.revealedMoveIds].sort((a, b) => a - b),
    },
    tags: knownOpponentBench ? [] : snapshotBattlerTags(mon, perspective),
    mechanics: snapshotMechanics(mon, knowledge, perspective),
    transformation: {
      teraType: selfKnowledge || mon.isTerastallized ? mon.teraType : null,
      terastallized: mon.isTerastallized,
      teraAvailable: selfKnowledge
        ? mon.isPlayer()
          ? safe(() => canTerastallize(mon as PlayerPokemon), false)
          : safe(() => !!scene.currentBattle.trainer?.shouldTera(mon as EnemyPokemon), false)
        : null,
      formChanged: formTransition != null || mon.summonData.speciesForm != null,
      formTransition,
    },
    boss: {
      segments: boss.bossSegments ?? 0,
      segmentIndex: boss.bossSegmentIndex ?? 0,
      phase: (boss.bossSegments ?? 0) > 0 ? (boss.bossSegments ?? 0) - (boss.bossSegmentIndex ?? 0) : null,
    },
    moves,
    fainted: mon.isFainted(),
  };
}

function snapshotArenaEffects(scene: BattleScene, perspective: ErCombatPerspective): ErCombatEffectObservation[] {
  return sortEffects(
    scene.arena.tags.map(tag => ({
      effectId: tag.tagType,
      scope: tag.side === ArenaTagSide.BOTH ? "field" : "side",
      side: sideName(tag.side, perspective),
      turnsLeft: tag.turnCount,
      maxDuration: tag.maxDuration,
      sourceMoveId: tag.sourceMove ?? null,
      sourceEntityId: tag.sourceId ?? null,
      targetSlot: null,
      state: stateFields(tag),
    })),
  );
}

function snapshotPositionalEffects(scene: BattleScene): ErCombatEffectObservation[] {
  return sortEffects(
    scene.arena.positionalTagManager.tags.map(tag => {
      const record = tag as unknown as { sourceMove?: number; sourceId?: number };
      return {
        effectId: tag.tagType,
        scope: "position",
        side: null,
        turnsLeft: tag.turnCount,
        maxDuration: null,
        sourceMoveId: record.sourceMove ?? null,
        sourceEntityId: record.sourceId ?? null,
        targetSlot: tag.targetIndex,
        state: stateFields(tag),
      };
    }),
  );
}

function snapshotGlobalMechanics(scene: BattleScene, perspective: ErCombatPerspective): ErCombatEffectObservation[] {
  if (perspective === "enemy") {
    return [];
  }
  const relicState = getErRelicBattleState();
  if (relicState.wave !== scene.currentBattle.waveIndex) {
    return [];
  }
  return sortEffects(
    Object.entries(relicState.lists).map(([key, entityIds]) => ({
      effectId: `relic-state:${key}`,
      scope: "mechanic",
      side: "self",
      turnsLeft: null,
      maxDuration: null,
      sourceMoveId: null,
      sourceEntityId: null,
      targetSlot: null,
      state: [
        { key: "count", value: entityIds.length },
        { key: "subjects", value: entityIds.join(",") },
      ],
    })),
  );
}

function snapshotModifier(
  modifier: Exclude<ReturnType<BattleScene["findModifier"]>, undefined>,
  side: "self" | "opponent",
): ErCombatModifierObservation {
  const record = modifier as unknown as Record<string, unknown>;
  const ownerEntityId = typeof record.pokemonId === "number" ? record.pokemonId : null;
  const inactive = record.active === false || record.consumed === true || record.spent === true;
  return {
    modifierId: modifier.type.id,
    className: modifier.constructor.name,
    side,
    scope: ownerEntityId == null ? (modifier.constructor.name === "ErRelicModifier" ? "run" : "team") : "pokemon",
    ownerEntityId,
    stackCount: modifier.stackCount,
    virtualStackCount: modifier.virtualStackCount,
    active: !inactive,
    state: stateFields(modifier),
  };
}

function snapshotModifiers(scene: BattleScene, perspective: ErCombatPerspective): ErCombatModifierObservation[] {
  const snapshots: ErCombatModifierObservation[] = [];
  for (const modifier of scene.findModifiers(() => true, perspective === "player")) {
    if (!(modifier instanceof PokemonHeldItemModifier)) {
      snapshots.push(snapshotModifier(modifier, "self"));
    }
  }
  return snapshots.sort((a, b) =>
    `${a.side}:${a.scope}:${a.ownerEntityId ?? -1}:${a.modifierId}`.localeCompare(
      `${b.side}:${b.scope}:${b.ownerEntityId ?? -1}:${b.modifierId}`,
    ),
  );
}

export function snapshotErCombatObservation(
  scene: BattleScene,
  options: ErCombatObservationOptions = {},
): ErCombatObservation {
  const perspective = options.perspective ?? "player";
  const ownParty = selfParty(scene, perspective);
  const ownField = selfField(scene, perspective);
  const opposingParty = opponentParty(scene, perspective);
  const opposingField = opponentField(scene, perspective);
  const activeOpponentIds = new Set(opposingField.map(mon => mon.id));
  const knownOpponentIds = options.knownOpponentEntityIds ?? new Set<number>();
  const enemyTerasUsed = new Set<number>();
  if (perspective === "enemy") {
    scene
      .getEnemyParty()
      .filter(mon => mon.isTerastallized)
      .forEach(mon => enemyTerasUsed.add(mon.id));
    scene.currentBattle.enemyFaintsHistory
      .filter(entry => entry.pokemon.isTerastallized)
      .forEach(entry => enemyTerasUsed.add(entry.pokemon.id));
  }
  return {
    version: ER_COMBAT_CONTRACT_VERSION,
    perspective: "self",
    wave: scene.currentBattle.waveIndex,
    turn: scene.currentBattle.turn,
    biome: scene.arena.biomeId,
    battleType: scene.currentBattle.battleType,
    format: scene.currentBattle.getBattlerCount(),
    weather: scene.arena.weather
      ? {
          effectId: scene.arena.weather.weatherType,
          turnsLeft: scene.arena.weather.turnsLeft,
          maxDuration: scene.arena.weather.maxDuration,
          immutable: scene.arena.weather.isImmutable(),
          suppressed: scene.arena.weather.isEffectSuppressed(),
          sourceEntityId: scene.arena.weather.sourceEntityId,
          owner:
            scene.arena.weather.sourcePlayer == null
              ? "field"
              : normalizedSide(scene.arena.weather.sourcePlayer, perspective),
        }
      : null,
    terrain: scene.arena.terrain
      ? {
          effectId: scene.arena.terrain.terrainType,
          turnsLeft: scene.arena.terrain.turnsLeft,
          maxDuration: scene.arena.terrain.maxDuration,
          immutable: scene.arena.terrain.turnsLeft === 0,
          suppressed: scene.arena.isFieldEffectSuppressed(),
          sourceEntityId: scene.arena.terrain.sourceEntityId,
          owner:
            scene.arena.terrain.sourcePlayer == null
              ? "field"
              : normalizedSide(scene.arena.terrain.sourcePlayer, perspective),
        }
      : null,
    fieldEffects: snapshotArenaEffects(scene, perspective),
    positionalEffects: snapshotPositionalEffects(scene),
    mechanics: snapshotGlobalMechanics(scene, perspective),
    modifiers: snapshotModifiers(scene, perspective),
    selfParty: ownParty.map((mon, partyIndex) => {
      const activeSlot = ownField.findIndex(active => active?.id === mon.id);
      return snapshotMon(scene, mon, "self", partyIndex, activeSlot >= 0 ? activeSlot : null, perspective);
    }),
    opponentActive: opposingField.map((mon, activeSlot) =>
      snapshotMon(scene, mon, "battle-info", null, activeSlot, perspective),
    ),
    opponentKnownParty: opposingParty
      .filter(
        mon =>
          !activeOpponentIds.has(mon.id)
          && (perspective === "player" ? mon.waveData.seenInBattle : knownOpponentIds.has(mon.id)),
      )
      .map(mon => snapshotMon(scene, mon, "battle-info", null, null, perspective)),
    opponentRosterSize: opposingParty.length,
    /** Normalized acting-side count; the legacy field name is retained for contract-v3 compatibility. */
    playerTerasUsed: perspective === "player" ? scene.arena.playerTerasUsed : enemyTerasUsed.size,
    previousActions: [...(options.previousActions ?? [])].slice(-32),
  };
}

/** Project the engine's complete two-sided turn command map without invoking either side's chooser. */
export function snapshotErCombatJointActions(
  scene: BattleScene,
  jointActionId: string,
  phase: "committed" | "resolved",
  previous: readonly ErCombatPreviousActionObservation[] = [],
): ErCombatPreviousActionObservation[] {
  const battle = scene.currentBattle;
  return Object.entries(battle.turnCommands).flatMap(([flatSlotText, command]) => {
    if (command == null) {
      return [];
    }
    const flatSlot = Number(flatSlotText);
    const located = battle.arrangement.locate(flatSlot);
    const opponent = flatSlot >= battle.arrangement.enemyOffset;
    const side = opponent ? "opponent" : "self";
    const field = opponent ? scene.getEnemyField() : scene.getPlayerField();
    const actor = field[located.position];
    const committedActionId = `${jointActionId}:${side}:${located.position}:committed`;
    const committed = previous.find(action => action.actionId === committedActionId);
    if (actor == null && committed == null) {
      return [];
    }
    const forced = command.skip === true || (command.command === Command.FIGHT && command.move?.move === MoveId.NONE);
    const kind: ErCombatPreviousActionObservation["kind"] = forced
      ? "forced"
      : command.command === Command.FIGHT
        ? "move"
        : command.command === Command.POKEMON
          ? "switch"
          : command.command === Command.SHIFT
            ? "shift"
            : command.command === Command.BALL
              ? "ball"
              : "run";
    return [
      {
        actionId: `${jointActionId}:${side}:${located.position}:${phase}`,
        jointActionId,
        turn: battle.turn,
        side,
        actorEntityId: committed?.actorEntityId ?? actor!.id,
        actorSlot: located.position,
        phase,
        kind,
        automatic: committed?.automatic ?? forced,
        moveId: command.move?.move ?? null,
        moveSlot: command.command === Command.FIGHT ? (command.cursor ?? null) : null,
        partyIndex: command.command === Command.POKEMON ? (command.cursor ?? null) : null,
        transfer: command.command === Command.POKEMON ? (command.args?.[0] ? "baton" : "normal") : null,
        tera: battle.preTurnCommands[flatSlot]?.command === Command.TERA,
        targets: (command.targets ?? command.move?.targets ?? [])
          .map(target => targetRef(scene, target, "player"))
          .filter(target => target != null),
        result: phase === "resolved" ? (command.move?.result ?? null) : null,
        resolutionOrder:
          phase === "resolved" && command.command === Command.FIGHT
            ? (() => {
                const index = scene.phaseManager.dynamicQueueManager
                  .getLastTurnOrder()
                  .findIndex(mon => mon.id === (committed?.actorEntityId ?? actor!.id));
                return index >= 0 ? index : null;
              })()
            : null,
      },
    ];
  });
}

function targetRef(
  scene: BattleScene,
  battlerIndex: number,
  perspective: ErCombatPerspective,
): ErCombatTargetRef | null {
  const ownField = selfField(scene, perspective);
  const opposingField = opponentField(scene, perspective);
  const self = ownField.findIndex(mon => mon?.getBattlerIndex() === battlerIndex);
  if (self >= 0) {
    return { side: "self", entityId: ownField[self].id, activeSlot: self };
  }
  const opponent = opposingField.findIndex(mon => mon?.getBattlerIndex() === battlerIndex);
  return opponent < 0 ? null : { side: "opponent", entityId: opposingField[opponent].id, activeSlot: opponent };
}

function moveTargetSets(
  scene: BattleScene,
  actor: Pokemon,
  moveId: MoveId,
  perspective: ErCombatPerspective,
): {
  targetMode: "resolved" | "random";
  sets: ErCombatTargetRef[][];
} {
  const move = allMoves[moveId];
  if (move.moveTarget === MoveTarget.RANDOM_NEAR_ENEMY) {
    // Calling getMoveTargets here would consume battle RNG and make observation change gameplay.
    return { targetMode: "random", sets: [[]] };
  }
  const targets = getMoveTargets(actor, moveId);
  const rawSets = targets.multiple ? [targets.targets] : targets.targets.map(target => [target]);
  return {
    targetMode: "resolved",
    sets: (rawSets.length > 0 ? rawSets : [[]])
      .filter(set => {
        if (targets.multiple) {
          return true;
        }
        const target = scene.getField(true).find(mon => mon?.getBattlerIndex() === set[0]);
        return target == null || !actor.isMoveTargetRestricted(moveId, target);
      })
      .map(set =>
        set
          .map(target => targetRef(scene, target, perspective))
          .filter((target): target is ErCombatTargetRef => target != null),
      ),
  };
}

function baseTypeMultiplier(
  scene: BattleScene,
  actor: Pokemon,
  moveId: MoveId,
  targets: readonly ErCombatTargetRef[],
  perspective: ErCombatPerspective,
): number {
  const move = allMoves[moveId];
  const moveType = safe(() => actor.getMoveType(move), move.type);
  const targetMons =
    targets.length > 0
      ? targets
          .map(target =>
            (target.side === "self" ? selfField(scene, perspective) : opponentField(scene, perspective)).find(
              mon => mon.id === target.entityId,
            ),
          )
          .filter((mon): mon is NonNullable<typeof mon> => mon != null)
      : opponentField(scene, perspective).filter(mon => mon.isActive(true));
  if (targetMons.length === 0) {
    return 1;
  }
  return (
    targetMons.reduce(
      (sum, target) =>
        sum + target.getTypes().reduce((multiplier, type) => multiplier * getTypeDamageMultiplier(moveType, type), 1),
      0,
    ) / targetMons.length
  );
}

function moveAttributeFraction(move: Move, className: "HitHealAttr" | "RecoilAttr"): number | null {
  const attribute = move.attrs.find(candidate => candidate.constructor.name === className) as
    | Record<string, unknown>
    | undefined;
  if (!attribute) {
    return null;
  }
  if (className === "HitHealAttr") {
    return attribute.healStat == null && typeof attribute.healRatio === "number" ? attribute.healRatio : null;
  }
  return typeof attribute.damageRatio === "number" ? attribute.damageRatio : null;
}

function previewHitRange(label: string): { expected: number; min: number; max: number } | null {
  const range = /^(\d+)-(\d+)/u.exec(label);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return { expected: (min + max) / 2, min, max };
  }
  const fixed = /^(\d+)/u.exec(label);
  if (fixed) {
    const hits = Number(fixed[1]);
    return { expected: hits, min: hits, max: hits };
  }
  return label ? null : { expected: 1, min: 1, max: 1 };
}

function candidateDerivedFeatures(
  scene: BattleScene,
  actor: Pokemon,
  moveId: MoveId,
  targets: readonly ErCombatTargetRef[],
  targetMode: "resolved" | "random",
  tera: boolean,
  perspective: ErCombatPerspective,
  chartMultiplier: number,
): ErCombatMoveCandidate["derived"] {
  const move = allMoves[moveId];
  const resolvedTargets =
    targets.length > 0
      ? targets.flatMap(target => {
          const field = target.side === "self" ? selfField(scene, perspective) : opponentField(scene, perspective);
          const mon = field.find(candidate => candidate.id === target.entityId);
          return mon ? [{ target, mon }] : [];
        })
      : targetMode === "random"
        ? opponentField(scene, perspective)
            .filter(mon => mon.isActive(true))
            .map((mon, activeSlot) => ({
              target: { side: "opponent", entityId: mon.id, activeSlot } satisfies ErCombatTargetRef,
              mon,
            }))
        : [];
  const previews =
    !tera && move.category !== MoveCategory.STATUS
      ? resolvedTargets.map(({ mon }) => getErDamagePreview(actor, mon, move))
      : [];
  const combine = (select: (preview: (typeof previews)[number]) => number): number | null => {
    if (previews.length === 0) {
      return null;
    }
    const total = previews.reduce((sum, preview) => sum + select(preview), 0);
    return targetMode === "random" ? Math.floor(total / previews.length) : total;
  };
  const expectedDamageMax = combine(preview => preview.max);
  const hitRange = previews.length > 0 ? previewHitRange(previews[0].hits) : null;
  const multiplierFor = (target: Pokemon): number | null =>
    safe(
      () =>
        target.getAttackTypeEffectiveness(actor.getMoveType(move), {
          source: actor,
          move,
          simulated: true,
        }),
      null,
    );
  const targetOutcomes = resolvedTargets.map(({ target, mon }, index) => {
    const preview = previews[index];
    const multiplier = multiplierFor(mon);
    return {
      target,
      engineTypeMultiplier: multiplier,
      expectedDamageMin: preview?.min ?? null,
      expectedDamageMax: preview?.max ?? null,
      expectedCriticalDamage: preview?.crit ?? null,
      immunityReason: move.category !== MoveCategory.STATUS && multiplier === 0 ? "revealed-engine-immunity" : null,
    };
  });
  const engineTypeMultiplier = targetOutcomes.length === 1 ? targetOutcomes[0].engineTypeMultiplier : null;
  const choiceItem = actor.getHeldItems().find(item => item.type.id.includes("CHOICE"));
  const chargingMove = move as Move & { chargeAttrs?: unknown[] };
  return {
    effectivePriority: safe(() => move.getPriority(actor), move.priority),
    actsBeforeTargets: null,
    orderAssessment:
      resolvedTargets.length === 0
        ? "not-applicable"
        : resolvedTargets.some(({ mon }) => mon.isPlayer() !== actor.isPlayer())
          ? "opponent-action-unknown"
          : "tie",
    engineTypeMultiplier,
    targetOutcomes,
    expectedDamageMin: combine(preview => preview.min),
    expectedDamageMax,
    expectedCriticalDamage: combine(preview => preview.crit),
    expectedHits: hitRange?.expected ?? null,
    minHits: hitRange?.min ?? null,
    maxHits: hitRange?.max ?? null,
    immunityReason:
      chartMultiplier === 0
        ? "type-chart"
        : engineTypeMultiplier === 0 && move.category !== MoveCategory.STATUS
          ? "revealed-engine-immunity"
          : null,
    hasDrain: move.hasAttr("HitHealAttr"),
    drainFraction: moveAttributeFraction(move, "HitHealAttr"),
    hasRecoil: move.hasAttr("RecoilAttr"),
    recoilFraction: moveAttributeFraction(move, "RecoilAttr"),
    statusChance: move.chance > 0 ? move.chance / 100 : null,
    requiresCharge: (chargingMove.chargeAttrs?.length ?? 0) > 0,
    forcesRecharge: move.hasAttr("RechargeAttr"),
    createsMoveLock: choiceItem != null,
    moveLockReason: choiceItem?.type.id ?? null,
    selfFaints:
      move.hasAttr("SacrificialAttr")
      || move.hasAttr("SacrificialAttrOnHit")
      || move.hasAttr("SacrificialFullRestoreAttr"),
  };
}

function appendMoveCandidates(
  scene: BattleScene,
  actor: Pokemon,
  actorSlot: number,
  canTera: boolean,
  candidates: ErCombatCandidate[],
  perspective: ErCombatPerspective,
): void {
  const usableMoves = actor
    .getMoveset()
    .map((move, moveSlot) => ({ move, moveSlot }))
    .filter(({ move }) => move.isUsable(actor, false, true)[0]);
  const moveRows =
    usableMoves.length > 0
      ? usableMoves
      : [{ move: { moveId: MoveId.STRUGGLE } as (typeof usableMoves)[number]["move"], moveSlot: -1 }];
  for (const { move, moveSlot } of moveRows) {
    const { targetMode, sets } = moveTargetSets(scene, actor, move.moveId, perspective);
    for (const targets of sets) {
      const chartMultiplier = baseTypeMultiplier(scene, actor, move.moveId, targets, perspective);
      const shared = {
        kind: "move" as const,
        actorSlot,
        moveSlot,
        moveId: move.moveId,
        targetMode,
        targets,
        baseTypeMultiplier: chartMultiplier,
        currentStab: actor.getTypes().includes(actor.getMoveType(allMoves[move.moveId])),
      };
      candidates.push(
        withCanonicalCombatCandidateId({
          ...shared,
          tera: false,
          derived: candidateDerivedFeatures(
            scene,
            actor,
            move.moveId,
            targets,
            targetMode,
            false,
            perspective,
            chartMultiplier,
          ),
        }),
      );
      if (canTera && moveSlot >= 0) {
        candidates.push(
          withCanonicalCombatCandidateId({
            ...shared,
            tera: true,
            derived: candidateDerivedFeatures(
              scene,
              actor,
              move.moveId,
              targets,
              targetMode,
              true,
              perspective,
              chartMultiplier,
            ),
          }),
        );
      }
    }
  }
}

function appendSwitchCandidates(
  scene: BattleScene,
  actor: Pokemon,
  actorSlot: number,
  earlier: readonly ErCombatEarlierChoice[],
  candidates: ErCombatCandidate[],
  perspective: ErCombatPerspective,
): void {
  const reservedPartySlots = new Set(
    earlier
      .filter(choice => choice.kind === "switch")
      .map(choice => choice.partyIndex)
      .filter(Number.isInteger),
  );
  const canNormalSwitch = !actor.isTrapped([], true);
  const canBaton = !!scene.findModifier(
    modifier => modifier.is("SwitchEffectTransferModifier") && modifier.pokemonId === actor.id,
    actor.isPlayer(),
  );
  for (const [partyIndex, pokemon] of selfParty(scene, perspective).entries()) {
    if (
      pokemon.id === actor.id
      || pokemon.isActive(true)
      || !pokemon.isAllowedInBattle()
      || reservedPartySlots.has(partyIndex)
    ) {
      continue;
    }
    if (canNormalSwitch) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "switch", actorSlot, partyIndex, transfer: "normal" }));
    }
    if (canBaton) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "switch", actorSlot, partyIndex, transfer: "baton" }));
    }
  }
}

function appendShiftCandidates(
  scene: BattleScene,
  actorSlot: number,
  candidates: ErCombatCandidate[],
  perspective: ErCombatPerspective,
): void {
  if (scene.currentBattle.getBattlerCount() < 3) {
    return;
  }
  selfField(scene, perspective).forEach((ally, targetActorSlot) => {
    if (targetActorSlot !== actorSlot && ally?.isActive(true)) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "shift", actorSlot, targetActorSlot }));
    }
  });
}

/**
 * Enumerate the engine-legal COMBAT command candidates for one player field slot.
 * Balls and run are a separate future action domain and are intentionally not implied by this API.
 */
export function enumerateErCombatCandidates(
  scene: BattleScene,
  actorSlot: number,
  earlier: readonly ErCombatEarlierChoice[] = [],
  perspective: ErCombatPerspective = "player",
): ErCombatCandidate[] {
  if (scene.gameMode.isCoop) {
    throw new Error("the v1 offline combat contract does not capture co-op decisions");
  }
  const actor = selfField(scene, perspective)[actorSlot];
  if (!actor?.isActive(true) || actor.isFainted()) {
    return [];
  }
  return withPokemonActiveAbilitySourceCache(() => {
    const candidates: ErCombatCandidate[] = [];
    const teraAlreadyPlanned =
      perspective === "player" && earlier.some(choice => choice.kind === "move" && choice.tera);
    const canTera =
      perspective === "player"
        ? canTerastallize(actor as PlayerPokemon)
          && scene.arena.playerTerasUsed + +teraAlreadyPlanned < MAX_TERAS_PER_ARENA
        : safe(() => !!scene.currentBattle.trainer?.shouldTera(actor as EnemyPokemon), false);
    appendMoveCandidates(scene, actor, actorSlot, canTera, candidates, perspective);
    appendSwitchCandidates(scene, actor, actorSlot, earlier, candidates, perspective);
    appendShiftCandidates(scene, actorSlot, candidates, perspective);
    return candidates;
  });
}
