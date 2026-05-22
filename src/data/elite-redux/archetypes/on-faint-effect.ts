/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: `on-faint-effect` archetype primitive.
//
// Parameterized AbAttr family that fires a configured side-effect when the
// subject Pokemon faints. Covers ~10 ER abilities (e.g. "Sets sandstorm on
// faint", "Damages attacker for N% of max HP on faint", "Sets up Stealth Rock
// on faint", etc.) plus serves as the canonical Phase-C primitive for the
// long-tail "post-faint trigger" pattern.
//
// Discriminator axis: the side-effect type. We model this as a discriminated
// union of effect payloads dispatched from a single `PostFaintAbAttr`
// subclass. Pokerogue's existing PostFaint family (PostFaintContactDamage,
// PostFaintHPDamage, PostFaintFormChange) all extend the same base; following
// that pattern lets the dispatcher route them through a single key.
//
// Sub-effects covered in C1c:
//   - `set-weather`           — On faint, set the configured weather
//                             (e.g. "Sets sandstorm on faint"). Mirrors
//                             `PostSummonWeatherChangeAbAttr` but on the
//                             faint surface.
//   - `set-terrain`           — On faint, set the configured terrain.
//   - `attacker-damage-flat`  — On faint, damage the attacker by N/M of THEIR
//                             max HP (e.g. PostFaintHPDamage-flavored "do X%
//                             damage to whoever killed you"). Symmetric to
//                             `PostFaintContactDamageAbAttr` but flat-rate
//                             rather than gated on contact.
//   - `set-hazard`            — Place an entry hazard on the opposing side
//                             on faint ("Sets Stealth Rock on faint").
//
// Sub-effects intentionally NOT covered (deferred):
//   - **Self-revive** (Cheating Death, Lucky Halo, Shallow Grave) — those are
//     pre-faint interrupts, not post-faint actions. Belong in a separate
//     archetype (or bespoke implementations as flagged in the long-tail
//     section of the taxonomy).
//   - **Form-change on faint** — Pokerogue's existing
//     `PostFaintFormChangeAbAttr` covers this; folding it into this archetype
//     would duplicate functionality without adding ergonomics. Wire-up uses
//     the existing class directly when needed.
//   - **PostFaintContactDamage** (Aftermath-style "if killed by contact, hurt
//     attacker for 1/4 max HP") — already in pokerogue as a separate class
//     with a contact gate. The flat-rate variant we DO cover is for ER
//     abilities that don't require the contact filter.
//
// Examples (per taxonomy):
//   - "Sets sandstorm on faint" — `new OnFaintEffectAbAttr({ kind: "set-weather",
//       weather: WeatherType.SANDSTORM })`
//   - "Damages attacker 25% on faint" — `new OnFaintEffectAbAttr({
//       kind: "attacker-damage-flat", maxHpFraction: 0.25 })`
//   - "Sets Stealth Rock on faint" — `new OnFaintEffectAbAttr({
//       kind: "set-hazard", hazard: ArenaTagType.STEALTH_ROCK })`
// =============================================================================

