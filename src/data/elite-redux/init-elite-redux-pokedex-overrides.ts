/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — editor-managed Pokedex overrides (learnsets / TMs / abilities).
//
// The DATA lives in three JSON files the er-editor "Pokedex Editor" tabs write,
// each keyed by speciesConst with numeric in-game ids (NOT ER draft ids — the
// editor reads the live, already-mapped pokerogue ids):
//
//   er-learnsets.json         { "SPECIES_PIKACHU": [[1, 84], [5, 86], ...] }
//   er-tm-learnsets.json      { "SPECIES_PIKACHU": [126, 87, ...] }
//   er-species-abilities.json { "SPECIES_PIKACHU": { ability1, ability2, hidden } }
//
// Overrides are ADDITIVE and FAIL-SAFE:
//   - an absent species (or absent file) leaves the init-computed value alone;
//   - every id is revalidated against allMoves / allAbilities and silently
//     dropped if it doesn't resolve, so a stale or bad entry can never break a
//     build or a run (the whole pass is wrapped so it can only no-op on error);
//   - it runs LAST in the init chain (after movesets, TM moves, custom species
//     and abilities), so a committed editor edit is the final word.
//
// speciesConst → pokerogue id resolution mirrors init-elite-redux-species-tuning:
//   - vanilla species → the `SpeciesId` enum (SPECIES_PIKACHU → SpeciesId.PIKACHU)
//   - ER customs      → the ER id-map (draft id → pokerogue id)
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves, tmPoolTiers } from "#balance/tms";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { AbilityId } from "#enums/ability-id";
import { ModifierTier } from "#enums/modifier-tier";
import type { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { LevelMoves } from "#types/pokemon-level-moves";
import learnsetsJson from "./er-learnsets.json";
import speciesAbilitiesJson from "./er-species-abilities.json";
import tmLearnsetsJson from "./er-tm-learnsets.json";

export type ErLearnsets = Record<string, [number, number][]>;
export type ErTmLearnsets = Record<string, number[]>;
export interface ErAbilityEntry {
  ability1?: number;
  ability2?: number;
  hidden?: number;
  /** ER 3-passive triple ("innates"); each an ability id or 0 (NONE). */
  innates?: number[];
}
export type ErSpeciesAbilities = Record<string, ErAbilityEntry>;

export interface ErPokedexOverridesData {
  learnsets?: ErLearnsets;
  tmLearnsets?: ErTmLearnsets;
  abilities?: ErSpeciesAbilities;
}

export interface InitEliteReduxPokedexOverridesResult {
  /** Species whose level-up learnset was replaced. */
  learnsetsApplied: number;
  /** Species whose TM-learnable set was replaced. */
  tmSetsApplied: number;
  /** Species whose ability slots were changed. */
  abilitiesApplied: number;
  /** Override entries whose speciesConst didn't resolve to a pokerogue id. */
  skippedUnmapped: number;
  /** Individual move/ability ids dropped because they don't resolve. */
  idsDropped: number;
  /** Non-fatal errors (the pass never throws). */
  errors: string[];
}

/** Resolve a speciesConst to its live pokerogue species id (vanilla or ER custom). */
function resolveSpeciesId(speciesConst: string, draftIdByConst: ReadonlyMap<string, number>): number | undefined {
  const draftId = draftIdByConst.get(speciesConst);
  if (draftId === undefined) {
    const id = (SpeciesId as unknown as Record<string, number | undefined>)[speciesConst.replace(/^SPECIES_/, "")];
    return typeof id === "number" ? id : undefined;
  }
  return ER_ID_MAP.species[draftId];
}

/**
 * Apply the editor-managed Pokedex overrides over the live learnset / TM / ability
 * tables. Data is injectable for tests; production callers use the JSON.
 */
export function applyErPokedexOverrides(
  data: ErPokedexOverridesData = {
    learnsets: learnsetsJson as ErLearnsets,
    tmLearnsets: tmLearnsetsJson as ErTmLearnsets,
    abilities: speciesAbilitiesJson as ErSpeciesAbilities,
  },
): InitEliteReduxPokedexOverridesResult {
  const result: InitEliteReduxPokedexOverridesResult = {
    learnsetsApplied: 0,
    tmSetsApplied: 0,
    abilitiesApplied: 0,
    skippedUnmapped: 0,
    idsDropped: 0,
    errors: [],
  };

  try {
    const draftIdByConst = new Map<string, number>();
    for (const draft of ER_SPECIES) {
      draftIdByConst.set(draft.speciesConst, draft.id);
    }
    const speciesById = new Map<number, (typeof allSpecies)[number]>();
    for (const sp of allSpecies) {
      speciesById.set(sp.speciesId, sp);
    }

    applyLearnsets(data.learnsets, draftIdByConst, result);
    applyTmLearnsets(data.tmLearnsets, draftIdByConst, result);
    applyAbilities(data.abilities, draftIdByConst, speciesById, result);
  } catch (err) {
    // Defensive: this pass must NEVER break a build/run. Record and move on.
    result.errors.push(String(err));
  }

  return result;
}

/** Replace each overridden species' level-up learnset (only resolvable moves kept). */
function applyLearnsets(
  learnsets: ErLearnsets | undefined,
  draftIdByConst: ReadonlyMap<string, number>,
  result: InitEliteReduxPokedexOverridesResult,
): void {
  if (!learnsets) {
    return;
  }
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;
  for (const [speciesConst, pairs] of Object.entries(learnsets)) {
    if (!Array.isArray(pairs)) {
      continue;
    }
    const pkrgId = resolveSpeciesId(speciesConst, draftIdByConst);
    if (pkrgId === undefined) {
      result.skippedUnmapped++;
      continue;
    }
    const translated: LevelMoves = [];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        continue;
      }
      const [level, moveId] = pair;
      if (typeof level !== "number" || typeof moveId !== "number" || !allMoves[moveId]) {
        result.idsDropped++;
        continue;
      }
      translated.push([level, moveId as MoveId]);
    }
    if (translated.length === 0) {
      // Don't clobber a real learnset with an empty one.
      continue;
    }
    translated.sort((a, b) => a[0] - b[0]);
    table[pkrgId] = translated;
    result.learnsetsApplied++;
  }
}

