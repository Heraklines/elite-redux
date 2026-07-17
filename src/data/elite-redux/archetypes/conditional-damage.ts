/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `conditional-damage` archetype primitive.
//
// Implements taxonomy entry #20 (~10+ abilities). Parameterized AbAttr that
// multiplies a Pokemon's outgoing move power when a configurable per-target /
// per-self / per-field condition is met. Symmetric to {@linkcode
// TypeDamageBoostAbAttr} and {@linkcode FlagDamageBoostAbAttr}, but the
// gating predicate is a condition over the *target* or *field* state rather
// than the move's type or flags.
//
// Base class: `MovePowerBoostAbAttr` (same as type-damage-boost and
// flag-damage-boost). The closure passed to the super constructor encodes
// the condition; apply just multiplies `power.value`.
//
// Sub-conditions covered in C1b:
//   - `target-statused`            — `Dreamcatcher` ("doubles damage if foe sleeping"),
//                                   `Cosmic Daze` (status set: confused, enraged).
//   - `target-low-hp`              — `Pretty Princess` and similar "deal more to wounded".
//                                   Threshold defaults to 0.5 but is configurable.
//   - `self-low-hp`                — orthogonal to the type-boost low-HP swap;
//                                   useful when the multiplier is unconditional in type but
//                                   gated only by self-HP (no current ER ability uses this
//                                   shape unflagged, but it's symmetric and trivial to support).
//   - `target-confused`            — Cosmic Daze's "vs confused" piece.
//   - `target-has-lowered-stat`    — `Pretty Princess` ("if target has any lowered stat").
//
// The condition is a discriminated union; new sub-conditions can be added
// additively. The C1b set covers the taxonomy entry's named examples plus
// the trivial dual-axis "self-low-hp" / "target-low-hp" pair.
//
// Sub-shapes NOT covered (deferred):
//   - Weather-active gating — overlaps with `weather-or-terrain-interaction`
//     (archetype #23); skipped to avoid duplicate primitives.
//   - Terrain-active gating — same reasoning.
//   - "Non-X-type" target gating (e.g. "boosted vs anything not Grass") —
//     none of the C1b targets need it; revisit if a future ER ability does.
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { BATTLE_STATS, type BattleStat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Discriminated condition payload. Each variant gates the damage boost on a
 * different observable state.
 */
export type DamageCondition =
  | DamageConditionTargetStatused
  | DamageConditionTargetLowHp
  | DamageConditionSelfLowHp
  | DamageConditionTargetConfused
  | DamageConditionTargetHasTag
  | DamageConditionTargetHasAnyTag
  | DamageConditionTargetHasLoweredStat
  | DamageConditionAnyActiveAsleep;

/**
 * Boost when the target's `status.effect` is in {@linkcode statuses}. Omit
 * `statuses` to mean "any non-NONE status" (matches `Dreamcatcher`'s
 * "any sleeping foe" → `statuses: [SLEEP]`; or `Cosmic Daze` would split into
 * this + {@linkcode DamageConditionTargetConfused} via composition).
 */
export interface DamageConditionTargetStatused {
  readonly kind: "target-statused";
  /** Status set that triggers the boost. Omit for "any status". */
  readonly statuses?: readonly StatusEffect[];
}

/**
 * Boost when the target's HP ratio is at-or-below {@linkcode threshold}.
 * Default threshold is 0.5 (matches "vs low HP foes" colloquial phrasing).
 */
export interface DamageConditionTargetLowHp {
  readonly kind: "target-low-hp";
  /**
   * The HP ratio (`hp / maxHp`) at-or-below which the boost fires.
   * @defaultValue `0.5`
   */
  readonly threshold?: number;
}

/** Boost when the *subject's* HP ratio is at-or-below `threshold` (default 0.5). */
export interface DamageConditionSelfLowHp {
  readonly kind: "self-low-hp";
  readonly threshold?: number;
}

/** Boost when the target has the {@linkcode BattlerTagType.CONFUSED} tag. */
export interface DamageConditionTargetConfused {
  readonly kind: "target-confused";
}

/**
 * Boost when the target carries a specific {@linkcode BattlerTagType} (e.g.
 * `ER_BLEED` for Blood Stigma's "2x vs bleeding foes"). Generalizes the
 * confused-only variant to any tag.
 */
export interface DamageConditionTargetHasTag {
  readonly kind: "target-has-tag";
  readonly tag: BattlerTagType;
}

/**
 * Boost when the target carries ANY of the listed {@linkcode BattlerTagType}s.
 * Used by Cosmic Daze's "2× vs confused AND enraged foes" — in ER, "enraged"
 * is the vanilla {@linkcode BattlerTagType.TAUNT} tag, so the condition is
 * `CONFUSED ∪ TAUNT`. Boost is applied once regardless of how many match.
 */
export interface DamageConditionTargetHasAnyTag {
  readonly kind: "target-has-any-tag";
  readonly tags: readonly BattlerTagType[];
}

/**
 * Boost when the target has ANY {@linkcode BattleStat} stage strictly below
 * zero (i.e. anything lowered). Matches `Pretty Princess`'s "if target has
 * any lowered stat".
 */
export interface DamageConditionTargetHasLoweredStat {
  readonly kind: "target-has-lowered-stat";
}

/**
 * Boost when ANY active Pokemon on the field (user, ally, or opponent) is
 * genuinely asleep (status = SLEEP). Matches Dreamcatcher / Dreamscape: "doubles
 * the power of the user's moves when any [active] Pokemon is asleep." Comatose
 * does NOT count (it is an ability, not a SLEEP status) — matching the dex note
 * "Does not activate against Comatose."
 */
export interface DamageConditionAnyActiveAsleep {
  readonly kind: "any-active-asleep";
}

/** All valid {@linkcode DamageCondition.kind} discriminator strings. */
export type DamageConditionKind = DamageCondition["kind"];

/** Construction options for {@linkcode ConditionalDamageAbAttr}. */
export interface ConditionalDamageOptions {
  /** The condition that gates whether the boost fires. */
  readonly condition: DamageCondition;
  /**
   * The damage multiplier applied when {@linkcode condition} evaluates true.
   * Must be > 0; > 1 for a boost, < 1 for a penalty.
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the `conditional-damage` archetype.
 *
 * Used (or will be used) by ER abilities such as `Dreamcatcher`, `Cosmic Daze`,
 * `Pretty Princess`, and similar "condition-gated" boost effects.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}. The condition predicate is
 * evaluated at canApply time — we read the target's status, HP, tags, or
 * stat stages depending on the discriminator. The predicate runs on every
 * dispatch (so it correctly reflects mid-turn state changes) and is cheap.
 *
 * The dispatch path is identical to the other power-boost archetypes:
 * super's canApply runs the closure, super's apply mults `power.value`. We
 * intentionally do NOT subclass {@linkcode TypeDamageBoostAbAttr} or
 * {@linkcode FlagDamageBoostAbAttr} because the conditions are
 * type-orthogonal — a future composite ability could chain a
 * `ConditionalDamageAbAttr` with a `TypeDamageBoostAbAttr` for the "x1.5 if
 * foe statused AND Fire-type move" sub-case.
 */
export class ConditionalDamageAbAttr extends MovePowerBoostAbAttr {
  // NOTE: We use distinct field names from the super (`condition`,
  // `powerMultiplier`) to avoid shadowing — TypeScript collapses subclass
  // declarations that share a name with the super, and the closure passed to
  // `super(...)` ends up dereferencing the subclass's value (which is bound
  // *after* super returns and is therefore not yet a callable closure).
  // Using `damageCondition` / `damageMultiplier` keeps the super's slots
  // intact while letting us expose typed accessors.
  private readonly damageCondition: DamageCondition;
  private readonly damageMultiplier: number;

  constructor(opts: ConditionalDamageOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[ConditionalDamageAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    super(
      (pokemon: Pokemon, target: Pokemon | null, _move: Move) =>
        // `target` should always be present for damage-resolution dispatches, but
        // pokerogue's `PokemonAttackCondition` types it as nullable for the rare
        // self-targeting / status-move dispatch paths. We bail on a null target —
        // every {@linkcode DamageCondition} variant needs a real target Pokemon.
        target !== null && ConditionalDamageAbAttr.evaluateCondition(opts.condition, pokemon, target),
      opts.multiplier,
      false,
    );
    this.damageCondition = opts.condition;
    this.damageMultiplier = opts.multiplier;
  }

  /**
   * Read-only accessor for the configured condition (used in tests / introspection).
   * Named `getDamageCondition` rather than `getCondition` to avoid shadowing the
   * base `AbAttr.getCondition(): AbAttrCondition | null` accessor (which returns
   * a wholly different shape).
   */
  public getDamageCondition(): DamageCondition {
    return this.damageCondition;
  }

  /** Read-only accessor for the configured multiplier. */
  public getMultiplier(): number {
    return this.damageMultiplier;
  }

  /**
   * Evaluate {@linkcode condition} against the subject and target. Returns
   * `true` when the configured boost should fire.
   *
   * Exposed as a public static so tests can verify condition evaluation
   * without spinning up the apply path, and so future archetypes (e.g.
   * `CompositeAbAttr`) can reuse the same predicate.
   *
   * @param condition - The discriminator + parameters.
   * @param pokemon   - The subject (i.e. the Pokemon attacking).
   * @param target    - The target of the attack.
   */
  public static evaluateCondition(condition: DamageCondition, pokemon: Pokemon, target: Pokemon): boolean {
    switch (condition.kind) {
      case "target-statused":
        return ConditionalDamageAbAttr.evalTargetStatused(condition, target);
      case "target-low-hp":
        return target.getHpRatio() <= (condition.threshold ?? 0.5);
      case "self-low-hp":
        return pokemon.getHpRatio() <= (condition.threshold ?? 0.5);
      case "target-confused":
        return target.getTag(BattlerTagType.CONFUSED) != null;
      case "target-has-tag":
        return target.getTag(condition.tag) != null;
      case "target-has-any-tag":
        return condition.tags.some(tag => target.getTag(tag) != null);
      case "target-has-lowered-stat":
        return ConditionalDamageAbAttr.evalAnyStatLowered(target);
      case "any-active-asleep":
        // The dedicated switch-strike on a sleeping foe is 1x, NOT 2x: "Attacks
        // hit sleeping foes who are switching out for 1x power instead." When the
        // target is mid-switch (its deferred voluntary switch is still pending —
        // TurnStartPhase held it back so this strike lands before it leaves), the
        // any-asleep boost must NOT apply to THIS hit. All other hits keep the boost.
        if (ConditionalDamageAbAttr.isTargetMidVoluntarySwitch(target)) {
          return false;
        }
        // Any active Pokemon (user/ally/opponent) with real SLEEP status triggers
        // the boost. COMATOSE ("considered asleep") only counts for the HOLDER
        // itself: Dreamcatcher (305) "does not activate against Comatose" foes,
        // but Dreamscape (859 = Comatose + Dreamcatcher) still self-triggers from
        // its own Comatose. So a Comatose OPPONENT no longer wrongly grants 2x.
        return globalScene
          .getField(true)
          .some(p => p.status?.effect === StatusEffect.SLEEP || (p === pokemon && p.hasAbility(AbilityId.COMATOSE)));
    }
  }

  /**
   * Whether `target` is currently mid-voluntary-switch: it has an unexecuted
   * `Command.POKEMON` queued this turn. In normal play a menu switch resolves
   * BEFORE any move (so the switcher is off-field and untargetable); the only way
   * a `POKEMON` command is still pending while the mon is on-field being struck is
   * the ER switch-out interception in {@linkcode TurnStartPhase} (Dreamcatcher /
   * Pursuit deferral). This is the transient "target is mid-switch" signal used to
   * drop the any-asleep boost to 1x for the dedicated switch-strike.
   */
  public static isTargetMidVoluntarySwitch(target: Pokemon): boolean {
    const command = globalScene.currentBattle.turnCommands[target.getBattlerIndex()];
    return command?.command === Command.POKEMON && !command.skip;
  }

  /**
   * `target-statused` predicate. When `statuses` is omitted, ANY non-null
   * status fires the boost; otherwise the target's status must be in the set.
   */
  private static evalTargetStatused(condition: DamageConditionTargetStatused, target: Pokemon): boolean {
    const effect = target.status?.effect;
    if (effect === undefined || effect === null) {
      return false;
    }
    if (condition.statuses === undefined) {
      return true;
    }
    return condition.statuses.includes(effect);
  }

  /**
   * `target-has-lowered-stat` predicate. Returns true if the target has any
   * {@linkcode BattleStat} stage value strictly below zero.
   */
  private static evalAnyStatLowered(target: Pokemon): boolean {
    for (const stat of BATTLE_STATS as readonly BattleStat[]) {
      if (target.getStatStage(stat) < 0) {
        return true;
      }
    }
    return false;
  }
}
