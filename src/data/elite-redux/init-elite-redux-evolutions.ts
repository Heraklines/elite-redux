// =============================================================================
// Elite Redux — Phase B Task B6 (evolutions): wire ER per-species level
// evolution requirements onto pokerogue's `pokemonEvolutions` table.
//
// ER ships its evolutions per-species in `er-species.ts` as
// `{ kind: number, requirement: string, into: number }[]`:
//   - `kind` 0 = EVO_LEVEL           → level-up evolution
//   - `kind` 1 = EVO_MEGA_EVOLUTION  → form change (handled by B5)
//   - `kind` 2 = EVO_PRIMAL_REVERSION→ form change (handled by B5)
//   - `kind` 3 = EVO_LEVEL_MALE      → level-up, gender-locked male
//   - `kind` 4 = EVO_LEVEL_FEMALE    → level-up, gender-locked female
//   - `kind` 5 = EVO_MOVE_MEGA       → form change (handled by B5)
//
// This patcher handles ONLY kinds 0/3/4 (level evolutions). Form changes
// (kinds 1/2/5) are owned by `init-elite-redux-form-changes.ts` and live in
// the ER form-change registry — they are NOT inserted into pokerogue's
// `pokemonEvolutions` table.
//
// `requirement` for level evolutions is the level number as a string
// (e.g. "16", "30", "36"). We parse with `Number.parseInt`.
//
// `into` is an INDEX into ER's `species[]` array (mirrored 1:1 into
// `ER_SPECIES`), NOT a species id. We resolve via `ER_SPECIES[evo.into].id`
// then translate through `ER_ID_MAP.species`. (Same convention as B5 —
// see init-elite-redux-form-changes.ts header for the rationale.)
//
// === Merge strategy (chosen over wholesale overwrite) ===
//
// ER's evolution dump carries kind + level + target but NO conditions —
// pokerogue's table, in contrast, encodes rich conditions for special
// evolutions (Tyrogue's move-based branching, Nincada's Shedinja split,
// Tandemaus's RNG-based form pick, Gallade's gender condition, etc.).
//
// Naively overwriting pokerogue's entry with `new SpeciesEvolution(target,
// level, null, null)` for every ER edge would CLOBBER these conditions and
// break the pokerogue vanilla evolution flow tests. We adopt a merge model:
//
//   1. For each ER source species with at least one level evo:
//      a. Lookup the existing pokerogue entry (may be empty/absent).
//      b. For each ER level edge `(target, level)`:
//         - If pokerogue HAS an entry with the same `target` species id:
//             UPDATE that entry's `level` field in-place. Preserve its
//             existing `item`, `condition`, `preFormKey`, `evoFormKey`.
//             (ER's level is authoritative; everything else is pokerogue's
//             richer model.)
//         - If pokerogue has NO matching target: APPEND a fresh
//             `SpeciesEvolution(target, level, null, null)`. This is the
//             ER-only edge case (mostly for ER-custom species).
//      c. Existing pokerogue edges with targets NOT in ER's list are
//         PRESERVED untouched (the "vanilla pokerogue-only" branch).
//
// This preserves the pokerogue vanilla test suite while honoring ER's
// authoritative level numbers for matched edges.
//
// Mutability boundary: `pokemonEvolutions` is a regular mutable object
// literal exported as `const`. Both the dictionary and the
// `SpeciesEvolution` instances within it have mutable `level` / `desc`
// fields.
//
// Order constraint: must run AFTER `initEliteReduxSpecies()` /
// `initEliteReduxCustomSpecies()` so the target species ids are guaranteed
// to be registered. The `pokemonEvolutions` table is keyed by species id,
// so we don't need pokerogue's species table directly.
//
// Prevolutions caveat: pokerogue derives `pokemonPrevolutions` from
// `pokemonEvolutions` once at boot via `initPokemonPrevolutions()`, which
// runs BEFORE our patcher (init.ts ordering). We rebuild the prevolutions
// table after our patches so post-ER lookups see the right edges. The
// pokemon-starters table also derives from prevolutions — we rebuild it too.
// =============================================================================

