/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: `crit-mod` archetype primitive.
//
// Implements taxonomy entry #7 (~24 abilities). Parameterized AbAttr family
// covering critical-hit modifications:
//   - **Block crits** (Battle-Armor / Shell-Armor parity): the user is immune
//     to incoming crits.
//   - **Bonus crit-stage**: the user's outgoing crit stage gets +N, optionally
//     gated on a move filter (type / flag).
//   - **Crit-damage multiplier**: the user's crit damage is scaled by a
//     multiplier — either as the attacker (Sniper-style "1.5x" bonus) or
//     defender (Bad-Omen-style "1/4 damage from crits").
//
// Because pokerogue's crit-resolution pipeline splits across three trigger
// surfaces (`BlockCritAbAttr`, `BonusCritAbAttr`, `MultCritAbAttr`), we follow
// the same split with three sibling subclasses. A single mega-class would need
// to extend all three at once, which TypeScript doesn't allow, and the
// dispatcher routes via separate string keys anyway.
//
// Sub-shapes covered:
//   - `Battle Armor` (vanilla, ER variant): immune to crits.
//   - `Super Luck` (vanilla): +1 crit stage to outgoing moves.
//   - `Sniper` (vanilla): crits do 1.5x bonus damage.
//   - `Bad Omen` (ER): takes 1/4 damage from crits (defender-side mult).
//   - Flag-gated crit-stage bonuses (Edge-/cleave-flag boosters that grant +1
//     crit for slashing moves).
//
// Sub-shapes intentionally NOT in this primitive (deferred):
//   - **Crit-on-condition** (`Merciless`-style "always crit poisoned target"):
//     pokerogue has `ConditionalCritAbAttr` which we could wrap, but the
//     condition shapes ER uses (sleeping, confused, super-effective) are
//     better expressed via the `conditional-damage` archetype's existing
//     `DamageCondition` discriminator. Wiring the `ConditionalCritAbAttr`
//     parent here is straightforward but the *use cases* belong with the
//     conditional-damage layer.
//   - **Crit-stat-change-on-receive** (`Anger Point`-style "+12 attack
//     stages when crit"): handled by `PostReceiveCritStatStageChangeAbAttr`
//     and belongs in the `stat-trigger-on-event` archetype (already implemented
//     as part of C1b — see {@linkcode StatTriggerOnHitAbAttr} for the broader
//     "on hit" surface).
//   - **Crit-effectiveness override** (`Overrule`-style "crits ignore
//     abilities + 2x vs resists"): composite of `MoveAbilityBypassAbAttr` +
//     `MultCritAbAttr` with a condition closure. Handled via `CompositeAbAttr`
//     (Phase C1f / final composite step).
//
// Examples (per taxonomy):
//   - `Battle Armor` — `new CritImmunityAbAttr()`
//   - `Super Luck` — `new CritStageBonusAbAttr({ bonus: 1 })`
//   - `Sniper` — `new CritDamageMultiplierAbAttr({ multiplier: 1.5 })`
//   - `Bad Omen` — composes a CritImmunity-free reduction; full case is
//     wired bespoke since the damage-side path differs from the parent's.
//   - Slashing-flag-keyed +1 crit — `new CritStageBonusAbAttr({ bonus: 1,
//       filter: { flag: MoveFlags.SLICING_MOVE } })`
// =============================================================================

