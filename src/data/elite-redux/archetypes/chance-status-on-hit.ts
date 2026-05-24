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
import type { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { StatusEffect } from "#enums/status-effect";

/**
 * Optional filter restricting which incoming moves can trigger the proc. The
 * primitive supports two filter kinds today, both matching ER classifier
 * payloads:
 *
 *   - `{ flag: MoveFlags }` — the incoming move must carry the given flag
 *     (e.g. `MoveFlags.BITING_MOVE` for `Cold Bite`-style `chance:50, status:
 *     FROSTBITE, filter:{flag:BITING_MOVE}`).
 *   - `{ type: PokemonType }` — the incoming move must be of the given type
 *     (e.g. `PokemonType.GRASS` for `Spore Defense`-style `chance:30,
 *     status:BURN, filter:{type:GRASS}`).
 *
 * Both filters compose with the `contactRequired` gate (AND'd together): a
 * move must satisfy both contact (if required) and the filter to roll the
 * proc.
 *
 * @remarks
 * The shape is intentionally narrow — these are the only two filter kinds the
 * classifier emits today. If more filter kinds appear (e.g. category), extend
 * the union here rather than introducing a separate primitive.
 */
export type ChanceStatusFilter = { readonly flag: MoveFlags } | { readonly type: PokemonType };

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
  /**
   * Optional gate on the incoming move (flag or type). When provided, the
   * proc only fires for moves that satisfy the filter (in addition to the
   * contact gate when `contactRequired` is true). Used by ER abilities like
   * `Cold Bite` (BITING_MOVE-gated FROSTBITE) or `Spore Defense` (GRASS-type
   * gated BURN).
   * @remarks
   * When `filter` is set, `contactRequired` typically defaults to `false`
   * to avoid a double-gate semantic mismatch — callers can still set it true
   * explicitly if they want both checks (e.g. BITING_MOVE that also makes
   * contact). Both gates are AND'd.
   */
  readonly filter?: ChanceStatusFilter;
  /**
   * When true, the proc fires ONLY on non-contact moves. Mutually exclusive
   * with `contactRequired`. Used by ER's vanilla-rebalance round 4/5 layers
   * that add a low-chance non-contact tier on top of vanilla's contact tier
   * (e.g. Flame Body's "30% contact + 20% non-contact"). Without this gate,
   * a `contactRequired: false` proc fires on BOTH contact and non-contact,
   * stacking with the vanilla contact proc and inflating the perceived
   * trigger rate.
   * @defaultValue `false`
   */
  readonly contactExcluded?: boolean;
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
  private readonly contactExcluded: boolean;
  private readonly filter: ChanceStatusFilter | undefined;

  constructor(opts: ChanceStatusOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceStatusOnHitAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    if (opts.effects.length === 0) {
      throw new Error("[ChanceStatusOnHitAbAttr] must configure at least one status effect");
    }
    if (opts.contactRequired === true && opts.contactExcluded === true) {
      throw new Error("[ChanceStatusOnHitAbAttr] contactRequired and contactExcluded are mutually exclusive");
    }
    super();
    this.chance = opts.chance;
    this.effects = opts.effects;
    // contactRequired defaults:
    //  - TRUE when no filter and not contactExcluded (vanilla shape)
    //  - FALSE when a filter is set (filter is the gate)
    //  - FALSE when contactExcluded is set (mutually exclusive at intent
    //    level — contactExcluded implies "this proc cares about hits but
    //    only the NON-contact ones", so contactRequired must default off
    //    or the proc would never fire).
    this.contactExcluded = opts.contactExcluded ?? false;
    this.contactRequired = opts.contactRequired ?? (opts.filter === undefined && !this.contactExcluded);
    this.filter = opts.filter;
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

  /** The configured move filter, or `undefined` when no filter is set. */
  public getFilter(): ChanceStatusFilter | undefined {
    return this.filter;
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
    const isContact = move.doesFlagEffectApply({
      flag: MoveFlags.MAKES_CONTACT,
      user: attacker,
      target: pokemon,
    });
    // Contact-excluded gate — proc fires ONLY on non-contact attacks.
    if (this.contactExcluded && isContact) {
      return false;
    }
    // Contact-required gate, when configured.
    if (this.contactRequired && !isContact) {
      return false;
    }
    // Filter gate (move-flag or type).
    if (this.filter !== undefined && !checkChanceStatusFilter(this.filter, move)) {
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

/** Construction payload for {@linkcode ChanceBattlerTagOnHitAbAttr}. */
export interface ChanceBattlerTagOnHitOptions {
  /**
   * Roll chance for the proc, as an integer in the range `[0, 100]`. The proc
   * fires when `pokemon.randBattleSeedInt(100) < chance` — i.e. 100 always
   * fires, 0 never fires.
   */
  readonly chance: number;
  /**
   * One or more battler tags to inflict on the attacker. When multiple are
   * provided, a uniform-random one is picked per proc. Most ER abilities in
   * this cluster wire a single tag, but the multi-tag shape matches the
   * sibling {@linkcode ChanceStatusOnHitAbAttr} symmetrically.
   */
  readonly tags: readonly BattlerTagType[];
  /**
   * When true (default), the proc only fires when the incoming move makes
   * contact. When false, any damaging move triggers a roll. ER abilities like
   * `Loud Bang` (sound-based, 50% chance to confuse) wire this `false`.
   * @defaultValue `true`
   */
  readonly contactRequired?: boolean;
  /**
   * Number of turns the tag persists. Most battler tags use the engine's
   * default duration (e.g. CONFUSED rolls 2-5 turns internally) — pass
   * `undefined` to defer to that default. Otherwise overrides the count.
   * @defaultValue `undefined` (engine default)
   */
  readonly turns?: number;
  /**
   * Optional gate on the incoming move (flag or type). See
   * {@linkcode ChanceStatusOnHitOptions.filter} for details — the semantics
   * are identical, just inflicting a battler tag instead of a status effect.
   */
  readonly filter?: ChanceStatusFilter;
}

/**
 * Parameterized `AbAttr` implementing the battler-tag flavor of the
 * `chance-status-on-hit` archetype.
 *
 * Used by ER abilities such as `Loud Bang` ("Sound-based moves have 50% chance
 * to confuse"), `Haunting Frenzy` ("20% chance to flinch"), `Radio Jam` (sound
 * → 20% disable), and any other ability whose proc semantics match
 * {@linkcode ChanceStatusOnHitAbAttr} but inflicts a tag (CONFUSED, FLINCHED,
 * INFATUATED, DISABLED, TAUNT, …) rather than a `StatusEffect`.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. The shape mirrors pokerogue's
 * existing `PostDefendContactApplyTagChanceAbAttr` (which hardcodes contact
 * required); we make the contact gate optional and accept multiple tags.
 *
 * The proc fires by calling `attacker.addTag(tag, turns, undefined,
 * pokemon.id)` — the same call pokerogue uses for the vanilla `*ApplyTag`
 * abilities. We pass `undefined` for `sourceMove` because none of our
 * incoming attacks should attribute the tag back to a specific move id; the
 * source pokemon is the defender (the ability holder).
 */
export class ChanceBattlerTagOnHitAbAttr extends PostDefendAbAttr {
  private readonly chance: number;
  private readonly tags: readonly BattlerTagType[];
  private readonly contactRequired: boolean;
  private readonly turns: number | undefined;
  private readonly filter: ChanceStatusFilter | undefined;

  constructor(opts: ChanceBattlerTagOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceBattlerTagOnHitAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    if (opts.tags.length === 0) {
      throw new Error("[ChanceBattlerTagOnHitAbAttr] must configure at least one battler tag");
    }
    super();
    this.chance = opts.chance;
    this.tags = opts.tags;
    this.contactRequired = opts.contactRequired ?? opts.filter === undefined;
    this.turns = opts.turns;
    this.filter = opts.filter;
  }

  /** The configured move filter, or `undefined` when no filter is set. */
  public getFilter(): ChanceStatusFilter | undefined {
    return this.filter;
  }

  /** The configured proc chance (0-100). */
  public getChance(): number {
    return this.chance;
  }

  /** The configured battler-tag list (read-only). */
  public getTags(): readonly BattlerTagType[] {
    return this.tags;
  }

  /** Whether the proc requires the incoming move to make contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  /** The configured turn override, or `undefined` to use the engine default. */
  public getTurns(): number | undefined {
    return this.turns;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent: attacker } = params;
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    if (this.filter !== undefined && !checkChanceStatusFilter(this.filter, move)) {
      return false;
    }
    if (this.chance !== 100 && pokemon.randBattleSeedInt(100) >= this.chance) {
      return false;
    }
    const tag = this.pickTag(pokemon);
    return attacker.canAddTag(tag);
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent: attacker } = params;
    const tag = this.pickTag(pokemon);
    attacker.addTag(tag, this.turns, undefined, pokemon.id);
  }

  /**
   * Uniform-random pick from {@linkcode tags} using `pokemon.randBattleSeedInt`
   * so test seeding works. Returns the singleton when only one is configured.
   *
   * @remarks
   * Mirrors the picking trick in {@linkcode ChanceStatusOnHitAbAttr.pickEffect}.
   * The same seed advances deterministically between `canApply` and `apply`,
   * so both calls pick the same index.
   */
  private pickTag(pokemon: Parameters<PostDefendAbAttr["apply"]>[0]["pokemon"]): BattlerTagType {
    if (this.tags.length === 1) {
      return this.tags[0];
    }
    return this.tags[pokemon.randBattleSeedInt(this.tags.length)];
  }
}

/**
 * Check whether the incoming `move` satisfies the given filter. Shared by
 * both {@linkcode ChanceStatusOnHitAbAttr} and
 * {@linkcode ChanceBattlerTagOnHitAbAttr}.
 *
 * The `Move` instance is structurally typed via the AbAttr params; we only
 * need `hasFlag` and `type` from it. Imports remain narrow.
 */
function checkChanceStatusFilter(
  filter: ChanceStatusFilter,
  move: { hasFlag(flag: MoveFlags): boolean; readonly type: PokemonType },
): boolean {
  if ("flag" in filter) {
    return move.hasFlag(filter.flag);
  }
  return move.type === filter.type;
}
