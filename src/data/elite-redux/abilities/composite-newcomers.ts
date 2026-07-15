/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Newcomer-patch composite abilities (fakemon forms phase).
//
// These are hand-authored composite abilities carried by the newcomer-patch
// megas/primals/evolutions. They use the manual ER-custom id range (5933+),
// which — like the Batch 1-4 abilities (5900-5932) — bypasses the auto-generated
// ER_ABILITIES / ER_ID_MAP / ER_COMPOSITE_PARTS tables (those are keyed by ER
// source draft id, and these abilities have no ER source draft).
//
// "Invoke ALL constituent parts via the established composite infra": each
// composite is the union of its constituents' AbAttrs, exactly the model
// documented in `archetypes/composite.ts` and executed by `dispatchComposite`
// (`resolveCompositePartAttrs`) for the draft-id composites. We replicate that
// resolution here for the manual-id range:
//   - resolve every constituent to its LIVE pokerogue ability (`allAbilities[id]`),
//   - copy its AbAttrs onto the composite (shallow-cloned so the two abilities
//     never share a mutable AbAttr instance),
//   - carry the constituent ability's own gate (`.conditions`, e.g. Swift Swim's
//     rain condition) onto each copied attr as an `extraCondition` so a gated
//     part cannot apply unconditionally inside the composite.
//
// Wiring happens in a post-init pass (`wireEliteReduxManualComposites`) called
// right after `refreshEliteReduxComposites()` so every constituent — ER-custom
// (>=5000, built in the main pass) AND vanilla (rebalance-/C-source-patched
// LATER) — is in its final state before we snapshot its attrs.
//
// "Show constituent detailed descriptions" (#201): `MANUAL_COMPOSITE_PARTS` is
// also consulted by `getErCompositeDetailedDescription` so the summary/ability
// detail view concatenates each constituent's detailed description, just like
// the draft-id composites.
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";

// ---------------------------------------------------------------------------
// Manual composite ability ids (continue the 5900-range Batch 1-4 numbering).
// ---------------------------------------------------------------------------
export const ER_FIRST_SERPENT_ABILITY_ID = 5933;
export const ER_TITAN_ABILITY_ID = 5934;
export const ER_PURE_GOOD_ABILITY_ID = 5935;
export const ER_BRAIN_FOOD_ABILITY_ID = 5936;
// 5937 Genesis Supernova — bespoke (see genesis-supernova.ts).
export const ER_WEIGHTED_SCALES_ABILITY_ID = 5938;
// 5939 Knight's Honor — bespoke variant (see knights-honor.ts).
export const ER_BRAINPOWER_ABILITY_ID = 5940;
export const ER_FAMILIAR_ABILITY_ID = 5941;
export const ER_PUNCTURE_ABILITY_ID = 5942;
export const ER_RAINBOW_FISH_ABILITY_ID = 5943;
export const ER_GALE_BLOOM_ABILITY_ID = 5944;

/**
 * A single manual-composite definition: the display name, the verbatim short
 * description, and the resolved pokerogue ability ids of its constituents.
 *
 * Constituent ids are the LIVE pokerogue ids (vanilla `AbilityId.*` for vanilla
 * parts, or the ER-custom id >=5000 that `ER_ID_MAP.abilities[draftId]`
 * produced — verified present at authoring time). The wire pass resolves each
 * against `allAbilities` at runtime.
 */
export interface ManualCompositeDef {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly constituents: readonly number[];
}

// Resolved ER-custom constituent ids (draft id -> pokerogue id, verified via
// ER_ID_MAP at authoring time). Named here for legibility of the table below.
const SIDEWINDER = 5380;
const WORLD_SERPENT = 5550;
const IMPENETRABLE = 5064;
const RELIC_STONE = 5567;
const ARCANE_FORCE = 5224;
const SOUL_EATER = 5069;
const EMANATE = 5190;
const MAJESTIC_BIRD = 5061;
const ARCHMAGE = 5186;
const DEEP_CUTS = 5438;
const PINNACLE_BLADE = 5401;
const AIR_BLOWER = 5058;
const HARUKAZE = 5534;

/**
 * The manual-composite registry, keyed by pokerogue ability id. This is the
 * single source of truth consumed by both {@linkcode wireEliteReduxManualComposites}
 * (attrs) and `getErCompositeDetailedDescription` (constituent detail text).
 */
