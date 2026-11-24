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
import { Gender } from "#data/gender";
import { Status } from "#data/status-effect";
import { Terrain, TerrainType } from "#data/terrain";
import { Weather } from "#data/weather";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { GameManager } from "#test/framework/game-manager";
import { BooleanHolder, NumberHolder } from "#utils/common";

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
  /** Gravity is up (arena tag). */
  readonly gravity: boolean;
  /** The holder carries the grounding tag (Smack Down, BattlerTagType.IGNORE_FLYING). */
  readonly groundedTag: boolean;
  /** The holder has already moved this turn (PokemonTurnData.acted). */
  readonly acted: boolean;
  /** Genders; undefined keeps the Pokemon's own. */
  readonly holderGender: Gender | undefined;
  readonly foeGender: Gender | undefined;
  /** Forces the holder's max HP (an even and an odd value reach different roundings); undefined keeps its own. */
  readonly maxHp: number | undefined;
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
  gravity: false,
  groundedTag: false,
  acted: false,
  holderGender: undefined,
  foeGender: undefined,
  maxHp: undefined,
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
  // Even and odd max HP: floor(max / 2) and max / 2 only differ for an even max, so both must be probed.
  for (const maxHp of [100, 101]) {
    for (const hp of ["max", "50%+1", "50%", "50%-1", "35%", 1]) {
      add(`max hp ${maxHp}, holder hp ${String(hp)}`, { maxHp, hp });
    }
  }
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
  add("foe is Dragon", { foeTypes: [PokemonType.DRAGON] });
  add("foe is Dark/Steel", { foeTypes: [PokemonType.DARK, PokemonType.STEEL] });
  add("gravity", { gravity: true });
  add("grounded by a tag", { groundedTag: true });
  add("gravity and grounded by a tag", { gravity: true, groundedTag: true });
  add("holder has already moved", { acted: true });
  add("male holder, female foe", { holderGender: Gender.MALE, foeGender: Gender.FEMALE });
  add("female holder, female foe", { holderGender: Gender.FEMALE, foeGender: Gender.FEMALE });
  add("genderless holder, female foe", { holderGender: Gender.GENDERLESS, foeGender: Gender.FEMALE });
  add("male holder, genderless foe", { holderGender: Gender.MALE, foeGender: Gender.GENDERLESS });
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
  if (!naturalMaxHp.has(holder)) {
    naturalMaxHp.set(holder, holder.stats[Stat.HP]);
  }
  holder.stats[Stat.HP] = state.maxHp ?? (naturalMaxHp.get(holder) as number);
  holder.hp = resolveHp(state.hp, holder.getMaxHp());
  foe.hp = resolveHp(state.foeHp, foe.getMaxHp());
  setStatusOf(holder, state.status);
  setWeatherOf(game, state.weather);
  setTerrainOf(game, state.terrain);
  holder.setStatStage(Stat.ATK, state.atkStage);
  holder.setStatStage(Stat.DEF, state.defStage);
  setTypesOf(holder, state.holderTypes);
  setTypesOf(foe, state.foeTypes);
  const arena = game.scene.arena;
  const gravityUp = arena.getTag(ArenaTagType.GRAVITY) !== undefined;
  if (state.gravity && !gravityUp) {
    arena.addTag(ArenaTagType.GRAVITY, 5, undefined, holder.id, ArenaTagSide.BOTH, true);
  } else if (!state.gravity && gravityUp) {
    arena.removeTag(ArenaTagType.GRAVITY);
  }
  const grounded = holder.getTag(BattlerTagType.IGNORE_FLYING) !== undefined;
  if (state.groundedTag && !grounded) {
    holder.addTag(BattlerTagType.IGNORE_FLYING, 1, MoveId.SMACK_DOWN, foe.id);
  } else if (!state.groundedTag && grounded) {
    holder.removeTag(BattlerTagType.IGNORE_FLYING);
  }
  holder.turnData.acted = state.acted;
  for (const [mon, gender] of [
    [holder, state.holderGender],
    [foe, state.foeGender],
  ] as const) {
    if (!naturalGender.has(mon)) {
      naturalGender.set(mon, mon.gender);
    }
    mon.gender = gender ?? (naturalGender.get(mon) as Gender);
  }
}

