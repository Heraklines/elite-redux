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
//   - **Post-faint revive** (`Shallow Grave`: "Revives at 25% HP once after
//     fainting in fog"): triggers AFTER KO not before; the trigger surface is
//     entirely different (post-faint phase, not pre-defend damage clamp).
//     Tracked in the long-tail.
//   - **Endure-on-low-HP** (Endeavor + Endure combos): different trigger
//     surface; bespoke.
//   - **Form-change on near-faint** (Ice Face / Shields Down lite): handled
//     by the `form-change` archetype (#25).
//
// Round-7 extension — `usage` gate covers the "once-per-battle" /
// "first-N-hits" family that previously deferred to bespoke:
//   - **`per-hit`** (default, vanilla Sturdy parity): the proc may fire once
//     per turn (the parent's STURDY tag suppresses repeats within a turn) and
//     re-arms each turn so long as the HP gate is re-satisfied.
//   - **`first-n-hits`**: the proc may fire only for the first N incoming hits
//     of the entire battle, regardless of turn boundary. Backed by the engine's
//     existing `Pokemon.battleData.hitCount` counter — which is incremented
//     post-damage in `move-effect-phase.ts:705` so its value during pre-defend
//     dispatch is "hits-received-so-far" excluding the current one. Covers ER
//     abilities like 583 Gallantry (N=1), 724 Lucky Halo (N=1, composes with
//     a stat-protect), 427 Cheating Death (N=2). Skips the STURDY tag because
//     `hitCount` is the source of truth across turns; the SturdyTag would
//     auto-decay at TURN_END and lose track.
//
// Examples (per taxonomy):
//   - `Sturdy` — `new PreFaintReviveAbAttr({ gate: { kind: "full-hp" } })`
//   - "Survives a KO at HP >= 50%" — `new PreFaintReviveAbAttr({
//       gate: { kind: "hp-threshold", threshold: 0.5 } })`
//   - Gallantry — `new PreFaintReviveAbAttr({
//       gate: { kind: "hp-threshold", threshold: 0 }, usage: { kind: "first-n-hits", n: 1 } })`
//   - Cheating Death — `new PreFaintReviveAbAttr({
//       gate: { kind: "hp-threshold", threshold: 0 }, usage: { kind: "first-n-hits", n: 2 } })`
//   - "Always survives a KO with 1 HP" (unconditional) — `new
//       PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0 } })`
//     — note this still requires `getMaxHp() > 1` to avoid the 1HP-corner
//     case where the subject would die from 1HP-decay anyway.
// =============================================================================

