/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 10 of the bespoke ability grind: `type-effectiveness-mod`
// archetype primitive.
//
// Models the ER "type hunter" cluster — abilities that grant (a) an offensive
// damage boost when attacking a Pokemon of a specific type, and (b) a defensive
// damage reduction when receiving moves of that same type. Five ER abilities
// follow this exact symmetric shape:
//
//   - 313 Dragonslayer  — "Deals 1.5x damage to Dragons. Takes 0.5x damage from Dragons."
//   - 442 Fae Hunter    — "Deals 1.5x damage to Fairy. Takes 0.5x damage from Fairy."
//   - 445 Lumberjack    — "Deals 1.5x damage to Grass. Takes 0.5x damage from Grass."
//   - 526 Monster Hunter — "Deals 1.5x damage to Dark. Takes 0.5x damage from Dark."
//   - 804 Firefighter   — "Deals 1.5x damage to Fire. Takes 0.5x damage from Fire."
//
// The naming convention ("…slayer", "…hunter", "…fighter") makes the intent
// clear: a Lumberjack hunts trees (Grass-types), takes less damage from grass
// retaliation. The offensive condition therefore gates on the *defender's*
// type (`opponent.isOfType(type)`) — not the move's type — while the defensive
// condition gates on the incoming move's type.
//
// Sub-shapes covered:
//   - Symmetric hunter (offensive boost vs type + defensive reduction from
//     that type). Most common — all 5 abilities above.
//   - Offensive-only (caller passes `defensiveMultiplier: 1`) — covers
//     "King of the Jungle" (1028, "deals 1.5x more damage to Grass-types")
//     once paired with the composite handler.
//   - Defensive-only (caller passes `offensiveMultiplier: 1`) — exposed for
//     symmetry; no current ER ability fits this exact shape but future
//     composites may.
//
// Why a primitive that produces a *pair* of AbAttrs?
//
//   The offensive and defensive sides hook into different pokerogue surfaces:
//   the offensive side multiplies outgoing `power.value` via
//   `MovePowerBoostAbAttr` (gated by defender-type predicate), and the
//   defensive side wraps `ReceivedTypeDamageMultiplierAbAttr` (vanilla,
//   pre-defend hook). They MUST live as two separate AbAttrs in
//   `Ability.attrs` because pokerogue's `applyAbAttrs(attrType, ...)`
//   iterates by type — an offensive attr won't fire on defense and vice
//   versa. The factory helper `buildTypeEffectivenessModAttrs(opts)` returns
//   both attrs at once so the dispatcher can spread them.
//
// Composes with: `composeAbAttrs` for hybrid composite cases.
//
// Examples:
//   - Dragonslayer (313): `buildTypeEffectivenessModAttrs({
//       type: PokemonType.DRAGON, offensiveMultiplier: 1.5,
//       defensiveMultiplier: 0.5 })`
//   - King of the Jungle (1028 — offensive piece): `buildTypeEffectivenessModAttrs({
//       type: PokemonType.GRASS, offensiveMultiplier: 1.5,
//       defensiveMultiplier: 1 })` — defensive side omitted via 1x.
// =============================================================================

