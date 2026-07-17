// =============================================================================
// Elite Redux — Phase B Task B6 (movesets): wire ER per-species level-up
// movesets onto pokerogue's `pokemonSpeciesLevelMoves` table.
//
// ER ships its own moveset for every species in `er-species.ts`:
//   - `levelUpMoves`: `{ id: number; level: number }[]`
//   - `tmhmMoves` / `tutorMoves` / `eggMoves`: ER move ids (unused here)
//
// For each ER species whose pokerogue id resolves cleanly, we OVERWRITE
// pokerogue's level-up moveset entry with ER's data (after translating each
// ER move id through `ER_ID_MAP.moves`).
//
// Mutability boundary: `pokemonSpeciesLevelMoves` is a regular mutable object
// literal exported as `const` (the binding is frozen, not the object). Direct
// property assignment is safe. We do NOT touch `pokemonFormLevelMoves` — ER
// does not ship per-form movesets (ER models megas as their own species,
// not as forms).
//
// Order constraint: must run AFTER `initMoves()` (so move ids are stable) and
// AFTER `initEliteReduxCustomMoves()` (so ER-custom move ids ≥ 5000 are
// guaranteed valid). The patcher does NOT need pokerogue's species table —
// the level-moves table is keyed purely by species id.
//
// Vanilla-vs-custom species handling:
//   - VANILLA species (pokerogue id < 10000): OVERWRITE the existing entry.
//   - ER-CUSTOM species (pokerogue id >= 10000): CREATE a fresh entry —
//     pokerogue's `pokemonSpeciesLevelMoves` won't have one yet (B1b
//     registered the species but not its moves).
//
// Idempotency: a second invocation observes the already-patched state and
// counts the same number of writes (we don't compare against the pre-existing
// pokerogue baseline — that semantic would require snapshotting). The result
// type reports `speciesPatched` per run, not "deltas".
// =============================================================================

import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allMoves, allSpecies } from "#data/data-lists";
import { enSpeciesName } from "#data/elite-redux/er-canonical-names";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { LevelMoves } from "#types/pokemon-level-moves";

const CASCOON_PRIMAL_ER_ID = 2157;
/**
 * The full Angel's Wrath kit (#380): every move the ability transforms. The
 * FINALE boss carries ALL of them at once (7 move slots, boss-only).
 */
export const CASCOON_ANGELS_WRATH_MOVES: LevelMoves = [
  [1, MoveId.TACKLE],
  [1, MoveId.POISON_STING],
  [1, MoveId.STRING_SHOT],
  [1, MoveId.HARDEN],
  [1, MoveId.IRON_DEFENSE],
  [1, MoveId.ELECTROWEB],
  [1, MoveId.BUG_BITE],
];

/** Aggregated result of a single `initEliteReduxMovesets()` run. */
export interface InitEliteReduxMovesetsResult {
  /** Number of species whose level-up moveset table entry was written. */
  speciesPatched: number;
  /** Total `[level, MoveId]` pairs applied across all patched species. */
  movesetEntriesApplied: number;
  /** ER species skipped because they had no `ER_ID_MAP.species` mapping. */
  speciesSkippedNoMapping: number;
  /** ER species skipped because their `levelUpMoves` array is empty. */
  speciesSkippedEmpty: number;
  /**
   * Count of individual ER move ids that had no `ER_ID_MAP.moves` entry and
   * were dropped from the patched moveset. Pre-existing id-map drift —
   * surfaces a coverage gap without failing the patcher.
   */
  moveIdsDropped: number;
  /** Non-fatal real errors. */
  errors: string[];
}

/**
 * Patch pokerogue's `pokemonSpeciesLevelMoves` table with ER's per-species
 * level-up movesets. Idempotent: safe to call multiple times — the second
 * call overwrites the first with identical data.
 *
 * @returns A summary of how many species/movesets were touched and any
 *          non-fatal errors encountered.
 */
