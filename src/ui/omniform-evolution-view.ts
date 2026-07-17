/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Omniform evolution VIEW model (data tier for the UI strip).
//
// An "Omniform mon" (maintainer vocabulary) is a mon that adaptively transforms
// mid-battle into a family of target forms (the partner-Eevee eeveelutions are
// the first family). This module derives, view-only, the LIST of evolutions the
// player can browse on the summary / learn-move screens and resolves each
// evolution's abilities + moveset for display. It performs NO gameplay change.
//
// The evolution list is DERIVED FROM REGISTRATION, never hardcoded:
//   1. A defensive read of the core model's per-mon list (built in parallel by
//      the core agent) via optional chaining against a locally-declared shape -
//      wiring the real model later is a one-line change with no edit here.
//   2. Fallback: the exported `ER_PARTNER_FAMILY` registration table (which GROWS
//      as new partner evolutions are added, so every future one is covered
//      automatically) plus the family HEAD (the Eevee "partner" form).
//
// The strip WINDOW math is pure (no Phaser / no scene) so it is unit-testable and
// scales to the 18-evolution cap via scrolling.
// =============================================================================

import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { ER_PARTNER_FAMILY } from "#data/elite-redux/er-newcomer-species";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Maintainer spec: the strip must scale to up to 18 possible evolutions. */
export const OMNIFORM_MAX_EVOLUTIONS = 18;

/** The vanilla Eevee "partner" form key - the Omniform family HEAD is this form. */
const PARTNER_FORM_KEY = "partner";

/** One browsable evolution: a (species, form) identity plus its display kit. */
export interface OmniformEvolutionEntry {
  readonly speciesId: number;
  readonly formIndex: number;
  readonly species: PokemonSpecies;
  readonly form: PokemonSpeciesForm;
  /** Player-facing name shown under the strip / in the panel header. */
  readonly name: string;
  /** This evolution's ACTIVE ability id (from its registration). */
  readonly activeAbilityId: AbilityId;
  /** This evolution's three INNATE (passive) ability ids (from its registration). */
  readonly innateAbilityIds: readonly [AbilityId, AbilityId, AbilityId];
  /** True for the mon's CURRENT battle-active species/form (marked distinctly). */
  readonly isCurrent: boolean;
}

/** Abilities resolved for the ability panel of a selected evolution. */
export interface OmniformEvolutionAbilities {
  readonly active: Ability | null;
  readonly innates: (Ability | null)[];
}

/** A resolved evolution moveset for the moves panel. */
export interface OmniformEvolutionMoveset {
  readonly moveIds: number[];
  /**
   * True when the moveset is the level-up FALLBACK (the per-evolution moveset
   * model was not present), so the panel can show a "(base)" hint.
   */
  readonly isBaseFallback: boolean;
}

// -----------------------------------------------------------------------------
// Defensive seam onto the CORE model (built in parallel; owned by another agent).
// Declared locally + read via optional chaining so this file never depends on
// the model's concrete type and wiring it later needs no change here.
// -----------------------------------------------------------------------------
interface OmniformCoreCarrier {
  /** Future generic list of (species, form) transform targets for this mon. */
  erOmniformEvolutions?: { speciesId: number; formIndex: number }[];
  /** Per-evolution movesets, keyed "<speciesId>:<formIndex>". */
  erMultiFormMovesets?: Record<string, number[] | undefined>;
}

function coreCarrier(pokemon: Pokemon): OmniformCoreCarrier {
  return pokemon as unknown as OmniformCoreCarrier;
}

/**
 * Whether an ability carries the Omniform attribute. Mirrors omniform.ts'
 * `hasOmniform` constructor-name check (OmniformAbAttr is an ER-custom attr not
 * registered in the AbAttrMap, so `Ability.hasAttr("OmniformAbAttr")` would miss
 * it - and composites copy the raw attr in). Reads `attrs` via a local shape.
 */
function abilityHasOmniform(ability: Ability | null | undefined): boolean {
  if (!ability) {
    return false;
  }
  const attrs = (ability as unknown as { attrs?: readonly { constructor?: { name?: string } }[] }).attrs;
  return Array.isArray(attrs) && attrs.some(a => a?.constructor?.name === "OmniformAbAttr");
}

/** The vanilla Eevee "partner" form index (-1 if the form is not registered). */
function partnerHeadFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === PARTNER_FORM_KEY);
}

/** Whether the mon's current (species, form) is the Eevee "partner" family HEAD. */
function isPartnerHead(pokemon: Pokemon): boolean {
  if (pokemon.getSpeciesForm().speciesId !== SpeciesId.EEVEE) {
    return false;
  }
  const partnerIdx = partnerHeadFormIndex();
  return partnerIdx >= 0 && pokemon.formIndex === partnerIdx;
}

