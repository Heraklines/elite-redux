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
import { ER_SEED_CONFIG, ErSeedModifier } from "#data/elite-redux/er-terrain-seeds";
import { PokemonMove } from "#data/moves/pokemon-move";
import type { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PokemonType } from "#enums/pokemon-type";
import type { BattleStat } from "#enums/stat";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { FieldEffectModifier } from "#modifiers/modifier";
import type { AbAttrBaseParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";

/**
 * Apply the holder's Terrain/Weather Extender (FieldEffectModifier, +2 turns per
 * stack) on top of an ER field summoner's fixed base duration. ER field
 * summoners (the surges) specify their own turn count, which would otherwise
 * bypass the extender in `arena.trySet{Terrain,Weather}` — this re-applies it so
 * e.g. Electro Surge's 8-turn Electric Terrain becomes 12 with the item. No-op
 * without the item (mirrors `erFieldTurnsWithItems` on the rebalance surge path).
 */
function extendFieldTurns(pokemon: Pokemon, baseTurns: number): number {
  const dur = new NumberHolder(baseTurns);
  globalScene.applyModifier(FieldEffectModifier, pokemon.isPlayer(), pokemon, dur);
  return dur.value;
}

/**
 * Discriminated union describing every payload the `entry-effect` archetype
 * can carry. New sub-shapes added in future C-phase tasks should extend this
 * union *additively* — never remove a kind that any registered ER ability
 * depends on.
 */
export type EntryEffect =
  | EntryEffectSetWeather
  | EntryEffectSetTerrain
  | EntryEffectSetTerrainRandom
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

/**
 * Set one of several terrains chosen at random on entry (e.g. Zen Garden:
 * Grassy or Psychic at 50/50). A held seed item can force a specific choice.
 */
export interface EntryEffectSetTerrainRandom {
  readonly kind: "set-terrain-random";
  /** Candidate terrains; one is picked via the holder's battle seed. */
  readonly terrains: readonly TerrainType[];
  /** Turns the terrain persists (>0 overrides pokerogue's default). */
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
  /**
   * Which side the hazard is laid on, relative to the holder. `"foe"` = the
   * opponent's side (the usual entry-hazard target, e.g. Hot Coals); `"self"` =
   * the holder's own side. @defaultValue `"both"` (legacy behaviour)
   */
  readonly side?: "self" | "foe" | "both";
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
  private readonly once: boolean;

  /**
   * @param effect The on-entry sub-effect to apply.
   * @param once When true, the effect fires only ONCE per battle (per wave) for
   *   the holder — re-entries during the same encounter are no-ops. Used by ER
   *   abilities like Royal Decree ("Glare on entry once per battle"). Tracked
   *   via {@linkcode PokemonWaveData.entryEffectsFired}.
   */
  constructor(effect: EntryEffect, once = false) {
    super(true);
    this.effect = effect;
    this.once = once;
  }

  /** Read-only accessor for the configured payload (used in tests). */
  public getEffect(): EntryEffect {
    return this.effect;
  }

  /** Whether this entry effect is gated to once-per-battle. */
  public isOnce(): boolean {
    return this.once;
  }

  /** Stable per-effect key for the once-per-battle tracker. */
  private onceKey(): string {
    const e = this.effect as unknown as Record<string, unknown>;
    const disc = e.move ?? e.type ?? e.weather ?? e.stat ?? "";
    return `entry-once:${this.effect.kind}:${String(disc)}`;
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
    // Once-per-battle gate: skip (and don't re-fire) if this effect already
    // fired this wave for the holder (survives switch-out/in within the wave).
    if (this.once) {
      const key = this.onceKey();
      if (pokemon.waveData.entryEffectsFired.has(key)) {
        return;
      }
      pokemon.waveData.entryEffectsFired.add(key);
    }
    switch (this.effect.kind) {
      case "set-weather":
        // `turns` (when > 0) overrides pokerogue's default 5-turn weather so ER
        // weathers keep their own duration (e.g. the new FOG's 8 turns). The
        // fixed override bypasses arena.trySetWeather's own extender hook, so the
        // Weather Extender (+2/stack) is re-applied here.
        globalScene.arena.trySetWeather(
          this.effect.weather,
          pokemon,
          this.effect.turns > 0 ? extendFieldTurns(pokemon, this.effect.turns) : undefined,
        );
        return;
      case "set-terrain":
        // `turns` (when > 0) overrides pokerogue's default 5-turn terrain so ER
        // terrains keep their own duration (e.g. Toxic/Electro Surge's 8 turns).
        // The fixed override bypasses arena.trySetTerrain's own extender hook, so
        // the Terrain Extender (+2/stack) is re-applied here (8 → 12).
        globalScene.arena.trySetTerrain(
          this.effect.terrain,
          false,
          pokemon,
          this.effect.turns > 0 ? extendFieldTurns(pokemon, this.effect.turns) : undefined,
        );
        return;
      case "set-terrain-random": {
        const choices = this.effect.terrains;
        if (choices.length === 0) {
          return;
        }
        // Zen Garden: a held terrain Seed (Grassy Seed / Psychic Seed) whose
        // terrain is one of the choices GUARANTEES that terrain; otherwise the
        // pick is random among the choices.
        const seed = pokemon
          .getHeldItems()
          .find(
            (m): m is ErSeedModifier => m instanceof ErSeedModifier && choices.includes(ER_SEED_CONFIG[m.kind].terrain),
          );
        const pick = seed ? ER_SEED_CONFIG[seed.kind].terrain : choices[pokemon.randBattleSeedInt(choices.length)];
        globalScene.arena.trySetTerrain(
          pick,
          false,
          pokemon,
          this.effect.turns > 0 ? extendFieldTurns(pokemon, this.effect.turns) : undefined,
        );
        return;
      }
      case "set-hazard": {
        const layers = this.effect.layers ?? 1;
        const sideOpt = this.effect.side ?? "both";
        const playerSide = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        const foeSide = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
        const side = sideOpt === "both" ? ArenaTagSide.BOTH : sideOpt === "self" ? playerSide : foeSide;
        // Foamy Web (er951): "Cannot activate if Sticky Web is already present on
        // the opponent's field." FOAMY_WEB is a distinct hazard type, so it would
        // otherwise stack with a real Sticky Web — no-op when one is already there.
        if (
          this.effect.hazard === ArenaTagType.FOAMY_WEB
          && globalScene.arena.getTagOnSide(ArenaTagType.STICKY_WEB, side)
        ) {
          return;
        }
        for (let i = 0; i < layers; i++) {
          globalScene.arena.addTag(this.effect.hazard, 0, undefined, pokemon.id, side);
        }
        return;
      }
      case "set-screen-or-room": {
        // Side screens (Aurora Veil / Reflect / Light Screen, e.g. North Wind)
        // protect the HOLDER's side only — default to it when no side is given.
        // Field-wide effects (Gravity / Trick Room / Magic Room) ignore the side
        // arg, so this is a no-op for them.
        const side = this.effect.side ?? (pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY);
        globalScene.arena.addTag(this.effect.tag, this.effect.turns, undefined, pokemon.id, side);
        return;
      }
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
        // first-move-priority still requires a per-move priority bracket
        // override hook that pokerogue doesn't expose generically — defer.
        return;
      case "scripted-move": {
        // Inject the configured move via MovePhase in INDIRECT mode (mirrors
        // Dancer's copy-move and other AbAttr-driven move spawns). The first
        // opponent is selected as the default target; status moves resolve
        // to the user's own side automatically via pokerogue's targeting.
        const opponents = pokemon.getOpponents().filter(o => o && !o.isFainted());
        const target = opponents[0]?.getBattlerIndex();
        const targets = target === undefined ? [pokemon.getBattlerIndex()] : [target];
        const pokemonMove = new PokemonMove(this.effect.move);
        globalScene.phaseManager.unshiftNew("MovePhase", pokemon, targets, pokemonMove, MoveUseMode.INDIRECT);
        return;
      }
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

    // ER ROM semantics: each Pokemon has at most 3 type slots (type1, type2,
    // type3). Type-adding abilities (Aquatic, Grounded, Ice Age, Half Drake,
    // Metallic, Dragonfly, Phantom, etc.) write to type3 ONLY IF the Pokemon
    // doesn't already have that type via type1/type2. Multiple add-type
    // abilities on the same Pokemon fight for the type3 slot — the most
    // recent one wins. Maximum is always exactly 3 types.
    //
    // We mirror this here: keep first 2 base types intact (slots 0/1), use
    // slot 2 for the added type. If the type already exists or the holder
    // is already pure-typed-as-this, no-op.

    // Get the holder's CURRENT effective types (respects any prior overrides).
    const current = summonData.types && summonData.types.length > 0 ? summonData.types : [...pokemon.getTypes()];

    // Already has this type → no-op (matches ER's `!IS_BATTLER_OF_TYPE` guard).
    if (current.includes(effect.type)) {
      summonData.types = current;
      return;
    }

    // ER's type3-slot model: at most 3 types total. Reuse the existing slot-2
    // if present (replace whatever's there), else append.
    if (current.length >= 3) {
      // Replace the last (slot-2 / type3) entry with the new type. This
      // matches ER's overwrite-on-conflict behavior when multiple add-type
      // abilities are active.
      summonData.types = [...current.slice(0, 2), effect.type];
    } else {
      summonData.types = [...current, effect.type];
    }
  }
}