export const MANUAL_COMPOSITE_PARTS: Readonly<Record<number, ManualCompositeDef>> = {
  [ER_FIRST_SERPENT_ABILITY_ID]: {
    id: ER_FIRST_SERPENT_ABILITY_ID,
    name: "First Serpent",
    description: "Sidewinder + World Serpent.",
    constituents: [SIDEWINDER, WORLD_SERPENT],
  },
  [ER_TITAN_ABILITY_ID]: {
    id: ER_TITAN_ABILITY_ID,
    name: "Titan",
    description: "Impenetrable + Relic Stone.",
    constituents: [IMPENETRABLE, RELIC_STONE],
  },
  [ER_PURE_GOOD_ABILITY_ID]: {
    id: ER_PURE_GOOD_ABILITY_ID,
    name: "Pure Good",
    description: "Fairy Aura + Soul-Heart.",
    constituents: [AbilityId.FAIRY_AURA, AbilityId.SOUL_HEART],
  },
  [ER_BRAIN_FOOD_ABILITY_ID]: {
    id: ER_BRAIN_FOOD_ABILITY_ID,
    name: "Brain Food",
    description: "Arcane Force + Soul Eater.",
    constituents: [ARCANE_FORCE, SOUL_EATER],
  },
  [ER_WEIGHTED_SCALES_ABILITY_ID]: {
    id: ER_WEIGHTED_SCALES_ABILITY_ID,
    name: "Weighted Scales",
    description: "Steelworker + Multiscale.",
    constituents: [AbilityId.STEELWORKER, AbilityId.MULTISCALE],
  },
  [ER_BRAINPOWER_ABILITY_ID]: {
    id: ER_BRAINPOWER_ABILITY_ID,
    name: "Brainpower",
    description: "Emanate + Insomnia.",
    constituents: [EMANATE, AbilityId.INSOMNIA],
  },
  [ER_FAMILIAR_ABILITY_ID]: {
    id: ER_FAMILIAR_ABILITY_ID,
    name: "Familiar",
    description: "Majestic Bird + Archmage.",
    constituents: [MAJESTIC_BIRD, ARCHMAGE],
  },
  [ER_PUNCTURE_ABILITY_ID]: {
    id: ER_PUNCTURE_ABILITY_ID,
    name: "Puncture",
    description: "Deep Cuts + Pinnacle Blade.",
    constituents: [DEEP_CUTS, PINNACLE_BLADE],
  },
  [ER_RAINBOW_FISH_ABILITY_ID]: {
    id: ER_RAINBOW_FISH_ABILITY_ID,
    name: "Rainbow Fish",
    description: "Swift Swim + Marvel Scale.",
    constituents: [AbilityId.SWIFT_SWIM, AbilityId.MARVEL_SCALE],
  },
  [ER_GALE_BLOOM_ABILITY_ID]: {
    id: ER_GALE_BLOOM_ABILITY_ID,
    name: "Gale Bloom",
    description: "Air Blower + Harukaze.",
    constituents: [AIR_BLOWER, HARUKAZE],
  },
};

/**
 * Resolve one constituent ability's AbAttrs for embedding in a composite.
 *
 * Mirrors `resolveCompositePartAttrs` in the archetype dispatcher: shallow-clones
 * each source attr (so the composite and the standalone ability never share a
 * mutable AbAttr instance) and, when the source ability carries ability-level
 * gate conditions (e.g. Swift Swim's rain condition), folds those onto each
 * clone as an `extraCondition` so the part cannot apply unconditionally.
 *
 * @param constituentId - live pokerogue ability id of the constituent
 * @returns the cloned, gate-preserving attr list; empty when the constituent
 *   is absent or has no attrs (logged by the caller for triage).
 */
function resolveConstituentAttrs(constituentId: number): readonly AbAttr[] {
  const ability = allAbilities[constituentId];
  if (!ability || ability.attrs.length === 0) {
    return [];
  }
  const sourceConditions = ability.conditions;
  return ability.attrs.map(attr => {
    const clone = Object.assign(Object.create(Object.getPrototypeOf(attr)), attr) as AbAttr;
    if (sourceConditions.length > 0) {
      const existing = clone.getCondition();
      clone.addCondition(
        pokemon => sourceConditions.every(c => c(pokemon)) && (existing === null || existing(pokemon)),
      );
    }
    return clone;
  });
}

/** Aggregated result of a single {@linkcode wireEliteReduxManualComposites} run. */
export interface WireManualCompositesResult {
  /** Number of composites that received at least one constituent attr this run. */
  wired: number;
  /** Constituent ids that resolved to zero attrs (a pre-existing port gap, logged). */
  emptyConstituents: { compositeId: number; constituentId: number }[];
}

/**
 * Post-init pass: populate every manual-composite ability's attrs from its
 * constituents. Idempotent — clears and rebuilds the attr list each call
 * (matches `refreshEliteReduxComposites`). Must run AFTER the vanilla rebalance
 * + C-source corrections + `refreshEliteReduxComposites`, so vanilla and
 * draft-id-composite constituents are in their final patched state.
 */
export function wireEliteReduxManualComposites(): WireManualCompositesResult {
  const result: WireManualCompositesResult = { wired: 0, emptyConstituents: [] };
  for (const def of Object.values(MANUAL_COMPOSITE_PARTS)) {
    const ability = allAbilities[def.id];
    if (!ability) {
      continue;
    }
    const collected: AbAttr[] = [];
    for (const constituentId of def.constituents) {
      const attrs = resolveConstituentAttrs(constituentId);
      if (attrs.length === 0) {
        result.emptyConstituents.push({ compositeId: def.id, constituentId });
        continue;
      }
      for (const attr of attrs) {
        collected.push(attr);
      }
    }
    if (collected.length === 0) {
      continue;
    }
    const attrs = (ability as unknown as { attrs: AbAttr[] }).attrs;
    attrs.length = 0;
    for (const attr of collected) {
      attrs.push(attr);
    }
    // A part with a PostFaint attr only fires if the ability bypasses the faint
    // gate. None of the newcomer constituents carry PostFaint attrs today, so no
    // bypassFaint plumbing is needed; documented so a future faint-based
    // constituent gets it (see wireArchetypeAttrs in init-elite-redux-custom-abilities).
    result.wired++;
  }
  return result;
}

/**
 * Whether `pokerogueAbilityId` is a manual-composite (newcomer-patch) ability.
 * Used by the ability-detail description path to route to the constituent-detail
 * builder.
 */
export function isManualComposite(pokerogueAbilityId: number): boolean {
  return pokerogueAbilityId in MANUAL_COMPOSITE_PARTS;
}

/** The constituent pokerogue ability ids for a manual-composite, or null. */
export function manualCompositeConstituents(pokerogueAbilityId: number): readonly number[] | null {
  return MANUAL_COMPOSITE_PARTS[pokerogueAbilityId]?.constituents ?? null;
}

/** Assert that a live ability instance is one of ours (test/diagnostic helper). */
export function manualCompositeName(ability: Ability | undefined): string | undefined {
  if (!ability) {
    return;
  }
  return MANUAL_COMPOSITE_PARTS[ability.id]?.name;
}
