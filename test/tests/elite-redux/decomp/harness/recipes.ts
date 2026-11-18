/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L3 golden recipes (spec section 4): a staff phrase, the composition a builder would assemble for it,
// and a BEHAVIOURAL pass criterion checked in a real battle (not just "it validates").
//
// A recipe whose blocks are not wired yet is marked `expectedFail`. The runner still executes it: it
// must keep failing for the stated reason, and the moment it starts passing the test says "precedent
// landed: remove expectedFail", so the mark can never go stale. Every check function is itself
// validated against a known-good original (`standIn`) where one exists, so a recipe whose blocks land
// later is not trusted on checks nobody ever ran.

import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type Phaser from "phaser";
import { BattleTrace, diffTraces, type TraceData } from "./battle-trace";
import { compositionProblems, registerCompositionAbility, rule } from "./blueprints";
import { freshGame } from "./game";
import { type Axes, celebrate, runScenario, type ScenarioSpec, TEMPLATES, use } from "./scenarios";

export interface CheckResult {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RecipeContext {
  /** The compiled recipe ability, absent when the composition did not compile. */
  readonly ability: number | undefined;
  /** Runs `spec` with the given ability (the recipe's, a baseline's, or none) and returns its trace. */
  run(abilityId: number, spec: ScenarioSpec, axes?: Axes): Promise<TraceData>;
}

export interface GoldenRecipe {
  readonly id: string;
  readonly title: string;
  /** What staff (or the AI builder) would say. */
  readonly phrase: string;
  /** Builds the rules; `ratio` style parameters make the same checks usable with a stand-in original. */
  readonly rules: readonly CompositionRuleV2[];
  /** Behavioural checks, run only when the composition compiled. */
  readonly check: (ctx: RecipeContext, variant: RecipeVariant) => Promise<CheckResult[]>;
  readonly expectedFail?: {
    readonly reason: string;
    readonly landsWith: string;
    /** Texts of which at least one must appear in the plain-language build error (a block id or a trigger label). */
    readonly mentions: readonly string[];
  };
  /** A known-good original that the checks must pass for, proving the checks themselves work. */
  readonly standIn?: { readonly abilityId: number; readonly note: string; readonly variant: RecipeVariant };
}

export interface RecipeVariant {
  /** HP fraction (0-1) of the switch threshold the checks aim at. */
  readonly ratio: number;
}

export interface RecipeResult {
  readonly recipe: GoldenRecipe;
  readonly compileErrors: readonly string[];
  readonly checks: readonly CheckResult[];
  readonly passed: boolean;
  readonly millis: number;
}

const hpAt = (ratio: number, offset: number): string => `${Math.round(ratio * 100)}%${offset >= 0 ? "+" : ""}${offset}`;

function finalSnapshot(trace: TraceData): Record<string, unknown> {
  const last = trace.snapshots.at(-1);
  if (last === undefined) {
    throw new Error("the run took no snapshots");
  }
  return last.data;
}

function playerField(trace: TraceData, key: string): unknown {
  const player = (finalSnapshot(trace).player as Record<string, unknown>[])[0];
  return player?.[key];
}

function startSnapshot(trace: TraceData): Record<string, unknown> {
  return trace.snapshots[0].data;
}

function startHp(trace: TraceData): number {
  return ((startSnapshot(trace).player as Record<string, unknown>[])[0]?.hp as number) ?? 0;
}

const check = (label: string, ok: boolean, detail: string): CheckResult => ({ label, ok, detail });

// ---------------------------------------------------------------------------------------------
// 1. "switch out below 35% HP"

const FORCED_SWITCH: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "recipe-forced-switch",
  label: "The enemy hits the holder once; a teammate is ready to come in",
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
};