/** Replace each overridden species' TM-learnable set (forward + reverse maps + pool tier). */
function applyTmLearnsets(
  tmLearnsets: ErTmLearnsets | undefined,
  draftIdByConst: ReadonlyMap<string, number>,
  result: InitEliteReduxPokedexOverridesResult,
): void {
  if (!tmLearnsets) {
    return;
  }
  const tmsBySpecies = speciesTmMoves as Record<number, (MoveId | [string | SpeciesId, MoveId])[]>;
  const speciesByTm = tmSpecies as Record<number, Array<SpeciesId | Array<SpeciesId | string>>>;
  const tiers = tmPoolTiers as Record<number, ModifierTier>;
  const entryMoveId = (entry: MoveId | [string | SpeciesId, MoveId]): number =>
    Array.isArray(entry) ? (entry[1] as number) : (entry as number);
  const reverseEntryIsSpecies = (entry: SpeciesId | Array<SpeciesId | string>, id: number): boolean =>
    Array.isArray(entry) ? entry[0] === id : entry === id;

  for (const [speciesConst, moveIds] of Object.entries(tmLearnsets)) {
    if (!Array.isArray(moveIds)) {
      continue;
    }
    const pkrgId = resolveSpeciesId(speciesConst, draftIdByConst);
    if (pkrgId === undefined) {
      result.skippedUnmapped++;
      continue;
    }
    const newSet = new Set<number>();
    for (const moveId of moveIds) {
      if (typeof moveId === "number" && allMoves[moveId]) {
        newSet.add(moveId);
      } else {
        result.idsDropped++;
      }
    }

    const oldForward = tmsBySpecies[pkrgId] ?? [];
    const oldMoveIds = new Set<number>(oldForward.map(entryMoveId));
    // Reverse-map removals: drop this species from moves it no longer learns.
    for (const oldMoveId of oldMoveIds) {
      if (!newSet.has(oldMoveId) && speciesByTm[oldMoveId]) {
        speciesByTm[oldMoveId] = speciesByTm[oldMoveId].filter(e => !reverseEntryIsSpecies(e, pkrgId));
      }
    }
    // Forward map: replace wholesale.
    tmsBySpecies[pkrgId] = [...newSet] as MoveId[];
    // Reverse-map additions + reward-pool registration for newly-learnable moves.
    for (const moveId of newSet) {
      if (!oldMoveIds.has(moveId)) {
        if (!speciesByTm[moveId]) {
          speciesByTm[moveId] = [];
        }
        speciesByTm[moveId].push(pkrgId as SpeciesId);
      }
      if (tiers[moveId] === undefined) {
        tiers[moveId] = ModifierTier.ULTRA;
      }
    }
    result.tmSetsApplied++;
  }
}

