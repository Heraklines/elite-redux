/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1f: `composite-vanilla-mashup` archetype primitive.
//
// Final C1 archetype. Implements taxonomy entry #1 (~200 abilities). Covers
// every ER ability whose description is literally the union of two or three
// other named abilities — ER's signature "layer existing effects" pattern:
//
//   - `As One` — "Unnerve + Chilling Neigh."
//   - `Rock Armor` — "Rocky Exterior + takes 10% less damage."
//   - `Slime Mold` — "Sticky Hold + Gooey."
//   - `Smoldering Wood` — "Raw Wood + Flame Body."
//   - `Two-Faced` — "Hunger Switch + Elec and Dark deal 1.35x with 10% recoil."
//
// Design: this archetype is NOT a new `AbAttr` subclass. Pokerogue's dispatcher
// already iterates `Ability.attrs` flat under each ability — `getAttrs(type)`
// scans for matching instances and runs each independently. So a "composite"
// is just the concatenation of the parts' AbAttrs into the parent ability's
// attrs list at construction time.
//
// We therefore expose a tiny helper `composeAbAttrs({ parts })` that:
//   - Validates the composite is meaningful (>= 2 parts; a single-part
//     "composite" should just be the part directly).
//   - Returns the parts list verbatim (callers spread it into `Ability.attr(...)`).
//
// Wire-up shape:
//
//   ```ts
//   // For "As One" — Unnerve + Chilling Neigh:
//   const asOneAttrs = composeAbAttrs({
//     parts: [
//       new UnnerveAbAttr(),
//       new StatTriggerOnKoAbAttr({ stages: 1, stat: Stat.ATK }),
//     ],
//   });
//   new Ability(AbilityId.AS_ONE, 8).attr(...asOneAttrs);
//   ```
//
// Why a helper and not a subclass: pokerogue's dispatcher iterates each AbAttr
// independently via `getAttrs(attrType)`. Wrapping multiple AbAttrs in a parent
// `CompositeAbAttr extends AbAttr` would require modifying every dispatcher
// path to "unwrap" composites (or making the composite extend multiple parents
// at once, which TS doesn't allow). The flatten-at-construction approach is
// strictly simpler and leverages the existing dispatch directly.
//
// Nested composites flatten naturally: a caller that wants to compose two
// already-composite abilities just spreads each `composeAbAttrs(...)` result
// into the outer call:
//
//   ```ts
//   const innerA = composeAbAttrs({ parts: [a1, a2] });
//   const innerB = composeAbAttrs({ parts: [b1, b2] });
//   const outer = composeAbAttrs({ parts: [...innerA, ...innerB] });
//   ```
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";

/** Construction options for {@linkcode composeAbAttrs}. */
export interface CompositeOptions {
  /**
   * The archetype primitives (AbAttrs) to combine into a single ability.
   * Must contain at least 2 entries — a single-part "composite" is degenerate
   * and the caller should just pass the part directly to `Ability.attr(...)`.
   *
   * Order is preserved. Pokerogue's dispatcher iterates `Ability.attrs` in
   * insertion order, so for AbAttrs that race for a shared outcome (e.g. two
   * different priority modifiers) the first registered wins / fires first.
   * Wire-up should mirror the order in ER's source descriptions (the "X" in
   * "X + Y" comes first).
   */
  readonly parts: readonly AbAttr[];
}

/**
 * Flatten a list of archetype primitives into a single AbAttr array suitable
 * for `new Ability(...).attr(...attrs)`. Each part contributes its own
 * `apply()` behavior independently; the runtime dispatcher iterates them in
 * insertion order.
 *
 * Use this for ER abilities whose description is "X + Y" or "X + Y + Z" — the
 * combined ability behaves as the union of its parts' hooks at every trigger
 * site (entry, hit, faint, …).
 *
 * @param opts - the composite options; must include `parts` with >= 2 entries.
 * @returns the flat AbAttr array, ready to be spread into `Ability.attr(...)`.
 * @throws if fewer than 2 parts are passed.
 *
 * @example
 * ```ts
 * // "Slime Mold" — Sticky Hold + Gooey
 * const slimeMoldAttrs = composeAbAttrs({
 *   parts: [
 *     new StickyHoldAbAttr(),
 *     new PostDefendStatStageChangeAbAttr(() => true, Stat.SPD, -1),
 *   ],
 * });
 * new Ability(AbilityId.SLIME_MOLD, 9).attr(...slimeMoldAttrs);
 * ```
 */
export function composeAbAttrs(opts: CompositeOptions): readonly AbAttr[] {
  if (opts.parts.length < 2) {
    throw new Error(
      `[composeAbAttrs] composite requires >= 2 parts (got ${opts.parts.length}); a single-part "composite" should pass the part directly`,
    );
  }
  // Pokerogue's dispatcher iterates `Ability.attrs` flat. No additional work
  // needed — return the parts list verbatim so the caller can spread it into
  // `.attr(...)`. We return a `readonly AbAttr[]` to signal that mutation
  // shouldn't happen post-construction, but the spread copies the values.
  return opts.parts;
}
