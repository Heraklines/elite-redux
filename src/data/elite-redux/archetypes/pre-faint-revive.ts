/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: `pre-faint-revive` archetype primitive.
//
// Parameterized AbAttr that prevents a Pokemon from being KO'd in a single hit
// under a configurable HP gate. Covers vanilla Sturdy and a handful of ER
// abilities that share the "absorb a lethal hit" shape:
//
//   - **Full-HP gate** (Sturdy-style): only fires when the subject is at max
//     HP; the standard vanilla shape.
//   - **HP-threshold gate** (e.g. "survives a KO if HP >= 50%"): fires whenever
//     the subject's HP ratio is at-or-above the configured threshold. Covers
//     ER customs that loosen Sturdy's full-HP requirement.
//
// Base class: `PreDefendFullHpEndureAbAttr` (extends `PreDefendAbAttr`) —
// pokerogue's existing Sturdy implementation. The parent's `canApply` is
// hardcoded to `isFullHp()`; we override `canApply` to evaluate against our
// configurable HP gate but reuse the parent's apply (which adds the
// `STURDY` BattlerTag to suppress the lethal damage in damage-calc).
//
// Sub-shapes intentionally NOT in this primitive (deferred to bespoke):
//   - **Once-per-battle revive** (`Cheating Death`, `Lucky Halo`, `Shallow
//     Grave`): requires per-battle counter state not covered by the STURDY
//     BattlerTag. Tracked in the long-tail.
//   - **Endure-on-low-HP** (Endeavor + Endure combos): different trigger
//     surface; bespoke.
//   - **Form-change on near-faint** (Ice Face / Shields Down lite): handled
//     by the `form-change` archetype (#25).
//
// Examples (per taxonomy):
//   - `Sturdy` — `new PreFaintReviveAbAttr({ gate: { kind: "full-hp" } })`
//   - "Survives a KO at HP >= 50%" — `new PreFaintReviveAbAttr({
//       gate: { kind: "hp-threshold", threshold: 0.5 } })`
//   - "Always survives a KO with 1 HP" (unconditional) — `new
//       PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0 } })`
//     — note this still requires `getMaxHp() > 1` to avoid the 1HP-corner
//     case where the subject would die from 1HP-decay anyway.
// =============================================================================

import { PreDefendFullHpEndureAbAttr, type PreDefendModifyDamageAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";

/**
 * Discriminated HP-gate payload — describes the condition under which the
 * subject can absorb a lethal hit.
 */
export type PreFaintReviveGate =
  | { readonly kind: "full-hp" }
  | { readonly kind: "hp-threshold"; readonly threshold: number };

/** Construction options for {@linkcode PreFaintReviveAbAttr}. */
export interface PreFaintReviveOptions {
  /**
   * The HP condition under which the subject survives a one-shot KO. Defaults
   * to `{ kind: "full-hp" }` (vanilla Sturdy behavior) when omitted.
   */
  readonly gate?: PreFaintReviveGate;
}

/**
 * Parameterized `AbAttr` implementing the `pre-faint-revive` archetype.
 *
 * Used (or will be used) by vanilla `Sturdy` and ER customs that share the
 * "survive a lethal hit" shape with broader HP gating.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PreDefendFullHpEndureAbAttr}, which already
 * implements the apply path (adding the `STURDY` BattlerTag so the damage
 * pipeline knows to clamp damage to leave 1 HP). We override `canApply` to
 * make the HP gate configurable; the rest of the parent's behavior (notably
 * the `damage >= hp` and `!getTag(STURDY)` gates) is preserved.
 *
 * The STURDY BattlerTag is single-use per addition — once the parent's apply
 * runs, the tag prevents the lethal damage AND blocks re-firing of this
 * AbAttr in the same dispatch. The tag lasts one turn (`duration: 1`), so
 * subsequent turns can re-arm if the HP gate is re-satisfied (e.g. via
 * recovery items / heals back to full).
 */
export class PreFaintReviveAbAttr extends PreDefendFullHpEndureAbAttr {
  private readonly gate: PreFaintReviveGate;

  constructor(opts: PreFaintReviveOptions = {}) {
    const gate = opts.gate ?? { kind: "full-hp" };
    PreFaintReviveAbAttr.validateGate(gate);
    super();
    this.gate = gate;
  }

  /** Read-only accessor for the configured HP gate. */
  public getGate(): PreFaintReviveGate {
    return this.gate;
  }

  /**
   * canApply: re-implements the parent's checks, replacing the hard-coded
   * `pokemon.isFullHp()` with our configurable gate evaluation. The other
   * three checks (`getMaxHp() > 1`, `damage.value >= pokemon.hp`,
   * `!pokemon.getTag(STURDY)`) are preserved verbatim.
   */
  public override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    const { pokemon, damage } = params;
    if (!this.matchesGate(pokemon.getHpRatio(true), pokemon.isFullHp())) {
      return false;
    }
    if (pokemon.getMaxHp() <= 1) {
      return false;
    }
    if (damage.value < pokemon.hp) {
      return false;
    }
    if (pokemon.getTag(BattlerTagType.STURDY)) {
      return false;
    }
    return true;
  }

  /**
   * Evaluate the configured HP gate. Exposed for tests / introspection.
   *
   * @param hpRatio - The subject's `hp / maxHp` at the moment of dispatch.
   * @param isFullHp - The subject's `isFullHp()` result (cheap to compute; we
   *   accept it as a separate arg to avoid double-calling on the Pokemon).
   */
  public matchesGate(hpRatio: number, isFullHp: boolean): boolean {
    switch (this.gate.kind) {
      case "full-hp":
        return isFullHp;
      case "hp-threshold":
        return hpRatio >= this.gate.threshold;
    }
  }

  /**
   * Validate the gate payload at construction time. Rejects out-of-range
   * thresholds.
   */
  private static validateGate(gate: PreFaintReviveGate): void {
    if (gate.kind === "hp-threshold" && !(gate.threshold >= 0 && gate.threshold <= 1)) {
      throw new Error(`[PreFaintReviveAbAttr] hp-threshold threshold must be in [0, 1]; got ${gate.threshold}`);
    }
  }
}
