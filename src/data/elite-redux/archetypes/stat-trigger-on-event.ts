/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `stat-trigger-on-event` archetype primitive.
//
// Implements taxonomy entry #9 (~50 ER abilities). Parameterized AbAttr family
// that fires a configured "raise/lower STATs by N stages" payload when a
// specific battle event occurs. The trigger event is the primary axis of the
// archetype, so we model it as a discriminated union *of subclasses* — each
// subclass extends the right pokerogue base class for that trigger surface:
//
//   - `StatTriggerOnKoAbAttr`        extends `PostKnockOutAbAttr`
//   - `StatTriggerOnHitAbAttr`       extends `PostDefendAbAttr`
//   - `StatTriggerOnEntryAbAttr`     extends `PostSummonAbAttr`
//   - `StatTriggerOnStatLoweredAbAttr` extends `PostStatStageChangeAbAttr`
//
// Picking subclasses over a single mega-class keeps each implementation small,
// matches what pokerogue's existing infra does (`PostKnockOutStatStageChange-
// AbAttr`, `PostDefendStatStageChangeAbAttr`, `PostSummonStatStageChangeAbAttr`
// are all separate concrete classes), and lets the dispatcher route them via
// the standard `applyAbAttrs("PostKnockOutAbAttr", …)` / etc. keys without
// any custom routing layer.
//
// The shared payload — *which* stats change by *how many* stages — lives in
// {@linkcode StatChange} and {@linkcode StatTriggerPayload}. Every subclass
// reads the same payload at construction time and dispatches the same
// `StatStageChangePhase` in apply. Sub-shape-specific predicates (e.g.
// "only fire when hit by Flying-type" for `Inflatable`, or "only fire when a
// stat is lowered by another source" for `Narcissist`) live in optional
// `filter` predicates.
//
// Examples (per taxonomy entry #9):
//   - `Chilling Neigh` — `new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] })`
//   - `Inflatable` — `new StatTriggerOnHitAbAttr({
//       stats: [{ stat: Stat.DEF, stages: 1 }, { stat: Stat.SPDEF, stages: 1 }],
//       filter: { types: [PokemonType.FLYING, PokemonType.FIRE] },
//     })`
//   - `Headstrong` — `new StatTriggerOnEntryAbAttr({ stats: [{ stat: Stat.SPDEF, stages: 1 }] })`
//   - `Narcissist` — `new StatTriggerOnStatLoweredAbAttr({
//       stats: [{ stat: Stat.ATK, stages: 2 }, { stat: Stat.SPATK, stages: 2 }],
//     })`
//
// Sub-shapes NOT covered in C1b (deferred to later C tasks):
//   - On foe-raise (`Egoist`) — pokerogue has no generic "another pokemon
//     raised stats" hook surfacing as an `AbAttr`. Tracked as a Phase-C gap.
//   - First-turn / passive triggers (`Violent Rush`, `Rapid Response`,
//     `Whiteout`) — these are weather/turn-counter conditional and overlap
//     with `weather-or-terrain-interaction` (archetype #23). They get their
//     own implementation when that archetype lands.
//   - Weather-conditional (`Raging Storm`) — same reasoning as above.
//
// The "on-hit" sub-shape DOES support an optional `filter` for `types` /
// `flags` (Inflatable needs this for "if hit by Flying or Fire moves"), but
// HP-threshold gating is deferred — none of the canonical C1b targets need
// it. Note also that we use `EffectiveStat` for the `stat` payload to match
// what pokerogue's `StatStageChangePhase` accepts.
// =============================================================================