import {
  initPokemonPrevolutions,
  initPokemonStarters,
  pokemonEvolutions,
  SpeciesEvolution,
  type SpeciesFormEvolution,
} from "#balance/pokemon-evolutions";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES, type ErEvolutionDraft } from "#data/elite-redux/er-species";

/**
 * ER evolution kind numerics. Mirrors the `evoKindT` table from the v2.65
 * dump (see init-elite-redux-form-changes.ts for the full mapping).
 */
const ER_EVO_KIND_LEVEL = 0;
const ER_EVO_KIND_LEVEL_MALE = 3;
const ER_EVO_KIND_LEVEL_FEMALE = 4;

/** Numeric kinds this patcher handles (level evolutions). */
const LEVEL_EVO_KINDS: ReadonlySet<number> = new Set([
  ER_EVO_KIND_LEVEL,
  ER_EVO_KIND_LEVEL_MALE,
  ER_EVO_KIND_LEVEL_FEMALE,
]);

/** Aggregated result of a single `initEliteReduxEvolutions()` run. */
export interface InitEliteReduxEvolutionsResult {
  /** Number of source species whose evolution table entry was touched (merge or append). */
  speciesPatched: number;
  /** Total ER level edges processed across all patched species. */
  evolutionEdgesApplied: number;
  /** Edges where ER's level updated an existing pokerogue edge with the same target. */
  edgesLevelUpdated: number;
  /** Edges appended fresh because pokerogue had no matching target. */
  edgesAppended: number;
  /** ER species skipped because they had no `ER_ID_MAP.species` mapping. */
  speciesSkippedNoMapping: number;
  /** ER species skipped because they had no level-kind evolutions. */
  speciesSkippedNoLevelEvos: number;
  /** Form-change edges (mega/primal/move-mega) skipped — owned by B5. */
  formChangeEdgesSkipped: number;
  /**
   * Evolution edges dropped because the target species id couldn't be
   * resolved (out-of-range `evo.into` or missing `ER_ID_MAP.species` entry).
   * Pre-existing ER-data drift.
   */
  edgesDroppedMissingTarget: number;
  /**
   * Evolution edges dropped because the requirement string didn't parse as
   * a positive integer (level evolutions only — defensive).
   */
  edgesDroppedBadLevel: number;
  /** Non-fatal real errors. */
  errors: string[];
}

/**
 * Patch pokerogue's `pokemonEvolutions` table with ER's per-species level
 * evolution requirements. Idempotent: safe to call multiple times — the
 * second call observes the merged state and reports the same counts.
 *
 * @returns A summary of how many species/evolution edges were touched and
 *          any non-fatal errors encountered.
 */
export function initEliteReduxEvolutions(): InitEliteReduxEvolutionsResult {
  const result: InitEliteReduxEvolutionsResult = {
    speciesPatched: 0,
    evolutionEdgesApplied: 0,
    edgesLevelUpdated: 0,
    edgesAppended: 0,
    speciesSkippedNoMapping: 0,
    speciesSkippedNoLevelEvos: 0,
    formChangeEdgesSkipped: 0,
    edgesDroppedMissingTarget: 0,
    edgesDroppedBadLevel: 0,
    errors: [],
  };

  // The evolutions table is a regular mutable object literal; the `const`
  // export freezes the binding, not the object.
  const table = pokemonEvolutions as Record<number, SpeciesFormEvolution[]>;

  for (const draft of ER_SPECIES) {
    processOneSpecies(draft, table, result);
  }

  // Rebuild prevolutions + starters tables so post-ER lookups (Dex,
  // breeding, starter eligibility) see the patched edges. Both helpers are
  // idempotent — they clear and re-derive from `pokemonEvolutions`.
  initPokemonPrevolutions();
  initPokemonStarters();

  return result;
}

/**
 * Apply ER's level evolutions for a single source species. Updates `result`
 * counters in place. Returns nothing — all state lives in the result and the
 * mutable `table` argument.
 */
