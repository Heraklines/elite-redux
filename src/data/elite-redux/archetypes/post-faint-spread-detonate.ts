/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-faint-spread-detonate` primitive (TRUE on-faint hook).
//
// A genuine {@linkcode PostFaintAbAttr}: it fires from `FaintPhase` on ANY KO
// cause (a damaging move, status/burn/poison chip, weather, recoil, an entry
// hazard on switch-in) and deals a `power`-BP spread hit of the configured type
// to every ADJACENT FOE of the fainter. Cannot miss (damage is applied
// directly, never rolled through the accuracy check).
//
// Wires:
//   - 729 Victory Bomb — "When fainting, retaliate with a 100 BP Fire-type
//     Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless
//     of how the user was KOed." → power 100, type Fire.
//   - 614 Balloon Bomb — "Uses a 100 BP Explosion or Outburst (whichever is
//     higher) when knocked out." → power 100, type Normal (Explosion/Outburst),
//     category chosen by the holder's higher offensive stat.
//
// Why a TRUE PostFaint hook and NOT the PreDefend-endure clamp
// -----------------------------------------------------------
// The sibling {@linkcode PostFaintDetonateAbAttr} (post-faint-detonate.ts) is a
// PreDefend damage-clamp that keeps the holder alive at 1 HP so it can USE a
// real Explosion MovePhase. That only sees LETHAL DAMAGING hits — a status /
// weather / recoil / hazard KO never reaches the PreDefend surface, so it never
// detonated ("Works regardless of how the user was KOed" was unmet). A fainted
// holder cannot run a MovePhase (`MovePhase.start` bails on `!isActive(true)`),
// so this primitive instead computes each foe's damage via
// {@linkcode Pokemon.getAttackDamage} and applies it directly — exactly how
// vanilla Aftermath (`PostFaintContactDamageAbAttr`) deals its chip from a real
// PostFaint hook, but as a proper move-power spread hit.
// =============================================================================

import { PostFaintAbAttr, type PostFaintAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { AttackMove, type Move } from "#moves/move";
import type { DamageResult } from "#types/damage-result";
import { BooleanHolder, toDmgValue } from "#utils/common";

/** Construction options for {@linkcode PostFaintSpreadDetonateAbAttr}. */
export interface PostFaintSpreadDetonateOptions {
  /**
   * Base power of the detonation.
   * @defaultValue `100`
   */
  readonly power?: number;
  /**
   * Whether each surviving target is also flinched.
   * @defaultValue `false`
   */
  readonly flinch?: boolean;
  /**
   * Elemental type of the blast. Victory Bomb is Fire; Balloon Bomb (an
   * Explosion/Outburst) is Normal.
   * @defaultValue {@linkcode PokemonType.NORMAL}
   */
  readonly type?: PokemonType;
}

/** Standard spread-move damage reduction applied when more than one target is hit. */
const SPREAD_MULTIPLIER = 0.75;

/**
 * Build the one-off detonation {@linkcode Move} used only to drive the damage
 * calculation. Keeps {@linkcode MoveId.EXPLOSION} as its id (so type/name
 * resolution is stable) but carries the reduced power, chosen category, and
 * chosen type. Built per-cast (cheap) to avoid mutating the shared global move.
 */
function buildDetonationMove(power: number, category: MoveCategory, type: PokemonType): Move {
  return new AttackMove(MoveId.EXPLOSION, type, category, power, 100, 5, -1, 0, 1).makesContact(false);
}

/**
 * Parameterized `AbAttr` implementing the `post-faint-spread-detonate`
 * archetype — a real {@linkcode PostFaintAbAttr} that detonates on any KO.
 */
export class PostFaintSpreadDetonateAbAttr extends PostFaintAbAttr {
  private readonly power: number;
  private readonly flinch: boolean;
  private readonly type: PokemonType;

  constructor(opts: PostFaintSpreadDetonateOptions = {}) {
    super(true);
    this.power = opts.power ?? 100;
    this.flinch = opts.flinch ?? false;
    this.type = opts.type ?? PokemonType.NORMAL;
    if (!(this.power > 0)) {
      throw new Error(`[PostFaintSpreadDetonateAbAttr] power must be positive; got ${this.power}`);
    }
  }

  /** Read-only accessor for the configured base power. */
  public getPower(): number {
    return this.power;
  }

  /** Read-only accessor for the flinch flag. */
  public getFlinch(): boolean {
    return this.flinch;
  }

  /** Read-only accessor for the configured blast type. */
  public getType(): PokemonType {
    return this.type;
  }

  override canApply({ pokemon }: PostFaintAbAttrParams): boolean {
    // Nothing to detonate against, or Damp blocks explosions.
    return pokemon.getAdjacentOpponents(true).length > 0 && !PostFaintSpreadDetonateAbAttr.isExplosionBlocked();
  }

  override apply({ pokemon, simulated }: PostFaintAbAttrParams): void {
    if (simulated) {
      return;
    }
    const targets = pokemon.getAdjacentOpponents(true);
    if (targets.length === 0) {
      return;
    }
    // Explosion (physical) vs Outburst (special): whichever offensive stat is
    // higher. Victory Bomb (Fire) uses the same choice.
    const category =
      pokemon.getEffectiveStat(Stat.SPATK) > pokemon.getEffectiveStat(Stat.ATK)
        ? MoveCategory.SPECIAL
        : MoveCategory.PHYSICAL;
    const move = buildDetonationMove(this.power, category, this.type);
    const spread = targets.length > 1 ? SPREAD_MULTIPLIER : 1;

    for (const target of targets) {
      if (target.isFainted()) {
        continue;
      }
      const calc = target.getAttackDamage({ source: pokemon, move, isCritical: false, simulated: false });
      if (calc.cancelled || calc.result === HitResult.NO_EFFECT || calc.damage <= 0) {
        continue;
      }
      const dealt = Math.max(1, toDmgValue(calc.damage * spread));
      target.damageAndUpdate(dealt, { result: calc.result as DamageResult, source: pokemon });
      if (this.flinch && !target.isFainted()) {
        target.addTag(BattlerTagType.FLINCHED, 1, MoveId.EXPLOSION, pokemon.id);
      }
    }
  }

  /**
   * True when a Damp-class ability (`FieldPreventExplosiveMovesAbAttr`) is
   * active on any field Pokemon. Mirrors the move engine's own Damp check so a
   * Damp holder suppresses the detonation.
   */
  private static isExplosionBlocked(): boolean {
    const cancelled = new BooleanHolder(false);
    for (const p of globalScene.getField(true)) {
      applyAbAttrs("FieldPreventExplosiveMovesAbAttr", { pokemon: p, cancelled });
      if (cancelled.value) {
        return true;
      }
    }
    return false;
  }
}