import {
  PostDefendAbAttr,
  PostKnockOutAbAttr,
  type PostKnockOutAbAttrParams,
  type PostMoveInteractionAbAttrParams,
  PostStatStageChangeAbAttr,
  type PostStatStageChangeAbAttrParams,
  PostSummonAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { HitResult } from "#enums/hit-result";
import type { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { BattleStat } from "#enums/stat";
import type { AbAttrBaseParams } from "#types/ability-types";

/** A single stat-stage delta the trigger applies to the subject Pokemon. */
export interface StatChange {
  /** The {@linkcode BattleStat} to mutate. */
  readonly stat: BattleStat;
  /** Positive for a raise, negative for a drop. Must be non-zero. */
  readonly stages: number;
}

/**
 * Filter narrowing when an on-hit trigger should fire. All members are
 * optional and combine with **OR** semantics within each list and **AND**
 * across lists — i.e. `{ types: [FIRE, FLYING] }` means "any move of type Fire
 * OR Flying", and `{ types: [...], flags: [...] }` means "the move's type is
 * one of `types` AND it carries one of `flags`".
 */
export interface OnHitFilter {
  /** Move types that trigger the proc. Omit to accept any type. */
  readonly types?: readonly PokemonType[];
  /** Move flags that trigger the proc. Omit to accept any flags. */
  readonly flags?: readonly MoveFlags[];
}

/** Construction payload shared by every {@linkcode StatTriggerOnEventAbAttr} variant. */
export interface StatTriggerPayload {
  /** One or more stat-stage deltas to apply when the trigger fires. */
  readonly stats: readonly StatChange[];
}

/** {@linkcode StatTriggerOnKoAbAttr} payload — adds the KO-credit opt-out. */
export interface StatTriggerOnKoPayload extends StatTriggerPayload {
  /**
   * When `false`/omitted (the default), the trigger only fires if THIS Pokemon
   * is credited with the knockout — Moxie/Hubris/Chilling Neigh semantics.
   *
   * When `true`, it fires whenever ANY Pokemon faints anywhere on the field,
   * including allies and enemies. ER's `Forsaken Heart` is the only ability
   * that wants this ("Raises Attack by one stage when any Pokemon faints on
   * the battlefield, including allies and enemies").
   */
  readonly triggerOnAnyFaint?: boolean;
}

/** {@linkcode StatTriggerOnHitAbAttr} payload — adds an optional on-hit filter. */
export interface StatTriggerOnHitPayload extends StatTriggerPayload {
  /** Optional filter for which incoming moves trigger the proc. Omit for "any hit". */
  readonly filter?: OnHitFilter;
}

/** Discriminator enum for the four trigger surfaces this archetype supports. */
export type StatTriggerEvent = "on-ko" | "on-hit" | "on-entry" | "on-stat-lowered";

/**
 * Validate a payload's stat-change list — throws if any entry has a zero
 * delta. Used by every subclass's constructor.
 */
function validateStatChanges(label: string, stats: readonly StatChange[]): void {
  if (stats.length === 0) {
    throw new Error(`[${label}] payload must include at least one stat change`);
  }
  for (const change of stats) {
    if (change.stages === 0) {
      throw new Error(`[${label}] stages must be non-zero; got 0 for stat ${change.stat}`);
    }
  }
}

/**
 * Dispatch a `StatStageChangePhase` for every change in {@linkcode stats}.
 * Pokerogue's phase manager already collapses same-stage same-frame deltas
 * into a single animation, so we just unshift one phase per change.
 *
 * @param params - The standard ability-apply params (we need the subject's
 *   {@linkcode AbAttrBaseParams.pokemon} and {@linkcode AbAttrBaseParams.simulated}).
 * @param stats - The configured stat changes.
 */
function applyStatChanges(params: AbAttrBaseParams, stats: readonly StatChange[]): void {
  if (params.simulated) {
    return;
  }
  for (const change of stats) {
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      params.pokemon.getBattlerIndex(),
      true,
      [change.stat],
      change.stages,
    );
  }
}

/**
 * `StatTriggerOnEventAbAttr` — base for all four subclasses; carries the
 * payload + discriminator. Subclasses extend the right pokerogue ancestor
 * (PostKnockOut, PostDefend, PostSummon, PostStatStageChange) and forward to
 * {@linkcode applyStatChanges}.
 *
 * This base class isn't instantiable directly — concrete subclasses are
 * exported for the wire-up layer to use.
 */
export interface StatTriggerOnEventAbAttr {
  /** The discriminator tag for which event surface this trigger uses. */
  readonly event: StatTriggerEvent;
  /** Read-only accessor for the configured stat deltas. */
  getStatChanges(): readonly StatChange[];
}

/**
 * Stat-trigger on KO — fires when *another* Pokemon (typically a foe the
 * subject just KO'd) faints. Used by `Chilling Neigh`, `Adrenaline Rush`,
 * `Hubris`, `Breezy Neigh`, `Super Strain`, and similar.
 *
 * @remarks
 * Extends {@linkcode PostKnockOutAbAttr}, which is dispatched from
 * `faint-phase.ts` for every still-alive Pokemon when one faints. Because that
 * fires for the holder even when a TEAMMATE faints, `canApply` is overridden to
 * require (by default) that the holder is the one credited with the KO
 * (Moxie/Hubris-style). `Forsaken Heart` opts out via `triggerOnAnyFaint`.
 */
export class StatTriggerOnKoAbAttr extends PostKnockOutAbAttr implements StatTriggerOnEventAbAttr {
  public readonly event: StatTriggerEvent = "on-ko";
  private readonly stats: readonly StatChange[];
  private readonly triggerOnAnyFaint: boolean;

  constructor(payload: StatTriggerOnKoPayload) {
    super();
    validateStatChanges("StatTriggerOnKoAbAttr", payload.stats);
    this.stats = payload.stats;
    this.triggerOnAnyFaint = payload.triggerOnAnyFaint ?? false;
  }

  public getStatChanges(): readonly StatChange[] {
    return this.stats;
  }

  /**
   * Moxie/Hubris semantics: only fire when THIS Pokemon landed the knockout -
   * NOT when a teammate (or the foe's own mon) faints. `faint-phase` applies
   * `PostKnockOutAbAttr` to EVERY on-field Pokemon when one faints, so without
   * this gate the holder would boost off an ally's death. The victim's most
   * recent attacker is the mon credited with the KO; require it to be us.
   *
   * `Forsaken Heart` sets `triggerOnAnyFaint` and skips the gate: it boosts on
   * any faint anywhere on the field, by design.
   */
  public override canApply(params: PostKnockOutAbAttrParams): boolean {
    if (this.triggerOnAnyFaint) {
      return true;
    }
    if (params.victim === params.pokemon) {
      return false;
    }
    return params.victim.turnData?.attacksReceived?.[0]?.sourceId === params.pokemon.id;
  }

  public override apply(params: PostKnockOutAbAttrParams): void {
    applyStatChanges(params, this.stats);
  }
}

/**
 * Stat-trigger on hit — fires when the subject takes damage from a move,
 * optionally gated on the incoming move's type and/or flag bits. Used by
 * `Inflatable` ("+1 Def/SpDef if hit by Flying or Fire"), `Furnace` ("+2
 * Speed when hit by rocks"), and a handful of similar reactive boosters.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. Pokerogue dispatches PostDefend
 * after a move resolves on the defender, so the `move` field on the params
 * gives us what we need for the type/flag filter. The filter is *both*-ish:
 * `types` and `flags` are independently OR-ed and then AND-ed together —
 * matching the `Inflatable` description "if hit by Flying or Fire MOVES"
 * (where Flying or Fire is the type set; the flag set is empty).
 */
export class StatTriggerOnHitAbAttr extends PostDefendAbAttr implements StatTriggerOnEventAbAttr {
  public readonly event: StatTriggerEvent = "on-hit";
  private readonly stats: readonly StatChange[];
  private readonly filter: OnHitFilter | null;

  constructor(payload: StatTriggerOnHitPayload) {
    super();
    validateStatChanges("StatTriggerOnHitAbAttr", payload.stats);
    this.stats = payload.stats;
    this.filter = payload.filter ?? null;
  }

  public getStatChanges(): readonly StatChange[] {
    return this.stats;
  }

  /** Read-only accessor for the configured on-hit filter (may be null). */
  public getFilter(): OnHitFilter | null {
    return this.filter;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    // Must be a damaging move that actually connected (HitResult < NO_EFFECT).
    if (params.hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    if (this.filter === null) {
      return true;
    }
    const moveType = params.opponent.getMoveType(params.move);
    const typesOk = this.filter.types === undefined || this.filter.types.includes(moveType);
    if (!typesOk) {
      return false;
    }
    const flagsOk = this.filter.flags === undefined || this.filter.flags.some(flag => params.move.hasFlag(flag));
    return flagsOk;
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    applyStatChanges(params, this.stats);
  }
}

/**
 * Stat-trigger on entry — fires once when the subject switches in. Used by
 * `Headstrong` ("+1 SpDef on entry") and the four `Embody Aspect` variants.
 *
 * @remarks
 * Extends {@linkcode PostSummonAbAttr}, which is the canonical "switch-in
 * effect" surface. We deliberately do NOT extend {@linkcode EntryEffectAbAttr}
 * even though that archetype also covers self-stat-boost on entry — keeping
 * the two as siblings means the wire-up layer can pick whichever has the
 * better ergonomics for a given ability description. `EntryEffect`'s
 * `self-stat-boost` variant carries a single stat; this one supports a list.
 *
 * The pattern follows pokerogue's existing `PostSummonStatStageChangeAbAttr`,
 * but here we use a `StatChange[]` payload so multi-stat triggers (e.g.
 * `Headstrong` doesn't, but Embody Aspect Cornerstone does) configure
 * symmetrically with the other on-event variants.
 */
export class StatTriggerOnEntryAbAttr extends PostSummonAbAttr implements StatTriggerOnEventAbAttr {
  public readonly event: StatTriggerEvent = "on-entry";
  private readonly stats: readonly StatChange[];

  constructor(payload: StatTriggerPayload) {
    super(true);
    validateStatChanges("StatTriggerOnEntryAbAttr", payload.stats);
    this.stats = payload.stats;
  }

  public getStatChanges(): readonly StatChange[] {
    return this.stats;
  }

  public override apply(params: AbAttrBaseParams): void {
    applyStatChanges(params, this.stats);
  }
}

/**
 * Stat-trigger on stat-lowered — fires whenever any of the subject's stats
 * gets a negative delta from a foreign source. Used by `Narcissist` ("when a
 * stat is lowered, sharply raise both offenses"), `Tactical Retreat`, and
 * similar "Defiant"-flavored abilities.
 *
 * @remarks
 * Extends {@linkcode PostStatStageChangeAbAttr}. Pokerogue's
 * `PostStatStageChangeStatStageChangeAbAttr` is the canonical Defiant-style
 * implementation; this archetype generalizes it via the `stats` list payload.
 * Both `canApply` and `apply` filter on `stages < 0` so a raise on the same
 * Pokemon doesn't re-trigger the chain.
 *
 * Note: `PostStatStageChangeAbAttrParams.selfTarget` is the pokerogue-named
 * field for "the lowering originated from the subject itself" — abilities
 * like Defiant exclude that case so a Pokemon's own Close Combat doesn't
 * trigger its Defiant boost. We follow the same convention.
 */
export class StatTriggerOnStatLoweredAbAttr extends PostStatStageChangeAbAttr implements StatTriggerOnEventAbAttr {
  public readonly event: StatTriggerEvent = "on-stat-lowered";
  private readonly stats: readonly StatChange[];

  constructor(payload: StatTriggerPayload) {
    super();
    validateStatChanges("StatTriggerOnStatLoweredAbAttr", payload.stats);
    this.stats = payload.stats;
  }

  public getStatChanges(): readonly StatChange[] {
    return this.stats;
  }

  public override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    // Only fire when the *originating* change was a drop and the drop came
    // from another source (not the subject's own self-targeting move).
    return params.stages < 0 && !params.selfTarget;
  }

  public override apply(params: PostStatStageChangeAbAttrParams): void {
    applyStatChanges(params, this.stats);
  }
}