function processOneSpecies(
  draft: (typeof ER_SPECIES)[number],
  table: Record<number, SpeciesFormEvolution[]>,
  result: InitEliteReduxEvolutionsResult,
): void {
  if (draft.evolutions.length === 0) {
    result.speciesSkippedNoLevelEvos++;
    return;
  }

  // Pre-flight: count level evos vs form-change evos so we can skip
  // species that ONLY have form changes (megas) without spending a
  // dictionary write.
  let levelEvoCount = 0;
  for (const evo of draft.evolutions) {
    if (LEVEL_EVO_KINDS.has(evo.kind)) {
      levelEvoCount++;
    } else {
      result.formChangeEdgesSkipped++;
    }
  }
  if (levelEvoCount === 0) {
    result.speciesSkippedNoLevelEvos++;
    return;
  }

  const sourceSpeciesId = ER_ID_MAP.species[draft.id];
  if (sourceSpeciesId === undefined) {
    result.speciesSkippedNoMapping++;
    return;
  }

  // Lookup or initialize the entry for this source species.
  const existing = table[sourceSpeciesId];
  const merged: SpeciesFormEvolution[] = existing ? [...existing] : [];

  let touched = false;
  for (const evo of draft.evolutions) {
    if (!LEVEL_EVO_KINDS.has(evo.kind)) {
      continue;
    }
    if (mergeOneEdge(evo, merged, result)) {
      touched = true;
    }
  }

  if (touched) {
    table[sourceSpeciesId] = merged;
    result.speciesPatched++;
  }
}

/**
 * Merge one ER level edge into the `merged` array. Returns `true` if the
 * merged array was touched (either an update or an append), `false` if the
 * edge was dropped (bad level / missing target).
 *
 * Mutates `result` counters for both the touched cases and the drop cases.
 */
function mergeOneEdge(
  evo: ErEvolutionDraft,
  merged: SpeciesFormEvolution[],
  result: InitEliteReduxEvolutionsResult,
): boolean {
  const resolved = resolveLevelEdge(evo, result);
  if (resolved === null) {
    return false;
  }
  result.evolutionEdgesApplied++;

  // Find a matching pokerogue edge by target species id. If found,
  // update its level in-place (preserving any condition/item/formKey).
  const match = merged.find(e => e.speciesId === resolved.targetSpeciesId);
  if (match) {
    if (match.level !== resolved.level) {
      match.level = resolved.level;
      // Reset memoized description so the new level is picked up.
      match.desc = "";
    }
    result.edgesLevelUpdated++;
    return true;
  }

  // ER-only target — append a fresh plain SpeciesEvolution.
  merged.push(new SpeciesEvolution(resolved.targetSpeciesId, resolved.level, null, null));
  result.edgesAppended++;
  return true;
}

/**
 * Pure resolver — does NOT mutate the result counters except for drop
 * counters (since drops are skip cases that must be tracked).
 */
function resolveLevelEdge(
  evo: ErEvolutionDraft,
  result: InitEliteReduxEvolutionsResult,
): { targetSpeciesId: number; level: number } | null {
  // `evo.into` is an index into ER_SPECIES (mirrored from the dump's
  // species[] array). NOT a species id.
  if (evo.into < 0 || evo.into >= ER_SPECIES.length) {
    result.edgesDroppedMissingTarget++;
    return null;
  }
  const targetDraft = ER_SPECIES[evo.into];
  if (!targetDraft) {
    result.edgesDroppedMissingTarget++;
    return null;
  }
  const targetSpeciesId = ER_ID_MAP.species[targetDraft.id];
  if (targetSpeciesId === undefined) {
    result.edgesDroppedMissingTarget++;
    return null;
  }

  const level = Number.parseInt(evo.requirement, 10);
  if (!Number.isFinite(level) || level <= 0) {
    result.edgesDroppedBadLevel++;
    return null;
  }

  return { targetSpeciesId, level };
}