const switchOutBelow: GoldenRecipe = {
  id: "switch-out-below-35",
  title: "Switch out below 35% HP",
  phrase: "switch out when my HP drops below 35%",
  rules: [
    rule(
      "switch-below-35",
      "event.after-taking-damage",
      [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.35, rounding: "exact" } }],
      [{ block: "effect.force-switch-out" }],
    ),
  ],
  standIn: {
    abilityId: AbilityId.WIMP_OUT,
    note: "Wimp Out switches below 50%, so the same checks aim at the 50% line",
    variant: { ratio: 0.5 },
  },
  async check(ctx, variant) {
    if (ctx.ability === undefined) {
      return [];
    }
    const id = ctx.ability;
    const crossing = await ctx.run(id, FORCED_SWITCH, { hp: hpAt(variant.ratio, 1) });
    const staysAbove = await ctx.run(id, FORCED_SWITCH, { hp: "90%" });
    const alreadyBelow = await ctx.run(id, FORCED_SWITCH, { hp: hpAt(variant.ratio, -50) });
    const first = (trace: TraceData): number => playerField(trace, "species") as number;
    return [
      check(
        `a hit that takes HP from just above ${variant.ratio * 100}% to below it switches the holder out`,
        first(crossing) === SpeciesId.MAGIKARP,
        `the holder in front afterwards is species ${first(crossing)}`,
      ),
      check(
        "a hit that leaves HP well above the line does not switch the holder out",
        first(staysAbove) === SpeciesId.BLISSEY,
        `the holder in front afterwards is species ${first(staysAbove)}`,
      ),
      check(
        "a hit while already far below the line does not switch it out again",
        first(alreadyBelow) === SpeciesId.BLISSEY,
        `the holder in front afterwards is species ${first(alreadyBelow)}`,
      ),
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// 2. "immune to Ground"

const EARTHQUAKE_HITS: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "recipe-earthquake",
  label: "The enemy uses Earthquake on the holder, then Tackle",
  foeMoves: [MoveId.EARTHQUAKE],
  turns: [celebrate()],
};

const immuneToGround: GoldenRecipe = {
  id: "immune-to-ground",
  title: "Immune to Ground",
  phrase: "immune to Ground moves",
  rules: [
    rule("ground-immunity", "calc.move-immunity", [], [{ block: "effect.immune-to-type", params: { type: "GROUND" } }]),
  ],
  standIn: {
    abilityId: AbilityId.LEVITATE,
    note: "Levitate is the shipped Ground immunity",
    variant: { ratio: 0 },
  },
  async check(ctx) {
    if (ctx.ability === undefined) {
      return [];
    }
    const none = await ctx.run(AbilityId.BALL_FETCH, EARTHQUAKE_HITS);
    const withRecipe = await ctx.run(ctx.ability, EARTHQUAKE_HITS);
    const lost = (trace: TraceData): number => startHp(trace) - (playerField(trace, "hp") as number);
    const tackle = await ctx.run(ctx.ability, TEMPLATES["foe-hits-holder"]);
    return [
      check("without the ability Earthquake hurts", lost(none) > 0, `${lost(none)} HP lost`),
      check("with the ability Earthquake does no damage", lost(withRecipe) === 0, `${lost(withRecipe)} HP lost`),
      check("it is still hurt by other types (Tackle)", lost(tackle) > 0, `${lost(tackle)} HP lost to Tackle`),
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// 3. "half damage at full HP"

const halfAtFullHp: GoldenRecipe = {
  id: "half-damage-at-full-hp",
  title: "Half damage at full HP",
  phrase: "take half damage while at full HP",
  rules: [
    rule(
      "half-at-full-hp",
      "calc.damage-taken",
      [{ block: "hp.full", params: { who: "holder" } }],
      [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
    ),
  ],
  async check(ctx) {
    if (ctx.ability === undefined) {
      return [];
    }
    const results: CheckResult[] = [];
    for (const hp of ["max", "max-1"]) {
      const multiscale = await ctx.run(AbilityId.MULTISCALE, TEMPLATES["foe-hits-holder"], { hp });
      const recipe = await ctx.run(ctx.ability, TEMPLATES["foe-hits-holder"], { hp });
      const none = await ctx.run(AbilityId.BALL_FETCH, TEMPLATES["foe-hits-holder"], { hp });
      const snapshotDiffs = diffTraces(multiscale, recipe).filter(d => d.part.startsWith("snapshot"));
      results.push(
        check(
          `starting at ${hp}, every turn's HP equals Multiscale's`,
          snapshotDiffs.length === 0,
          snapshotDiffs.map(d => d.message).join("; ") || "identical",
        ),
      );
      if (hp === "max") {
        const lostRecipe = startHp(recipe) - (recipe.snapshots[1].data.player as Record<string, number>[])[0].hp;
        const lostNone = startHp(none) - (none.snapshots[1].data.player as Record<string, number>[])[0].hp;
        results.push(
          check(
            "the first hit at full HP is about half of an unprotected hit",
            lostRecipe * 2 <= lostNone + 2 && lostRecipe > 0,
            `${lostRecipe} HP with the recipe against ${lostNone} without`,
          ),
        );
      }
    }
    return results;
  },
};

// ---------------------------------------------------------------------------------------------
// 4. "50 BP Steam Eruption after a Fire or Water move"

const FIRE_OR_WATER_MOVES: ScenarioSpec = {
  ...TEMPLATES["holder-hits-foe"],
  id: "recipe-steam-eruption",
  label: "The holder uses Ember, Water Gun, then Tackle",
  // No foe ability: Ball Fetch copies and blocks "ball" moves such as Water Gun, which would hide the trigger.
  foeAbility: AbilityId.NONE,
  holderMoves: [MoveId.EMBER, MoveId.WATER_GUN, MoveId.TACKLE, MoveId.CELEBRATE],
  turns: [use(MoveId.EMBER), use(MoveId.WATER_GUN), use(MoveId.TACKLE)],
};

const steamEruption: GoldenRecipe = {
  id: "steam-eruption-after-fire-or-water",
  title: "50 BP Steam Eruption after Fire or Water",
  phrase: "after I use a Fire or Water move, follow up with a 50 power Steam Eruption",
  rules: [
    rule(
      "steam-follow-up",
      "event.after-my-hit",
      [
        {
          any: [
            { block: "move.type", params: { type: "FIRE", effective: true } },
            { block: "move.type", params: { type: "WATER", effective: true } },
          ],
        },
      ],
      [{ block: "effect.scripted-move", params: { moveId: "STEAM_ERUPTION", power: 50 } }],
    ),
  ],
  async check(ctx) {
    if (ctx.ability === undefined) {
      return [];
    }
    const none = await ctx.run(AbilityId.NONE, FIRE_OR_WATER_MOVES);
    const withRecipe = await ctx.run(ctx.ability, FIRE_OR_WATER_MOVES);
    const movePhases = (trace: TraceData): number => trace.phases.filter(p => p === "MovePhase").length;
    const extra = movePhases(withRecipe) - movePhases(none);
    const steamMessages = (trace: TraceData): number => trace.messages.filter(m => m.includes("Steam Eruption")).length;
    return [
      check("two follow-up moves happen (after Ember and after Water Gun)", extra === 2, `${extra} extra moves queued`),
      check(
        "the follow-up is Steam Eruption, twice, and only with the ability",
        steamMessages(withRecipe) === 2 && steamMessages(none) === 0,
        `${steamMessages(withRecipe)} Steam Eruption messages with the ability, ${steamMessages(none)} without`,
      ),
    ];
  },
};

export const GOLDEN_RECIPES: readonly GoldenRecipe[] = [switchOutBelow, immuneToGround, halfAtFullHp, steamEruption];

// ---------------------------------------------------------------------------------------------
// Runner

export async function runRecipe(
  phaserGame: Phaser.Game,
  recipe: GoldenRecipe,
  options: { readonly standIn?: boolean; readonly seed?: string } = {},
): Promise<RecipeResult> {
  const started = Date.now();
  const seed = options.seed ?? `recipe-${recipe.id}`;
  const variant: RecipeVariant =
    options.standIn === true ? (recipe.standIn?.variant ?? { ratio: 0.35 }) : { ratio: 0.35 };
  let ability: number | undefined;
  let compileErrors: string[] = [];
  if (options.standIn === true) {
    ability = recipe.standIn?.abilityId;
  } else {
    compileErrors = compositionProblems(recipe.title, recipe.rules);
    if (compileErrors.length === 0) {
      try {
        ability = registerCompositionAbility(recipe.title, recipe.rules);
      } catch (error) {
        compileErrors = [(error as Error).message];
      }
    }
  }
  const context: RecipeContext = {
    ability,
    run: (abilityId, spec, axes = {}) =>
      runScenario(freshGame(phaserGame), spec, { abilityId, axes }, game =>
        BattleTrace.attach(game, { rng: "seeded", seed }),
      ),
  };
  const checks = compileErrors.length > 0 ? [] : await recipe.check(context, variant);
  const passed = compileErrors.length === 0 && checks.length > 0 && checks.every(c => c.ok);
  return { recipe, compileErrors, checks, passed, millis: Date.now() - started };
}

/** Plain-language report of a recipe result. */
export function describeRecipe(result: RecipeResult): string {
  const lines = [`${result.recipe.title} ("${result.recipe.phrase}"): ${result.passed ? "PASS" : "FAIL"}`];
  for (const error of result.compileErrors) {
    lines.push(`  does not build: ${error}`);
  }
  for (const c of result.checks) {
    lines.push(`  ${c.ok ? "ok  " : "FAIL"} ${c.label}: ${c.detail}`);
  }
  return lines.join("\n");
}