export function initEliteReduxMovesets(): InitEliteReduxMovesetsResult {
  const result: InitEliteReduxMovesetsResult = {
    speciesPatched: 0,
    movesetEntriesApplied: 0,
    speciesSkippedNoMapping: 0,
    speciesSkippedEmpty: 0,
    moveIdsDropped: 0,
    errors: [],
  };

  // The level-moves table is a regular mutable object literal; the `const`
  // export freezes the binding, not the object. Direct property assignment
  // is safe at runtime.
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;

  for (const draft of ER_SPECIES) {
    if (draft.levelUpMoves.length === 0) {
      result.speciesSkippedEmpty++;
      continue;
    }

    const pokerogueSpeciesId = ER_ID_MAP.species[draft.id];
    if (pokerogueSpeciesId === undefined) {
      result.speciesSkippedNoMapping++;
      continue;
    }

    // Translate each ER move id through ER_ID_MAP.moves and drop any that
    // can't be resolved. We preserve ER's ordering (ER orders by level
    // ascending; pokerogue does the same).
    const translated: LevelMoves = [];
    for (const lvm of draft.levelUpMoves) {
      const pokerogueMoveId = ER_ID_MAP.moves[lvm.id];
      if (pokerogueMoveId === undefined) {
        result.moveIdsDropped++;
        continue;
      }
      // SECOND defense: verify the resolved pokerogue id actually has a
      // registered Move in `allMoves`. ER-custom ids that failed to register
      // in `initEliteReduxCustomMoves` would otherwise slip through to a
      // trainer's moveset and crash later reads (getMatchupScore,
      // loadAssets, etc.).
      if (!allMoves[pokerogueMoveId]) {
        result.moveIdsDropped++;
        continue;
      }
      // Cast through `MoveId` — we know the id is in range because the
      // id-map points to either a vanilla id (< 5000) or an ER-custom id
      // (≥ 5000) that B2 already registered.
      translated.push([lvm.level, pokerogueMoveId as MoveId]);
    }

    if (translated.length === 0) {
      // All move ids dropped — defensive skip (don't clobber an existing
      // pokerogue moveset with an empty array).
      continue;
    }

    table[pokerogueSpeciesId] = translated;
    result.speciesPatched++;
    result.movesetEntriesApplied += translated.length;
  }

  installCascoonAngelsWrathMoves(table, SpeciesId.CASCOON);
  installCascoonAngelsWrathMoves(table, ER_ID_MAP.species[CASCOON_PRIMAL_ER_ID]);

  // #411: in-run redux mons are VANILLA species wearing the "redux" FORM, so
  // they read the vanilla species' level-moves table - a redux-form Beedrill
  // kept regular Beedrill's learnset and never learned its kit (Icicle Spear
  // etc.). Mirror each "<X> Redux" custom's level moves onto the vanilla
  // species' redux FORM via pokemonFormLevelMoves[vanillaId][reduxFormIndex],
  // which PokemonSpeciesForm.getLevelMoves prefers over the species table.
  installReduxFormLevelMoves(table);

  // #606 follow-up: same shadowing bug for Zacian/Zamazenta's CROWNED form.
  installCrownedFormLevelMoves(table);

  return result;
}

function installCascoonAngelsWrathMoves(table: Record<number, LevelMoves>, speciesId: number | undefined): void {
  if (speciesId === undefined) {
    return;
  }
  const moves = table[speciesId] ? [...table[speciesId]] : [];
  for (const [level, moveId] of CASCOON_ANGELS_WRATH_MOVES) {
    if (!moves.some(([, existingMove]) => existingMove === moveId)) {
      moves.push([level, moveId]);
    }
  }
  moves.sort((a, b) => a[0] - b[0]);
  table[speciesId] = moves;
}

/**
 * Mirror every "<X> Redux" custom species' level-up moves onto the matching
 * vanilla species' REDUX form (#411). Idempotent - plain assignment.
 */
