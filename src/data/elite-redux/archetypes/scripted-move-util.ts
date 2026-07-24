/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — scripted-move helper.
//
// Several ER abilities script a move at a REDUCED base power (e.g. Phantom
// Thief "40 BP Spectral Thief", Sand Pit "20 BP Sand Tomb", Frost Burn "40 BP
// Ice Beam"). The registered moves carry their full vanilla power, and the
// scripted-move primitives previously cast them at that full power — an
// unfaithful balance bug.
//
// `scriptedPokemonMove(moveId, power?)` returns a {@linkcode PokemonMove} the
// scripted-move primitives hand to `MovePhase`. With no `power` it is a plain
// PokemonMove (full power). With a `power` it returns a subclass whose
// `getMove()` yields a shallow CLONE of the registered move with `power`
// overridden — so the cast deals the ER-specified power while keeping the real
// move's type, target, attrs, animation, and name. Nothing global is mutated.
//
// The clone is built lazily on first `getMove()` (battle time), not at
// construction, because ability attrs are built during init BEFORE ER-custom
// moves are registered — a construction-time `allMoves[id]` read could be
// undefined for a custom scripted move.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { FirstMoveCondition } from "#data/moves/move-condition";
import { PokemonMove } from "#data/moves/pokemon-move";
import type { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import {
  HitHealAttr,
  HpPowerAttr,
  MagnitudePowerAttr,
  type Move,
  PreMoveMessageAttr,
  RechargeAttr,
  ScaledHpPowerAttr,
  // biome-ignore lint/suspicious/noImportCycles: Scripted move construction requires the concrete move attribute classes.
} from "#moves/move";
import { randSeedIntRange } from "#utils/common";
import type { NumberHolder } from "#utils/value-holder";
import i18next from "i18next";

export interface ScriptedMoveOptions {
  readonly alwaysHit?: boolean;
  readonly bypassFirstMoveCondition?: boolean;
  readonly magnitudeRange?: readonly [min: number, max: number];
  /**
   * Strip {@linkcode RechargeAttr} from the scripted cast so the holder is NOT
   * locked into a recharge turn afterwards. Used by ability-triggered casts of
   * recharge moves (Retribution Blow's 150 BP Hyper Beam: "no recharge period,
   * allowing normal actions next turn"). No-op for moves with no recharge.
   */
  readonly noRecharge?: boolean;
  /**
   * When set, replace the cloned move's {@linkcode HpPowerAttr} (vanilla's
   * hardcoded 150-BP-at-full-HP scaling, used by Eruption) with a
   * {@linkcode ScaledHpPowerAttr} whose base at full HP is this value. Used by
   * Volcano Rage's "50 BP Eruption follow-up that scales with HP".
   */
  readonly hpScaledBasePower?: number;
  /** Optional battle-only category override for an ability-scripted move. */
  readonly category?: MoveCategory;
  /** Optional battle-only primary type override for an ability-scripted move. */
  readonly type?: PokemonType;
  /**
   * Strip {@linkcode MoveFlags.REFLECTABLE} from the scripted cast so it is NOT
   * bounced back by Magic Bounce / Magic Coat onto the caster. Used by
   * ability-triggered casts of reflectable status moves at an opponent (e.g.
   * Telekinetic's on-entry Telekinesis): the ability forces the move ONTO the
   * opponent, so it must not behave like the holder chose to use a reflectable
   * move on a Magic-Bounce target. No-op for moves without the flag.
   */
  readonly nonReflectable?: boolean;
  /** Scales healing attrs on this scripted cast without mutating the registered move. */
  readonly healMultiplier?: number;
}

function getMagnitudeLevel(range: readonly [min: number, max: number]): number {
  let level = range[0];
  globalScene.executeWithSeedOffset(
    () => {
      level = randSeedIntRange(range[0], range[1]);
    },
    globalScene.currentBattle.turn << 6,
    globalScene.waveSeed,
  );
  return level;
}

export class ScriptedMagnitudePowerAttr extends MagnitudePowerAttr {
  private readonly min: number;
  private readonly max: number;

  constructor(min: number, max: number) {
    super();
    this.min = min;
    this.max = max;
  }

  override apply(_user: Pokemon, _target: Pokemon, _move: Move, args: [NumberHolder, ...unknown[]]): boolean {
    const powers = [10, 30, 50, 70, 90, 110, 150];
    args[0].value = powers[getMagnitudeLevel([this.min, this.max]) - 4];
    return true;
  }
}

class PowerOverriddenPokemonMove extends PokemonMove {
  private readonly power: number | undefined;
  private readonly alwaysHit: boolean;
  private readonly bypassFirstMoveCondition: boolean;
  private readonly magnitudeRange: readonly [min: number, max: number] | undefined;
  private readonly noRecharge: boolean;
  private readonly nonReflectable: boolean;
  private readonly hpScaledBasePower: number | undefined;
  private readonly category: MoveCategory | undefined;
  private readonly type: PokemonType | undefined;
  private readonly healMultiplier: number | undefined;
  private cached: Move | undefined;

  constructor(moveId: MoveId, power: number | undefined, opts: ScriptedMoveOptions) {
    super(moveId);
    this.power = power;
    this.alwaysHit = opts.alwaysHit ?? false;
    this.bypassFirstMoveCondition = opts.bypassFirstMoveCondition ?? false;
    this.magnitudeRange = opts.magnitudeRange;
    this.noRecharge = opts.noRecharge ?? false;
    this.hpScaledBasePower = opts.hpScaledBasePower;
    this.category = opts.category;
    this.type = opts.type;
    this.nonReflectable = opts.nonReflectable ?? false;
    this.healMultiplier = opts.healMultiplier;
  }

  public override getMove(): Move {
    if (this.cached === undefined) {
      const base = super.getMove();
      // Shallow-clone the registered Move: preserve its prototype (so methods
      // work) and copy own fields. `attrs`/`conditions` are shared by reference
      // — they're read-only during move execution — and only `power`/`accuracy`
      // are overridden. `calculateBattlePower` seeds the holder with
      // `this.power`, so the override takes effect for this cast alone.
      const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as Move;
      if (this.power !== undefined) {
        (clone as unknown as { power: number }).power = this.power;
      }
      if (this.category !== undefined) {
        (clone as unknown as { _category: MoveCategory })._category = this.category;
      }
      if (this.type !== undefined) {
        (clone as unknown as { _type: PokemonType })._type = this.type;
      }
      if (this.alwaysHit) {
        // accuracy -1 = "bypasses the accuracy check" (Swift/Aerial Ace style).
        (clone as unknown as { accuracy: number }).accuracy = -1;
      }
      if (this.bypassFirstMoveCondition) {
        const cloneConditions = clone as unknown as { conditionsSeq3: unknown[] };
        cloneConditions.conditionsSeq3 = cloneConditions.conditionsSeq3.filter(
          condition => !(condition instanceof FirstMoveCondition),
        );
      }
      if (this.noRecharge) {
        // Drop the recharge so the scripted cast doesn't lock the holder next turn.
        // A NEW array on the clone — the registered move's shared attrs are untouched.
        clone.attrs = clone.attrs.filter(attr => !(attr instanceof RechargeAttr));
      }
      if (this.hpScaledBasePower !== undefined) {
        // Swap the move's hardcoded-150 HpPowerAttr for a base-configurable one
        // (Volcano Rage's 50-BP Eruption). New array — shared attrs untouched.
        const base = this.hpScaledBasePower;
        clone.attrs = clone.attrs.map(attr => (attr instanceof HpPowerAttr ? new ScaledHpPowerAttr(base) : attr));
      }
      if (this.nonReflectable) {
        // Clear the REFLECTABLE bit on the clone's own `flags` number (copied by
        // value via Object.assign, so this never mutates the registered move).
        // An ability forced this move onto the opponent — Magic Bounce must not
        // bounce it back onto the holder as if the holder chose to use it.
        const cloneFlags = clone as unknown as { flags: number };
        cloneFlags.flags &= ~MoveFlags.REFLECTABLE;
      }
      if (this.healMultiplier !== undefined) {
        const multiplier = this.healMultiplier;
        clone.attrs = clone.attrs.map(attr =>
          attr instanceof HitHealAttr
            ? new HitHealAttr(attr.getHealRatio(), attr.getHealStat() ?? undefined, multiplier)
            : attr,
        );
      }
      if (this.magnitudeRange !== undefined) {
        const range = this.magnitudeRange;
        clone.attrs = clone.attrs.map(attr => {
          if (attr instanceof PreMoveMessageAttr) {
            return new PreMoveMessageAttr(() =>
              i18next.t("moveTriggers:magnitudeMessage", { magnitude: getMagnitudeLevel(range) }),
            );
          }
          if (attr instanceof MagnitudePowerAttr) {
            return new ScriptedMagnitudePowerAttr(range[0], range[1]);
          }
          return attr;
        });
      }
      this.cached = clone;
    }
    return this.cached;
  }
}

/**
 * Build the {@linkcode PokemonMove} a scripted-move ability casts.
 *
 * @param moveId - the move to cast.
 * @param power - optional ER-specified base power override. Omit to use the
 *   move's registered (full) power.
 * @param opts.alwaysHit - when true, the cast bypasses the accuracy check
 *   (accuracy -1) — e.g. Retribution Blow's Hyper Beam "cannot miss".
 */
export function scriptedPokemonMove(moveId: MoveId, power?: number, opts: ScriptedMoveOptions = {}): PokemonMove {
  const alwaysHit = opts.alwaysHit ?? false;
  const bypassFirstMoveCondition = opts.bypassFirstMoveCondition ?? false;
  const magnitudeRange = opts.magnitudeRange;
  const noRecharge = opts.noRecharge ?? false;
  const nonReflectable = opts.nonReflectable ?? false;
  return power === undefined
    && !alwaysHit
    && !bypassFirstMoveCondition
    && magnitudeRange === undefined
    && !noRecharge
    && !nonReflectable
    && opts.healMultiplier === undefined
    && opts.category === undefined
    && opts.type === undefined
    ? new PokemonMove(moveId)
    : new PowerOverriddenPokemonMove(moveId, power, opts);
}
