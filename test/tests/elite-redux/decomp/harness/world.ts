/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The L1 world: a real battle's Pokemon (never mocks), a deterministic state grid driven by declared
// probes, and the engine-parameter builders that let the L1 differential call `canApply` on original
// and rebuilt attrs.
//
// The grid is "one factor at a time plus HP sweeps": every HP boundary value (full, full-1, 99%, 50%
// +-1 HP, 35% +-1 HP, 25%, 1 HP and every value a declaration's `probes` names) is crossed with the
// status / weather / stage / type variants that matter, instead of a full cartesian product. The
// world is mutated once per state and every binding is evaluated inside that state.

import { allMoves } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { Terrain, TerrainType } from "#data/terrain";
import { Weather } from "#data/weather";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";

export type AxisValue = string | number | boolean;
export type Axes = Readonly<Record<string, AxisValue>>;

/** hp values: "max", "max-N", a number, "N%", "N%+K", "N%-K" (percent of max HP rounded up, then offset). */
export function resolveHp(value: AxisValue, max: number): number {
  if (typeof value === "number") {
    return Math.max(1, Math.min(max, value));
  }
  if (value === "max") {
    return max;
  }
  const relative = /^max-(\d+)$/.exec(value as string);
  if (relative !== null) {
    return Math.max(1, max - Number(relative[1]));
  }
  const percent = /^(\d+(?:\.\d+)?)%([+-]\d+)?$/.exec(value as string);
  if (percent !== null) {
    return Math.max(1, Math.min(max, Math.ceil((max * Number(percent[1])) / 100) + Number(percent[2] ?? 0)));
  }
  throw new Error(`the hp value "${String(value)}" is not understood (use max, max-N, a number, or N%, N%+1, N%-1)`);
}

// ---------------------------------------------------------------------------------------------
// State setters (also used by the L2 scenarios)

export function setStatusOf(mon: Pokemon, effect: StatusEffect): void {
  mon.status = effect === StatusEffect.NONE ? null : new Status(effect);
}

export function setWeatherOf(game: GameManager, weather: WeatherType): void {
  const arena = game.scene.arena;
  arena.weather = weather === WeatherType.NONE ? null : new Weather(weather, 5, 5);
}

export function setTerrainOf(game: GameManager, terrain: TerrainType): void {
  const arena = game.scene.arena;
  arena.terrain = terrain === TerrainType.NONE ? null : new Terrain(terrain, 5, 5);
}

export function setTypesOf(mon: Pokemon, types: readonly PokemonType[] | undefined): void {
  mon.summonData.types = types === undefined ? [] : [...types];
}

// ---------------------------------------------------------------------------------------------
// The grid

export interface GridState {
  readonly name: string;
  readonly hp: AxisValue;
  readonly foeHp: AxisValue;
  readonly status: StatusEffect;
  readonly weather: WeatherType;
  readonly terrain: TerrainType;
  readonly atkStage: number;
  readonly defStage: number;
  readonly holderTypes: readonly PokemonType[] | undefined;
  readonly foeTypes: readonly PokemonType[] | undefined;
}

const HP_BOUNDARIES: readonly AxisValue[] = [
  "max",
  "max-1",
  "99%",
  "75%",
  "51%",
  "50%+1",
  "50%",
  "50%-1",
  "35%+1",
  "35%",
  "35%-1",
  "25%",
  1,
];

const BASE: GridState = {
  name: "base",
  hp: "max",
  foeHp: "max",
  status: StatusEffect.NONE,
  weather: WeatherType.NONE,
  terrain: TerrainType.NONE,
  atkStage: 0,
  defStage: 0,
  holderTypes: undefined,
  foeTypes: undefined,
};

/** Probe axes of the declarations under test, merged: `hp` values become extra HP boundary states. */
export function extraHpValues(
  probeAxes: readonly Axes[] | readonly Record<string, readonly AxisValue[]>[],
): AxisValue[] {
  const values: AxisValue[] = [];
  for (const axes of probeAxes) {
    const hp = (axes as Record<string, unknown>).hp;
    if (Array.isArray(hp)) {
      values.push(...(hp as AxisValue[]));
    } else if (hp !== undefined) {
      values.push(hp as AxisValue);
    }
  }
  return values;
}

