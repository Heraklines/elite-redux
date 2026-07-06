/**
 * Showdown evolution-stage + mega-stage enumeration.
 *
 * The showdown teambuilder lets a player pick a starter LINE from the grid and
 * then choose which STAGE of that line to field at level 100 (e.g. field Charmander
 * as Charizard, or as Mega Charizard X). This module enumerates those stages.
 *
 * - `listEvolutionStages` is pure over the static `pokemonEvolutions` table (BFS
 *   forward from the root, dedup, branches included), so it is unit-testable with
 *   no engine boot.
 * - `listMegaStages` / `isMegaStage` read the species' own injected `forms` (both
 *   vanilla megas AND ER-custom megas land there via `init-elite-redux-species`),
 *   so a single form-key test covers every mega/primal/origin the fork ships.
 *   `isMegaStage` is the `isMegaForm` predicate `validateShowdownTeam` consumes.
 */
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import type { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * Form keys that mark a mega/primal-style battle form. In this fork these forms are
 * PERMANENT (spawned into directly), and fielding one locks the mon's held-item slot
 * to the mega-stone sentinel and counts against the one-mega-per-team cap. Covers the
 * vanilla `mega`/`mega-x`/`mega-y`/`primal`/`origin` keys and the ER regional variants
 * (`hisui-mega`, `galar-mega`, `alola-mega`), all of which contain one of these tokens.
 */
const MEGA_FORM_KEY_PATTERN = /mega|primal|origin/;

/** True iff `formKey` denotes a mega/primal/origin battle form. */
export function isMegaFormKey(formKey: string): boolean {
  return MEGA_FORM_KEY_PATTERN.test(formKey);
}

/** A fieldable mega/primal stage: a concrete species + the mega form index on it. */
export interface ShowdownMegaStage {
  speciesId: number;
  formIndex: number;
  formName: string;
}

/**
 * Every species in the line rooted at `rootSpeciesId`, BFS forward through
 * `pokemonEvolutions`: the root itself first, then each reachable evolution, deduped.
 * A branching line (e.g. Eevee) returns ALL branches. Species with no forward
 * evolution just return `[rootSpeciesId]`.
 */
export function listEvolutionStages(rootSpeciesId: number): number[] {
  const stages: number[] = [];
  const seen = new Set<number>([rootSpeciesId]);
  const queue: number[] = [rootSpeciesId];
  while (queue.length > 0) {
    const node = queue.shift() as number;
    stages.push(node);
    const evolutions = pokemonEvolutions[node];
    if (!evolutions) {
      continue;
    }
    for (const evolution of evolutions) {
      if (!seen.has(evolution.speciesId)) {
        seen.add(evolution.speciesId);
        queue.push(evolution.speciesId);
      }
    }
  }
  return stages;
}

/**
 * Every mega/primal stage available across the line rooted at `rootSpeciesId`. Each
 * entry is a `{speciesId, formIndex}` naming the concrete evolved species carrying the
 * mega form plus that form's index. Megas are picked as stages in the teambuilder but
 * flagged separately because they lock the item slot (see `isMegaStage`).
 */
export function listMegaStages(rootSpeciesId: number): ShowdownMegaStage[] {
  const stages: ShowdownMegaStage[] = [];
  for (const speciesId of listEvolutionStages(rootSpeciesId)) {
    const species = getPokemonSpecies(speciesId as SpeciesId);
    species.forms.forEach((form, formIndex) => {
      if (isMegaFormKey(form.formKey)) {
        stages.push({ speciesId, formIndex, formName: form.formName });
      }
    });
  }
  return stages;
}

/**
 * True iff `(speciesId, formIndex)` names a mega/primal battle form. This is the
 * `isMegaForm` predicate `validateShowdownTeam` uses to enforce the item-lock and the
 * one-mega-per-team cap. An out-of-range `formIndex` (or a species with no forms) is
 * not a mega.
 */
export function isMegaStage(speciesId: number, formIndex: number): boolean {
  const form = getPokemonSpecies(speciesId as SpeciesId)?.forms?.[formIndex];
  return form ? isMegaFormKey(form.formKey) : false;
}
