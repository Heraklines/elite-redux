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
import { HitResult } from "#enums/hit-result";
import type { PokemonType } from "#enums/pokemon-type";
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
   * one safe type.
   */
  readonly safeTypes: readonly PokemonType[];
  /**
   * Fraction of max HP each non-safe foe loses per turn. Must be `> 0` and
   * `<= 1`. Typical values: `1/8`, `1/4`.
   */
  readonly damageFraction: number;
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

  constructor(opts: PostTurnHurtNonTypedOptions) {
    if (!(opts.damageFraction > 0 && opts.damageFraction <= 1)) {
      throw new Error(`[PostTurnHurtNonTypedAbAttr] damageFraction must be in (0, 1]; got ${opts.damageFraction}`);
    }
    super(true);
    this.safeTypes = opts.safeTypes;
    this.damageFraction = opts.damageFraction;
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
   * Check if the proc has at least one valid target. Pure read-only check —
   * matches vanilla `PostTurnHurtIfSleepingAbAttr.canApply` shape.
   */
  public override canApply({ pokemon }: AbAttrBaseParams): boolean {
    for (const opp of pokemon.getOpponents()) {
      if (this.isValidTarget(opp)) {
        return true;
      }
    }
    return false;
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
    for (const opp of pokemon.getOpponents()) {
      if (!this.isValidTarget(opp)) {
        continue;
      }
      const cancelled = new BooleanHolder(false);
      applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon: opp, simulated: false, cancelled });
      if (cancelled.value) {
        continue;
      }
      const damage = toDmgValue(opp.getMaxHp() * this.damageFraction);
      opp.damageAndUpdate(damage, { result: HitResult.INDIRECT });
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