export function buildStateGrid(extraHp: readonly AxisValue[] = []): GridState[] {
  const states: GridState[] = [];
  const add = (name: string, patch: Partial<GridState>): void => {
    states.push({ ...BASE, ...patch, name });
  };
  const hps = [...HP_BOUNDARIES];
  for (const value of extraHp) {
    if (!hps.some(existing => String(existing) === String(value))) {
      hps.push(value);
    }
  }
  for (const hp of hps) {
    add(`holder hp ${String(hp)}`, { hp });
  }
  for (const [label, effect] of [
    ["burn", StatusEffect.BURN],
    ["paralysis", StatusEffect.PARALYSIS],
    ["sleep", StatusEffect.SLEEP],
    ["poison", StatusEffect.POISON],
  ] as const) {
    add(`holder ${label}, full hp`, { status: effect });
    add(`holder ${label}, half hp`, { status: effect, hp: "50%" });
  }
  for (const [label, weather] of [
    ["rain", WeatherType.RAIN],
    ["sun", WeatherType.SUNNY],
    ["sandstorm", WeatherType.SANDSTORM],
    ["snow", WeatherType.SNOW],
  ] as const) {
    add(`${label}, full hp`, { weather });
    add(`${label}, hp 50%-1`, { weather, hp: "50%-1" });
  }
  add("electric terrain", { terrain: TerrainType.ELECTRIC });
  add("grassy terrain", { terrain: TerrainType.GRASSY });
  add("holder attack +2", { atkStage: 2 });
  add("holder defense -1", { defStage: -1 });
  add("holder is Water", { holderTypes: [PokemonType.WATER] });
  add("holder is Steel", { holderTypes: [PokemonType.STEEL] });
  add("holder is Fire/Flying", { holderTypes: [PokemonType.FIRE, PokemonType.FLYING] });
  add("foe is Fire", { foeTypes: [PokemonType.FIRE] });
  add("foe is Grass/Poison", { foeTypes: [PokemonType.GRASS, PokemonType.POISON] });
  add("foe is Ground", { foeTypes: [PokemonType.GROUND] });
  add("foe hp 50%", { foeHp: "50%" });
  add("foe hp 1", { foeHp: 1 });
  add("rain + burn + half hp", { weather: WeatherType.RAIN, status: StatusEffect.BURN, hp: "50%" });
  add("sun + paralysis + near-full hp, foe Grass", {
    weather: WeatherType.SUNNY,
    status: StatusEffect.PARALYSIS,
    hp: "max-1",
    foeTypes: [PokemonType.GRASS],
  });
  return states;
}

export interface World {
  readonly game: GameManager;
  readonly holder: Pokemon;
  readonly foe: Pokemon;
}

/** Sets the world to `state`. The holder's base types are kept in `baseTypes` so a state can restore them. */
export function applyGridState(world: World, state: GridState): void {
  const { game, holder, foe } = world;
  holder.hp = resolveHp(state.hp, holder.getMaxHp());
  foe.hp = resolveHp(state.foeHp, foe.getMaxHp());
  setStatusOf(holder, state.status);
  setWeatherOf(game, state.weather);
  setTerrainOf(game, state.terrain);
  holder.setStatStage(Stat.ATK, state.atkStage);
  holder.setStatStage(Stat.DEF, state.defStage);
  setTypesOf(holder, state.holderTypes);
  setTypesOf(foe, state.foeTypes);
}

/** The moves every closure is evaluated with: type, category, contact, priority, multi-hit, status, chance. */
export const GRID_MOVES: readonly MoveId[] = [
  MoveId.TACKLE,
  MoveId.EMBER,
  MoveId.WATER_GUN,
  MoveId.THUNDERBOLT,
  MoveId.EARTHQUAKE,
  MoveId.SURF,
  MoveId.SUCKER_PUNCH,
  MoveId.QUICK_ATTACK,
  MoveId.FLAME_WHEEL,
  MoveId.DOUBLE_SLAP,
  MoveId.ROCK_SLIDE,
  MoveId.SWORDS_DANCE,
  MoveId.SPLASH,
  MoveId.EXPLOSION,
  MoveId.HYPER_BEAM,
  MoveId.SEISMIC_TOSS,
];

export function gridMoves(): Move[] {
  return GRID_MOVES.map(id => allMoves[id]);
}

// ---------------------------------------------------------------------------------------------
// Engine parameters per WHEN, for the attr-level differential. Each builder returns exactly the
// object the engine passes to `canApply` at that moment (damage is a NumberHolder for the calc
// moments and a plain number for the after-hit moments, as in ab-attrs.ts).

export interface ParamContext {
  readonly holder: Pokemon;
  readonly foe: Pokemon;
  readonly move: Move;
  /** Damage dealt, for moments that carry it. */
  readonly damage: number;
}

export type ParamBuilder = (ctx: ParamContext) => Record<string, unknown>;

const holderDamage = (ctx: ParamContext): NumberHolder => new NumberHolder(ctx.damage);

export const PARAM_BUILDERS: Readonly<Record<string, ParamBuilder>> = {
  "event.on-entry": ({ holder }) => ({ pokemon: holder, simulated: false }),
  "event.end-of-turn": ({ holder }) => ({ pokemon: holder, simulated: false }),
  "event.after-taking-damage": ({ holder, foe, damage }) => ({
    pokemon: holder,
    source: foe,
    damage,
    simulated: false,
  }),
  "event.after-hit": ({ holder, foe, move, damage }) => ({
    pokemon: holder,
    opponent: foe,
    move,
    damage,
    hitResult: HitResult.EFFECTIVE,
    simulated: false,
  }),
  "event.after-my-hit": ({ holder, foe, move, damage }) => ({
    pokemon: holder,
    opponent: foe,
    move,
    damage,
    hitResult: HitResult.EFFECTIVE,
    simulated: false,
  }),
  "calc.damage-taken": ctx => ({
    pokemon: ctx.holder,
    opponent: ctx.foe,
    move: ctx.move,
    damage: holderDamage(ctx),
    simulated: false,
  }),
  "calc.damage-dealt": ctx => ({
    pokemon: ctx.holder,
    opponent: ctx.foe,
    move: ctx.move,
    damage: holderDamage(ctx),
    simulated: false,
  }),
  "calc.move-power": ctx => ({
    pokemon: ctx.holder,
    opponent: ctx.foe,
    move: ctx.move,
    power: new NumberHolder(ctx.move.power),
    simulated: false,
  }),
};
