/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "passive per-turn damage to non-Type-X foes".
//
// Models ER's "while on the field, foes of non-immune types take chip damage"
// cluster (Toxic Spill, Flame Coat, Funeral Pyre, …). The trigger surface is
// `PostTurnAbAttr` (end-of-turn dispatch, same surface vanilla Bad Dreams uses
// for its sleep-tick damage).
//
// Mechanic: at end of each turn, this Pokemon's on-field opponents that are
// NOT of any configured `safeTypes` lose `damageFraction` of their max HP
// (rounded via pokerogue's standard `toDmgValue`). Opponents that ARE of any
// safe type are skipped; switched-out foes are skipped; fainted foes are
// skipped.
//
// Sub-shape variants currently in scope:
//   - 411 Toxic Spill — `{ safeTypes: [POISON], damageFraction: 1/8 }`.
//   - 775 Flame Coat — `{ safeTypes: [FIRE], damageFraction: 1/8 }`.
//   - 663 Funeral Pyre — `{ safeTypes: [GHOST, DARK], damageFraction: 1/4 }`.
//
// Differences from vanilla `PostTurnHurtIfSleepingAbAttr` (Bad Dreams):
//   - Bad Dreams gates on the foe's *status* (asleep); we gate on the foe's
//     *types*.
//   - Bad Dreams hardcodes the 1/8 fraction; we parameterize.
//   - We honor `BlockNonDirectDamageAbAttr` (Magic Guard) the same way Bad
//     Dreams does — so a Magic Guard foe shrugs off this chip damage.
// =============================================================================

