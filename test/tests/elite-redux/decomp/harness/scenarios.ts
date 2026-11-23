/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L2 scenario templates (spec section 4, L2 items 2-4). One template per MOMENT of a battle ("the
// enemy hits the holder", "the holder attacks", "entry", "end of turn", "faint", ...). Every WHEN in
// WHEN_REGISTRY is mapped to the template that reaches it (`templateForWhen`); the harness lint test
// fails when a WHEN is neither mapped nor explicitly marked static.
//
// A scenario is DATA (`ScenarioSpec`) plus optional state axes, so the same template can be run for
// every condition probe of a class: "axes" are the names a declaration's `probes[].axes` may use
// (hp, foeHp, foeMove, weather, status, stage). An axis the harness does not understand is a lint
// failure, never silently ignored.

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import type { BattleTrace, TraceData } from "./battle-trace";
import { type Axes, type AxisValue, resolveHp, setStatusOf, setWeatherOf } from "./world";

export type { Axes, AxisValue };
export { resolveHp };

/** What one player-side command does in a scenario turn. */
export type TurnAction =
  | {
      readonly move: MoveId;
      readonly until?: "next-turn" | "BerryPhase" | "TurnEndPhase";
      /**
       * Runs right after the move was selected. Prompt answers (a forced switch) must be queued here and
       * not earlier: the prompt handler serves prompts in order, and the move selection comes first.
       */
      readonly afterSelect?: (ctx: ScenarioContext) => void;
    }
  | { readonly switchTo: number }
  | { readonly kill: "holder" | "foe" }
  /** The holder is put on 1 HP and the enemy's attack makes it faint; the run stops after the FaintPhase. */
  | { readonly faintHolder: true };

export interface ScenarioSpec {
  readonly id: string;
  readonly label: string;
  readonly holder: SpeciesId;
  /** Extra player party members after the holder (for switches). */
  readonly party: readonly SpeciesId[];
  readonly foe: SpeciesId;
  /** Defaults to 30. */
  readonly foeLevel?: number;
  readonly foeAbility: AbilityId;
  readonly holderMoves: readonly MoveId[];
  readonly foeMoves: readonly MoveId[];
  readonly doubles?: boolean;
  /** Field weather at the start. Leave unset when the enemy should be the one who changes the weather. */
  readonly weather?: WeatherType;
  /** The holder carries a Sitrus Berry (berry and item-loss moments need an item). */
  readonly berry?: boolean;
  readonly crits?: boolean;
  readonly turns: readonly TurnAction[];
  /** Runs once after the battle started and the axes were applied. */
  readonly setup?: (ctx: ScenarioContext) => void;
}

export interface ScenarioContext {
  readonly game: GameManager;
  readonly holder: Pokemon;
  readonly foe: Pokemon;
}

const BASE = {
  holder: SpeciesId.BLISSEY,
  party: [] as readonly SpeciesId[],
  foe: SpeciesId.MAGIKARP,
  foeAbility: AbilityId.BALL_FETCH,
  holderMoves: [MoveId.CELEBRATE, MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.DOUBLE_SLAP] as readonly MoveId[],
  foeMoves: [MoveId.TACKLE] as readonly MoveId[],
} as const;

/** Two quiet-turn follow-ups give an "end of turn" and a second occasion for once-per / nth-use memory. */
export const celebrate = (until?: "next-turn" | "BerryPhase" | "TurnEndPhase"): TurnAction => ({
  move: MoveId.CELEBRATE,
  ...(until === undefined ? {} : { until }),
});
export const use = (move: MoveId, until?: "next-turn" | "BerryPhase" | "TurnEndPhase"): TurnAction => ({
  move,
  ...(until === undefined ? {} : { until }),
});

export const TEMPLATES: Readonly<Record<string, ScenarioSpec>> = {
  /** The battle starts; entry effects, battle-start effects and a quiet turn (end of turn) happen. */
  entry: {
    ...BASE,
    id: "entry",
    label: "The holder enters the battle and sits through two quiet turns",
    turns: [celebrate(), celebrate()],
  },
  /** Nothing is attacked: end-of-turn, weather lapse, speed and trap checks happen. */
  "quiet-turns": {
    ...BASE,
    id: "quiet-turns",
    label: "Two quiet turns (nobody attacks)",
    foeMoves: [MoveId.CELEBRATE],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy hits the holder while a teammate is ready; a forced-switch prompt (Wimp Out, Emergency Exit) is answered. */
  "hit-with-reserve": {
    ...BASE,
    id: "hit-with-reserve",
    label: "The enemy hits the holder while a teammate is ready to come in",
    party: [SpeciesId.MAGIKARP],
    turns: [
      {
        move: MoveId.CELEBRATE,
        until: "TurnEndPhase",
        afterSelect: ({ game }) => {
          game.doSelectPartyPokemon(1);
        },
      },
    ],
  },
  /**
   * Flags nobody dispatches (while-active, engine-query): the holder attacks a Rough Skin foe (contact matters) while
   * the foe uses Earthquake and Spikes (grounding matters). Both runs must end identically.
   */
  "while-active-flags": {
    ...BASE,
    id: "while-active-flags",
    label: "The holder attacks a Rough Skin foe that uses Earthquake and Spikes",
    foe: SpeciesId.SNORLAX,
    foeLevel: 100,
    foeAbility: AbilityId.ROUGH_SKIN,
    foeMoves: [MoveId.EARTHQUAKE, MoveId.SPIKES],
    turns: [use(MoveId.TACKLE), use(MoveId.TACKLE), celebrate()],
  },
  /** The enemy hits the holder twice. */
  "foe-hits-holder": {
    ...BASE,
    id: "foe-hits-holder",
    label: "The enemy attacks the holder on two turns",
    turns: [celebrate(), celebrate()],
  },
  /** The enemy lands a critical hit. */
  "foe-crits-holder": {
    ...BASE,
    id: "foe-crits-holder",
    label: "The enemy lands critical hits on the holder",
    crits: true,
    turns: [celebrate(), celebrate()],
  },
  /** The holder attacks, using a single-hit and a multi-hit move. */
  "holder-hits-foe": {
    ...BASE,
    id: "holder-hits-foe",
    label: "The holder attacks the enemy (single hit, then multi hit)",
    foe: SpeciesId.SNORLAX,
    foeLevel: 100,
    foeMoves: [MoveId.CELEBRATE],
    turns: [use(MoveId.TACKLE), use(MoveId.DOUBLE_SLAP)],
  },
  /** The holder uses a status move on itself and the enemy attacks in return. */
  "holder-uses-status-move": {
    ...BASE,
    id: "holder-uses-status-move",
    label: "The holder uses a status move while the enemy attacks",
    turns: [use(MoveId.SWORDS_DANCE), celebrate()],
  },
  /** The holder knocks the enemy out. */
  "holder-kos-foe": {
    ...BASE,
    id: "holder-kos-foe",
    label: "The holder knocks out the enemy",
    foeMoves: [MoveId.CELEBRATE],
    setup: ({ foe }) => {
      foe.hp = 1;
    },
    turns: [use(MoveId.TACKLE, "BerryPhase")],
  },
  /** The holder faints. */
  "holder-faints": {
    ...BASE,
    id: "holder-faints",
    label: "The holder faints to the enemy's attack",
    party: [SpeciesId.MAGIKARP],
    turns: [{ faintHolder: true }],
  },
  /**
   * B13 chunk 3 (Ring General): a trapping ability of the HOLDER is evaluated when the FOE tries to switch or run, which
   * the engine asks through `foe.isTrapped()`. The real engine entry point is called right after the move selection.
   */
  "foe-tries-to-leave": {
    ...BASE,
    id: "foe-tries-to-leave",
    label: "The enemy tries to switch out or run while the holder is on the field",
    foeMoves: [MoveId.CELEBRATE],
    turns: [
      {
        move: MoveId.CELEBRATE,
        until: "TurnEndPhase",
        afterSelect: ({ foe }) => {
          foe.isTrapped();
        },
      },
      celebrate(),
    ],
  },
  /** The holder switches out. */
  "holder-switches-out": {
    ...BASE,
    id: "holder-switches-out",
    label: "The holder switches out to a teammate",
    party: [SpeciesId.MAGIKARP],
    turns: [{ switchTo: 1 }, celebrate()],
  },
  /** The enemy inflicts a status on the holder. */
  "foe-inflicts-status": {
    ...BASE,
    id: "foe-inflicts-status",
    label: "The enemy paralyses (Glare, never misses) and tries to burn the holder",
    foeMoves: [MoveId.GLARE, MoveId.WILL_O_WISP],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy lowers the holder's stats. */
  "foe-drops-stat": {
    ...BASE,
    id: "foe-drops-stat",
    label: "The enemy lowers the holder's attack (Growl never misses)",
    foeMoves: [MoveId.GROWL],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy raises its own stats. */
  "foe-raises-stat": {
    ...BASE,
    id: "foe-raises-stat",
    label: "The enemy raises its own stats",
    foeMoves: [MoveId.SWORDS_DANCE],
    turns: [celebrate(), celebrate()],
  },
  /** An enemy with Intimidate enters. */
  "foe-intimidates": {
    ...BASE,
    id: "foe-intimidates",
    label: "The enemy enters with Intimidate",
    foeAbility: AbilityId.INTIMIDATE,
    foeMoves: [MoveId.CELEBRATE],
    turns: [celebrate()],
  },
  /** Weather is set by the field at the start and changed by the enemy. */
  "weather-set": {
    ...BASE,
    id: "weather-set",
    label: "The enemy sets sun, then rain",
    foeMoves: [MoveId.SUNNY_DAY, MoveId.RAIN_DANCE],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy sets a terrain. */
  "terrain-set": {
    ...BASE,
    id: "terrain-set",
    label: "The enemy sets Electric Terrain",
    foeMoves: [MoveId.ELECTRIC_TERRAIN],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy knocks off the holder's item (needs a held item to lose). */
  "foe-removes-item": {
    ...BASE,
    id: "foe-removes-item",
    label: "The enemy uses Knock Off on a holder with a berry",
    berry: true,
    foeMoves: [MoveId.KNOCK_OFF],
    turns: [celebrate(), celebrate()],
  },
  /** The enemy forces the holder to switch. */
  "foe-forces-switch": {
    ...BASE,
    id: "foe-forces-switch",
    label: "The enemy uses Dragon Tail",
    party: [SpeciesId.MAGIKARP],
    foeMoves: [MoveId.DRAGON_TAIL],
    turns: [celebrate()],
  },
  /** The enemy explodes. */
  "foe-explodes": {
    ...BASE,
    id: "foe-explodes",
    label: "The enemy uses Explosion",
    foeMoves: [MoveId.EXPLOSION],
    turns: [celebrate("BerryPhase")],
  },
  /** The holder is low enough to want its berry; the enemy hits it. */
  "holder-low-hp-turns": {
    ...BASE,
    id: "holder-low-hp-turns",
    label: "The holder starts at 30% HP with a Sitrus Berry and the enemy hits it",
    berry: true,
    setup: ({ holder }) => {
      holder.hp = Math.max(1, Math.floor(holder.getMaxHp() * 0.3));
    },
    turns: [celebrate(), celebrate()],
  },
  /** Doubles: the holder has an ally that is hit, boosted and dropped. */
  "doubles-ally": {
    ...BASE,
    id: "doubles-ally",
    label: "Doubles: the holder's ally is attacked and boosted",
    party: [SpeciesId.SHUCKLE],
    doubles: true,
    turns: [celebrate(), celebrate()],
  },
};

/** Moment families for WHENs that need no battle of their own. */
export const STATIC_WHEN_REASONS: Readonly<Record<string, string>> = {
  "while.active": "A flag checked by presence (instanceof / hasAttr); nothing is dispatched.",
};

const t = {
  entry: "entry",
  quiet: "quiet-turns",
  hit: "foe-hits-holder",
  crit: "foe-crits-holder",
  attack: "holder-hits-foe",
  statusMove: "holder-uses-status-move",
  ko: "holder-kos-foe",
  faint: "holder-faints",
  switchOut: "holder-switches-out",
  inflicted: "foe-inflicts-status",
  statDrop: "foe-drops-stat",
  statRaise: "foe-raises-stat",
  intimidate: "foe-intimidates",
  weather: "weather-set",
  terrain: "terrain-set",
  item: "foe-removes-item",
  forced: "foe-forces-switch",
  boom: "foe-explodes",
  low: "holder-low-hp-turns",
  doubles: "doubles-ally",
  reserve: "hit-with-reserve",
  flags: "while-active-flags",
} as const;

/** WHEN id to the template that reaches it. Reviewed by hand; `reach.test.ts` proves it with a probe attr. */
const WHEN_TEMPLATE: Readonly<Record<string, string>> = {
  "event.on-entry": t.entry,
  "event.before-entry": t.entry,
  "event.battle-start": t.entry,
  "event.after-battle": t.ko,
  "event.switch-out": t.switchOut,
  "event.leave-field": t.switchOut,
  "event.faint": t.faint,
  "event.end-of-turn": t.quiet,
  "event.wake-up": t.quiet,
  "event.flinched": t.hit,
  "event.berry-eaten": t.low,
  "event.before-i-use-move": t.attack,
  "event.my-move-starts": t.attack,
  "event.after-my-hit": t.attack,
  "event.on-ko": t.ko,
  "event.on-win": t.ko,
  "event.after-any-move": t.hit,
  "event.after-inflicting-status": t.attack,
  "event.after-hit": t.hit,
  "event.after-taking-damage": t.reserve,
  "event.after-crit-taken": t.crit,
  "event.before-hit-lands": t.hit,
  "event.got-status": t.inflicted,
  "event.item-lost": t.item,
  "event.intimidated": t.intimidate,
  "event.weather-changed": t.weather,
  "event.weather-each-turn": t.weather,
  "event.terrain-changed": t.terrain,
  "event.biome-changed": t.entry,
  "event.stat-changed": t.statDrop,
  "event.ally-stat-changed": t.doubles,
  "event.foe-raised-stat": t.statRaise,
  "calc.redirect-move": t.doubles,
  "calc.priority": t.attack,
  "calc.speed-bypass": t.quiet,
  "calc.trap-check": "foe-tries-to-leave",
  "calc.run-chance": t.quiet,
  "calc.weight": t.hit,
  "calc.burn-damage": t.inflicted,
  "calc.status-duration": t.inflicted,
  "calc.berry-effect": t.low,
  "calc.berry-threshold": t.low,
  "calc.move-power": t.attack,
  "calc.damage-dealt": t.attack,
  "calc.damage-taken": t.hit,
  "calc.stab": t.attack,
  "calc.crit-stage": t.attack,
  "calc.crit-multiplier": t.crit,
  "calc.crit-roll": t.attack,
  "calc.hit-count": t.attack,
  "calc.max-multi-hit": t.attack,
  "calc.accuracy": t.attack,
  "calc.incoming-accuracy": t.hit,
  "calc.effect-chance": t.attack,
  "calc.incoming-effect-chance": t.hit,
  "calc.damage-roll": t.hit,
  "calc.weather-type-debuff": t.weather,
  "calc.stat-value": t.hit,
  "calc.foe-stat-value": t.hit,
  "calc.ignore-stat-stages": t.attack,
  "calc.defensive-stat-substitute": t.hit,
  "calc.defensive-stat-pick": t.crit,
  "calc.stage-change-amount": t.statusMove,
  "calc.move-type": t.attack,
  "calc.type-matchup": t.hit,
  "calc.move-immunity": t.hit,
  "calc.ignore-type-immunity": t.attack,
  "calc.ability-bypass": t.attack,
  "cancel.stat-drop": t.statDrop,
  "cancel.stat-protect": t.statDrop,
  "cancel.stat-protect-field": t.statDrop,
  "cancel.stat-reflect": t.statDrop,
  "cancel.intimidate": t.intimidate,
  "cancel.status": t.inflicted,
  "cancel.status-immunity": t.inflicted,
  "cancel.status-immunity-field": t.inflicted,
  "cancel.status-type-immunity": t.inflicted,
  "cancel.battle-effect": t.inflicted,
  "cancel.battle-effect-immunity": t.inflicted,
  "cancel.battle-effect-immunity-field": t.inflicted,
  "cancel.weather-damage": t.weather,
  "cancel.weather-effect": t.weather,
  "cancel.weather-suppress": t.weather,
  "cancel.interaction": t.hit,
  "cancel.crit": t.crit,
  "cancel.item-theft": t.item,
  "cancel.indirect-damage": t.weather,
  "cancel.one-hit-ko": t.hit,
  "cancel.forced-switch": t.forced,
  "cancel.explosive-moves": t.boom,
  "cancel.berry-use": t.low,
  "cancel.reflect-status-move": t.statDrop,
  "cancel.infiltrate": t.hit,
  "calc.incoming-move": t.hit,
  "calc.outgoing-move": t.attack,
  "while.active": t.flags,
};

/** The template that reaches `whenId`, or undefined for a static (flag) WHEN or an unknown id. */
export function templateForWhen(whenId: string): ScenarioSpec | undefined {
  const id = WHEN_TEMPLATE[whenId];
  return id === undefined ? undefined : TEMPLATES[id];
}

export function mappedWhenIds(): string[] {
  return Object.keys(WHEN_TEMPLATE);
}

// ---------------------------------------------------------------------------------------------
// Axes

/** The axis names a declaration's probes may use. */
export const KNOWN_AXES = ["hp", "foeHp", "foeMove", "weather", "status", "stage"] as const;

export function describeAxes(axes: Axes): string {
  const entries = Object.entries(axes);
  return entries.length === 0 ? "default state" : entries.map(([k, v]) => `${k}=${String(v)}`).join(", ");
}

function enumValue(table: Record<string, string | number>, name: AxisValue, axis: string): number {
  if (typeof name === "number") {
    return name;
  }
  const value = table[name as string];
  if (typeof value !== "number") {
    throw new Error(`the ${axis} value "${String(name)}" is not a known name`);
  }
  return value;
}

/** Applies state axes to the live battle. Throws a plain-language error for an axis it does not know. */
export function applyAxes(ctx: ScenarioContext, axes: Axes): void {
  const { game, holder, foe } = ctx;
  for (const [axis, value] of Object.entries(axes)) {
    switch (axis) {
      case "hp":
        holder.hp = resolveHp(value, holder.getMaxHp());
        break;
      case "foeHp":
        foe.hp = resolveHp(value, foe.getMaxHp());
        break;
      case "foeMove":
        game.move.changeMoveset(foe, enumValue(MoveId as never, value, "foeMove") as MoveId);
        break;
      case "weather":
        setWeatherOf(game, enumValue(WeatherType as never, value, "weather") as WeatherType);
        break;
      case "status":
        setStatusOf(holder, enumValue(StatusEffect as never, value, "status") as StatusEffect);
        break;
      case "stage": {
        const [stat, amount] = String(value).split(":");
        const index = Stat[stat as keyof typeof Stat];
        if (index === undefined || Number.isNaN(Number(amount))) {
          throw new Error(`the stage value "${String(value)}" must look like ATK:+2`);
        }
        holder.setStatStage(index as Parameters<Pokemon["setStatStage"]>[0], Number(amount));
        break;
      }
      default:
        throw new Error(
          `the probe axis "${axis}" is not understood by the L2 harness (known: ${KNOWN_AXES.join(", ")})`,
        );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Runner

export interface RunOptions {
  readonly abilityId: number;
  readonly axes?: Axes;
  /** Shadow id to original id for the trace. */
  readonly aliases?: Readonly<Record<number, number>>;
  readonly rng?: "max" | "seeded";
  readonly seed?: string;
}

/**
 * Runs one scenario for `abilityId` on the given GameManager and returns its trace. The ability must
 * already be registered in `allAbilities`.
 */
export async function runScenario(
  game: GameManager,
  spec: ScenarioSpec,
  options: RunOptions,
  attachTrace: (game: GameManager) => BattleTrace,
): Promise<TraceData> {
  if (allAbilities[options.abilityId] === undefined) {
    throw new Error(`ability ${options.abilityId} is not registered`);
  }
  const axes = options.axes ?? {};
  game.override
    .battleStyle(spec.doubles ? "double" : "single")
    .moveset([...spec.holderMoves])
    .ability(options.abilityId as AbilityId)
    .startingLevel(100)
    .enemySpecies(spec.foe)
    .enemyLevel(spec.foeLevel ?? 30)
    .enemyAbility(spec.foeAbility)
    .enemyMoveset([...spec.foeMoves])
    .criticalHits(spec.crits ?? false)
    // The ER innate slots would add confounding abilities (status immunities, extra triggers) to every run.
    .hasPassiveAbility(false)
    .enemyHasPassiveAbility(false);
  if (spec.weather !== undefined) {
    game.override.weather(spec.weather);
  }
  if (spec.berry === true) {
    game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);
  }
  const trace = attachTrace(game);
  try {
    await game.classicMode.startBattle(...([spec.holder, ...spec.party] as [SpeciesId, SpeciesId]));
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const ctx: ScenarioContext = { game, holder, foe };
    applyAxes(ctx, axes);
    spec.setup?.(ctx);
    trace.snapshot("start");
    let turn = 0;
    for (const action of spec.turns) {
      turn++;
      if ("move" in action) {
        game.move.select(action.move);
        action.afterSelect?.(ctx);
        if (action.until === "BerryPhase") {
          await game.phaseInterceptor.to("BerryPhase");
        } else if (action.until === "TurnEndPhase") {
          await game.toEndOfTurn();
        } else {
          await game.toNextTurn();
        }
      } else if ("switchTo" in action) {
        game.doSwitchPokemon(action.switchTo);
        await game.toNextTurn();
      } else if ("faintHolder" in action) {
        holder.hp = 1;
        game.move.select(MoveId.CELEBRATE);
        await game.phaseInterceptor.to("FaintPhase");
      } else {
        await game.killPokemon(action.kill === "holder" ? holder : foe);
      }
      trace.snapshot(`turn ${turn}`);
    }
    return trace.data();
  } finally {
    trace.detach();
  }
}
