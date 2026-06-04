// =============================================================================
// Elite Redux Phase D1 — form-change overlay helper.
//
// B5 built `ER_FORM_CHANGE_REGISTRY` + `ER_FORM_CHANGES_BY_SOURCE`. This
// module exposes a small consumption API used by ER-aware battle code to
// query the registry at mega-evolution / primal-reversion time.
//
// Design rationale: pokerogue's vanilla `pokemonFormChanges` already
// handles mega evolution for the standard megas (Mega Venusaur, Mega
// Charizard X/Y, etc.); B1a installed ER's innates on those existing
// pokerogue forms so the per-form passives surface correctly. The ER
// registry's value is in:
//   - documenting ER's complete form-change graph (303 entries vs ~50 in
//     vanilla pokerogue)
//   - providing reverse lookup (target → source) for mega-form transformer
//     scenarios
//   - exposing the canonical trigger string (ITEM_VENUSAURITE, etc.) for
//     future item-side wire-up
//
// Full integration with pokerogue's runtime form-change system (i.e.
// adding ER-only mega entries to `pokemonFormChanges`) is deferred — this
// helper is the callable utility for that integration when the API
// surface is understood and stable. Vanilla pokerogue mega evolution
// continues to work unchanged.
// =============================================================================

import { ER_FORM_CHANGE_KIND, ER_FORM_CHANGE_REGISTRY, ER_FORM_CHANGES_BY_SOURCE } from "#data/elite-redux/init-elite-redux-form-changes";
import type {
  ErFormChangeKindLabel,
  ErFormChangeRegistryEntry,
} from "#data/elite-redux/init-elite-redux-form-changes";

/** True if the source species has at least one ER form change registered. */
export function hasErFormChanges(sourceSpeciesId: number): boolean {
  const bucket = ER_FORM_CHANGES_BY_SOURCE.get(sourceSpeciesId);
  return bucket !== undefined && bucket.length > 0;
}

/**
 * Return every ER form change with the given source species id. Returns an
 * empty array if the source has no ER form changes.
 *
 * Multiple entries can share a source (e.g. Charizard has both MEGA_X and
 * MEGA_Y). Order matches the v2.65 dump's insertion order.
 */
export function getErFormChangesFor(sourceSpeciesId: number): readonly ErFormChangeRegistryEntry[] {
  return ER_FORM_CHANGES_BY_SOURCE.get(sourceSpeciesId) ?? [];
}

/**
 * Reverse-lookup: given a target species id (typically an ER-custom mega
 * like SPECIES_VENUSAUR_MEGA_REDUX = 10000+), return the source species
 * + trigger info. Useful for "what mega form is this and how did we get
 * here" diagnostics.
 *
 * Returns the FIRST entry matching the target; if multiple sources point
 * to the same target (unlikely in v2.65), only the first is returned.
 */
export function findErFormChangeByTarget(targetSpeciesId: number): ErFormChangeRegistryEntry | undefined {
  return ER_FORM_CHANGE_REGISTRY.find(e => e.targetSpeciesId === targetSpeciesId);
}

/**
 * Filter the registry to entries of a specific kind (MEGA / PRIMAL /
 * MOVE_MEGA). Returns a fresh array each call.
 */
export function getErFormChangesByKind(kind: ErFormChangeKindLabel): readonly ErFormChangeRegistryEntry[] {
  return ER_FORM_CHANGE_REGISTRY.filter(e => e.kind === kind);
}

/**
 * Filter the registry to entries with a specific trigger requirement
 * (e.g. "ITEM_VENUSAURITE", "ITEM_BLUE_ORB", "MOVE_DRAGON_ASCENT").
 * Returns a fresh array each call.
 */
export function getErFormChangesByRequirement(requirement: string): readonly ErFormChangeRegistryEntry[] {
  return ER_FORM_CHANGE_REGISTRY.filter(e => e.requirement === requirement);
}

/** Total form-change entries in the registry — useful for audit logs. */
export function getErFormChangeCount(): number {
  return ER_FORM_CHANGE_REGISTRY.length;
}

/**
 * Per-kind breakdown of the registry. Returns counts for MEGA, PRIMAL,
 * MOVE_MEGA, plus the LEVEL kinds (which should always be 0 since the
 * registry is filtered to form-changes only at construction time).
 */
export function getErFormChangeKindBreakdown(): Record<ErFormChangeKindLabel, number> {
  const counts: Record<ErFormChangeKindLabel, number> = {
    [ER_FORM_CHANGE_KIND.LEVEL]: 0,
    [ER_FORM_CHANGE_KIND.MEGA]: 0,
    [ER_FORM_CHANGE_KIND.PRIMAL]: 0,
    [ER_FORM_CHANGE_KIND.LEVEL_MALE]: 0,
    [ER_FORM_CHANGE_KIND.LEVEL_FEMALE]: 0,
    [ER_FORM_CHANGE_KIND.MOVE_MEGA]: 0,
    [ER_FORM_CHANGE_KIND.UNKNOWN]: 0,
  };
  for (const entry of ER_FORM_CHANGE_REGISTRY) {
    counts[entry.kind]++;
  }
  return counts;
}
