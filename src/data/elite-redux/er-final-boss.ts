/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Elite/Hell classic final boss.
//
// On Elite and Hell difficulty the classic final boss (the Eternatus fight) is
// replaced by a two-phase Cascoon → Primal Cascoon encounter — a structural
// drop-in for vanilla's Eternatus → Eternamax:
//
//   Phase 1: Cascoon       (form 0, "",       BST 205)
//      ↓ first health bar broken
//   Phase 2: Primal Cascoon (form 1, "primal", BST 726)
//
// The transform reuses pokerogue's existing final-boss machinery:
// `BattleScene.initFinalBossPhaseTwo()` calls
// `triggerPokemonFormChange(boss, SpeciesFormChangeManualTrigger)`, which is
// generic — it transforms ANY species that has a manual form-change registered.
// We register Cascoon "" → "primal" below so that path fires for the swapped
// boss exactly as it does for Eternatus → Eternamax. The forced phase-1
// survive-at-1HP logic (`Pokemon.getMinimumSegmentIndex` / damage cap) is keyed
// on `isClassicFinalBoss && formIndex === 0`, so the two-phase flow works
// unchanged for Cascoon.
//
// Ace difficulty is untouched — it keeps the vanilla Eternatus boss.
// =============================================================================

import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import type { PokemonSpecies } from "#data/pokemon-species";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** The species (phase-1 form) that replaces Eternatus as the Elite/Hell final boss. */
const ER_FINAL_BOSS_SPECIES = SpeciesId.CASCOON;

/** Whether the current run is on a difficulty that swaps in the ER final boss. */
function usesErFinalBoss(): boolean {
  const difficulty = getErDifficulty();
  return difficulty === "elite" || difficulty === "hell";
}

/**
 * The species to use as the classic final boss for the current run, or `null`
 * to keep the vanilla boss (Eternatus). Callers should only consult this when
 * the wave actually IS the classic final boss.
 */
export function getErFinalBossSpecies(): PokemonSpecies | null {
  return usesErFinalBoss() ? getPokemonSpecies(ER_FINAL_BOSS_SPECIES) : null;
}

/** Whether `speciesId` is the ER final-boss replacement species (Cascoon). */
export function isErFinalBossSpecies(speciesId: SpeciesId): boolean {
  return speciesId === ER_FINAL_BOSS_SPECIES;
}

/**
 * Register Cascoon "" → "primal" as a manual form change so the generic
 * final-boss transform (`triggerPokemonFormChange(SpeciesFormChangeManualTrigger)`)
 * promotes phase 1 (Cascoon) into phase 2 (Primal Cascoon). Idempotent.
 */
export function registerErFinalBossFormChange(): void {
  const table = pokemonFormChanges as Record<number, SpeciesFormChange[]>;
  if (!table[ER_FINAL_BOSS_SPECIES]) {
    table[ER_FINAL_BOSS_SPECIES] = [];
  }
  // NOTE: the ER primal bridge may already register a "" → "primal" change with
  // an ITEM trigger (the primal stone). We still need a MANUAL-trigger entry for
  // the final-boss transform, so the idempotency check is trigger-type-specific.
  // (Vanilla Eternatus likewise carries both a manual and an item ETERNAMAX entry.)
  const alreadyRegistered = table[ER_FINAL_BOSS_SPECIES].some(
    fc => fc.preFormKey === "" && fc.formKey === SpeciesFormKey.PRIMAL && fc.findTrigger(SpeciesFormChangeManualTrigger),
  );
  if (!alreadyRegistered) {
    table[ER_FINAL_BOSS_SPECIES].push(
      new SpeciesFormChange(ER_FINAL_BOSS_SPECIES, "", SpeciesFormKey.PRIMAL, new SpeciesFormChangeManualTrigger()),
    );
  }
}
