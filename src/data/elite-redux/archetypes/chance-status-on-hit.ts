/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `chance-status-on-hit` archetype primitive.
//
// Implements taxonomy entry #6 (~28+ entries on the ability side; the move
// side is data-only and reuses pokerogue's existing `StatusEffectAttr`).
//
// Base class: `PostDefendAbAttr` — extends pokerogue's existing
// `PostDefendContactApplyStatusEffectAbAttr` pattern (which is how Static,
// Flame Body, Poison Point, Effect Spore, etc. are implemented). Our version
// generalizes it for ER's wider sub-shape variety:
//
//   - `chance` is a single roll number 0-100 (matches pokerogue convention).
//   - `effects` is a list of {@linkcode StatusEffect}s; if multiple are given,
//     a random one is picked when the proc fires (this matches the existing
//     `PostDefendContactApplyStatusEffectAbAttr` multi-effect model — Effect
//     Spore is the canonical example with POISON / PARALYSIS / SLEEP).
//   - `contactRequired` defaults to `true` (matches Static-style abilities);
//     set to `false` for "any incoming attack" abilities. Optional asymmetric
//     ER abilities like `Freezing Point` ("20% on contact, 30% non-contact")
//     would compose two instances — one with `contactRequired: true` at 20%
//     and another with `contactRequired: false` at 30% — but that composition
//     is the caller's responsibility, not this primitive's.
//
// Differences from vanilla pokerogue:
//   - Vanilla `PostDefendContactApplyStatusEffectAbAttr` hardcodes
//     `MoveFlags.MAKES_CONTACT` as required. We make that optional via
//     `contactRequired`, letting ER abilities like Daybreak ("Burns the foe
//     on contact. Also works on offense.") wire a non-contact variant.
//
// Sub-shapes intentionally NOT in this primitive (deferred to later C tasks
// or composed via {@linkcode CompositeAbAttr}):
//   - **On offense** (subject attacks foe → foe takes status): use
//     `PostAttackApplyStatusEffectAbAttr` directly. The taxonomy entry calls
//     out `Solenoglyphs` and `Daybreak (offense side)` — those compose with
//     the post-attack flavor.
//   - **Flag-gated procs** (e.g. `Solenoglyphs` requires a biting move). For
//     defensive procs that's straightforward (`flag` filter on the move that
//     hit you); for offensive procs the existing
//     `PostAttackApplyStatusEffectAbAttr` doesn't carry that filter, so we
//     skip it in C1b.
//
// Examples (per taxonomy):
//   - `Static`-style — `new ChanceStatusOnHitAbAttr({
//       chance: 30, effects: [StatusEffect.PARALYSIS] })`
//   - `Effect Spore`-style — `new ChanceStatusOnHitAbAttr({
//       chance: 30, effects: [POISON, PARALYSIS, SLEEP] })`
//   - `Daybreak` on-defense flavor — `new ChanceStatusOnHitAbAttr({
//       chance: 100, effects: [StatusEffect.BURN], contactRequired: true })`
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { StatusEffect } from "#enums/status-effect";

/** Construction payload for {@linkcode ChanceStatusOnHitAbAttr}. */
export interface ChanceStatusOnHitOptions {
  /**
   * Roll chance for the proc, as an integer in the range `[0, 100]`. The proc
   * fires when `pokemon.randBattleSeedInt(100) < chance` — i.e. 100 always
   * fires, 0 never fires.
   */
  readonly chance: number;
  /**
   * One or more status effects to inflict on the attacker. When multiple are
   * provided, a uniform-random one is picked per proc (matches Effect Spore).
   */
  readonly effects: readonly StatusEffect[];
  /**
   * When true (default), the proc only fires when the incoming move makes
   * contact. When false, any damaging move triggers a roll — used by ER
   * abilities that proc on non-contact attacks too.
   * @defaultValue `true`
   */
  readonly contactRequired?: boolean;
}

