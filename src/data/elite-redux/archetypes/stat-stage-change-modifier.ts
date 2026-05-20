/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: `stat-stage-change-modifier` archetype primitive.
//
// Parameterized AbAttr that scales the magnitude of stat-stage changes applied
// to the user (own stat boosts/drops). Covers two canonical sub-shapes:
//
//   - **Simple-style amplifier**: every incoming stat-stage change is doubled
//     (the vanilla `Simple` ability — multiplier `2`). Both boosts and drops
//     are amplified, since the parent's `apply` multiplies `numStages` in
//     place.
//   - **Contrary-style inverter**: every incoming stat-stage change is flipped
//     (multiplier `-1`). Boosts become drops, drops become boosts. Mirrors
//     vanilla `Contrary`.
//   - **ER custom amplifiers/dampeners**: configurable multipliers in (-1, 0)
//     or (0, ∞), used by ER custom abilities that partially scale stat changes
//     (e.g. "Stat boosts gained at half magnitude").
//
// Base class: `StatStageChangeMultiplierAbAttr` — pokerogue's existing
// `Simple`/`Contrary` implementation. The parent's `apply` multiplies the
// `numStages.value` holder by the constructor-stored multiplier; we just wrap
// the typed-options shape on top with validation.
//
// Sub-shapes intentionally NOT covered in this primitive:
//   - **Per-stat amplification** (e.g. "Attack stage changes are doubled,
//     others are normal"): would require either per-stat instances composed
//     together or a different parent. Not in the canonical taxonomy — bespoke
//     when needed.
//   - **One-sided amplification** (e.g. "Stat boosts are doubled but drops are
//     normal"): the parent's multiplier applies to both signs uniformly.
//     Asymmetric sub-shape would need a custom predicate; not in scope.
//   - **`StatStageChangeCopyAbAttr` composition** (Mirror Armor-style "copy
//     stat drops back to attacker"): different trigger surface; will land as
//     a separate primitive (`stat-drop-mirror`) if more than one ability
//     adopts the shape.
//
// Examples:
//   - `Simple` (vanilla, ER parity) — `new StatStageChangeModifierAbAttr({ multiplier: 2 })`
//   - `Contrary` (vanilla, ER parity) — `new StatStageChangeModifierAbAttr({ multiplier: -1 })`
//   - ER "Half Stat" custom — `new StatStageChangeModifierAbAttr({ multiplier: 0.5 })`
// =============================================================================

import { StatStageChangeMultiplierAbAttr } from "#abilities/ab-attrs";

/** Construction options for {@linkcode StatStageChangeModifierAbAttr}. */
export interface StatStageChangeModifierOptions {
  /**
   * The multiplier applied to the magnitude of every stat-stage change.
   * Canonical values:
   *   - `2`   → Simple
   *   - `-1`  → Contrary (negates direction)
   *   - `0.5` → ER custom half-magnitude variants
   *
   * Constraints:
   *   - Must NOT be `0` (a 0-multiplier silently swallows all stat changes,
   *     which is `Clear Body`'s job — and lives in `ProtectStatAbAttr`).
   *   - Must NOT be `1` (no-op — the AbAttr would have zero effect, which is
   *     almost certainly a configuration mistake).
   *   - Otherwise unconstrained: positive amplifies, negative inverts.
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the `stat-stage-change-modifier`
 * archetype.
 *
 * Used by vanilla `Simple` (multiplier=2) and `Contrary` (multiplier=-1), as
 * well as ER customs that partially scale stat changes.
 *
 * @remarks
 * Extends pokerogue's {@linkcode StatStageChangeMultiplierAbAttr}. The parent's
 * `apply` multiplies the `numStages.value` holder by the constructor multiplier;
 * we wrap a typed-options constructor for parity with the rest of the archetype
 * layer plus input validation.
 *
 * The parent's class has no `canApply` (defaults to `true`), so every stat
 * change is processed. The dispatcher routes the apply call regardless of
 * which stat or direction; this archetype is *uniform* — same multiplier for
 * every stat, both signs.
 */
export class StatStageChangeModifierAbAttr extends StatStageChangeMultiplierAbAttr {
  private readonly configuredMultiplier: number;

  constructor(opts: StatStageChangeModifierOptions) {
    if (!Number.isFinite(opts.multiplier)) {
      throw new Error(`[StatStageChangeModifierAbAttr] multiplier must be finite; got ${opts.multiplier}`);
    }
    if (opts.multiplier === 0) {
      throw new Error(
        "[StatStageChangeModifierAbAttr] multiplier must not be 0 (use ProtectStatAbAttr / Clear-Body-style classes to fully block stat changes)",
      );
    }
    if (opts.multiplier === 1) {
      throw new Error(
        "[StatStageChangeModifierAbAttr] multiplier must not be 1 (no-op — likely a configuration mistake)",
      );
    }
    super(opts.multiplier);
    this.configuredMultiplier = opts.multiplier;
  }

  /** Read-only accessor for the configured stat-change multiplier. */
  public getMultiplier(): number {
    return this.configuredMultiplier;
  }

  /**
   * Returns true if this primitive is acting as a Contrary-style inverter
   * (multiplier is negative). Useful for the wire-up layer to detect Contrary-
   * style configurations without inspecting the multiplier directly.
   */
  public invertsDirection(): boolean {
    return this.configuredMultiplier < 0;
  }

  /**
   * Returns true if this primitive amplifies stat changes (|multiplier| > 1).
   * Simple = `true` (multiplier=2), Contrary = `false` (multiplier=-1, same
   * magnitude), ER half-stat = `false` (multiplier=0.5).
   */
  public amplifies(): boolean {
    return Math.abs(this.configuredMultiplier) > 1;
  }
}
