/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: `effect-chance-modifier` archetype primitive.
//
// Parameterized AbAttr that multiplies the additional-effect chance of a
// Pokemon's outgoing move. Covers two canonical sub-shapes:
//
//   - **Serene-Grace-style** (chance amplifier): multiply effect chance by N
//     to make secondary effects (flinch, status, stat drops) proc more often.
//     ER customs use multipliers in the 1.5x-3x range; vanilla Serene Grace
//     uses 2x.
//   - **Sheer-Force-style** (chance suppressor + power boost rider): set the
//     effect chance to 0 to strip all secondary effects, paired with a power
//     boost (the boost itself is OUT OF SCOPE for this primitive and lives in
//     {@linkcode TypeDamageBoostAbAttr} / {@linkcode FlagDamageBoostAbAttr}).
//     This archetype only covers the chance-strip piece; the power boost is
//     wired via composition.
//
// Base class: `MoveEffectChanceMultiplierAbAttr` — pokerogue's existing
// Sheer Force / Serene Grace implementation. The parent's constructor takes
// a positional `chanceMultiplier`; we wrap the typed-options shape on top so
// the data layer can configure it via the same `{ multiplier }` ergonomics
// as the other power-boost archetypes.
//
// Sub-shapes intentionally NOT in this primitive (composed elsewhere):
//   - **Power boost rider** (Sheer Force's "+30% power for moves with
//     secondary effects"): use `MovePowerBoostAbAttr` with a `move.chance >= 1`
//     condition. The composition at the data layer wires both instances.
//   - **Per-type / per-flag chance modification**: pokerogue's parent doesn't
//     support per-move filtering — the multiplier applies to every move with
//     a non-zero effect chance. ER abilities that need filtering would need a
//     bespoke subclass; none of the C1d targets do.
//   - **Negative or fractional chance changes** (e.g. "+5% chance instead of
//     2x multiplier"): the parent's class multiplies; an additive variant
//     would need a sibling AbAttr. Not in scope.
//
// Examples (per taxonomy / vanilla):
//   - `Serene Grace` (vanilla): `new EffectChanceModifierAbAttr({ multiplier: 2 })`
//   - `Sheer Force` (vanilla, chance-strip piece): `new EffectChanceModifierAbAttr({
//       multiplier: 0 })`
//   - ER "Doubly Serene" custom: `new EffectChanceModifierAbAttr({ multiplier: 3 })`
// =============================================================================

import { MoveEffectChanceMultiplierAbAttr } from "#abilities/ab-attrs";

/** Construction options for {@linkcode EffectChanceModifierAbAttr}. */
export interface EffectChanceModifierOptions {
  /**
   * The multiplier applied to the move's additional-effect chance. Typical
   * values:
   *   - `0`   → strip secondary effects (Sheer Force).
   *   - `0.5` → halve effect chances.
   *   - `2`   → double effect chances (Serene Grace).
   *   - `3+`  → ER custom amplifiers.
   *
   * Must be ≥ 0. The parent's apply clamps the post-multiplication value to
   * `[0, 100]` so very-high multipliers don't exceed 100%.
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the `effect-chance-modifier` archetype.
 *
 * Used by vanilla `Serene Grace` (multiplier=2), `Sheer Force` (multiplier=0
 * — pairs with a `MovePowerBoostAbAttr` rider for the +30% power piece), and
 * ER customs that modify secondary-effect proc rates.
 *
 * @remarks
 * Extends pokerogue's {@linkcode MoveEffectChanceMultiplierAbAttr}. The
 * parent's canApply checks that the move has a positive chance (otherwise
 * the multiplier is moot) and excludes special-cased moves (ORDER_UP,
 * ELECTRO_SHOT) that pokerogue documents as bypassing this hook. Apply
 * multiplies `chance.value` and clamps to ≤ 100.
 *
 * We add typed-options ergonomics plus construction validation: reject
 * negative multipliers (the parent doesn't validate, so a stray `-0.5` would
 * silently turn a 30% chance into -15%, which the clamp would then leave
 * negative — broken behavior). Multiplier of `0` is explicitly allowed for
 * the Sheer Force pattern.
 */
export class EffectChanceModifierAbAttr extends MoveEffectChanceMultiplierAbAttr {
  private readonly configuredMultiplier: number;

  constructor(opts: EffectChanceModifierOptions) {
    if (!(opts.multiplier >= 0)) {
      // Note: `>= 0` rejects both negative AND NaN. Sheer Force uses 0 explicitly.
      throw new Error(`[EffectChanceModifierAbAttr] multiplier must be ≥ 0; got ${opts.multiplier}`);
    }
    super(opts.multiplier);
    this.configuredMultiplier = opts.multiplier;
  }

  /** Read-only accessor for the configured chance multiplier. */
  public getMultiplier(): number {
    return this.configuredMultiplier;
  }

  /**
   * Returns true if this primitive is acting as a "strip secondary effects"
   * gate (i.e. multiplier=0). Useful for the wire-up layer to detect Sheer-
   * Force-style configurations without inspecting the multiplier directly.
   */
  public stripsSecondaryEffects(): boolean {
    return this.configuredMultiplier === 0;
  }
}
