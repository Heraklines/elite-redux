/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: `priority-modifier` archetype primitive.
//
// Implements taxonomy entry #13 (~15 abilities). Parameterized AbAttr that
// adds a configurable priority delta to a Pokemon's outgoing move when the
// move matches a configured filter (type, flag, or unfiltered "any move"),
// optionally gated by a condition over the user's HP ratio.
//
// Base class: `ChangeMovePriorityAbAttr` — already used by Gale Wings,
// Prankster, Triage, Mycelium Might, Stall. The parent constructor takes a
// `(pokemon, move) => boolean` predicate plus a `changeAmount` integer; we
// build the predicate from the typed options object so callers get
// constructor-time validation and structured introspection.
//
// Sub-shapes covered:
//   - Type-keyed: `Galeforce Wings` ("Flying moves get +1 Priority")
//   - Flag-keyed: status of priority moves keyed by a `MoveFlags` bit
//   - HP-gated type-keyed: `Flaming Soul` / `Frozen Soul` / `Tidal Rush` —
//     "X-type moves get +1 priority at max HP" (or equivalent threshold)
//   - HP-gated flag-keyed: `Blitz Boxer` — "+1 priority to punching moves at
//     full HP"
//
// Sub-shapes intentionally NOT in this primitive (deferred):
//   - **First-move-each-entry**: `Sidewinder`/`Edgelord`/`Cutthroat` — needs
//     per-entry counter state on the Pokemon. Belongs in the `entry-effect`
//     archetype as the `first-move-priority` sub-effect (already wired,
//     pending integration). Documenting cross-reference for clarity.
//   - **First-turn-only priority**: `On the Prowl` — needs turn-counter
//     gating; will fold into priority-modifier once we expose `turnCount`
//     in the predicate signature (Phase C follow-up).
//   - **Priority-boost-side**: `Higher Rank` — "Priority moves get a 1.2x
//     boost" — that's a power boost gated on priority, not a priority mod;
//     belongs in `conditional-damage` once we add a `move-priority` gate.
//
// Examples (per taxonomy):
//   - `Galeforce Wings` — `new PriorityModifierAbAttr({
//       priority: 1, filter: { type: PokemonType.FLYING } })`
//   - `Flaming Soul` — `new PriorityModifierAbAttr({
//       priority: 1, filter: { type: PokemonType.FIRE },
//       condition: { kind: "full-hp" } })`
//   - `Blitz Boxer` — `new PriorityModifierAbAttr({
//       priority: 1, filter: { flag: MoveFlags.PUNCHING_MOVE },
//       condition: { kind: "full-hp" } })`
// =============================================================================

import { ChangeMovePriorityAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Filter narrowing which moves the priority bonus applies to. Exactly one of
 * {@linkcode type} or {@linkcode flag} should be provided in practice (if both
 * are present, BOTH must match). An empty filter (`{}`) matches every move —
 * useful for "first-move every entry" patterns once that condition lands.
 */
export interface PriorityModifierFilter {
  /** Move types that trigger the priority bonus. Omit to accept any type. */
  readonly type?: PokemonType;
  /** Move flag(s) that trigger the priority bonus. Omit to accept any flags. */
  readonly flag?: MoveFlags;
}

/**
 * Discriminated condition gating when the priority bonus fires. New
 * conditions should extend this union additively as we expand archetype
 * coverage.
 */
export type PriorityCondition =
  | { readonly kind: "always" }
  | { readonly kind: "full-hp" }
  | { readonly kind: "low-hp"; readonly threshold?: number };

/** Construction options for {@linkcode PriorityModifierAbAttr}. */
export interface PriorityModifierOptions {
  /**
   * The priority delta to apply. Typically `+1` (e.g. Gale Wings, Prankster);
   * may be negative (e.g. Stall). Must be a non-zero integer.
   */
  readonly priority: number;
  /** Move-side filter (type / flag). Omit to apply the bonus to any move. */
  readonly filter?: PriorityModifierFilter;
  /**
   * Condition over the user's state gating when the bonus fires. Defaults to
   * `{ kind: "always" }` — the bonus always fires when the filter matches.
   */
  readonly condition?: PriorityCondition;
}

/**
 * Parameterized `AbAttr` implementing the `priority-modifier` archetype.
 *
 * Used (or will be used) by ER abilities such as `Galeforce Wings` (vanilla
 * Gale Wings parity), `Flaming Soul`, `Frozen Soul`, `Early Grave`,
 * `Stygian Rush`, `Tidal Rush`, `Blitz Boxer`, `Volt Rush`, `Pretty
 * Privilege`, and similar typed/flagged priority abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode ChangeMovePriorityAbAttr}. The parent's
 * `canApply` runs our combined `(filter ∧ condition)` predicate, and the
 * parent's `apply` adds {@linkcode PriorityModifierOptions.priority} to the
 * holder. We avoid re-implementing apply/canApply by funneling the entire
 * gate through the parent's `moveFunc` slot.
 *
 * Note that the predicate runs at canApply-time, so it reads the user's CURRENT
 * HP ratio each dispatch — meaning a full-HP-gated boost correctly toggles
 * off the moment damage drops the user below the threshold. This matches the
 * Gale Wings semantics pokerogue already implements.
 */
export class PriorityModifierAbAttr extends ChangeMovePriorityAbAttr {
  private readonly priorityDelta: number;
  private readonly filter: PriorityModifierFilter;
  private readonly condition: PriorityCondition;

  constructor(opts: PriorityModifierOptions) {
    if (!Number.isInteger(opts.priority) || opts.priority === 0) {
      throw new Error(`[PriorityModifierAbAttr] priority must be a non-zero integer; got ${opts.priority}`);
    }
    if (opts.filter?.flag === MoveFlags.NONE) {
      throw new Error("[PriorityModifierAbAttr] filter.flag must be a non-NONE MoveFlags bit when set");
    }
    if (opts.condition?.kind === "low-hp") {
      const threshold = opts.condition.threshold ?? 0.5;
      if (!(threshold > 0 && threshold <= 1)) {
        throw new Error(`[PriorityModifierAbAttr] low-hp threshold must be in (0, 1]; got ${threshold}`);
      }
    }
    const filter = opts.filter ?? {};
    const condition = opts.condition ?? { kind: "always" };
    super(
      (pokemon: Pokemon, move: Move) =>
        PriorityModifierAbAttr.matchesFilter(filter, pokemon, move)
        && PriorityModifierAbAttr.matchesCondition(condition, pokemon),
      opts.priority,
    );
    this.priorityDelta = opts.priority;
    this.filter = filter;
    this.condition = condition;
  }

  /** The configured priority delta (read-only accessor). */
  public getPriority(): number {
    return this.priorityDelta;
  }

  /** The configured move filter (read-only accessor). */
  public getFilter(): PriorityModifierFilter {
    return this.filter;
  }

  /**
   * Read-only accessor for the configured condition (used in tests / introspection).
   * Named `getPriorityCondition` rather than `getCondition` to avoid shadowing the
   * base `AbAttr.getCondition(): AbAttrCondition | null` accessor (which returns
   * a wholly different shape — a `(pokemon) => boolean` predicate, not a discriminated
   * options object).
   */
  public getPriorityCondition(): PriorityCondition {
    return this.condition;
  }

  /**
   * Evaluate the filter against a candidate move. Both `type` and `flag`
   * (when present) must match; an empty filter matches every move.
   *
   * Exposed as a static so tests can verify the predicate in isolation and
   * future archetypes (e.g. `CompositeAbAttr`) can reuse the predicate
   * directly without re-implementing the type / flag bit-test.
   */
  public static matchesFilter(filter: PriorityModifierFilter, pokemon: Pokemon, move: Move): boolean {
    if (filter.type !== undefined && pokemon.getMoveType(move) !== filter.type) {
      return false;
    }
    if (filter.flag !== undefined && !move.hasFlag(filter.flag)) {
      return false;
    }
    return true;
  }

  /**
   * Evaluate the condition against the subject. `always` returns true,
   * `full-hp` checks `getHpRatio() === 1`, `low-hp` checks `getHpRatio() <=
   * threshold` (default `0.5`).
   */
  public static matchesCondition(condition: PriorityCondition, pokemon: Pokemon): boolean {
    switch (condition.kind) {
      case "always":
        return true;
      case "full-hp":
        return pokemon.isFullHp();
      case "low-hp":
        return pokemon.getHpRatio() <= (condition.threshold ?? 0.5);
    }
  }
}