import { PostFaintAbAttr, type PostFaintAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { WeatherType } from "#enums/weather-type";
import { BooleanHolder, toDmgValue } from "#utils/common";

/** Set a weather condition when the subject faints. */
export interface OnFaintEffectSetWeather {
  readonly kind: "set-weather";
  /** The weather to set. Must not be {@linkcode WeatherType.NONE}. */
  readonly weather: WeatherType;
}

/** Set a terrain when the subject faints. */
export interface OnFaintEffectSetTerrain {
  readonly kind: "set-terrain";
  readonly terrain: TerrainType;
}

/**
 * Damage the Pokemon that caused the faint (the {@linkcode PostFaintAbAttrParams.attacker})
 * for a configurable fraction of THEIR max HP. Mirrors `PostFaintContactDamageAbAttr`
 * but without the contact gate — fires on any faint where there's a known
 * attacker. The `BlockNonDirectDamageAbAttr` cancellation hook is honored.
 */
export interface OnFaintEffectAttackerDamageFlat {
  readonly kind: "attacker-damage-flat";
  /**
   * The fraction of the attacker's max HP to deduct. Must be in `(0, 1]`.
   * `0.25` corresponds to "1/4 max HP" — the common "Aftermath without contact"
   * value.
   */
  readonly maxHpFraction: number;
}

/**
 * Place an entry hazard on the side opposite the fainting Pokemon (i.e. on
 * the attacker's side). Used by ER abilities that "set Spikes / Stealth Rock /
 * Sticky Web / Toxic Spikes on faint".
 */
export interface OnFaintEffectSetHazard {
  readonly kind: "set-hazard";
  readonly hazard: ArenaTagType;
  /**
   * Number of hazard layers to apply (e.g. `2` for the equivalent of two
   * Spikes layers in one shot).
   * @defaultValue `1`
   */
  readonly layers?: number;
}

/**
 * Apply a {@linkcode BattlerTagType} to the attacker that caused the faint.
 * Used by ER abilities such as Haunted Spirit ("When this Pokemon is KO'd,
 * casts a Curse on the attacker"). The tag goes onto the attacker via
 * `attacker.addTag(...)`; if there's no known attacker (status / hazard
 * faint) the effect is a no-op.
 */
export interface OnFaintEffectAttackerBattlerTag {
  readonly kind: "attacker-battler-tag";
  /** The {@linkcode BattlerTagType} to add to the attacker. */
  readonly tagType: BattlerTagType;
  /**
   * Number of turns the tag persists. `0` = "until lifted" (some tags like
   * CURSED don't honor turn counts in pokerogue's implementation; passing
   * `0` matches the move-effect convention).
   * @defaultValue `0`
   */
  readonly turns?: number;
}

/**
 * Discriminated union describing every post-faint side-effect this archetype
 * can carry. New sub-shapes should extend this union additively.
 */
export type OnFaintEffect =
  | OnFaintEffectSetWeather
  | OnFaintEffectSetTerrain
  | OnFaintEffectAttackerDamageFlat
  | OnFaintEffectSetHazard
  | OnFaintEffectAttackerBattlerTag;

/** All valid {@linkcode OnFaintEffect.kind} discriminator strings. */
export type OnFaintEffectKind = OnFaintEffect["kind"];

/** Construction options for {@linkcode OnFaintEffectAbAttr}. */
export interface OnFaintEffectOptions {
  /** The discriminated effect payload describing what to do on faint. */
  readonly effect: OnFaintEffect;
}

/**
 * Parameterized `AbAttr` implementing the `on-faint-effect` archetype.
 *
 * Used (or will be used) by ER abilities such as "Sets sandstorm on faint",
 * "Damages attacker 25% on faint", "Sets Stealth Rock on faint", and similar
 * "perform action X when this Pokemon is KO'd" abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostFaintAbAttr}, which is dispatched from
 * faint-phase.ts after a Pokemon's HP is set to 0. The `canApply` predicate
 * validates that the configured effect has its prerequisites met (e.g. for
 * attacker-damage we need a known attacker); the `apply` switch routes to the
 * right side-effect dispatcher.
 *
 * Per pokerogue convention, side effects respect `params.simulated` — when
 * true, the AbAttr still passes through canApply but skips the actual scene
 * mutation. This lets the dispatcher's preview / record-only modes inspect
 * the trigger without firing it.
 */
export class OnFaintEffectAbAttr extends PostFaintAbAttr {
  private readonly effect: OnFaintEffect;

  constructor(opts: OnFaintEffectOptions) {
    super(true);
    OnFaintEffectAbAttr.validateEffect(opts.effect);
    this.effect = opts.effect;
  }

  /** Read-only accessor for the configured effect payload. */
  public getEffect(): OnFaintEffect {
    return this.effect;
  }

  /** Read-only accessor for the effect discriminator. */
  public getKind(): OnFaintEffectKind {
    return this.effect.kind;
  }

  public override canApply(params: PostFaintAbAttrParams): boolean {
    switch (this.effect.kind) {
      case "set-weather":
        return globalScene.arena.canSetWeather(this.effect.weather);
      case "set-terrain":
        return globalScene.arena.canSetTerrain(this.effect.terrain);
      case "attacker-damage-flat":
        return OnFaintEffectAbAttr.canApplyAttackerDamage(params);
      case "set-hazard":
        return true;
      case "attacker-battler-tag":
        return params.attacker !== undefined && !params.attacker.isFainted();
    }
  }

  public override apply(params: PostFaintAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    switch (this.effect.kind) {
      case "set-weather":
        globalScene.arena.trySetWeather(this.effect.weather, params.pokemon);
        return;
      case "set-terrain":
        globalScene.arena.trySetTerrain(this.effect.terrain, false, params.pokemon);
        return;
      case "attacker-damage-flat":
        OnFaintEffectAbAttr.applyAttackerDamage(this.effect, params);
        return;
      case "set-hazard":
        OnFaintEffectAbAttr.applyHazard(this.effect, params);
        return;
      case "attacker-battler-tag":
        OnFaintEffectAbAttr.applyAttackerBattlerTag(this.effect, params);
    }
  }

  /**
   * Validate the effect payload at construction time. Rejects nonsensical
   * configurations (e.g. WeatherType.NONE, out-of-range fractions, zero
   * hazard layers).
   */
  private static validateEffect(effect: OnFaintEffect): void {
    switch (effect.kind) {
      case "set-weather":
        if (effect.weather === WeatherType.NONE) {
          throw new Error("[OnFaintEffectAbAttr] set-weather effect cannot use WeatherType.NONE");
        }
        return;
      case "set-terrain":
        // No invalid terrain to guard against — TerrainType.NONE has a valid
        // canSetTerrain check at apply-time and corresponds to "clear terrain"
        // semantics in pokerogue, which is an intentional use case.
        return;
      case "attacker-damage-flat":
        if (!(effect.maxHpFraction > 0 && effect.maxHpFraction <= 1)) {
          throw new Error(
            `[OnFaintEffectAbAttr] attacker-damage-flat maxHpFraction must be in (0, 1]; got ${effect.maxHpFraction}`,
          );
        }
        return;
      case "set-hazard": {
        const layers = effect.layers ?? 1;
        if (!Number.isInteger(layers) || layers < 1) {
          throw new Error(`[OnFaintEffectAbAttr] set-hazard layers must be a positive integer; got ${layers}`);
        }
        return;
      }
      case "attacker-battler-tag": {
        const turns = effect.turns ?? 0;
        if (!Number.isInteger(turns) || turns < 0) {
          throw new Error(
            `[OnFaintEffectAbAttr] attacker-battler-tag turns must be a non-negative integer; got ${turns}`,
          );
        }
        return;
      }
    }
  }

  /**
   * canApply for the attacker-damage variant: only fires if there's a known
   * attacker, a known move that caused the faint, and the attacker isn't
   * blocking indirect damage (Magic Guard etc.). Mirrors what
   * `PostFaintHPDamageAbAttr.apply` checks inline.
   *
   * @remarks
   * The Magic-Guard check goes through `applyAbAttrs("BlockNonDirectDamageAbAttr", …)`,
   * the same dispatch path used by `PostFaintContactDamageAbAttr.canApply` and
   * `PostFaintHPDamageAbAttr.apply` (which calls it inline). We make it a
   * canApply gate here so the dispatcher records a NO-OP rather than a spurious
   * fire when Magic Guard absorbs the damage.
   */
  private static canApplyAttackerDamage({ attacker, move }: PostFaintAbAttrParams): boolean {
    if (attacker === undefined || move === undefined) {
      return false;
    }
    const cancelled = new BooleanHolder(false);
    applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon: attacker, cancelled });
    return !cancelled.value;
  }

  private static applyAttackerDamage(
    effect: OnFaintEffectAttackerDamageFlat,
    { attacker, simulated }: PostFaintAbAttrParams,
  ): void {
    if (simulated || attacker === undefined) {
      return;
    }
    const damage = toDmgValue(attacker.getMaxHp() * effect.maxHpFraction);
    attacker.damageAndUpdate(damage, { result: HitResult.INDIRECT });
    attacker.turnData.damageTaken += damage;
  }

  /**
   * Apply the hazard sub-effect by adding the configured ArenaTag to the
   * attacker's side. We default to the opposing side relative to the faint
   * subject because most "set hazard on faint" abilities hit the foe's side.
   */
  private static applyHazard(effect: OnFaintEffectSetHazard, { pokemon }: PostFaintAbAttrParams): void {
    const layers = effect.layers ?? 1;
    // Identify the opposing side. We use the fainting pokemon's `isPlayer()`
    // determination to decide which side to apply to.
    const targetSide = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    for (let i = 0; i < layers; i++) {
      globalScene.arena.addTag(effect.hazard, 0, undefined, pokemon.id, targetSide);
    }
  }

  /**
   * Apply a `BattlerTagType` to the attacker that caused the faint. Models
   * ER's "haunt your killer" cluster (Haunted Spirit casts Curse). The tag
   * goes through pokerogue's standard `addTag` path so its lapse / immunity
   * checks apply normally.
   */
  private static applyAttackerBattlerTag(
    effect: OnFaintEffectAttackerBattlerTag,
    { attacker, pokemon, simulated }: PostFaintAbAttrParams,
  ): void {
    if (simulated || attacker === undefined) {
      return;
    }
    const turns = effect.turns ?? 0;
    attacker.addTag(effect.tagType, turns, undefined, pokemon.id);
  }
}