import { PostTurnAbAttr } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import type { PokemonType } from "#enums/pokemon-type";
import type { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import { BooleanHolder } from "#utils/value-holder";
import i18next from "i18next";

/** Construction options for {@linkcode PostTurnHurtNonTypedAbAttr}. */
export interface PostTurnHurtNonTypedOptions {
  /**
   * The Pokemon types that are IMMUNE to the chip damage. Foes possessing any
   * of these types are spared. Empty list is allowed (degenerates to "hurt
   * every foe each turn") but unusual — every wired ER ability lists at least
   * one safe type. Christmas Nightmare ("Enemies take 1/8 dmg when in hail")
   * uses the empty-list shape — the weather gate carries the conditioning.
   */
  readonly safeTypes: readonly PokemonType[];
  /**
   * Fraction of max HP each non-safe foe loses per turn. Must be `> 0` and
   * `<= 1`. Typical values: `1/8`, `1/4`.
   */
  readonly damageFraction: number;
  /**
   * Optional weather gate — when set, the proc only fires while one of the
   * listed {@linkcode WeatherType}s is active. Wires ER abilities like
   * Christmas Nightmare ("Enemies take 1/8 damage when in hail"). Omit for
   * weather-agnostic procs (Toxic Spill / Flame Coat / Funeral Pyre).
   */
  readonly requiredWeathers?: readonly WeatherType[];
  /**
   * When true, target the WHOLE field (every active Pokemon except the holder),
   * not just the holder's opponents. Toxic Spill's dex reads "damages ALL
   * non-Poison-type Pokemon" — in doubles that includes the holder's ally.
   * @defaultValue `false`
   */
  readonly fieldWide?: boolean;
  /**
   * When true, a target with {@linkcode AbilityId.POISON_HEAL} RECOVERS the
   * configured fraction instead of taking damage (Toxic Spill: "Pokemon with
   * Poison Heal recover instead").
   * @defaultValue `false`
   */
  readonly poisonHealRecovers?: boolean;
}

/**
 * Parameterized `AbAttr` dealing chip damage to opposing Pokemon at end-of-turn
 * unless they are of an immune type.
 *
 * @remarks
 * Extends {@linkcode PostTurnAbAttr}, which is dispatched once per still-alive
 * Pokemon at end of every turn. We iterate `pokemon.getOpponents()`, filter on
 * the safe-types check + Magic-Guard-style cancellation, and call
 * `damageAndUpdate` with `HitResult.INDIRECT` so the foe's
 * `damageNonDirectDamageAttr` lock still applies.
 */
export class PostTurnHurtNonTypedAbAttr extends PostTurnAbAttr {
  private readonly safeTypes: readonly PokemonType[];
  private readonly damageFraction: number;
  private readonly requiredWeathers: readonly WeatherType[] | null;
  private readonly fieldWide: boolean;
  private readonly poisonHealRecovers: boolean;

  constructor(opts: PostTurnHurtNonTypedOptions) {
    if (!(opts.damageFraction > 0 && opts.damageFraction <= 1)) {
      throw new Error(`[PostTurnHurtNonTypedAbAttr] damageFraction must be in (0, 1]; got ${opts.damageFraction}`);
    }
    super(true);
    this.safeTypes = opts.safeTypes;
    this.damageFraction = opts.damageFraction;
    this.requiredWeathers = opts.requiredWeathers && opts.requiredWeathers.length > 0 ? opts.requiredWeathers : null;
    this.fieldWide = opts.fieldWide ?? false;
    this.poisonHealRecovers = opts.poisonHealRecovers ?? false;
  }

  /** Targets of the proc: the whole field (minus the holder) or just its foes. */
  private getTargets(pokemon: AbAttrBaseParams["pokemon"]): AbAttrBaseParams["pokemon"][] {
    if (this.fieldWide) {
      return globalScene.getField(true).filter(p => p !== pokemon);
    }
    return pokemon.getOpponents();
  }

  /** Read-only accessor: the configured safe-types list. */
  public getSafeTypes(): readonly PokemonType[] {
    return this.safeTypes;
  }

  /** Read-only accessor: the configured per-turn damage fraction. */
  public getDamageFraction(): number {
    return this.damageFraction;
  }

  /**
   * Read-only accessor: the configured weather gate (or `null` for
   * weather-agnostic procs).
   */
  public getRequiredWeathers(): readonly WeatherType[] | null {
    return this.requiredWeathers;
  }

  /**
   * Check if the proc has at least one valid target. Pure read-only check —
   * matches vanilla `PostTurnHurtIfSleepingAbAttr.canApply` shape.
   *
   * If a weather gate is configured, returns false immediately when none of
   * the listed weathers is active — saves the per-opponent type-check loop.
   */
  public override canApply({ pokemon }: AbAttrBaseParams): boolean {
    if (!this.isWeatherActive()) {
      return false;
    }
    for (const opp of this.getTargets(pokemon)) {
      if (this.isValidTarget(opp)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether the configured weather gate is currently satisfied. Returns
   * `true` when no gate is configured (weather-agnostic mode). Mirrors the
   * convention in `weather-terrain-interaction.ts` — read the cached
   * `arena.weatherType` rather than the optional `arena.weather` object.
   */
  private isWeatherActive(): boolean {
    if (this.requiredWeathers === null) {
      return true;
    }
    return this.requiredWeathers.includes(globalScene.arena.weatherType);
  }

  /**
   * Deal the configured damage to every non-safe-typed on-field opponent.
   * Honors `BlockNonDirectDamageAbAttr` (Magic Guard) per the vanilla
   * convention — each foe gets its own block check so partial application is
   * possible.
   */
  public override apply(params: AbAttrBaseParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    for (const opp of this.getTargets(pokemon)) {
      if (!this.isValidTarget(opp)) {
        continue;
      }
      const amount = toDmgValue(opp.getMaxHp() * this.damageFraction);
      // Poison Heal holders RECOVER the fraction instead of taking it.
      if (this.poisonHealRecovers && opp.hasAbility(AbilityId.POISON_HEAL)) {
        if (!opp.isFullHp()) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            opp.getBattlerIndex(),
            amount,
            i18next.t("abilityTriggers:poisonHeal", {
              pokemonName: getPokemonNameWithAffix(opp),
              abilityName: allAbilities[AbilityId.POISON_HEAL].name,
            }),
            true,
          );
        }
        continue;
      }
      const cancelled = new BooleanHolder(false);
      applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon: opp, simulated: false, cancelled });
      if (cancelled.value) {
        continue;
      }
      opp.damageAndUpdate(amount, { result: HitResult.INDIRECT });
      globalScene.phaseManager.queueMessage(
        i18next.t("battle:hurtByItem", { pokemonNameWithAffix: getPokemonNameWithAffix(opp) }),
      );
    }
  }

  /**
   * A foe is a valid target if it's on the field, not fainted, not switched
   * out, and not of any of the configured safe types.
   *
   * The `isOfType` call uses pokerogue's standard arguments — we don't pass
   * `includeTeraType` etc. since the safe-type check should respect terastal
   * (an Electric pokemon tera'd to Poison gets Toxic Spill immunity); the
   * default behavior of `isOfType` matches.
   */
  private isValidTarget(opp: ReturnType<AbAttrBaseParams["pokemon"]["getOpponents"]>[number]): boolean {
    if (opp.switchOutStatus || opp.isFainted()) {
      return false;
    }
    for (const t of this.safeTypes) {
      if (opp.isOfType(t)) {
        return false;
      }
    }
    return true;
  }
}