/** Whether the mon's current species is one of the registered partner evolutions. */
function isPartnerEvolution(pokemon: Pokemon): boolean {
  const speciesId = pokemon.getSpeciesForm().speciesId;
  return ER_PARTNER_FAMILY.some(def => def.partnerId === speciesId);
}

/**
 * Whether this mon should show the Omniform evolution strip. True for any mon
 * carrying the Omniform ability (active or innate) OR a member of the partner
 * family (head or an evolution). A normal single-form mon returns false, so the
 * strip never renders for it.
 */
export function isOmniformMon(pokemon: Pokemon | null | undefined): boolean {
  if (!pokemon) {
    return false;
  }
  try {
    if (isPartnerHead(pokemon) || isPartnerEvolution(pokemon)) {
      return true;
    }
    if (abilityHasOmniform(pokemon.getAbility(true))) {
      return true;
    }
    return (pokemon.getPassiveAbilities?.() ?? []).some(abilityHasOmniform);
  } catch {
    return false;
  }
}

/** Build an entry from a resolved species + form, marking the current identity. */
function makeEntry(
  species: PokemonSpecies,
  form: PokemonSpeciesForm,
  formIndex: number,
  name: string,
  current: { speciesId: number; formIndex: number },
): OmniformEvolutionEntry {
  return {
    speciesId: species.speciesId,
    formIndex,
    species,
    form,
    name,
    activeAbilityId: form.getAbility(0) ?? form.ability1,
    innateAbilityIds: form.getPassiveAbilities(formIndex),
    isCurrent: species.speciesId === current.speciesId && formIndex === current.formIndex,
  };
}

/**
 * Build strip entries for an EXPLICIT list of core-model family targets, in the
 * caller's order (base first, NO current-first reordering / dedupe). This is what
 * the level-up batch panel + TM/Shroom teach flows use so `entries[i]` maps 1:1 to
 * `targets[i]` - the same `(speciesId, formIndex)` the core teach API
 * ({@link learnMoveForEvolution}) validates against. `getOmniformEvolutions` above
 * is the VIEW-only, current-first browser list; this is the teach-aligned list.
 */
export function omniformEntriesForTargets(
  pokemon: Pokemon,
  targets: readonly { speciesId: number; formIndex: number }[],
): OmniformEvolutionEntry[] {
  const sf = pokemon.getSpeciesForm();
  const current = { speciesId: sf.speciesId, formIndex: pokemon.formIndex };
  const entries: OmniformEvolutionEntry[] = [];
  for (const t of targets) {
    const species = getPokemonSpecies(t.speciesId as SpeciesId);
    if (!species) {
      continue;
    }
    const form = species.forms[t.formIndex] ?? species;
    entries.push(makeEntry(species, form, t.formIndex, i18nName(species, t.formIndex), current));
  }
  return entries;
}

/** The partner-family evolution entries (registration-derived, order preserved). */
function partnerFamilyEntries(current: { speciesId: number; formIndex: number }): OmniformEvolutionEntry[] {
  const entries: OmniformEvolutionEntry[] = [];
  for (const def of ER_PARTNER_FAMILY) {
    const species = getPokemonSpecies(def.partnerId as SpeciesId);
    if (!species) {
      continue;
    }
    entries.push(makeEntry(species, species, 0, def.name || species.getName(), current));
  }
  return entries;
}

/** The Eevee "partner" HEAD entry (the vanilla Eevee partner form). */
function partnerHeadEntry(current: { speciesId: number; formIndex: number }): OmniformEvolutionEntry | null {
  const species = getPokemonSpecies(SpeciesId.EEVEE);
  const formIndex = partnerHeadFormIndex();
  if (formIndex < 0) {
    return null;
  }
  const form = species.forms[formIndex];
  const name = `${i18nName(species, formIndex)}`;
  return makeEntry(species, form, formIndex, name, current);
}

/** Prefer the vanilla localized species name; fall back to the raw species name. */
function i18nName(species: PokemonSpecies, formIndex: number): string {
  const formName = species.forms[formIndex]?.formName;
  const base = species.getName();
  return formName ? `${base} (${formName})` : base;
}

/**
 * Derive the ordered evolution list a player can browse for `pokemon`. The list
 * always LEADS with the mon's current battle-active form (marked `isCurrent`),
 * then every sibling evolution. Empty for a non-Omniform mon.
 */
