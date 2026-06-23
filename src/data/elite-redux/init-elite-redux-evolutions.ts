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
  pokemonPrevolutions,
  SpeciesEvolution,
  SpeciesFormEvolution,
} from "#balance/pokemon-evolutions";
import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES, type ErEvolutionDraft } from "#data/elite-redux/er-species";
import { SpeciesId } from "#enums/species-id";

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
  /**
   * Redux-line edges appended onto the VANILLA base species, gated to the
   * "redux" form (preFormKey "redux") — e.g. Psyduck(redux) → Shyduck.
   */
  reduxEdgesAppended: number;
  /**
   * Pre-existing all-form edges gated to the BASE form (preFormKey "") because
   * the redux form got its own dedicated edge — e.g. Psyduck → Golduck becomes
   * base-form-only so a Redux Psyduck no longer falls down the normal line.
   */
  reduxEdgesGated: number;
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
    reduxEdgesAppended: 0,
    reduxEdgesGated: 0,
    errors: [],
  };

  // The evolutions table is a regular mutable object literal; the `const`
  // export freezes the binding, not the object.
  const table = pokemonEvolutions as Record<number, SpeciesFormEvolution[]>;

  for (const draft of ER_SPECIES) {
    processOneSpecies(draft, table, result);
  }

  // Redux-line pass: make the REDUX form's own evolution line reachable from
  // the vanilla species (which is how the port models redux — as a FORM).
  appendReduxFormEvolutions(table, result);

  // ER (community report 2026-06-11): Roaming Gimmighoul never evolved. The
  // vanilla edge needs 10 Gimmighoul Coin stacks (EVO_TREASURE_TRACKER),
  // which the roaming form practically never accrues in this port, and ER's
  // own dump carries no usable Gimmighoul evolution data. Give the ROAMING
  // form a plain level-50 evolution; the chest form keeps the coin path.
  {
    const gimmighoul = table[SpeciesId.GIMMIGHOUL];
    const idx = gimmighoul?.findIndex(ev => (ev as unknown as { preFormKey?: string }).preFormKey === "roaming") ?? -1;
    if (gimmighoul && idx >= 0) {
      gimmighoul[idx] = new SpeciesFormEvolution(SpeciesId.GHOLDENGO, "roaming", "", 50, null, null, [50, 60, 70]);
    }
  }

  // Rebuild prevolutions + starters tables so post-ER lookups (Dex,
  // breeding, starter eligibility) see the patched edges. Both helpers are
  // idempotent — they clear and re-derive from `pokemonEvolutions`.
  initPokemonPrevolutions();
  initPokemonStarters();

  // #626: Basculin <-> Basculegion candy sharing. ER imports White-Striped
  // Basculin as its OWN custom species, so the white-striped -> Basculegion
  // edge makes initPokemonPrevolutions root Basculegion's candy onto that custom
  // id instead of vanilla Basculin - splitting the candy bucket so the two never
  // pool candy. Restore the vanilla prevolution (Basculegion <- Basculin) so the
  // line shares a candy bucket again. The forward white-striped -> Basculegion
  // evolution in `pokemonEvolutions` is untouched, so evolving still works.
  pokemonPrevolutions[SpeciesId.BASCULEGION] = SpeciesId.BASCULIN;

  return result;
}

/**
 * ER models redux variants as SEPARATE species records with their OWN
 * evolution lines; the port models redux as a FORM on the vanilla species. The
 * main merge above lands each `<BASE>_REDUX` record's edges on its own
 * custom-species id — unreachable from a redux-FORM mon, whose evolutions are
 * looked up on the VANILLA species id. Two player-visible bugs follow:
 *
 *  1. Redux lines whose evolved stage is a STANDALONE custom species (Psyduck
 *     Redux → Shyduck, Cinccino Redux → Frostuccino, Excadrill Redux →
 *     Rexcadrill, …15 lines in v2.65) simply could not evolve there.
 *  2. Worse, the redux mon instead matched the base species' all-form edges and
 *     evolved down the NORMAL line (Cinccino Redux → Beniccino; Psyduck Redux →
 *     plain Golduck) — the reported "redux evolves into its normal counterpart".
 *
 * Fix, per `<BASE>_REDUX` record with level edges whose base species carries a
 * "redux" form:
 *  - For each edge NOT already covered by form-carry (i.e. the target is not
 *    `<EVOLVED>_REDUX` modeled as a redux form the base already evolves into):
 *    append `SpeciesFormEvolution(target, "redux", null, level)` on the VANILLA
 *    base species — only redux-form mons match it (validate() compares
 *    preFormKey against getFormKey()).
 *  - Gate the base species' pre-existing all-form (preFormKey null) edges to
 *    the BASE form (preFormKey "") — EXCEPT form-carry edges, which legitimately
 *    serve the redux form via the evolve() form-carry heuristic.
 *
 * Idempotent: appended edges are detected by (target, preFormKey="redux");
 * re-gating "" is a no-op.
 */