const naturalGender = new WeakMap<Pokemon, Gender>();
const naturalMaxHp = new WeakMap<Pokemon, number>();

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
  // Ghost, Dark, Psychic and sound-based moves (Heavy Metal, Astral Project and the sound-flag users).
  MoveId.SHADOW_BALL,
  MoveId.BITE,
  MoveId.PSYCHIC,
  MoveId.HYPER_VOICE,
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
  "calc.move-immunity": ctx => ({
    pokemon: ctx.holder,
    opponent: ctx.foe,
    move: ctx.move,
    typeMultiplier: new NumberHolder(1),
    cancelled: new BooleanHolder(false),
    simulated: false,
  }),
  "calc.move-power": ctx => ({
    pokemon: ctx.holder,
    opponent: ctx.foe,
    move: ctx.move,
    power: new NumberHolder(ctx.move.power),
    simulated: false,
  }),
  // B18 chunk 1. The turn-order jump check hands over only the holder (BypassSpeedChanceAbAttr: pokemon, simulated).
  "calc.speed-bypass": ({ holder }) => ({ pokemon: holder, simulated: false }),
  // B18 chunk 2. The effect-chance calc hands over the target (holder), the move and the chance as a holder; the grid uses the move's own chance.
  "calc.incoming-effect-chance": ({ holder, move }) => ({
    pokemon: holder,
    move,
    simulated: false,
    chance: new NumberHolder(move.chance),
  }),
  // B18 chunk 3. A stat calculation hands over the holder, the move, the stat and the value being built (StatMultiplierAbAttr and, for the
  // ally dispatch, AllyStatMultiplierAbAttr: `target` is the Pokemon that receives the stat and `ignoreAbility` the Mold Breaker flag). The
  // grid has no stat axis, so the stat is picked from the grid move's position: all seven stats, Accuracy and Evasion included, are asked.
  "calc.stat-value": ({ holder, foe, move }) => {
    const index = Math.max(0, GRID_MOVES.indexOf(move.id));
    const stats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA];
    return {
      pokemon: holder,
      target: foe,
      stat: stats[index % stats.length],
      statVal: new NumberHolder(100),
      move,
      ignoreAbility: index % 4 === 3,
      simulated: false,
    };
  },
  // B18 chunk 3. The stat drop check hands over the holder, the stat, the change, the source and the cancel flag. The grid has no such axes, so
  // the grid move's position picks the change (-1, -2, +1, 0), the source (the foe, nobody, or `undefined`) and an already blocked drop.
  "cancel.stat-drop": ({ holder, foe, move }) => {
    const index = Math.max(0, GRID_MOVES.indexOf(move.id));
    return {
      pokemon: holder,
      stat: Stat.ATK,
      stages: [-1, -2, 1, 0][index % 4],
      source: index % 5 === 3 ? null : index % 7 === 5 ? undefined : foe,
      cancelled: new BooleanHolder(index % 6 === 4),
      simulated: false,
    };
  },
  // B18 chunk 4. The faint check hands over the holder, the foe that knocked it out and that foe's move (faint-phase.ts: the newest hit it took;
  // after poison, weather or recoil there is neither). The grid has no such axes, so the grid move's position picks the case: no attacker,
  // the holder as its own attacker, or no move; every other position is a normal knock-out by the foe with the grid move.
  "event.faint": ({ holder, foe, move }) => {
    const index = Math.max(0, GRID_MOVES.indexOf(move.id));
    return {
      pokemon: holder,
      attacker: index % 5 === 3 ? undefined : index % 6 === 4 ? holder : foe,
      move: index % 7 === 5 ? undefined : move,
      simulated: false,
    };
  },
};