function installReduxFormLevelMoves(table: Record<number, LevelMoves>): void {
  const customByName = new Map<string, number>();
  for (const sp of allSpecies) {
    if (sp.speciesId >= 10000) {
      // #633: key on the locale-INVARIANT (forced-English) species name so co-op
      // clients in different languages match identically (sp is a live PokemonSpecies).
      customByName.set(enSpeciesName(sp).toLowerCase(), sp.speciesId);
    }
  }
  const formTable = pokemonFormLevelMoves as Record<number, Record<number, LevelMoves>>;
  for (const sp of allSpecies) {
    if (sp.speciesId >= 10000 || sp.forms?.length === 0) {
      continue;
    }
    const reduxFormIndex = sp.forms.findIndex(f => f.formKey === "redux");
    if (reduxFormIndex < 0) {
      continue;
    }
    const counterpartId = customByName.get(`${enSpeciesName(sp).toLowerCase()} redux`);
    if (counterpartId === undefined) {
      continue;
    }
    const moves = table[counterpartId];
    if (moves?.length === 0) {
      continue;
    }
    formTable[sp.speciesId] = { ...formTable[sp.speciesId], [reduxFormIndex]: moves };
  }
}

/**
 * Zacian/Zamazenta's Crowned form: vanilla ships a
 * `pokemonFormLevelMoves[ZACIAN][crownedIndex]` entry (Behemoth Blade, ...)
 * which `PokemonSpeciesForm.getLevelMoves` PREFERS over the ER species-level
 * override, so the Crowned form showed the VANILLA level-up learnset instead of
 * ER's (the same shadowing bug the redux forms hit). ER ships the Crowned form
 * as its own species record (SPECIES_ZACIAN_CROWNED_SWORD /
 * SPECIES_ZAMAZENTA_CROWNED_SHIELD, id-mapped to custom species >= 10000, whose
 * ER learnset the main loop already wrote to `table`). Mirror that learnset onto
 * the vanilla Crowned FORM index so the form matches the ER 2.65 dex. #606 fixed
 * the Crowned abilities/stats/types; the learnset was missed. Idempotent - plain
 * assignment; self-limiting to species that actually ship a "crowned" form AND an
 * ER Crowned form draft.
 */
function installCrownedFormLevelMoves(table: Record<number, LevelMoves>): void {
  const draftByConst = new Map<string, (typeof ER_SPECIES)[number]>();
  for (const draft of ER_SPECIES) {
    draftByConst.set(draft.speciesConst, draft);
  }
  const speciesById = new Map<number, (typeof allSpecies)[number]>();
  for (const sp of allSpecies) {
    speciesById.set(sp.speciesId, sp);
  }
  const formTable = pokemonFormLevelMoves as Record<number, Record<number, LevelMoves>>;
  for (const crownedDraft of ER_SPECIES) {
    const match = crownedDraft.speciesConst.match(/^(SPECIES_.+)_CROWNED_(?:SWORD|SHIELD)$/);
    if (!match) {
      continue;
    }
    const baseDraft = draftByConst.get(match[1]);
    if (!baseDraft) {
      continue;
    }
    const baseSpeciesId = ER_ID_MAP.species[baseDraft.id];
    const crownedSpeciesId = ER_ID_MAP.species[crownedDraft.id];
    if (baseSpeciesId === undefined || crownedSpeciesId === undefined) {
      continue;
    }
    const crownedFormIndex = speciesById.get(baseSpeciesId)?.forms.findIndex(f => f.formKey === "crowned") ?? -1;
    if (crownedFormIndex < 0) {
      continue;
    }
    const moves = table[crownedSpeciesId];
    if (moves?.length === 0) {
      continue;
    }
    formTable[baseSpeciesId] = { ...formTable[baseSpeciesId], [crownedFormIndex]: moves };
  }
}