function appendReduxFormEvolutions(
  table: Record<number, SpeciesFormEvolution[]>,
  result: InitEliteReduxEvolutionsResult,
): void {
  const byConst = new Map(ER_SPECIES.map(d => [d.speciesConst, d]));
  const speciesById = new Map(allSpecies.map(s => [s.speciesId as number, s]));

  for (const draft of ER_SPECIES) {
    // Source must be exactly "<BASE>_REDUX" (excludes _REDUX_MEGA, _REDUX_FUZZ,
    // _REDUX_EVO etc., which are targets/forms, not redux base records).
    if (!draft.speciesConst.endsWith("_REDUX")) {
      continue;
    }
    const levelEvos = draft.evolutions.filter(e => LEVEL_EVO_KINDS.has(e.kind));
    if (levelEvos.length === 0) {
      continue;
    }
    const baseDraft = byConst.get(draft.speciesConst.slice(0, -"_REDUX".length));
    if (!baseDraft) {
      continue;
    }
    const basePkrgId = ER_ID_MAP.species[baseDraft.id];
    if (basePkrgId === undefined) {
      continue;
    }
    const baseSpecies = speciesById.get(basePkrgId);
    if (!baseSpecies?.forms.some(f => f.formKey === "redux")) {
      continue; // redux not modeled as a form here — nothing to bridge
    }

    const edges = table[basePkrgId] ?? [];
    const toAppend: { targetId: number; level: number }[] = [];
    const formCarryTargets = new Set<number>();

    for (const evo of levelEvos) {
      const resolved = resolveLevelEdge(evo, result);
      if (resolved === null) {
        continue;
      }
      // Covered by form-carry? Target is "<EVOLVED>_REDUX" modeled as a redux
      // FORM on the vanilla evolved species, which the base already evolves
      // into — evolve()'s form-carry keeps the redux form on that path.
      const targetDraft = ER_SPECIES[evo.into];
      if (targetDraft?.speciesConst.endsWith("_REDUX")) {
        const evolvedBase = byConst.get(targetDraft.speciesConst.slice(0, -"_REDUX".length));
        const evolvedPkrgId = evolvedBase ? ER_ID_MAP.species[evolvedBase.id] : undefined;
        const evolvedSp = evolvedPkrgId === undefined ? undefined : speciesById.get(evolvedPkrgId);
        if (
          evolvedSp?.forms.some(f => f.formKey === "redux")
          && edges.some(e => (e.speciesId as number) === evolvedPkrgId)
        ) {
          formCarryTargets.add(evolvedPkrgId as number);
          continue;
        }
      }
      // Idempotency: already bridged on a previous init run.
      if (edges.some(e => (e.speciesId as number) === resolved.targetSpeciesId && e.preFormKey === "redux")) {
        continue;
      }
      toAppend.push({ targetId: resolved.targetSpeciesId, level: resolved.level });
    }

    if (toAppend.length === 0) {
      continue;
    }
    for (const a of toAppend) {
      edges.push(new SpeciesFormEvolution(a.targetId, "redux", null, a.level, null, null));
      result.reduxEdgesAppended++;
    }
    for (const e of edges) {
      if (e.preFormKey === null && !formCarryTargets.has(e.speciesId as number)) {
        e.preFormKey = "";
        e.desc = "";
        result.reduxEdgesGated++;
      }
    }
    table[basePkrgId] = edges;
  }
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

  // Find a matching pokerogue edge by target species id. If found, update its
  // level in-place AND clear any vanilla evolution ITEM. Elite Redux has NO
  // stone/trade evolutions — everything evolves by level (the ER kind is always
  // level / level-male / level-female here). So a vanilla Fire Stone, Linking
  // Cord, etc. must be removed, leaving the ER level as the only requirement.
  // Gender/form conditions (Gallade, Froslass, the Eevee branches) are KEPT, so
  // those simply become level-up player-choice evolutions — the ER design.
  const match = merged.find(e => e.speciesId === resolved.targetSpeciesId);
  if (match) {
    // A plain LEVEL ER evolution is a pure level-up: it drops the vanilla ITEM
    // AND the vanilla CONDITION (friendship / time-of-day / move / biome, etc.)
    // that ER removed. Examples: Igglybuff (L10, was friendship), Crobat (was
    // friendship), Alolan Rattata (was night). Gender kinds (LEVEL_MALE /
    // LEVEL_FEMALE) KEEP their condition so Gallade / Froslass-style branches
    // stay gendered. When several edges share a level and all lose their
    // conditions, they become player-choice split evos (Eevee, etc.) - the
    // EvolutionPhase prompts a pick, like Tyrogue / Wurmple.
    const clearsCondition = evo.kind === ER_EVO_KIND_LEVEL && match.condition != null;
    if (match.level !== resolved.level || match.item != null || clearsCondition) {
      match.level = resolved.level;
      match.item = null;
      if (clearsCondition) {
        match.condition = null;
      }
      // Reset memoized description so the new level/no-item is picked up.
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
