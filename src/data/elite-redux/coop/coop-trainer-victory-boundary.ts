/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import type { ModifierTypeFunc } from "#types/modifier-types";

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

/** Snapshot a live trainer battle without retaining its mutable Battle/Trainer objects. */
export function snapshotCoopTrainerVictoryBoundary(
  scene: BattleScene,
  battle: Battle,
): CoopTrainerVictoryBoundary | null {
  const trainer = battle.trainer;
  if (battle.battleType !== BattleType.TRAINER || trainer == null || !Number.isInteger(battle.waveIndex)) {
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
