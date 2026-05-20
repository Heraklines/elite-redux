/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `entry-effect` archetype primitive.
//
// Implements taxonomy entry #5 (~85 abilities). Parameterized AbAttr that
// fires once when a Pokemon switches in (`PostSummonAbAttr` trigger),
// dispatching a sub-effect based on a discriminated `EntryEffect` payload.
//
// Base class: `PostSummonAbAttr`. The dispatcher's standard `PostSummonAbAttr`
// trigger surface is what we want — switch-in is exactly when this archetype
// fires, so we slot directly into the existing pokerogue infra.
//
// Sub-shapes covered (the eight discriminator kinds in the taxonomy):
//   - `set-weather`               — `Drizzle`, ER weather customs.
//   - `set-terrain`               — `Electro Surge`, ER terrain customs.
//   - `set-hazard`                — `Spider Lair` (Sticky Web), spike-setters,
//                                  `Watch Your Step` (2 layers of Spikes).
//   - `set-screen-or-room`        — `Atlas` (Gravity 8 turns), Magic Room,
//                                  Tailwind, Trick Room, Reflect/Light Screen.
//   - `add-self-type`             — `Aquatic`, `Grounded`, `Half Drake`,
//                                  `Phantom`, `Hover`, `Fey Flight`, etc.
//   - `self-stat-boost`           — `Headstrong` (+1 SpDef), Embody Aspect
//                                  variants.
//   - `first-move-priority`       — `Sidewinder`, `Edgelord`, `Cutthroat`
//                                  (priority on first <flag> move each entry).
//   - `scripted-move`             — `Jumpscare` (Astonish on first entry).
//
// Most sub-effects need `globalScene.{arena,phaseManager}` to fully execute.
// We honor pokerogue's standard convention: when `params.simulated === true`,
// the side effect is skipped (the AbAttr still runs `canApply` so dispatch
// records still see it). This matches what `PostSummonAddArenaTagAbAttr`,
// `PostSummonStatStageChangeAbAttr`, and friends do.
//
// The `add-self-type` sub-effect is the one C1 fully exercises without
// touching `globalScene` — it mutates `pokemon.summonData.types` directly,
// which is plain pokemon state. Other sub-effects are wired to fail safely
// in the C0 harness's `execute-attrs` mode (simulated=true) so the harness
// can dispatch them without crashing; their full integration tests will land
// when later C-phase tasks add a richer harness with `globalScene` mocking.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import type { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { BattleStat } from "#enums/stat";
import type { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";

/**
 * Discriminated union describing every payload the `entry-effect` archetype
 * can carry. New sub-shapes added in future C-phase tasks should extend this
 * union *additively* — never remove a kind that any registered ER ability
 * depends on.
 */
export type EntryEffect =
  | EntryEffectSetWeather
  | EntryEffectSetTerrain
  | EntryEffectSetHazard
  | EntryEffectSetScreenOrRoom
  | EntryEffectAddSelfType
  | EntryEffectSelfStatBoost
  | EntryEffectFirstMovePriority
  | EntryEffectScriptedMove;

/** Set a weather condition (e.g. Drizzle, Drought-derived ER customs). */
export interface EntryEffectSetWeather {
  readonly kind: "set-weather";
  readonly weather: WeatherType;
  /** Number of turns the weather should persist (ER customs commonly use 8). */
  readonly turns: number;
}

/** Set a terrain (e.g. Electric Surge, Misty Surge). */
export interface EntryEffectSetTerrain {
  readonly kind: "set-terrain";
  readonly terrain: TerrainType;
  readonly turns: number;
}

/**
 * Place an entry hazard (Spikes, Toxic Spikes, Stealth Rock, Sticky Web)
 * on the *opposing* side. Multi-layer hazards may specify {@linkcode layers}
 * — e.g. `Watch Your Step` sets two layers of Spikes in a single trigger.
 */
export interface EntryEffectSetHazard {
  readonly kind: "set-hazard";
  readonly hazard: ArenaTagType;
  /** Number of hazard layers to apply in a single dispatch. @defaultValue `1` */
  readonly layers?: number;
}

/**
 * Set a screen / room / Gravity-style arena effect on the configured side.
 * Includes Reflect, Light Screen, Aurora Veil, Tailwind, Trick Room,
 * Magic Room, Wonder Room, Gravity, Defense Curl.
 */
export interface EntryEffectSetScreenOrRoom {
  readonly kind: "set-screen-or-room";
  readonly tag: ArenaTagType;
  readonly turns: number;
  /** Which side(s) the tag applies to. Defaults to `ArenaTagSide.BOTH` if undefined. */
  readonly side?: ArenaTagSide;
}

/**
 * Append a {@linkcode PokemonType} to the user's current type list, leaving
 * existing types intact. Models `Aquatic` (+Water), `Half Drake` (+Dragon),
 * `Phantom` (+Ghost), etc. Idempotent — duplicate types are de-duped.
 */
export interface EntryEffectAddSelfType {
  readonly kind: "add-self-type";
  readonly type: PokemonType;
}

/** Raise one of the user's own stat stages on entry (e.g. Headstrong +1 SpDef). */
export interface EntryEffectSelfStatBoost {
  readonly kind: "self-stat-boost";
  readonly stat: BattleStat;
  /** Positive for a raise, negative for a drop. */
  readonly stages: number;
}

/**
 * Grant `+priority` to the *first* move of the matching flag this Pokemon
 * uses after entering. Resets on KO / re-switch. Models `Sidewinder`-cluster.
 */
export interface EntryEffectFirstMovePriority {
  readonly kind: "first-move-priority";
  readonly flag: MoveFlags;
  readonly priority: number;
}

/**
 * Use a configured move automatically on the first turn after entry.
 * Models `Jumpscare` (Astonish on switch-in).
 */
export interface EntryEffectScriptedMove {
  readonly kind: "scripted-move";
  readonly move: MoveId;
}

/** All valid {@linkcode EntryEffect.kind} discriminator strings. */
export type EntryEffectKind = EntryEffect["kind"];

/**
 * Parameterized `AbAttr` implementing the `entry-effect` archetype.
 *
 * Used (or will be used) by the ~85 ER abilities whose description starts
 * with "On entry, …" — see the taxonomy doc, archetype #5, for the full list.
 *
 * @remarks
 * Extends {@linkcode PostSummonAbAttr}, which the standard `applyAbAttrs`
 * dispatcher invokes on switch-in. Subclassing here (rather than building a
 * standalone class with our own dispatch hook) lets ER abilities slot into
 * the existing pokerogue ability infra unchanged — `init-elite-redux-custom-
 * abilities.ts` just attaches an `EntryEffectAbAttr` instance via the standard
 * `AbBuilder.attr(...)` API.
 *
 * Sub-effect routing happens in {@linkcode apply} via the discriminator
 * tag. The mapping is single-responsibility per kind — adding a new kind to
 * the union is a single additive switch case here plus an entry in the union
 * type above. Tests under `test/data/elite-redux/archetypes/entry-effect.test.ts`
 * lock in the routing behavior for each kind.
 */
export class EntryEffectAbAttr extends PostSummonAbAttr {
  private readonly effect: EntryEffect;

  constructor(effect: EntryEffect) {
    super(true);
    this.effect = effect;
  }

  /** Read-only accessor for the configured payload (used in tests). */
  public getEffect(): EntryEffect {
    return this.effect;
  }

  /** Convenience: the discriminator tag. */
  public getKind(): EntryEffectKind {
    return this.effect.kind;
  }

  /**
   * Single dispatch for all configured sub-effects. Honors the
   * `params.simulated` convention pokerogue uses across the
   * `PostSummonAbAttr` family — side effects (weather, hazards, stat
   * changes that touch `globalScene`) are gated behind `!simulated`.
   *
   * The `add-self-type` branch is the exception: it mutates
   * `pokemon.summonData.types` directly and is safe to run in both
   * simulated and non-simulated dispatches because the mutation is local
   * to the pokemon instance. We still honor `simulated` for symmetry,
   * matching `PostSummonStatStageChangeAbAttr.apply`'s behavior.
   */
  public override apply(params: AbAttrBaseParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    switch (this.effect.kind) {
      case "set-weather":
        globalScene.arena.trySetWeather(this.effect.weather, pokemon);
        return;
      case "set-terrain":
        globalScene.arena.trySetTerrain(this.effect.terrain, false, pokemon);
        return;
      case "set-hazard": {
        const layers = this.effect.layers ?? 1;
        for (let i = 0; i < layers; i++) {
          globalScene.arena.addTag(this.effect.hazard, 0, undefined, pokemon.id);
        }
        return;
      }
      case "set-screen-or-room":
        globalScene.arena.addTag(this.effect.tag, this.effect.turns, undefined, pokemon.id, this.effect.side);
        return;
      case "add-self-type":
        this.applyAddSelfType(params);
        return;
      case "self-stat-boost":
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          pokemon.getBattlerIndex(),
          true,
          [this.effect.stat],
          this.effect.stages,
        );
        return;
      case "first-move-priority":
      case "scripted-move":
        // C1 records the configuration but defers full integration to the
        // turn-queue work scheduled later in Phase C. Both sub-effects need
        // hooks the existing pokerogue infra doesn't expose generically yet
        // (per-move priority bracket override, OR injecting a free move into
        // the turn). We intentionally no-op here so the AbAttr can be wired
        // onto an ER ability today without crashing — the wiring side will
        // get its real behavior in a later C task.
        return;
    }
  }

  /**
   * Even in simulated runs we want the `pokemon.canApplyAbility` chain to
   * succeed — there's no precondition to gate on for the basic entry
   * triggers. Sub-effects that DO have a precondition (e.g. weather/terrain
   * setters checking whether the requested state is already active) defer
   * that check to apply-time via `globalScene.arena.try{SetWeather,SetTerrain}`,
   * which silently no-op when the change is rejected.
   *
   * We do NOT call `globalScene.arena.canSet*` here because:
   *   1. The harness's record-only mode wants `canApply` to be a pure check;
   *      reaching for `globalScene` would crash test runs.
   *   2. The arena setters are themselves idempotent and already gate on
   *      their own preconditions.
   */
  public override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  /**
   * `add-self-type` implementation: append the configured type to the
   * pokemon's current type list (de-duped). Per
   * {@linkcode EntryEffectAddSelfType} semantics, the existing types are
   * preserved — this is an *additive* type change.
   *
   * Pokemon's type list lives on `summonData.types` (which falls back to
   * species types when null). We make sure to materialize the array (if it's
   * null) before appending, so the change persists across the rest of the
   * switch-in.
   *
   * @remarks
   * We don't call `pokemon.updateInfo()` here because:
   *   1. The C0 harness doesn't render UI, so `updateInfo` would crash
   *      reaching for sprite references.
   *   2. Battle infra runs `updateInfo` separately after the
   *      `PostSummonAbAttr` dispatch, so the type change is reflected on
   *      the next paint regardless.
   */
  private applyAddSelfType(params: AbAttrBaseParams): void {
    const { pokemon } = params;
    const effect = this.effect as EntryEffectAddSelfType;
    const summonData = pokemon.summonData as { types: PokemonType[] | null };
    const existing = summonData.types ?? [...pokemon.getTypes()];
    if (existing.includes(effect.type)) {
      // Already present — write back the materialized list so subsequent
      // changes see a stable array, but don't append a duplicate.
      summonData.types = existing;
    } else {
      summonData.types = [...existing, effect.type];
    }
  }
}