/** Internal mutable view of a species' three ability slots. */
type MutableAbilitySlots = { ability1: number; ability2: number; abilityHidden: number };

/**
 * Resolve one ability-slot override to the id to write, or `undefined` to leave
 * the slot untouched. `noneTo` (slot 2) maps a NONE override onto the primary
 * ability (the constructor invariant); `allowNone` (hidden slot) treats NONE as
 * the legal "no hidden ability" value. An unresolvable id is dropped.
 */
function resolveAbilitySlot(
  value: number | undefined,
  opts: { noneTo?: number; allowNone?: boolean },
  result: InitEliteReduxPokedexOverridesResult,
): number | undefined {
  if (value === undefined) {
    return;
  }
  if (value === AbilityId.NONE) {
    if (opts.noneTo !== undefined) {
      return opts.noneTo;
    }
    if (opts.allowNone) {
      return AbilityId.NONE;
    }
  } else if (allAbilities[value]) {
    return value;
  }
  result.idsDropped++;
  return;
}

/** A species OR a form: both extend PokemonSpeciesForm, so both carry the three
 * ability slots + `setPassives`. The override writes to whichever the in-game
 * ability lookup actually reads (form-level wins for multi-form species). */
type AbilitySlotTarget = MutableAbilitySlots & {
  formKey: string;
  setPassives(passives: readonly [AbilityId, AbilityId, AbilityId]): void;
};

/** ER mega/alt-form draft id → its base species draft id + the injected formKey. */
const megaTargetToForm: ReadonlyMap<number, { baseDraftId: number; formKey: string }> = new Map(
  ER_MEGA_FORMS.map(m => [m.targetErId, { baseDraftId: m.baseErId, formKey: m.formKey }]),
);

/**
 * Resolve one editor ability entry to its final slot values ONCE (so a bad id is
 * only counted once), then write those values onto every {@linkcode AbilitySlotTarget}.
 * Returns whether anything was written.
 *
 * Writing to multiple targets is the crux of the multi-form fix: the in-game
 * ability of a multi-form species (e.g. a Redux base + its Mega) is read from the
 * FORM, not the species' top-level slots, so an editor edit must reach the form.
 */
function applyEntryToTargets(
  targets: readonly AbilitySlotTarget[],
  entry: ErAbilityEntry,
  result: InitEliteReduxPokedexOverridesResult,
): boolean {
  if (targets.length === 0) {
    return false;
  }
  const a1 = resolveAbilitySlot(entry.ability1, {}, result);
  // Slot 2's NONE mirrors the NEW primary (a1) when present; the editor always
  // writes a1 alongside a2, so a per-target fallback is unnecessary here.
  const a2 = resolveAbilitySlot(entry.ability2, { noneTo: a1 ?? targets[0].ability1 }, result);
  const ah = resolveAbilitySlot(entry.hidden, { allowNone: true }, result);
  const triple = Array.isArray(entry.innates)
    ? ([0, 1, 2].map(i => {
        const v = entry.innates?.[i];
        if (v === undefined || v === AbilityId.NONE) {
          return AbilityId.NONE;
        }
        if (allAbilities[v]) {
          return v as AbilityId;
        }
        result.idsDropped++;
        return AbilityId.NONE;
      }) as [AbilityId, AbilityId, AbilityId])
    : undefined;

  let changed = false;
  for (const target of targets) {
    if (a1 !== undefined) {
      target.ability1 = a1;
      changed = true;
    }
    if (a2 !== undefined) {
      target.ability2 = a2;
      changed = true;
    }
    if (ah !== undefined) {
      target.abilityHidden = ah;
      changed = true;
    }
    if (triple) {
      target.setPassives(triple);
      changed = true;
    }
  }
  return changed;
}

