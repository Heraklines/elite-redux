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

import { PostAttackAbAttr, PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import type { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#types/move-types";

/**
 * The set of {@linkcode HitResult}s that represent an actual *damaging attack*
 * landing on the target. A `contactExcluded` (non-contact-tier) proc — e.g.
 * Flame Body's "20% burn on non-contact" or Static's "10% paralyze on
 * non-contact" — must only fire on these. The ER ROM descriptions read "...on
 * non-contact **attacks**" / "Non-contact has a 20% chance" — i.e. damaging
 * moves. A non-contact STATUS move (Growl, Leer, Sand Attack, …) reports
 * {@linkcode HitResult.STATUS} (zero damage) and must NOT proc the non-contact
 * tier; otherwise an opponent opening with a status move appears to burn the
 * holder "before any attack was made" (user-reported as Flame Body burning at
 * the start of battle / on switch-in).
 */
const DAMAGING_HIT_RESULTS: ReadonlySet<HitResult> = new Set([
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
]);

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
export type ChanceStatusFilter =
  | { readonly flag: MoveFlags }
  | { readonly type: PokemonType }
  | { readonly moveId: MoveId }
  | { readonly category: MoveCategory };

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
  /**
   * OFFENSIVE-ONLY (read by {@linkcode ChanceStatusOnAttackAbAttr}; ignored by
   * the defensive {@linkcode ChanceStatusOnHitAbAttr}). Additional
   * {@linkcode BattlerTagType} outcomes pooled together with {@linkcode effects}
   * under the SINGLE `chance` roll: when the proc fires, one outcome is picked
   * uniformly from `[...effects, ...tags]` and applied (status via `trySetStatus`,
   * tag via `addTag`). Used by Assassin's Tools ("Contact moves have a 30% chance
   * to poison, paralyze, OR bleed" — one 30% roll picking one of three, NOT three
   * independent rolls). Leave `effects` non-empty or provide at least one tag.
   */
  readonly tags?: readonly BattlerTagType[];
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
  // Unified outcome pool ([...statuses, ...tags]) picked from under the single
  // chance roll (mirrors the offensive ChanceStatusOnAttackAbAttr). `status`
  // outcomes inflict a StatusEffect on the attacker; `tag` outcomes an ER
  // battler tag (e.g. Crispy Cream "30% burn OR frostbite when hit by contact").
  private readonly outcomes: readonly (
    | { kind: "status"; value: StatusEffect }
    | { kind: "tag"; value: BattlerTagType }
  )[];
  private readonly hasTagOutcomes: boolean;
  private readonly contactRequired: boolean;
  private readonly contactExcluded: boolean;
  private readonly filter: ChanceStatusFilter | undefined;
  // Status procs don't use a first-turn override; declared (always undefined)
  // so the shared chance-roll expression type-checks.
  private readonly firstTurnChance: number | undefined = undefined;

  constructor(opts: ChanceStatusOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceStatusOnHitAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    const tags = opts.tags ?? [];
    if (opts.effects.length + tags.length === 0) {
      throw new Error("[ChanceStatusOnHitAbAttr] must configure at least one status effect or tag");
    }
    if (opts.contactRequired === true && opts.contactExcluded === true) {
      throw new Error("[ChanceStatusOnHitAbAttr] contactRequired and contactExcluded are mutually exclusive");
    }
    super();
    this.chance = opts.chance;
    this.effects = opts.effects;
    this.outcomes = [
      ...opts.effects.map(value => ({ kind: "status" as const, value })),
      ...tags.map(value => ({ kind: "tag" as const, value })),
    ];
    this.hasTagOutcomes = tags.length > 0;
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
    // User-aware contact: factors in the attacker's contact-suppressing
    // abilities (Long Reach / Twinkle Toes → IgnoreContactAbAttr) and
    // substitute hits. Used by the contact-REQUIRED gate so a Long Reach
    // attacker correctly does NOT trigger a contact-required proc.
    const makesContact = move.doesFlagEffectApply({
      flag: MoveFlags.MAKES_CONTACT,
      user: attacker,
      target: pokemon,
    });
    // Inherent contact: the move's own MAKES_CONTACT flag, IGNORING the
    // attacker's contact-suppression. Used by the contact-EXCLUDED gate so a
    // physical contact move (e.g. Tackle) whose contact was suppressed by the
    // attacker's Long Reach is NOT reclassified as "non-contact" and punished
    // by a non-contact proc (e.g. Flame Body's 20% non-contact burn). Long
    // Reach's purpose is to dodge the target's contact-reactive effects — it
    // must not push the attacker into the non-contact-reactive branch instead.
    // (See #254 — "non-contact moves trigger contact abilities" — same class of
    // contact-classification bug.) An inherently ranged move (Ember) has the
    // flag unset, so the non-contact tier still fires on it as intended.
    const inherentlyMakesContact = move.hasFlag(MoveFlags.MAKES_CONTACT);
    // Contact-excluded gate — proc fires ONLY on inherently non-contact attacks.
    if (this.contactExcluded) {
      if (inherentlyMakesContact) {
        return false;
      }
      // The non-contact tier is a "non-contact ATTACK" tier (per ER ROM text).
      // It must NOT fire on STATUS-category moves (Growl/Leer/etc., which report
      // HitResult.STATUS) or on no-damage interactions (NO_EFFECT/IMMUNE/etc.).
      // Without this gate, a foe opening with a non-contact status move procs the
      // burn/paralysis, which players saw as Flame Body burning them "before any
      // move was made." Only genuine damaging attacks qualify.
      if (!DAMAGING_HIT_RESULTS.has(params.hitResult)) {
        return false;
      }
    }
    // Contact-required gate, when configured.
    if (this.contactRequired && !makesContact) {
      return false;
    }
    // Filter gate (move-flag or type).
    if (this.filter !== undefined && !checkChanceStatusFilter(this.filter, move)) {
      return false;
    }
    // Attacker must be unstatused for a STATUS-only pool (existing status blocks
    // a new one). When the pool also carries tag outcomes (Crispy Cream), don't
    // short-circuit here — a tag (frostbite) can still land on an already-statused
    // attacker; the per-outcome applicability check below handles it.
    if (!this.hasTagOutcomes && attacker.status) {
      return false;
    }
    // Roll the proc — 100% always passes, 0% never does.
    {
      const effChance =
        this.firstTurnChance !== undefined && pokemon.tempSummonData?.waveTurnCount === 1
          ? this.firstTurnChance
          : this.chance;
      if (effChance !== 100 && pokemon.randBattleSeedInt(100) >= effChance) {
        return false;
      }
    }
    // Pick an outcome (uniform random across the status+tag pool) and verify the
    // attacker can actually receive it. The same index is recomputed in apply via
    // the same RNG seed (pokerogue convention — apply gets the matching index
    // because the seed advances deterministically per dispatch).
    const outcome = this.pickOutcome(pokemon);
    if (outcome.kind === "status") {
      return attacker.canSetStatus(outcome.value, true, false, pokemon);
    }
    return !attacker.getTag(outcome.value);
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
    const outcome = this.pickOutcome(pokemon);
    if (outcome.kind === "status") {
      attacker.trySetStatus(outcome.value, pokemon);
    } else {
      attacker.addTag(outcome.value, 0, undefined, pokemon.id);
    }
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
  private pickOutcome(
    pokemon: Parameters<PostDefendAbAttr["apply"]>[0]["pokemon"],
  ): { kind: "status"; value: StatusEffect } | { kind: "tag"; value: BattlerTagType } {
    if (this.outcomes.length === 1) {
      return this.outcomes[0];
    }
    return this.outcomes[pokemon.randBattleSeedInt(this.outcomes.length)];
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
  readonly contactExcluded?: boolean;
  /**
   * Number of turns the tag persists. Most battler tags use the engine's
   * default duration (e.g. CONFUSED rolls 2-5 turns internally) — pass
   * `undefined` to defer to that default. Otherwise overrides the count.
   * @defaultValue `undefined` (engine default)
   */
  readonly turns?: number;
  readonly turnRange?: readonly [number, number];
  readonly damageDenominator?: number;
  /**
   * Optional gate on the incoming move (flag or type). See
   * {@linkcode ChanceStatusOnHitOptions.filter} for details — the semantics
   * are identical, just inflicting a battler tag instead of a status effect.
   */
  readonly filter?: ChanceStatusFilter;
  /**
   * Optional gate on the TARGET's state: the proc only fires when the target
   * already carries this battler tag. Used by Cryostasis (981) — "Frostbite
   * causes flinching": the holder's hits flinch targets that are frostbitten.
   */
  readonly targetHasTag?: BattlerTagType;
  /**
   * Optional gate on the TARGET's status condition: the proc only fires when
   * the target currently has this status. Used by status-cascade abilities like
   * Set Ablaze (740) — "inflicting burn also inflicts fear".
   */
  readonly targetHasStatus?: StatusEffect;
  /**
   * When true, the proc only fires when the holder's attack landed a CRITICAL
   * hit on the target this interaction (offensive `OnAttack` variant only).
   * Implies contact is NOT required, since crits can be non-contact. Used by
   * the crit-bleed abilities Razor Sharp (730) and To The Bone (731).
   * @defaultValue `false`
   */
  readonly critRequired?: boolean;
  /**
   * Overrides `chance` on the holder's first turn after entering (or gaining
   * the ability), i.e. while `tempSummonData.waveTurnCount === 1`. Used by
   * Talon Trap (973): "50% to trap on contact, 100% if entered this turn."
   */
  readonly firstTurnChance?: number;
  /**
   * Optional gate on the holder's OWN move id(s): the proc only fires when the
   * holder used one of these specific moves. Unlike {@linkcode filter} and
   * {@linkcode contactRequired}, setting `moveIds` permits STATUS moves to
   * trigger the proc (the default PostAttack gate excludes them), since these
   * are by-name riders on a known move. Used by Hypnotic Trance (953):
   * "Hypnosis never misses and also causes Confusion" — the confusion is a
   * 100% rider tied to the status move Hypnosis itself. OnAttack variant only.
   */
  readonly moveIds?: readonly MoveId[];
  /** Optional per-interaction chance override for offensive tag procs. */
  readonly chanceResolver?: (holder: Pokemon, target: Pokemon, move: Move) => number;
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
  private readonly contactExcluded: boolean;
  private readonly turns: number | undefined;
  private readonly turnRange: readonly [number, number] | undefined;
  private readonly damageDenominator: number | undefined;
  private readonly filter: ChanceStatusFilter | undefined;
  private readonly firstTurnChance: number | undefined;

  constructor(opts: ChanceBattlerTagOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceBattlerTagOnHitAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    if (opts.tags.length === 0) {
      throw new Error("[ChanceBattlerTagOnHitAbAttr] must configure at least one battler tag");
    }
    if (opts.contactRequired === true && opts.contactExcluded === true) {
      throw new Error("[ChanceBattlerTagOnHitAbAttr] contactRequired and contactExcluded are mutually exclusive");
    }
    if (opts.turns !== undefined && opts.turnRange !== undefined) {
      throw new Error("[ChanceBattlerTagOnHitAbAttr] turns and turnRange are mutually exclusive");
    }
    super();
    this.chance = opts.chance;
    this.tags = opts.tags;
    this.contactExcluded = opts.contactExcluded ?? false;
    this.contactRequired = opts.contactRequired ?? (opts.filter === undefined && !this.contactExcluded);
    this.turns = opts.turns;
    this.turnRange = opts.turnRange;
    this.damageDenominator = opts.damageDenominator;
    this.filter = opts.filter;
    this.firstTurnChance = opts.firstTurnChance;
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

  public excludesContact(): boolean {
    return this.contactExcluded;
  }

  /** The configured turn override, or `undefined` to use the engine default. */
  public getTurns(): number | undefined {
    return this.turns;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent: attacker } = params;
    if (
      this.contactExcluded
      && (move.hasFlag(MoveFlags.MAKES_CONTACT) || !DAMAGING_HIT_RESULTS.has(params.hitResult))
    ) {
      return false;
    }
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    if (this.filter !== undefined && !checkChanceStatusFilter(this.filter, move)) {
      return false;
    }
    {
      const effChance =
        this.firstTurnChance !== undefined && pokemon.tempSummonData?.waveTurnCount === 1
          ? this.firstTurnChance
          : this.chance;
      if (effChance !== 100 && pokemon.randBattleSeedInt(100) >= effChance) {
        return false;
      }
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
    attacker.addTag(tag, resolveTagTurns(tag, this.turns, this.turnRange, pokemon), undefined, pokemon.id);
    if (this.damageDenominator !== undefined) {
      const appliedTag = attacker.getTag(tag);
      if (appliedTag) {
        (appliedTag as { damageDenominatorOverride?: number }).damageDenominatorOverride = this.damageDenominator;
      }
    }
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

// =============================================================================
// OFFENSIVE flavors (PostAttack) — the holder's own move inflicts the status /
// tag on the TARGET. Many ER chance-status abilities are offensive, not
// defensive: their descriptions read "X moves have N% chance to STATUS the
// foe/target" (e.g. Shocking Jaws "Biting moves have 50% chance to paralyze the
// target", Loud Bang "Sound-based moves have 50% chance to confuse the foe").
// In the v2.65.3b C-source these live in the post-attack ability block
// (`battle_util.c` ~9316/9536, alongside Poison Touch) where `battler ==
// gBattlerAttacker` and the effect lands on `gBattlerTarget`.
//
// The defensive {@linkcode ChanceStatusOnHitAbAttr} above procs the WRONG
// direction for these (it fires when the holder is hit). These PostAttack
// variants mirror pokerogue's `PostAttackApplyStatusEffectAbAttr` /
// `PostAttackApplyBattlerTagAbAttr` (Poison Touch is the canonical example) but
// add the flag/type filter the vanilla classes lack, so biting/sound/type-gated
// ER abilities stay faithful.
//
// `contactRequired`/`contactExcluded`/`filter` semantics match the defensive
// flavors exactly (AND'd gates). For offensive abilities `pokemon` is the
// attacker (holder) and `opponent` is the target receiving the status/tag.
// =============================================================================

/**
 * Offensive (PostAttack) counterpart of {@linkcode ChanceStatusOnHitAbAttr}.
 * The holder's damaging move has a chance to inflict a {@linkcode StatusEffect}
 * on the move's target. Used by ER abilities like `Shocking Jaws`
 * (BITING_MOVE-gated PARALYSIS), `Flaming Jaws` (BITING_MOVE-gated BURN),
 * `Envenom` (POISON on any move), `Virus` (ELECTRIC-type-gated POISON), etc.
 */
export class ChanceStatusOnAttackAbAttr extends PostAttackAbAttr {
  private readonly chance: number;
  private readonly effects: readonly StatusEffect[];
  // The unified outcome pool ([...statuses, ...tags]) picked from under the
  // single chance roll. `status` outcomes carry a StatusEffect; `tag` outcomes
  // carry a BattlerTagType. Kept as a flat, index-stable array so `canApply`
  // and `apply` pick the SAME entry from the deterministically-advancing seed.
  private readonly outcomes: readonly (
    | { kind: "status"; value: StatusEffect }
    | { kind: "tag"; value: BattlerTagType }
  )[];
  private readonly contactRequired: boolean;
  private readonly contactExcluded: boolean;
  private readonly filter: ChanceStatusFilter | undefined;
  // Status procs don't use a first-turn override; declared (always undefined)
  // so the shared chance-roll expression type-checks.
  private readonly firstTurnChance: number | undefined = undefined;

  constructor(opts: ChanceStatusOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceStatusOnAttackAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    const tags = opts.tags ?? [];
    if (opts.effects.length + tags.length === 0) {
      throw new Error("[ChanceStatusOnAttackAbAttr] must configure at least one status effect or tag");
    }
    if (opts.contactRequired === true && opts.contactExcluded === true) {
      throw new Error("[ChanceStatusOnAttackAbAttr] contactRequired and contactExcluded are mutually exclusive");
    }
    super();
    this.chance = opts.chance;
    this.effects = opts.effects;
    this.outcomes = [
      ...opts.effects.map(value => ({ kind: "status" as const, value })),
      ...tags.map(value => ({ kind: "tag" as const, value })),
    ];
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

  /** The configured move filter, or `undefined` when no filter is set. */
  public getFilter(): ChanceStatusFilter | undefined {
    return this.filter;
  }

  /** Whether the proc requires the holder's move to make contact (read-only). */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, pokemon, move, opponent: target } = params;
    if (!super.canApply(params)) {
      return false;
    }
    if (simulated) {
      return true;
    }
    if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") || pokemon === target) {
      return false;
    }
    const makesContact = move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target });
    // Inherent contact flag (ignores the holder's contact-suppression). The
    // non-contact tier (`contactExcluded`) must key off whether the move is
    // INHERENTLY ranged, not whether the holder's Long Reach made an otherwise-
    // contact move "non-contact" — mirrors the defensive `ChanceStatusOnHitAbAttr`
    // fix so the two contact-excluded gates classify contact identically.
    const inherentlyMakesContact = move.hasFlag(MoveFlags.MAKES_CONTACT);
    if (this.contactExcluded && inherentlyMakesContact) {
      return false;
    }
    if (this.contactRequired && !makesContact) {
      return false;
    }
    if (this.filter !== undefined && !checkChanceStatusFilter(this.filter, move)) {
      return false;
    }
    {
      const effChance =
        this.firstTurnChance !== undefined && pokemon.tempSummonData?.waveTurnCount === 1
          ? this.firstTurnChance
          : this.chance;
      if (effChance !== 100 && pokemon.randBattleSeedInt(100) >= effChance) {
        return false;
      }
    }
    const outcome = this.pickOutcome(pokemon);
    if (outcome.kind === "status") {
      return target.canSetStatus(outcome.value, true, false, pokemon);
    }
    // A tag outcome that the target already carries can't re-apply (addTag
    // no-ops on overlap), so skip it rather than "wasting" the proc silently.
    return !target.getTag(outcome.value);
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent: target } = params;
    const outcome = this.pickOutcome(pokemon);
    if (outcome.kind === "status") {
      target.trySetStatus(outcome.value, pokemon);
    } else {
      target.addTag(outcome.value, 0, undefined, pokemon.id);
    }
  }

  private pickOutcome(
    pokemon: Parameters<PostAttackAbAttr["apply"]>[0]["pokemon"],
  ): { kind: "status"; value: StatusEffect } | { kind: "tag"; value: BattlerTagType } {
    if (this.outcomes.length === 1) {
      return this.outcomes[0];
    }
    return this.outcomes[pokemon.randBattleSeedInt(this.outcomes.length)];
  }
}

/**
 * Offensive (PostAttack) counterpart of {@linkcode ChanceBattlerTagOnHitAbAttr}.
 * The holder's damaging move has a chance to inflict a {@linkcode BattlerTagType}
 * on the move's target. Used by ER abilities like `Loud Bang`
 * (SOUND_BASED-gated CONFUSED), `Beautiful Music` (SOUND_BASED-gated INFATUATED),
 * `Radio Jam` (SOUND_BASED-gated DISABLED), `Haunting Frenzy` (FLINCHED), etc.
 */
export class ChanceBattlerTagOnAttackAbAttr extends PostAttackAbAttr {
  private readonly chance: number;
  private readonly tags: readonly BattlerTagType[];
  private readonly contactRequired: boolean;
  private readonly contactExcluded: boolean;
  private readonly turns: number | undefined;
  private readonly turnRange: readonly [number, number] | undefined;
  private readonly damageDenominator: number | undefined;
  private readonly filter: ChanceStatusFilter | undefined;
  private readonly targetHasTag: BattlerTagType | undefined;
  private readonly targetHasStatus: StatusEffect | undefined;
  private readonly critRequired: boolean;
  private readonly firstTurnChance: number | undefined;
  private readonly moveIds: readonly MoveId[] | undefined;
  private readonly chanceResolver: ((holder: Pokemon, target: Pokemon, move: Move) => number) | undefined;

  constructor(opts: ChanceBattlerTagOnHitOptions) {
    if (!(opts.chance >= 0 && opts.chance <= 100)) {
      throw new Error(`[ChanceBattlerTagOnAttackAbAttr] chance must be in [0, 100]; got ${opts.chance}`);
    }
    if (opts.tags.length === 0) {
      throw new Error("[ChanceBattlerTagOnAttackAbAttr] must configure at least one battler tag");
    }
    if (opts.contactRequired === true && opts.contactExcluded === true) {
      throw new Error("[ChanceBattlerTagOnAttackAbAttr] contactRequired and contactExcluded are mutually exclusive");
    }
    if (opts.turns !== undefined && opts.turnRange !== undefined) {
      throw new Error("[ChanceBattlerTagOnAttackAbAttr] turns and turnRange are mutually exclusive");
    }
    // When gated to specific move ids, override the default PostAttack
    // attackCondition (which excludes status moves) so by-name riders on a
    // status move (e.g. Hypnosis) can trigger.
    super(opts.moveIds === undefined ? undefined : (_u, _t, move) => opts.moveIds!.includes(move.id), false);
    this.chance = opts.chance;
    this.tags = opts.tags;
    this.critRequired = opts.critRequired ?? false;
    this.firstTurnChance = opts.firstTurnChance;
    this.moveIds = opts.moveIds;
    this.chanceResolver = opts.chanceResolver;
    this.contactExcluded = opts.contactExcluded ?? false;
    // A target-state gate (targetHasTag), crit gate, or move-id gate replaces
    // contact as the trigger when set.
    this.contactRequired =
      opts.contactRequired
      ?? (opts.filter === undefined
        && opts.targetHasTag === undefined
        && opts.targetHasStatus === undefined
        && opts.moveIds === undefined
        && !this.critRequired
        && !this.contactExcluded);
    this.turns = opts.turns;
    this.turnRange = opts.turnRange;
    this.damageDenominator = opts.damageDenominator;
    this.filter = opts.filter;
    this.targetHasTag = opts.targetHasTag;
    this.targetHasStatus = opts.targetHasStatus;
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

  public requiresContact(): boolean {
    return this.contactRequired;
  }

  public excludesContact(): boolean {
    return this.contactExcluded;
  }

  /** The configured fixed turn count, or `undefined` when a range/default is used. */
  public getTurns(): number | undefined {
    return this.turns;
  }

  /** The configured trap turn range `[min, max]`, or `undefined` when unset. */
  public getTurnRange(): readonly [number, number] | undefined {
    return this.turnRange;
  }

  /** The configured per-turn damage denominator override, or `undefined`. */
  public getDamageDenominator(): number | undefined {
    return this.damageDenominator;
  }

  private matchesMove(move: Move, pokemon: Pokemon, target: Pokemon): boolean {
    if (this.moveIds !== undefined && !this.moveIds.includes(move.id)) {
      return false;
    }
    if (this.contactExcluded && move.hasFlag(MoveFlags.MAKES_CONTACT)) {
      return false;
    }
    if (this.contactRequired && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target })) {
      return false;
    }
    return this.filter === undefined || checkChanceStatusFilter(this.filter, move);
  }

  private matchesTarget(target: Pokemon): boolean {
    if (this.targetHasTag !== undefined && !target.getTag(this.targetHasTag)) {
      return false;
    }
    if (this.targetHasStatus !== undefined && target.status?.effect !== this.targetHasStatus) {
      return false;
    }
    return !this.critRequired || !!target.turnData?.attacksReceived?.[0]?.critical;
  }

  private passesChance(pokemon: Pokemon, target: Pokemon, move: Move): boolean {
    const chance = this.chanceResolver
      ? this.chanceResolver(pokemon, target, move)
      : this.firstTurnChance !== undefined && pokemon.tempSummonData?.waveTurnCount === 1
        ? this.firstTurnChance
        : this.chance;
    return chance === 100 || pokemon.randBattleSeedInt(100) < chance;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent: target } = params;
    if (!super.canApply(params)) {
      return false;
    }
    if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr") || pokemon === target) {
      return false;
    }
    if (!this.matchesMove(move, pokemon, target)) {
      return false;
    }
    if (!this.matchesTarget(target)) {
      return false;
    }
    if (!this.passesChance(pokemon, target, move)) {
      return false;
    }
    const tag = this.pickTag(pokemon);
    return target.canAddTag(tag);
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent: target } = params;
    const tag = this.pickTag(pokemon);
    target.addTag(tag, resolveTagTurns(tag, this.turns, this.turnRange, pokemon), undefined, pokemon.id);
    if (this.damageDenominator !== undefined) {
      const appliedTag = target.getTag(tag);
      if (appliedTag) {
        (appliedTag as { damageDenominatorOverride?: number }).damageDenominatorOverride = this.damageDenominator;
      }
    }
  }

  private pickTag(pokemon: Parameters<PostAttackAbAttr["apply"]>[0]["pokemon"]): BattlerTagType {
    if (this.tags.length === 1) {
      return this.tags[0];
    }
    return this.tags[pokemon.randBattleSeedInt(this.tags.length)];
  }
}

