// =============================================================================
// Elite Redux — Phase B Task B1a: install ER 3-passive triples on vanilla species.
//
// Reads the auto-generated ER drafts (`er-species.ts`) and, for each entry whose
// pokerogue species id is < VANILLA_ID_CUTOFF (i.e., maps to an existing
// vanilla `SpeciesId`), calls `setPassives()` on the corresponding
// `PokemonSpecies` instance with the ER ability ids mapped through
// `ER_ID_MAP.abilities`.
//
// This unlocks the 3-passive UI (A16's `getPassiveCount() > 1` gate) for the
// ~1025 vanilla pokerogue species that ER provides innates for. ER-custom
// species (pokerogue id ≥ VANILLA_ID_CUTOFF) are skipped here — B1b adds them
// as fresh `PokemonSpecies` instances.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { AbilityId } from "#enums/ability-id";

/**
 * Numeric cutoff for "vanilla pokerogue" species ids. ER-custom species are
 * assigned fresh ids ≥ 10000 by the id-map builder (see `er-id-map.ts`).
 */
const VANILLA_ID_CUTOFF = 10000;

/** Aggregated result of a single `initEliteReduxSpecies()` run. */
export interface InitEliteReduxSpeciesResult {
  /** Number of vanilla species that received a 3-passive triple. */
  vanillaCount: number;
  /** Number of ER-custom species skipped (B1b's job). */
  customSkipped: number;
  /** Number of non-base FORMS (mega / primal / origin) that received ER passives. */
  formCount: number;
  /** Non-fatal issues encountered (missing mappings, missing species). */
  errors: string[];
}

/**
 * Pokerogue form keys (e.g. `"mega"`, `"mega-x"`, `"primal"`) map to ER
 * species-name suffixes. ER ships e.g. `SPECIES_VENUSAUR_MEGA_REDUX` and
 * `SPECIES_CHARIZARD_MEGA_X_REDUX` as separate species records (id ≥ 10000),
 * with their innates representing the mega/primal-form's passive triple.
 *
 * The mapping derives the candidate ER name from the base species' const
 * (`SPECIES_VENUSAUR`) + the form's pokerogue key (`mega` → `MEGA`) + the
 * `_REDUX` suffix ER uses for its custom species names.
 */
function deriveErFormSpeciesConst(baseConst: string, formKey: string): string {
  const upperFormKey = formKey.toUpperCase().replace(/-/g, "_");
  return `${baseConst}_${upperFormKey}_REDUX`;
}

/**
 * Install ER's 3-innate passive triples onto the existing vanilla pokerogue
 * species. Idempotent: safe to call multiple times — the second call overwrites
 * the first with the same data.
 *
 * Defensive: if `allSpecies` is empty (e.g., the species table hasn't been
 * initialized yet by `initSpecies()`), the function returns immediately with
 * a warning. Callers are responsible for ordering — wire this AFTER
 * `initSpecies()` in `initializeGame()`.
 */
export function initEliteReduxSpecies(): InitEliteReduxSpeciesResult {
  const result: InitEliteReduxSpeciesResult = {
    vanillaCount: 0,
    customSkipped: 0,
    formCount: 0,
    errors: [],
  };

  if (allSpecies.length === 0) {
    console.warn("[ER B1a] initEliteReduxSpecies(): allSpecies is empty — skipping");
    return result;
  }

  // Build a O(1) speciesId → PokemonSpecies lookup once.
  const byId = new Map<number, (typeof allSpecies)[number]>();
  for (const species of allSpecies) {
    byId.set(species.speciesId, species);
  }

  // Build a O(1) ER speciesConst → draft lookup for the form-mapping pass.
  // (ER ships mega/primal forms as separate species records keyed by name.)
  const erDraftByConst = new Map<string, (typeof ER_SPECIES)[number]>();
  for (const draft of ER_SPECIES) {
    erDraftByConst.set(draft.speciesConst, draft);
  }

  for (const draft of ER_SPECIES) {
    const pokerogueId = ER_ID_MAP.species[draft.id];
    if (pokerogueId === undefined) {
      result.errors.push(`No pokerogue id mapping for ER species ${draft.id} (${draft.speciesConst})`);
      continue;
    }

    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      // ER-custom species — added by B1b, not here.
      result.customSkipped++;
      continue;
    }

    const species = byId.get(pokerogueId);
    if (!species) {
      result.errors.push(`Pokerogue species ${pokerogueId} (ER ${draft.speciesConst}) not found in allSpecies`);
      continue;
    }

    const passives: readonly [AbilityId, AbilityId, AbilityId] = [
      mapAbilityId(draft.innates[0]),
      mapAbilityId(draft.innates[1]),
      mapAbilityId(draft.innates[2]),
    ];

    species.setPassives(passives);
    result.vanillaCount++;

    // Also install ER innates on each non-base FORM of this species (mega,
    // mega-x, mega-y, primal, origin). ER ships those forms as separate
    // species records (e.g. SPECIES_VENUSAUR_MEGA_REDUX) — we look each up
    // by name and copy its innates onto the pokerogue PokemonForm instance.
    // This fixes the "mega-form-passives" gap documented in the fusion +
    // transform audit (post-Phase-B).
    for (const form of species.forms) {
      if (!form.formKey) {
        continue;
      }
      const candidateConst = deriveErFormSpeciesConst(draft.speciesConst, form.formKey);
      const formDraft = erDraftByConst.get(candidateConst);
      if (!formDraft) {
        // No ER counterpart for this form — silently skip. Acceptable: many
        // pokerogue forms (regional variants, alolan/galarian, etc.) don't
        // exist in ER's mega-centric custom set.
        continue;
      }
      const formPassives: readonly [AbilityId, AbilityId, AbilityId] = [
        mapAbilityId(formDraft.innates[0]),
        mapAbilityId(formDraft.innates[1]),
        mapAbilityId(formDraft.innates[2]),
      ];
      form.setPassives(formPassives);
      result.formCount++;
    }
  }

  return result;
}

/**
 * Resolve an ER ability id to a pokerogue `AbilityId`. Returns `AbilityId.NONE`
 * for empty slots (ER stores `0` for "no innate") and for unmapped ids
 * (defensive — shouldn't happen if `er-id-map.ts` is complete).
 */
function mapAbilityId(erAbilityId: number): AbilityId {
  if (erAbilityId === 0) {
    return AbilityId.NONE;
  }
  const mapped = ER_ID_MAP.abilities[erAbilityId];
  if (mapped === undefined) {
    return AbilityId.NONE;
  }
  return mapped as AbilityId;
}