/** Overwrite each overridden species' three ability slots (only resolvable ids). */
function applyAbilities(
  abilities: ErSpeciesAbilities | undefined,
  draftIdByConst: ReadonlyMap<string, number>,
  speciesById: ReadonlyMap<number, (typeof allSpecies)[number]>,
  result: InitEliteReduxPokedexOverridesResult,
): void {
  if (!abilities) {
    return;
  }
  // Forms that have their OWN editor entry (a `_MEGA`/alt-form const) - keyed
  // `${baseSpeciesId}:${formKey}`. A base-species override must NOT clobber these
  // (e.g. Kingambit Redux's "mega" form is owned by SPECIES_KINGAMBIT_REDUX_MEGA),
  // but it SHOULD reach every other form (e.g. all of Sawsbuck's seasons).
  const formsWithOwnEntry = new Set<string>();
  for (const key of Object.keys(abilities)) {
    const d = draftIdByConst.get(key);
    const m = d === undefined ? undefined : megaTargetToForm.get(d);
    if (m) {
      const baseId = ER_ID_MAP.species[m.baseDraftId];
      if (baseId !== undefined) {
        formsWithOwnEntry.add(`${baseId}:${m.formKey}`);
      }
    }
  }
  for (const [speciesConst, entry] of Object.entries(abilities)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const draftId = draftIdByConst.get(speciesConst);
    const pkrgId = resolveSpeciesId(speciesConst, draftIdByConst);
    // `ability*` are declared readonly; the `const` only freezes the binding,
    // runtime assignment is fine. Cast species/forms to the mutable slot view.
    const species =
      pkrgId === undefined ? undefined : (speciesById.get(pkrgId) as unknown as AbilitySlotTarget | undefined);

    // Collect every target the in-game ability lookup might read from.
    const targets: AbilitySlotTarget[] = [];
    if (species) {
      targets.push(species);
    }

    const mega = draftId === undefined ? undefined : megaTargetToForm.get(draftId);
    if (mega) {
      // A mega/alt-form const: the live mega is reached as a FORM on the BASE
      // species, NOT this standalone species - so its abilities are read from
      // baseSpecies.forms[formKey]. Write there too (this is the Mega bug).
      const baseId = ER_ID_MAP.species[mega.baseDraftId];
      const baseForms = (baseId === undefined ? undefined : speciesById.get(baseId))?.forms as
        | AbilitySlotTarget[]
        | undefined;
      const form = baseForms?.find(f => f.formKey === mega.formKey);
      if (form) {
        targets.push(form);
      }
    } else if (species) {
      // A base-species const on a MULTI-FORM species: each form is a distinct
      // object whose slots SHADOW the species-level ones, so write every form -
      // EXCEPT any form that has its own dedicated editor entry (its `_MEGA`/alt
      // const owns it). This makes one SPECIES_SAWSBUCK edit reach all 4 seasons,
      // while SPECIES_KINGAMBIT_REDUX leaves the "mega" form to its own entry.
      const forms = (speciesById.get(pkrgId as number)?.forms as AbilitySlotTarget[] | undefined) ?? [];
      for (const form of forms) {
        if ((form as unknown) === (species as unknown)) {
          continue;
        }
        if (formsWithOwnEntry.has(`${pkrgId}:${form.formKey}`)) {
          continue;
        }
        targets.push(form);
      }
    }

    if (targets.length === 0) {
      result.skippedUnmapped++;
      continue;
    }
    if (applyEntryToTargets(targets, entry, result)) {
      result.abilitiesApplied++;
    }
  }
}

/** Init-chain entry point (uses the committed JSON). */
export function initEliteReduxPokedexOverrides(): InitEliteReduxPokedexOverridesResult {
  return applyErPokedexOverrides();
}
