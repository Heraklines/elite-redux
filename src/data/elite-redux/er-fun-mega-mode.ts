/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allSpecies } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { FormChangeItem } from "#enums/form-change-item";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Pokemon } from "#field/pokemon";

export interface FunMegaStoneMetadata {
  item: FormChangeItem;
  sourceSpeciesId: number;
  sourceName: string;
  targetName: string;
  statDelta: readonly number[];
}

let cachedEdgeCount = -1;
let cachedMetadata = new Map<FormChangeItem, FunMegaStoneMetadata>();

function isMegaFormKey(formKey: string): boolean {
  return formKey === "mega" || formKey.startsWith("mega-");
}

function formChangeItem(change: SpeciesFormChange): FormChangeItem | null {
  const trigger = change.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | null;
  return trigger?.item ?? null;
}

function rebuildMetadataIfNeeded(): void {
  const edgeCount = Object.values(pokemonFormChanges).reduce((total, changes) => total + changes.length, 0);
  if (edgeCount === cachedEdgeCount) {
    return;
  }

  cachedEdgeCount = edgeCount;
  cachedMetadata = new Map();
  for (const [speciesIdText, changes] of Object.entries(pokemonFormChanges)) {
    const speciesId = Number(speciesIdText);
    const species = allSpecies.find(candidate => candidate.speciesId === speciesId);
    if (!species) {
      continue;
    }
    for (const change of changes) {
      if (!isMegaFormKey(change.formKey)) {
        continue;
      }
      const item = formChangeItem(change);
      const sourceForm = species.forms.find(form => form.formKey === change.preFormKey) ?? species.forms[0];
      const targetForm = species.forms.find(form => form.formKey === change.formKey);
      if (item == null || !sourceForm || !targetForm || cachedMetadata.has(item)) {
        continue;
      }
      cachedMetadata.set(item, {
        item,
        sourceSpeciesId: speciesId,
        sourceName: species.getName(sourceForm.formIndex),
        targetName: species.getName(targetForm.formIndex),
        statDelta: targetForm.baseStats.map((stat, index) => stat - sourceForm.baseStats[index]),
      });
    }
  }
}

export function getFunMegaStoneMetadata(item: FormChangeItem): FunMegaStoneMetadata | null {
  rebuildMetadataIfNeeded();
  return cachedMetadata.get(item) ?? null;
}

export function getFunMegaStoneItems(): FormChangeItem[] {
  rebuildMetadataIfNeeded();
  return [...cachedMetadata.keys()];
}

export interface FunRealMegaChoice {
  item: FormChangeItem;
  formIndex: number;
}

export function getFunRealMegaChoices(species: PokemonSpecies, formIndex: number): FunRealMegaChoice[] {
  const formKey = species.forms[formIndex]?.formKey ?? "";
  return (pokemonFormChanges[species.speciesId] ?? []).flatMap(change => {
    const item = formChangeItem(change);
    const targetFormIndex = species.forms.findIndex(form => form.formKey === change.formKey);
    return change.preFormKey === formKey && isMegaFormKey(change.formKey) && item != null && targetFormIndex >= 0
      ? [{ item, formIndex: targetFormIndex }]
      : [];
  });
}

export function getFunEnemyMegaChance(waveIndex: number): number {
  if (waveIndex >= 50) {
    return 1;
  }
  return 0.08 + (Math.max(1, waveIndex) - 1) * (0.92 / 49);
}

export function getFunRealMegaChange(pokemon: Pokemon, item: FormChangeItem): SpeciesFormChange | null {
  return (
    pokemonFormChanges[pokemon.species.speciesId]?.find(
      change =>
        change.preFormKey === pokemon.getFormKey()
        && isMegaFormKey(change.formKey)
        && formChangeItem(change) === item,
    ) ?? null
  );
}

export function pokemonHasRealMega(pokemon: Pokemon): boolean {
  return (
    pokemonFormChanges[pokemon.species.speciesId]?.some(
      change => isMegaFormKey(change.formKey) && formChangeItem(change) != null,
    ) ?? false
  );
}

/** A matching stone uses the real Mega form; every other stone grants a temporary stat-only Mega. */
export function canUseFunMegaStone(pokemon: Pokemon, item: FormChangeItem): boolean {
  if (getFunRealMegaChange(pokemon, item)) {
    return true;
  }
  return !pokemon.isMega() && getFunMegaStoneMetadata(item) != null;
}

export function applyFunMegaStatDelta(baseStats: readonly number[], item: FormChangeItem): number[] {
  const delta = getFunMegaStoneMetadata(item)?.statDelta;
  return baseStats.map((stat, index) => Math.max(1, stat + (delta?.[index] ?? 0)));
}

export function isFunPseudoMegaActive(markedPseudoMega: boolean, recordedStone: unknown, hasHeldStone: boolean): boolean {
  return markedPseudoMega && recordedStone != null && hasHeldStone;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/** Deterministically shuffles the effective statline while preserving its BST. */
export function shuffleFunStats(
  baseStats: readonly number[],
  pokemonId: number,
  item?: FormChangeItem,
): number[] {
  const shuffled = [...baseStats];
  let state = mix32(pokemonId ^ Math.imul((item ?? -1) + 1, 0x9e3779b1));
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = mix32(state + index);
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function formatFunMegaStatDelta(item: FormChangeItem): string | null {
  const metadata = getFunMegaStoneMetadata(item);
  if (!metadata) {
    return null;
  }
  const labels = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
  return metadata.statDelta.map((value, index) => `${labels[index]} ${value >= 0 ? "+" : ""}${value}`).join("  ");
}
