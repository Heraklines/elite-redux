/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `attack-stat-substitute` archetype.
//
// Replaces the attacking stat used in the damage formula with a different stat
// (the ability-driven analogue of Body Press's VariableAtkAttr). Distinct from
// SpeedBonusToStat, which ADDS a fraction of another stat — this fully
// SUBSTITUTES, matching ER descriptions like "uses Def instead of Attack".
//
// Hooked by `Pokemon.getBaseDamage` via a by-name scan of the attacker's
// ability/passive attrs (registration-free, like RecoilDamageMultiplierAbAttr
// and OffensiveTypeChartOverrideAbAttr).
//
// Wires:
//   - 286 Ancient Idol — physical moves use Def, special moves use SpDef.
//   - 372 Momentum — contact moves use Speed as the attacking stat.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { type EffectiveStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

export interface AttackStatSubstituteOptions {
  /** Stat to use instead of ATK for physical moves (omit to leave ATK). */
  readonly physicalStat?: EffectiveStat;
  /** Stat to use instead of SPATK for special moves (omit to leave SPATK). */
  readonly specialStat?: EffectiveStat;
  /** When true, only substitutes for contact moves. */
  readonly contactOnly?: boolean;
  /**
   * When set, only substitutes for moves carrying this flag (e.g.
   * `MoveFlags.BITING_MOVE` for Mind Crunch's "biting moves use SpAtk").
   * Composes with {@linkcode contactOnly}.
   */
  readonly flag?: MoveFlags;
  /**
   * When true, all attacks use the HIGHER of the holder's Attack / Special
   * Attack as the offensive stat (Equinox). Overrides physicalStat/specialStat.
   */
  readonly useHigherOffense?: boolean;
  /** Optional exact move allowlist. */
  readonly moveIds?: readonly MoveId[];
}

export class AttackStatSubstituteAbAttr extends AbAttr {
  private readonly physicalStat: EffectiveStat | undefined;
  private readonly specialStat: EffectiveStat | undefined;
  private readonly contactOnly: boolean;
  private readonly flag: MoveFlags | undefined;
  private readonly useHigherOffense: boolean;
  private readonly moveIds: readonly MoveId[] | undefined;

  constructor(options: AttackStatSubstituteOptions) {
    super(false);
    this.physicalStat = options.physicalStat;
    this.specialStat = options.specialStat;
    this.contactOnly = options.contactOnly ?? false;
    this.flag = options.flag;
    this.useHigherOffense = options.useHigherOffense ?? false;
    this.moveIds = options.moveIds;
  }

  /**
   * The stat to use instead of the move's default offensive stat, or `null`
   * when this ability does not substitute for the given move.
   */
  public resolveStat(move: Move, isPhysical: boolean, source: Pokemon): EffectiveStat | null {
    if (this.moveIds !== undefined && !this.moveIds.includes(move.id)) {
      return null;
    }
    if (this.contactOnly && !move.hasFlag(MoveFlags.MAKES_CONTACT)) {
      return null;
    }
    if (this.flag !== undefined && !move.hasFlag(this.flag)) {
      return null;
    }
    if (this.useHigherOffense) {
      return source.getStat(Stat.ATK, false) >= source.getStat(Stat.SPATK, false) ? Stat.ATK : Stat.SPATK;
    }
    return (isPhysical ? this.physicalStat : this.specialStat) ?? null;
  }
}