/**
 * Parameterized `AbAttr` implementing the `chance-status-on-hit` archetype.
 *
 * Used (or will be used) by ER abilities such as `Static` (vanilla),
 * `Flame Body` (vanilla), `Poison Point` (vanilla), `Effect Spore` (vanilla
 * with custom canApply), `Crispy Cream` ("30% to burn/frostbite on contact"),
 * `Daybreak` (defense flavor), and the wider ER reactive-status family.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. We do NOT extend pokerogue's
 * `PostDefendContactApplyStatusEffectAbAttr` directly because that class
 * hardcodes the contact-required check; we want it configurable. The
 * canApply contract mirrors what `PostDefendContactApplyStatusEffectAbAttr`
 * does — random roll + status-can-be-applied check on the attacker — minus
 * the always-on contact requirement.
 *
 * The proc fires by calling `attacker.trySetStatus(effect, pokemon)` — the
 * same call pokerogue uses for Static and friends.
 */
export class ChanceStatusOnHitAbAttr extends PostDefendAbAttr {
  private readonly chance: number;
  private readonly effects: readonly StatusEffect[];
  private readonly contactRequired: boolean;

  constructor(opts: ChanceStatusOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceStatusOnHitAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    if (opts.effects.length === 0) {
      throw new Error("[ChanceStatusOnHitAbAttr] must configure at least one status effect");
    }
    super();
    this.chance = opts.chance;
    this.effects = opts.effects;
    this.contactRequired = opts.contactRequired ?? true;
  }

  /** The configured proc chance (0-100). */
  public getChance(): number {
    return this.chance;
  }

  /** The configured status-effect list (read-only). */
  public getEffects(): readonly StatusEffect[] {
    return this.effects;
  }

  /** Whether the proc requires the incoming move to make contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  /**
   * Roll the proc and decide whether it should fire. We mirror pokerogue's
   * existing {@linkcode PostDefendContactApplyStatusEffectAbAttr.canApply}
   * down to the order-of-operations: contact check, status-already check on
   * the attacker, random roll, can-set-status check.
   *
   * Note that pokerogue's canApply runs the random roll *inside* canApply
   * because the AbAttr's apply phase doesn't get any per-pokemon randomness
   * state — running the roll in canApply is the convention. We follow it
   * here exactly.
   */
  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent: attacker } = params;
    // Contact-required gate, when configured.
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    // Attacker must be alive and unstatused (existing status blocks new one).
    if (attacker.status) {
      return false;
    }
    // Roll the proc — 100% always passes, 0% never does.
    if (this.chance !== 100 && pokemon.randBattleSeedInt(100) >= this.chance) {
      return false;
    }
    // Pick a status (uniform random if multiple configured) and verify the
    // attacker can actually receive it. The same effect index is recomputed
    // in apply via the same RNG seed (pokerogue convention — apply gets the
    // matching index because the seed advances deterministically per dispatch).
    const effect = this.pickEffect(pokemon);
    return attacker.canSetStatus(effect, true, false, pokemon);
  }

  /**
   * Apply the proc: try to set the status on the attacker. We re-pick the
   * effect here because pokerogue's dispatcher calls canApply and apply
   * separately (so the RNG advances between them); the picked effect index
   * is reproducible because we use the same `randBattleSeedInt(length)` form
   * pokerogue's existing class uses.
   */
  public override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, opponent: attacker } = params;
    if (params.simulated) {
      return;
    }
    const effect = this.pickEffect(pokemon);
    attacker.trySetStatus(effect, pokemon);
  }

  /**
   * Uniform-random pick from {@linkcode effects} using `pokemon.randBattleSeedInt`
   * so that test seeding works. Returns the singleton when only one is
   * configured (no RNG needed).
   *
   * @remarks
   * Pokerogue's existing class does the same picking trick — see
   * `PostDefendContactApplyStatusEffectAbAttr.canApply` line ~981 — but it
   * picks once in canApply, throws away the result, then re-picks in apply.
   * We mirror that order-of-operations exactly so the determinism story is
   * the same as Effect Spore et al.
   */
  private pickEffect(pokemon: Parameters<PostDefendAbAttr["apply"]>[0]["pokemon"]): StatusEffect {
    if (this.effects.length === 1) {
      return this.effects[0];
    }
    return this.effects[pokemon.randBattleSeedInt(this.effects.length)];
  }
}
