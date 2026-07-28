/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import type { CoopTrainerVictoryMaterial } from "#data/elite-redux/coop/coop-operation-envelope";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { BattleType } from "#enums/battle-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";

/**
 * Immutable material and presentation identity for one defeated trainer.
 *
 * The authoritative encounter carrier constructs the exact host-authored trainer before the battle opens.
 * Capture the values TrainerVictoryPhase will need at that boundary: after a retained wave transaction wins,
 * a speculative NewBattle may already have replaced `currentBattle` with wave N+1. Reading that mutable
 * ambient battle would apply the wrong trainer's rewards or throw when wave N+1 is wild.
 */
export interface CoopTrainerVictoryBoundary {
  readonly sourceWave: number;
  readonly trainerType: TrainerType;
  readonly moneyMultiplier: number;
  readonly modifierRewardFuncs: readonly ModifierTypeFunc[];
  readonly isBoss: boolean;
  readonly hasCharSprite: boolean;
  readonly victoryBgm: string | undefined;
  readonly trainerSpriteKey: string;
  readonly trainerName: string;
  readonly trainerDialogueName: string;
  readonly victoryMessages: readonly string[];
  readonly biomeId: number;
  readonly isErGhost: boolean;
}

/** Per-renderer ownership: the two-engine harness shares modules but production browsers do not. */
const contextsByScene = new WeakMap<object, Map<number, CoopTrainerVictoryBoundary>>();
const MAX_RETAINED_TRAINER_BOUNDARIES = 4;

function freezeBoundary(boundary: CoopTrainerVictoryBoundary): CoopTrainerVictoryBoundary {
  Object.freeze(boundary.modifierRewardFuncs);
  Object.freeze(boundary.victoryMessages);
  return Object.freeze(boundary);
}

function retainBoundary(scene: BattleScene, boundary: CoopTrainerVictoryBoundary): CoopTrainerVictoryBoundary {
  let byWave = contextsByScene.get(scene);
  if (byWave == null) {
    byWave = new Map<number, CoopTrainerVictoryBoundary>();
    contextsByScene.set(scene, byWave);
  }
  byWave.delete(boundary.sourceWave);
  byWave.set(boundary.sourceWave, boundary);
  while (byWave.size > MAX_RETAINED_TRAINER_BOUNDARIES) {
    const oldestWave = byWave.keys().next().value;
    if (oldestWave === undefined) {
      break;
    }
    byWave.delete(oldestWave);
  }
  return boundary;
}

/** Snapshot a live trainer battle without retaining its mutable Battle/Trainer objects. */
export function snapshotCoopTrainerVictoryBoundary(
  scene: BattleScene,
  battle: Battle,
): CoopTrainerVictoryBoundary | null {
  const trainer = battle.trainer;
  // Mystery-encounter trainer battles keep battleType MYSTERY_ENCOUNTER and mark
  // trainer-ness via encounterMode (see Battle#getBgmOverride) - they reach
  // TrainerVictoryPhase too, so the snapshot must accept them or solo ME trainer
  // victories throw "TrainerVictoryPhase started without a trainer battle".
  const isTrainerBattle =
    battle.battleType === BattleType.TRAINER
    || battle.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE;
  if (!isTrainerBattle || trainer == null || !Number.isInteger(battle.waveIndex)) {
    return null;
  }
  const config = trainer.config;
  return freezeBoundary({
    sourceWave: battle.waveIndex,
    trainerType: config.trainerType,
    moneyMultiplier: config.moneyMultiplier,
    modifierRewardFuncs: [...config.modifierRewardFuncs],
    isBoss: config.isBoss,
    hasCharSprite: config.hasCharSprite,
    victoryBgm: config.victoryBgm,
    trainerSpriteKey: trainer.getKey(),
    trainerName: trainer.getName(TrainerSlot.NONE, true),
    trainerDialogueName: trainer.getName(TrainerSlot.TRAINER, true),
    victoryMessages: [...trainer.getVictoryMessages()],
    biomeId: scene.arena.biomeId,
    isErGhost: hasErGhostOverride(trainer),
  });
}