import { PreDefendFullHpEndureAbAttr, type PreDefendModifyDamageAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";

/**
 * Discriminated HP-gate payload — describes the condition under which the
 * subject can absorb a lethal hit.
 */
export type PreFaintReviveGate =
  | { readonly kind: "full-hp" }
  | { readonly kind: "hp-threshold"; readonly threshold: number };

/**
 * Discriminated usage-policy payload — describes how often the proc may fire.
 *
 *   - `per-hit` (default, vanilla Sturdy parity): the proc may fire once per
 *     turn. The parent's STURDY {@linkcode BattlerTagType.STURDY} tag is added
 *     in `apply`, suppressing further fires within the same dispatch; the tag
 *     auto-decays at TURN_END so subsequent turns can re-arm if the HP gate is
 *     re-satisfied (e.g. via heals back to full HP).
 *   - `first-n-hits`: the proc may fire only for the first {@linkcode n}
 *     incoming hits of the entire battle. Backed by
 *     `Pokemon.battleData.hitCount`. Does NOT add the STURDY tag — the tag's
 *     TURN_END lapse would otherwise reset the per-turn block while leaving
 *     the persistent counter intact, but we want the persistent counter to be
 *     the sole source of truth across turns.
 */
export type PreFaintReviveUsage = { readonly kind: "per-hit" } | { readonly kind: "first-n-hits"; readonly n: number };

/** Construction options for {@linkcode PreFaintReviveAbAttr}. */
export interface PreFaintReviveOptions {
  /**
   * The HP condition under which the subject survives a one-shot KO. Defaults
   * to `{ kind: "full-hp" }` (vanilla Sturdy behavior) when omitted.
   */
  readonly gate?: PreFaintReviveGate;
  /**
   * The usage policy controlling how often the proc may fire. Defaults to
   * `{ kind: "per-hit" }` (vanilla Sturdy behavior — once per turn, re-armed
   * each turn by the STURDY tag's TURN_END lapse) when omitted.
   */
  readonly usage?: PreFaintReviveUsage;
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
  private readonly usage: PreFaintReviveUsage;

  constructor(opts: PreFaintReviveOptions = {}) {
    const gate = opts.gate ?? { kind: "full-hp" };
    const usage = opts.usage ?? { kind: "per-hit" };
    PreFaintReviveAbAttr.validateGate(gate);
    PreFaintReviveAbAttr.validateUsage(usage);
    super();
    this.gate = gate;
    this.usage = usage;
  }

  /** Read-only accessor for the configured HP gate. */
  public getGate(): PreFaintReviveGate {
    return this.gate;
  }

  /** Read-only accessor for the configured usage policy. */
  public getUsage(): PreFaintReviveUsage {
    return this.usage;
  }

  /**
   * canApply: re-implements the parent's checks, replacing the hard-coded
   * `pokemon.isFullHp()` with our configurable gate evaluation. The other
   * three checks (`getMaxHp() > 1`, `damage.value >= pokemon.hp`) are
   * preserved verbatim. The STURDY-tag block is replaced by the configured
   * usage-policy check:
   *
   *   - `per-hit`: same as parent — block when STURDY tag is present.
   *   - `first-n-hits`: block when `battleData.hitCount >= n` (the holder has
   *     already received N hits, so no more procs are allowed).
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
    if (!this.matchesUsage(pokemon)) {
      return false;
    }
    return true;
  }

  /**
   * apply: clamp the damage so the subject survives with 1 HP. For
   * `per-hit` usage we add the STURDY tag (vanilla parent behavior — the tag
   * suppresses re-fire within the dispatch AND signals the damage pipeline to
   * clamp to 1 HP). For `first-n-hits` usage we still need the damage clamp
   * but don't want the tag's TURN_END auto-decay racing with our persistent
   * counter — we add the tag too (it's the mechanism by which the damage
   * pipeline knows to leave the subject at 1 HP, see {@linkcode SturdyTag});
   * the persistent `battleData.hitCount` counter remains the source of truth
   * for cross-turn gating, while the tag handles within-dispatch clamping.
   *
   * @remarks
   * The reason we still add the STURDY tag for `first-n-hits` is downstream:
   * pokerogue's damage-application path in {@linkcode Pokemon.damageAndUpdate}
   * (around line 4050 of pokemon.ts) inspects `getTag(BattlerTagType.STURDY)`
   * and uses it to set `surviveDamage.value = true` — without the tag the
   * subject would still take the lethal damage. So the tag IS the clamp
   * mechanism; we just don't read it as the policy gate when in
   * `first-n-hits` mode.
   */
  public override apply(params: PreDefendModifyDamageAbAttrParams): void {
    super.apply(params);
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
   * Evaluate the configured usage policy. Exposed for tests / introspection.
   *
   * For `per-hit` we replicate the parent's STURDY-tag-presence check. For
   * `first-n-hits` we consult `battleData.hitCount` — incremented post-damage
   * in `move-effect-phase.ts:705`, so at the moment of pre-defend dispatch its
   * value is "hits-received-so-far" excluding the current one. The proc may
   * fire when `hitCount < n`.
   */
  public matchesUsage(pokemon: Pokemon): boolean {
    switch (this.usage.kind) {
      case "per-hit":
        return !pokemon.getTag(BattlerTagType.STURDY);
      case "first-n-hits":
        return pokemon.battleData.hitCount < this.usage.n;
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

  /**
   * Validate the usage payload at construction time. Rejects non-positive
   * `n` for `first-n-hits`.
   */
  private static validateUsage(usage: PreFaintReviveUsage): void {
    if (usage.kind === "first-n-hits" && (!Number.isInteger(usage.n) || usage.n < 1)) {
      throw new Error(`[PreFaintReviveAbAttr] first-n-hits n must be a positive integer; got ${usage.n}`);
    }
  }
}