import { BlockCritAbAttr, BonusCritAbAttr, MultCritAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Move filter narrowing which moves a crit-stage bonus applies to. Exactly
 * one of {@linkcode type} or {@linkcode flag} should be provided in practice;
 * if both are present, BOTH must match. An empty filter (`{}`) matches every
 * move — the default for Super-Luck-style "all moves" abilities.
 */
export interface CritModFilter {
  /** Move type that triggers the crit-stage bonus. Omit to accept any type. */
  readonly type?: PokemonType;
  /** Move flag(s) that trigger the crit-stage bonus. Omit to accept any flags. */
  readonly flag?: MoveFlags;
  /** Specific move ids that trigger the bonus. Omit to accept any move id. */
  readonly moveIds?: readonly MoveId[];
  /**
   * Only moves whose base power is `<=` this value trigger the bonus (e.g.
   * Perfectionist's "+1 crit stage for moves with 50 BP or lower"). Omit for
   * no base-power gate.
   */
  readonly maxBasePower?: number;
}

// -----------------------------------------------------------------------------
// CritImmunityAbAttr — Battle-Armor parity.
// -----------------------------------------------------------------------------

/**
 * Parameterized `AbAttr` implementing the "immune to incoming crits"
 * sub-shape of the `crit-mod` archetype.
 *
 * Used by vanilla `Battle Armor`, `Shell Armor` (both pokerogue parents
 * already exist), and ER variants like `Crust Coat` / `Dream State` (composite
 * with damage-reduction).
 *
 * @remarks
 * Thin parameterless wrapper around pokerogue's {@linkcode BlockCritAbAttr}.
 * We export it from the archetype layer so the wire-up can construct it via
 * the same `new ArchetypeAbAttr(opts)` pattern as every other primitive —
 * even though there are no options, the construction style is symmetric.
 */
export class CritImmunityAbAttr extends BlockCritAbAttr {}

// -----------------------------------------------------------------------------
// CritStageBonusAbAttr — Super-Luck parity, with optional move filter.
// -----------------------------------------------------------------------------

/** Construction options for {@linkcode CritStageBonusAbAttr}. */
export interface CritStageBonusOptions {
  /**
   * Number of crit-stages to add. Typically `1` (Super Luck); some ER customs
   * use `2`. Must be a positive integer.
   */
  readonly bonus: number;
  /**
   * Optional move filter. Omit to apply the bonus to every outgoing move
   * (Super Luck behavior). When set, only moves matching the filter receive
   * the bonus.
   */
  readonly filter?: CritModFilter;
}

/**
 * Parameterized `AbAttr` implementing the "+N crit-stage" sub-shape of the
 * `crit-mod` archetype.
 *
 * Used by vanilla `Super Luck` (+1 to all moves) and ER customs that gate the
 * bonus on a flag (e.g. "+1 crit for slashing moves").
 *
 * @remarks
 * Extends pokerogue's {@linkcode BonusCritAbAttr}. The parent always adds 1
 * to `critStage.value`; we override `apply` to add {@linkcode bonus}, and
 * override `canApply` to gate on the filter. This is a clean superset of the
 * parent's behavior — `bonus=1, filter={}` reproduces vanilla Super Luck.
 *
 * Note that the parent doesn't define `canApply` (defaults to `true` from the
 * `AbAttr` base), and its `constructor()` takes no arguments. We pass through
 * via `super()` and then validate and store our typed options.
 */
export class CritStageBonusAbAttr extends BonusCritAbAttr {
  private readonly bonusAmount: number;
  private readonly bonusFilter: CritModFilter;

  constructor(opts: CritStageBonusOptions) {
    if (!Number.isInteger(opts.bonus) || opts.bonus < 1) {
      throw new Error(`[CritStageBonusAbAttr] bonus must be a positive integer; got ${opts.bonus}`);
    }
    if (opts.filter?.flag === MoveFlags.NONE) {
      throw new Error("[CritStageBonusAbAttr] filter.flag must be a non-NONE MoveFlags bit when set");
    }
    super();
    this.bonusAmount = opts.bonus;
    this.bonusFilter = opts.filter ?? {};
  }

  /** Read-only accessor for the configured crit-stage bonus. */
  public getBonus(): number {
    return this.bonusAmount;
  }

  /** Read-only accessor for the configured move filter. */
  public getFilter(): CritModFilter {
    return this.bonusFilter;
  }

  /**
   * canApply: gates on the move filter. Empty filter passes for any move.
   * Note: the runtime params include `pokemon` (user) and `move` (the outgoing
   * move) per the {@linkcode BonusCritAbAttrParams} shape extended via the
   * dispatcher. We duck-type via the params object since pokerogue passes
   * additional contextual fields in real dispatches.
   */
  public override canApply(params: Parameters<BonusCritAbAttr["canApply"]>[0]): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const ctx = params as unknown as { pokemon?: Pokemon; move?: Move };
    if (ctx.pokemon === undefined || ctx.move === undefined) {
      // Defensive: if the dispatcher didn't include pokemon/move, default to
      // passing the gate (matches the parent's unconditional fire).
      return true;
    }
    return CritStageBonusAbAttr.matchesFilter(this.bonusFilter, ctx.pokemon, ctx.move);
  }

  /** Apply: add the configured bonus to the crit-stage holder. */
  public override apply(params: Parameters<BonusCritAbAttr["apply"]>[0]): void {
    params.critStage.value += this.bonusAmount;
  }

  /**
   * Evaluate the filter against a candidate move. Both `type` and `flag`
   * (when present) must match; an empty filter matches every move.
   *
   * Exposed as a static so tests can verify the predicate in isolation and
   * future archetypes (composite, conditional-damage) can reuse it without
   * re-implementing the type / flag bit-test.
   */
  public static matchesFilter(filter: CritModFilter, pokemon: Pokemon, move: Move): boolean {
    if (filter.type !== undefined && pokemon.getMoveType(move) !== filter.type) {
      return false;
    }
    if (filter.flag !== undefined && !move.hasFlag(filter.flag)) {
      return false;
    }
    if (filter.moveIds !== undefined && !filter.moveIds.includes(move.id)) {
      return false;
    }
    if (filter.maxBasePower !== undefined && move.power > filter.maxBasePower) {
      return false;
    }
    return true;
  }
}