import { type AbAttr, MovePowerBoostAbAttr, ReceivedTypeDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import type { PokemonType } from "#enums/pokemon-type";

/** Construction options for {@linkcode buildTypeEffectivenessModAttrs}. */
export interface TypeEffectivenessModOptions {
  /**
   * The {@linkcode PokemonType} this ability is "tuned against". The offensive
   * boost fires when the *defender* is this type; the defensive reduction
   * fires when the incoming move is this type.
   */
  readonly type: PokemonType;
  /**
   * Multiplier applied to outgoing power when attacking a defender whose
   * types include {@linkcode type}. Must be > 0. A value of `1` disables the
   * offensive side (no attr emitted).
   * @defaultValue `1.5`
   */
  readonly offensiveMultiplier?: number;
  /**
   * Multiplier applied to incoming damage when the move's resolved type
   * matches {@linkcode type}. Must be > 0. A value of `1` disables the
   * defensive side (no attr emitted).
   * @defaultValue `0.5`
   */
  readonly defensiveMultiplier?: number;
}

/**
 * Parameterized `AbAttr` implementing the offensive half of the
 * `type-effectiveness-mod` archetype: a power boost when the *defender* has
 * the configured type.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}, gating on
 * `opponent.isOfType(this.targetDefenderType)`. Tera/typed-override semantics
 * follow vanilla `isOfType` defaults (`includeTeraType: true`,
 * `returnOriginalTypesIfStellar: false`) — Tera Dragon Charizard counts as
 * Dragon for a Dragonslayer hit.
 *
 * Unlike `TypeDamageBoostAbAttr` (which gates on the *move's* type — i.e.
 * "boost when I use a Fire move"), this gates on the *defender's* type —
 * "boost when I attack a Fire-type". The two are complementary axes and
 * compose multiplicatively without overlap.
 */
export class OffensiveTypeMultiplierAbAttr extends MovePowerBoostAbAttr {
  private readonly targetDefenderType: PokemonType;
  private readonly multiplier: number;

  constructor(targetDefenderType: PokemonType, multiplier: number) {
    if (!(multiplier > 0)) {
      throw new Error(`[OffensiveTypeMultiplierAbAttr] multiplier must be > 0; got ${multiplier}`);
    }
    super((_pokemon, opponent, _move) => opponent?.isOfType?.(targetDefenderType) === true, multiplier, false);
    this.targetDefenderType = targetDefenderType;
    this.multiplier = multiplier;
  }

  /** Read-only accessor for the defender type that this boost gates on. */
  public getTargetDefenderType(): PokemonType {
    return this.targetDefenderType;
  }

  /** Read-only accessor for the configured power multiplier. */
  public getMultiplier(): number {
    return this.multiplier;
  }
}

/**
 * Build the AbAttr pair for the `type-effectiveness-mod` archetype.
 *
 * Returns a list of 0, 1, or 2 AbAttrs depending on which sides are enabled:
 *   - Both multipliers ≠ 1  → returns `[offensive, defensive]` (length 2).
 *   - Only offensive ≠ 1    → returns `[offensive]` (length 1).
 *   - Only defensive ≠ 1    → returns `[defensive]` (length 1).
 *   - Both === 1            → returns `[]` (degenerate; caller should not
 *     wire it, but we don't throw because the callsite may be programmatic).
 *
 * The defensive attr is a stock {@linkcode ReceivedTypeDamageMultiplierAbAttr}
 * from pokerogue (already in `ab-attrs`); the offensive attr is the new
 * {@linkcode OffensiveTypeMultiplierAbAttr} above. Both are independent and
 * fire on different pokerogue surfaces.
 *
 * @param opts - the archetype options (type, offensive/defensive multipliers).
 * @returns the constructed AbAttrs, in offensive-then-defensive order.
 * @throws if either multiplier is ≤ 0.
 *
 * @example
 * ```ts
 * // "Dragonslayer" — 1.5x to Dragons, 0.5x from Dragons:
 * const attrs = buildTypeEffectivenessModAttrs({
 *   type: PokemonType.DRAGON,
 *   offensiveMultiplier: 1.5,
 *   defensiveMultiplier: 0.5,
 * });
 * // attrs = [OffensiveTypeMultiplierAbAttr, ReceivedTypeDamageMultiplierAbAttr]
 * ```
 */
export function buildTypeEffectivenessModAttrs(opts: TypeEffectivenessModOptions): AbAttr[] {
  const offensiveMult = opts.offensiveMultiplier ?? 1.5;
  const defensiveMult = opts.defensiveMultiplier ?? 0.5;
  if (!(offensiveMult > 0)) {
    throw new Error(`[buildTypeEffectivenessModAttrs] offensiveMultiplier must be > 0; got ${offensiveMult}`);
  }
  if (!(defensiveMult > 0)) {
    throw new Error(`[buildTypeEffectivenessModAttrs] defensiveMultiplier must be > 0; got ${defensiveMult}`);
  }
  const attrs: AbAttr[] = [];
  if (offensiveMult !== 1) {
    attrs.push(new OffensiveTypeMultiplierAbAttr(opts.type, offensiveMult));
  }
  if (defensiveMult !== 1) {
    attrs.push(new ReceivedTypeDamageMultiplierAbAttr(opts.type, defensiveMult));
  }
  return attrs;
}

/** Marker type — generic alias for the wire-up layer. */
export type TypeEffectivenessMod = ReturnType<typeof buildTypeEffectivenessModAttrs>;
