/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TrainerType } from "#enums/trainer-type";

/** Last non-fixed, non-custom trainer class generated in the current run. */
let lastGenericTrainerType: TrainerType | null = null;

/**
 * Remove the immediately previous trainer class when the pool has another
 * option. Single-entry pools deliberately fall back to their only valid class.
 */
export function withoutImmediateTrainerRepeat(
  trainerPool: readonly TrainerType[],
  excludedTrainerType: TrainerType | null,
): readonly TrainerType[] {
  if (excludedTrainerType === null) {
    return trainerPool;
  }
  const eligiblePool = trainerPool.filter(trainerType => trainerType !== excludedTrainerType);
  return eligiblePool.length > 0 ? eligiblePool : trainerPool;
}

export function getLastGenericTrainerType(): TrainerType | null {
  return lastGenericTrainerType;
}

export function markGenericTrainerType(trainerType: TrainerType): void {
  lastGenericTrainerType = trainerType;
}

export function resetGenericTrainerTracking(): void {
  lastGenericTrainerType = null;
}

/** Restore the last generic trainer class from a session save. */
export function restoreGenericTrainerTracking(trainerType: TrainerType | null | undefined): void {
  lastGenericTrainerType =
    typeof trainerType === "number" && Number.isInteger(trainerType) && trainerType >= 0 ? trainerType : null;
}