// -----------------------------------------------------------------------------
// CritDamageMultiplierAbAttr — Sniper parity.
// -----------------------------------------------------------------------------

/** Construction options for {@linkcode CritDamageMultiplierAbAttr}. */
export interface CritDamageMultiplierOptions {
  /**
   * Damage multiplier applied to a crit hit. Typical values:
   *   - `1.5` → Sniper (50% bonus crit damage).
   *   - `2`   → ER customs.
   * Must be > 1 (this primitive amplifies; for incoming-crit damage reduction
   * the symmetrical class wires via the defender-side hook — currently bespoke
   * since pokerogue routes attacker-side crit-damage through `MultCritAbAttr`
   * and defender-side crit-damage reduction has no shared parent).
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the "amplify crit damage" sub-shape of
 * the `crit-mod` archetype.
 *
 * Used by vanilla `Sniper` (1.5x crit damage) and ER customs amplifying or
 * dampening crit damage on the attacker side.
 *
 * @remarks
 * Extends pokerogue's {@linkcode MultCritAbAttr}. The parent's constructor
 * takes a positional `multAmount`; we wrap typed-options for parity with the
 * rest of the archetype layer and add validation: reject multipliers ≤ 1
 * (Sniper amplifies, doesn't reduce — defender-side crit reduction has a
 * different hook surface and would need a separate class).
 */
export class CritDamageMultiplierAbAttr extends MultCritAbAttr {
  private readonly configuredMultiplier: number;

  constructor(opts: CritDamageMultiplierOptions) {
    if (!(opts.multiplier > 1)) {
      throw new Error(
        `[CritDamageMultiplierAbAttr] multiplier must be > 1 (this primitive amplifies crit damage); got ${opts.multiplier}`,
      );
    }
    super(opts.multiplier);
    this.configuredMultiplier = opts.multiplier;
  }

  /** Read-only accessor for the configured crit-damage multiplier. */
  public getMultiplier(): number {
    return this.configuredMultiplier;
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to any subclass of this
 * archetype generically. Mirrors the pattern in `weather-terrain-interaction`,
 * `status-immunity`, etc.
 */
export type CritMod = CritImmunityAbAttr | CritStageBonusAbAttr | CritDamageMultiplierAbAttr;