/**
 * Resolve the turn count to pass to `addTag` for an inflicted battler tag.
 *
 * Only {@linkcode BattlerTagType.CONFUSED} actually consumes the count —
 * `ConfusedTag` is a CUSTOM-lapse tag, so a `0` count (the `addTag` default)
 * makes it expire on the very next lapse without ever taking effect. Every
 * other tag we emit (`DISABLED`, `INFATUATED`, `FLINCHED`, and the ER-specific
 * `ER_BLEED`/`ER_FROSTBITE`/`ER_FEAR`) self-manages its own duration and
 * ignores the passed count.
 *
 * When no explicit `turns` override is supplied we roll 2-5 turns for CONFUSED,
 * matching move-based confusion (`ConfuseAttr`, `move.ts`); other tags fall
 * through to the `addTag` default.
 */
function resolveTagTurns(
  tag: BattlerTagType,
  turns: number | undefined,
  turnRange: readonly [number, number] | undefined,
  pokemon: { randBattleSeedIntRange(min: number, max: number): number },
): number | undefined {
  if (turns !== undefined) {
    return turns;
  }
  if (turnRange !== undefined) {
    return pokemon.randBattleSeedIntRange(turnRange[0], turnRange[1]);
  }
  if (tag === BattlerTagType.CONFUSED) {
    return pokemon.randBattleSeedIntRange(2, 5);
  }
  return;
}

/**
 * Check whether the incoming `move` satisfies the given filter. Shared by
 * both {@linkcode ChanceStatusOnHitAbAttr} and
 * {@linkcode ChanceBattlerTagOnHitAbAttr}.
 */
function checkChanceStatusFilter(
  filter: ChanceStatusFilter,
  move: {
    hasFlag(flag: MoveFlags): boolean;
    readonly type: PokemonType;
    readonly id: MoveId;
    readonly category: MoveCategory;
  },
): boolean {
  if ("flag" in filter) {
    return move.hasFlag(filter.flag);
  }
  if ("moveId" in filter) {
    return move.id === filter.moveId;
  }
  if ("category" in filter) {
    return move.category === filter.category;
  }
  return move.type === filter.type;
}