/** Retain one exact source-wave context for a later retained TrainerVictoryPhase. */
export function captureCoopTrainerVictoryBoundary(
  scene: BattleScene,
  battle: Battle,
): CoopTrainerVictoryBoundary | null {
  const boundary = snapshotCoopTrainerVictoryBoundary(scene, battle);
  if (boundary == null) {
    return null;
  }
  return retainBoundary(scene, boundary);
}

/** Capture the complete JSON-safe trainer-victory result for an authoritative terminal entry. */
export function captureCoopTrainerVictoryMaterial(
  scene: BattleScene,
  battle: Battle,
): CoopTrainerVictoryMaterial | null {
  const boundary = snapshotCoopTrainerVictoryBoundary(scene, battle);
  if (boundary == null) {
    return null;
  }
  try {
    const modifierRewardTypeIds = boundary.modifierRewardFuncs.map(func => getModifierType(func).id);
    if (
      modifierRewardTypeIds.some(id => typeof id !== "string" || id.length === 0 || getModifierTypeFuncById(id) == null)
    ) {
      return null;
    }
    return Object.freeze({
      sourceWave: boundary.sourceWave,
      trainerType: boundary.trainerType,
      moneyMultiplier: boundary.moneyMultiplier,
      modifierRewardTypeIds: Object.freeze(modifierRewardTypeIds),
      isBoss: boundary.isBoss,
      hasCharSprite: boundary.hasCharSprite,
      victoryBgm: boundary.victoryBgm ?? null,
      trainerSpriteKey: boundary.trainerSpriteKey,
      trainerName: boundary.trainerName,
      trainerDialogueName: boundary.trainerDialogueName,
      victoryMessages: Object.freeze([...boundary.victoryMessages]),
      biomeId: boundary.biomeId,
      isErGhost: boundary.isErGhost,
    });
  } catch {
    return null;
  }
}

/** Install one validated wire result into the same exact-wave ledger used by ordinary progression. */
export function installCoopTrainerVictoryMaterial(
  scene: BattleScene,
  material: CoopTrainerVictoryMaterial,
): CoopTrainerVictoryBoundary | null {
  try {
    const modifierRewardFuncs = material.modifierRewardTypeIds.map(id => getModifierTypeFuncById(id));
    if (modifierRewardFuncs.some(func => func == null)) {
      return null;
    }
    return retainBoundary(
      scene,
      freezeBoundary({
        sourceWave: material.sourceWave,
        trainerType: material.trainerType as TrainerType,
        moneyMultiplier: material.moneyMultiplier,
        modifierRewardFuncs,
        isBoss: material.isBoss,
        hasCharSprite: material.hasCharSprite,
        victoryBgm: material.victoryBgm ?? undefined,
        trainerSpriteKey: material.trainerSpriteKey,
        trainerName: material.trainerName,
        trainerDialogueName: material.trainerDialogueName,
        victoryMessages: [...material.victoryMessages],
        biomeId: material.biomeId,
        isErGhost: material.isErGhost,
      }),
    );
  } catch {
    return null;
  }
}

/** Exact-wave read; never falls back to the newest/ambient trainer. */
export function getCoopTrainerVictoryBoundary(
  scene: BattleScene,
  sourceWave: number,
): CoopTrainerVictoryBoundary | null {
  return contextsByScene.get(scene)?.get(sourceWave) ?? null;
}

/** Clear the completed exact boundary so reward functions cannot leak into a later run/wave. */
export function clearCoopTrainerVictoryBoundary(scene: BattleScene, sourceWave: number): void {
  const byWave = contextsByScene.get(scene);
  if (byWave == null) {
    return;
  }
  byWave.delete(sourceWave);
  if (byWave.size === 0) {
    contextsByScene.delete(scene);
  }
}