export function getOmniformEvolutions(pokemon: Pokemon | null | undefined): OmniformEvolutionEntry[] {
  if (!isOmniformMon(pokemon) || !pokemon) {
    return [];
  }
  const sf = pokemon.getSpeciesForm();
  const current = { speciesId: sf.speciesId, formIndex: pokemon.formIndex };

  // 1) Core-model list (future) - defensive optional read. When wired, it fully
  //    drives the strip and covers any Omniform family automatically.
  const coreList = coreCarrier(pokemon).erOmniformEvolutions;
  if (Array.isArray(coreList) && coreList.length > 0) {
    const entries: OmniformEvolutionEntry[] = [];
    for (const t of coreList) {
      const species = getPokemonSpecies(t.speciesId as SpeciesId);
      if (!species) {
        continue;
      }
      const form = species.forms[t.formIndex] ?? species;
      entries.push(makeEntry(species, form, t.formIndex, i18nName(species, t.formIndex), current));
    }
    return dedupeAndOrder(entries);
  }

  // 2) Registration fallback: the partner family (+ head if not already in it).
  const familyEntries = partnerFamilyEntries(current);
  const entries = [...familyEntries];
  const currentInFamily = familyEntries.some(e => e.isCurrent);
  if (!currentInFamily) {
    const head = partnerHeadEntry(current);
    if (head) {
      entries.unshift(head);
    }
  }
  return dedupeAndOrder(entries);
}

/** De-dupe by identity, lead with the current form, and cap at the 18 max. */
function dedupeAndOrder(entries: OmniformEvolutionEntry[]): OmniformEvolutionEntry[] {
  const seen = new Set<string>();
  const unique: OmniformEvolutionEntry[] = [];
  for (const e of entries) {
    const key = `${e.speciesId}:${e.formIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(e);
  }
  // Lead with the current form so the default selection = what is battle-active.
  unique.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  return unique.slice(0, OMNIFORM_MAX_EVOLUTIONS);
}

/** The index of the current (battle-active) entry, or 0 if none is marked. */
export function currentEvolutionIndex(entries: readonly OmniformEvolutionEntry[]): number {
  const idx = entries.findIndex(e => e.isCurrent);
  return idx < 0 ? 0 : idx;
}

/** Resolve an evolution's ability panel kit from its registration. */
export function getEvolutionAbilities(entry: OmniformEvolutionEntry): OmniformEvolutionAbilities {
  const active = entry.activeAbilityId === AbilityId.NONE ? null : allAbilities[entry.activeAbilityId];
  const innates = entry.innateAbilityIds.map(id => (id === AbilityId.NONE ? null : allAbilities[id]));
  return { active: active ?? null, innates };
}

/**
 * Resolve an evolution's moveset for display. Uses the per-evolution moveset
 * model when present (defensive read of the core seam); otherwise falls back to
 * that species' level-up moves the mon's level qualifies for, flagged as base.
 */
export function getEvolutionMoveset(
  pokemon: Pokemon,
  entry: OmniformEvolutionEntry,
  maxMoves: number,
): OmniformEvolutionMoveset {
  const key = `${entry.speciesId}:${entry.formIndex}`;
  const custom = coreCarrier(pokemon).erMultiFormMovesets?.[key];
  if (Array.isArray(custom) && custom.length > 0) {
    return { moveIds: custom.slice(0, maxMoves), isBaseFallback: false };
  }

  // Fallback: the most-recent level-up moves at or below the mon's level.
  const levelMoves = entry.form.getLevelMoves();
  const seen = new Set<number>();
  const eligible: number[] = [];
  for (let i = levelMoves.length - 1; i >= 0; i--) {
    const [moveLevel, moveId] = levelMoves[i];
    if (moveLevel > pokemon.level || seen.has(moveId)) {
      continue;
    }
    seen.add(moveId);
    eligible.push(moveId);
    if (eligible.length >= maxMoves) {
      break;
    }
  }
  return { moveIds: eligible, isBaseFallback: true };
}

// -----------------------------------------------------------------------------
// Strip WINDOW math (pure) - windowed scrolling with < > overflow indicators.
// -----------------------------------------------------------------------------
export interface OmniformStripWindow {
  /** First visible entry index. */
  readonly start: number;
  /** Number of visible entries. */
  readonly count: number;
  /** Whether entries exist to the LEFT of the window (show a "<" indicator). */
  readonly hasLeft: boolean;
  /** Whether entries exist to the RIGHT of the window (show a ">" indicator). */
  readonly hasRight: boolean;
}

/**
 * Compute the visible window of a horizontally-scrolling strip that keeps the
 * `selected` entry in view (centred where possible). Caps the browsable count at
 * {@link OMNIFORM_MAX_EVOLUTIONS}.
 */
export function computeStripWindow(total: number, selected: number, windowSize: number): OmniformStripWindow {
  const cap = Math.min(Math.max(total, 0), OMNIFORM_MAX_EVOLUTIONS);
  const size = Math.max(1, Math.min(windowSize, cap || 1));
  if (cap <= size) {
    return { start: 0, count: cap, hasLeft: false, hasRight: false };
  }
  const clampedSel = Math.max(0, Math.min(selected, cap - 1));
  let start = clampedSel - Math.floor(size / 2);
  start = Math.max(0, Math.min(start, cap - size));
  return { start, count: size, hasLeft: start > 0, hasRight: start + size < cap };
}
