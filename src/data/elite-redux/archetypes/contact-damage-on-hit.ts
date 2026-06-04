/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: `contact-damage-on-hit` archetype primitive.
//
// Parameterized AbAttr that damages the attacker for a configurable fraction of
// their max HP when the subject is hit by a qualifying move. Covers the
// Rough Skin / Iron Barbs vanilla pattern plus the wider ER reactive-damage
// family: ~10 abilities currently. The damage fraction is the primary axis;
// the secondary axis is the move filter (contact-required vs. any incoming
// damaging move — ER lifts the vanilla "MAKES_CONTACT required" gate for a
// handful of abilities that proc on every hit regardless of contact).
//
// Base class: `PostDefendContactDamageAbAttr` (extends `PostDefendAbAttr`) —
// pokerogue's existing Rough Skin/Iron Barbs implementation. The vanilla class
// hardcodes the contact requirement, so we extend it and override `canApply`
// to make the gate optional. Damage application (apply) is unchanged from
// vanilla — same `attacker.damageAndUpdate(...)` call with the configurable
// fraction.
//
// Differences from vanilla `PostDefendContactDamageAbAttr`:
//   - Vanilla accepts a positional `damageRatio` (the integer denominator, so
//     `8` means 1/8 max HP). Our typed Options accepts {@linkcode maxHpFraction}
//     as a `(0, 1]` fraction directly, matching the ergonomics of
//     {@linkcode OnFaintEffectAttackerDamageFlat}. We translate at construction
//     time by passing `1 / maxHpFraction` to the super, so the parent's
//     `apply` math (`attacker.getMaxHp() * (1 / damageRatio)`) yields the
//     expected `maxHpFraction * maxHp` damage.
//   - Vanilla enforces `MoveFlags.MAKES_CONTACT` unconditionally; we expose
//     {@linkcode ContactDamageOnHitOptions.contactRequired} so ER abilities
//     that proc on any hit (e.g. "Reactive Spikes — damages any attacker for
//     1/8 max HP") can wire `contactRequired: false`.
//
// Sub-shapes intentionally NOT in this primitive (deferred or composed):
//   - **Flag-gated contact damage** ("damages attacker only if hit by a
//     biting move"): compose with the existing predicate by extending
//     `OnHitFilter` from `stat-trigger-on-event`. None of the C1d targets
//     need this — skipped to keep the primitive small.
//   - **Type-gated contact damage** ("damages Fire-type attackers"): same
//     reasoning — composes via a future filter pass.
//   - **Variable damage based on attacker HP / level**: handled by bespoke
//     classes in the long-tail; not a recurring archetype shape.
//   - **Aftermath-style post-faint contact damage**: covered by pokerogue's
//     existing `PostFaintContactDamageAbAttr` and the `on-faint-effect`
//     archetype's `attacker-damage-flat` variant. They share dispatch
//     structure but live on different trigger surfaces (PostFaint vs
//     PostDefend).
//
// Examples (per taxonomy):
//   - `Rough Skin` / `Iron Barbs` — `new ContactDamageOnHitAbAttr({
//       maxHpFraction: 1/8 })`
//   - "Damages attacker for 1/4 max HP on contact" — `new ContactDamageOnHitAbAttr({
//       maxHpFraction: 1/4 })`
//   - "Damages attacker for 1/8 max HP on any hit" — `new ContactDamageOnHitAbAttr({
//       maxHpFraction: 1/8, contactRequired: false })`
// =============================================================================

import { PostDefendContactDamageAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { toDmgValue } from "#utils/common";

/** Construction payload for {@linkcode ContactDamageOnHitAbAttr}. */
export interface ContactDamageOnHitOptions {
  /**
   * The fraction of the attacker's max HP to deduct when the proc fires. Must
   * be in `(0, 1]`. Typical values:
   *   - `1/8` (= `0.125`) — Rough Skin / Iron Barbs vanilla.
   *   - `1/4` (= `0.25`)  — ER "Aftermath-flavored Iron Barbs" customs.
   */
  readonly maxHpFraction: number;
  /**
   * When true (default), the proc only fires when the incoming move makes
   * contact (matches vanilla Rough Skin / Iron Barbs). When false, every
   * damaging move that connects triggers the proc — used by ER abilities like
   * "Reactive Spikes" that damage any attacker regardless of contact.
   * @defaultValue `true`
   */
  readonly contactRequired?: boolean;
}

/**
 * Parameterized `AbAttr` implementing the `contact-damage-on-hit` archetype.
 *
 * Used (or will be used) by `Rough Skin` (vanilla), `Iron Barbs` (vanilla),
 * and ER customs that damage the attacker on a successful hit (with or
 * without the contact gate).
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostDefendContactDamageAbAttr}. The parent's
 * `apply` does the damage math we want — `attacker.damageAndUpdate(maxHp /
 * damageRatio, INDIRECT)` — so we keep that. We override `canApply` to allow
 * the optional non-contact mode and to additionally gate on `hitResult` (the
 * proc shouldn't fire on a NO_EFFECT / NO_HIT / FAIL result).
 *
 * The `BlockNonDirectDamageAbAttr` check is inherited from the parent —
 * Magic Guard etc. correctly absorbs the proc damage.
 */
export class ContactDamageOnHitAbAttr extends PostDefendContactDamageAbAttr {
  private readonly maxHpFraction: number;
  private readonly contactRequired: boolean;

  constructor(opts: ContactDamageOnHitOptions) {
    if (!(opts.maxHpFraction > 0 && opts.maxHpFraction <= 1)) {
      throw new Error(`[ContactDamageOnHitAbAttr] maxHpFraction must be in (0, 1]; got ${opts.maxHpFraction}`);
    }
    // Pokerogue's parent stores `damageRatio` and computes damage as
    // `maxHp * (1 / damageRatio)`. We pass `1 / maxHpFraction` so the parent's
    // arithmetic yields `maxHp * maxHpFraction` damage as our caller expects.
    super(1 / opts.maxHpFraction);
    this.maxHpFraction = opts.maxHpFraction;
    this.contactRequired = opts.contactRequired ?? true;
  }

  /** Read-only accessor for the configured max-HP damage fraction. */
  public getMaxHpFraction(): number {
    return this.maxHpFraction;
  }

  /** Whether the proc requires the incoming move to make contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  /**
   * Custom canApply: enforces the optional contact gate AND the parent's
   * Magic-Guard / damage-block checks. We reimplement rather than calling
   * `super.canApply` because the parent's check unconditionally requires
   * contact — flipping the contact requirement off means bypassing that
   * specific branch.
   *
   * Hit-result gating: PostDefend dispatches fire even when a move resolves
   * to NO_EFFECT (e.g. immunity). We additionally require `hitResult <
   * NO_EFFECT` so the proc doesn't fire on a fully-blocked attack.
   */
  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, move, opponent: attacker, pokemon, hitResult } = params;
    if (simulated) {
      // Vanilla `PostDefendContactDamageAbAttr.canApply` also bails on
      // simulated dispatches — we preserve that. (Side effects don't run
      // in simulated dispatches in any path.)
      return false;
    }
    if (hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    return !attacker.hasAbilityWithAttr("BlockNonDirectDamageAbAttr");
  }

  /**
   * Apply the proc damage. We re-implement rather than delegating to super
   * because the parent uses `toDmgValue(getMaxHp() * (1 / damageRatio))`,
   * which gives identical output to `toDmgValue(getMaxHp() * maxHpFraction)`
   * — but doing it directly makes the intent obvious in this class and
   * sidesteps any floating-point drift from the `1 / (1 / x)` round-trip.
   */
  public override apply(params: PostMoveInteractionAbAttrParams): void {
    const { simulated, opponent: attacker } = params;
    if (simulated) {
      return;
    }
    const damage = toDmgValue(attacker.getMaxHp() * this.maxHpFraction);
    attacker.damageAndUpdate(damage, { result: HitResult.INDIRECT });
    attacker.turnData.damageTaken += damage;
  }
}
