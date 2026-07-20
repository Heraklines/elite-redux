/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbilityId } from "#enums/ability-id";
import type { Pokemon } from "#field/pokemon";

export type InnateSlot = 0 | 1 | 2;

function suppressedInnateSlots(pokemon: Pokemon): boolean[] {
  const { summonData } = pokemon;
  if (!Array.isArray(summonData.erSuppressedInnateSlots)) {
    summonData.erSuppressedInnateSlots = [false, false, false];
  }
  return summonData.erSuppressedInnateSlots;
}

/** Disable one innate slot for the lifetime of the current summon data. */
export function suppressInnateSlotUntilSwitch(pokemon: Pokemon, slot: InnateSlot): void {
  suppressedInnateSlots(pokemon)[slot] = true;
}

/** Whether an innate slot is disabled until the holder next switches out. */
export function isInnateSlotSuppressed(pokemon: Pokemon, slot: InnateSlot): boolean {
  return suppressedInnateSlots(pokemon)[slot] === true;
}

/**
 * Disable one ability id for a fixed number of completed turns.
 * Reapplying the same source keeps the longer remaining duration.
 */
export function suppressAbilityIdForTurns(
  pokemon: Pokemon,
  abilityId: AbilityId,
  turns: number,
  sourceAbilityId: AbilityId,
): void {
  const duration = Math.floor(turns);
  if (duration <= 0) {
    return;
  }

  const suppressions = pokemon.summonData.erTimedAbilitySuppressions;
  const existing = suppressions.find(
    suppression => suppression.abilityId === abilityId && suppression.sourceAbilityId === sourceAbilityId,
  );
  if (existing) {
    existing.turnsRemaining = Math.max(existing.turnsRemaining, duration);
    return;
  }

  suppressions.push({ abilityId, sourceAbilityId, turnsRemaining: duration });
}

/** Whether any timed source currently disables this ability id. */
export function isAbilityIdSuppressed(pokemon: Pokemon, abilityId: AbilityId): boolean {
  return pokemon.summonData.erTimedAbilitySuppressions.some(
    suppression => suppression.abilityId === abilityId && suppression.turnsRemaining > 0,
  );
}

/**
 * Lapse every timed suppression once and return the ability ids that became fully
 * unsuppressed. An id remains suppressed until every independent source expires.
 */
export function lapseTimedAbilitySuppressions(pokemon: Pokemon): readonly AbilityId[] {
  const expiredIds = new Set<AbilityId>();
  const remaining = pokemon.summonData.erTimedAbilitySuppressions.filter(suppression => {
    suppression.turnsRemaining--;
    if (suppression.turnsRemaining > 0) {
      return true;
    }
    expiredIds.add(suppression.abilityId);
    return false;
  });
  pokemon.summonData.erTimedAbilitySuppressions = remaining;

  for (const suppression of remaining) {
    expiredIds.delete(suppression.abilityId);
  }
  return [...expiredIds];
}

function claimProvenance(keys: string[], key: string): boolean {
  if (keys.includes(key)) {
    return false;
  }
  keys.push(key);
  return true;
}

/** Claim a once-per-entry ability marker. Returns false when it was already claimed. */
export function claimSummonAbilityProvenance(pokemon: Pokemon, key: string): boolean {
  return claimProvenance(pokemon.summonData.erAbilityProvenance, key);
}

/** Whether a once-per-entry ability marker has already been claimed. */
export function hasSummonAbilityProvenance(pokemon: Pokemon, key: string): boolean {
  return pokemon.summonData.erAbilityProvenance.includes(key);
}

/** Claim a marker for this Pokémon's current command/turn. */
export function claimCommandAbilityProvenance(pokemon: Pokemon, key: string): boolean {
  return claimProvenance(pokemon.turnData.erAbilityProvenance, key);
}

/** Whether a current-command ability marker has already been claimed. */
export function hasCommandAbilityProvenance(pokemon: Pokemon, key: string): boolean {
  return pokemon.turnData.erAbilityProvenance.includes(key);
}
