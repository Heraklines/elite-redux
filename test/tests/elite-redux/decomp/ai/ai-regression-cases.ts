/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The AI regression set (spec section 5, AI server): the four audited failures plus staff phrases, each with the
// composition a correct builder returns for it. The plan is the ORACLE: the offline test checks that
//   1. the vocabulary search offers every block the plan uses (so the model can find them by label, synonym or
//      example, without knowing a class or ability name),
//   2. the plan schema built from the offered blocks accepts the plan (and the shared validator and compiler too),
//   3. the plan survives expansion into a blueprint that the game's own blueprint validator and compiler accept.
// With ER_AI_LIVE=1 and OPENAI_API_KEY already in the environment the same phrases run against the real server,
// and the four audited failures must also pass their BEHAVIOURAL battle criterion (recipes.ts).
//
// Phrases are plain staff wording. A phrase never names a class, a block id or an ability that already does it.

import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { GOLDEN_RECIPES } from "#test/tests/elite-redux/decomp/harness/recipes";

export interface AiCase {
  readonly id: string;
  readonly phrase: string;
  /** What a correct builder returns. Empty for a phrase the vocabulary cannot build yet (see `unbuildable`). */
  readonly plan: readonly CompositionRuleV2[];
  /** One of the four audited failures: its plan IS the golden recipe, whose behaviour L3 checks in a real battle. */
  readonly audited?: string;
  /** Ids of the planned (not yet runnable) blocks the phrase needs; the search must surface them as such. */
  readonly unbuildable?: readonly string[];
}

const rule = (
  key: string,
  when: string,
  ifs: CompositionRuleV2["if"],
  effects: CompositionRuleV2["do"],
  chance = 100,
): CompositionRuleV2 => ({
  key,
  when: { block: when },
  ...(ifs === undefined ? {} : { if: ifs }),
  do: effects,
  chance,
});

const recipe = (id: string) => {
  const found = GOLDEN_RECIPES.find(entry => entry.id === id);
  if (found === undefined) {
    throw new Error(`no golden recipe ${id}`);
  }
  return found;
};

const audited = (id: string): AiCase => ({
  id,
  phrase: recipe(id).phrase,
  plan: recipe(id).rules,
  audited: id,
});

export const AI_CASES: readonly AiCase[] = [
  // ---- the four audited failures (plans come from the golden recipes) -----------------------------
  audited("switch-out-below-35"),
  audited("immune-to-ground"),
  audited("half-damage-at-full-hp"),
  audited("steam-eruption-after-fire-or-water"),

  // ---- staff phrases: entry and end of turn -------------------------------------------------------
  {
    id: "heal-end-of-turn",
    phrase: "heal 25% of my max HP at the end of every turn",
    plan: [
      rule(
        "heal-each-turn",
        "event.end-of-turn",
        [],
        [{ block: "effect.heal-percent", params: { target: "holder", percent: 25 } }],
      ),
    ],
  },
  {
    id: "attack-on-entry",
    phrase: "raise my Attack by one stage when I enter the battle",
    plan: [
      rule(
        "attack-on-entry",
        "event.on-entry",
        [],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      ),
    ],
  },
  {
    id: "rain-on-entry",
    phrase: "when I switch in, make it rain",
    plan: [rule("rain-on-entry", "event.on-entry", [], [{ block: "effect.set-weather", params: { weather: "RAIN" } }])],
  },
  {
    id: "terrain-on-entry",
    phrase: "set Electric Terrain as soon as I come in",
    plan: [
      rule(
        "terrain-on-entry",
        "event.on-entry",
        [],
        [{ block: "effect.set-terrain", params: { terrain: "ELECTRIC" } }],
      ),
    ],
  },
  {
    id: "intimidate-style",
    phrase: "lower every opposing Pokemon's Attack by one stage when I enter",
    plan: [
      rule(
        "lower-foe-attack",
        "event.on-entry",
        [],
        [{ block: "effect.stat-stage", params: { target: "opposing-side", stat: "ATK", stages: -1 } }],
      ),
    ],
  },
  {
    id: "cure-on-entry",
    phrase: "cure my status condition when I enter the battle",
    plan: [
      rule(
        "cure-on-entry",
        "event.on-entry",
        [],
        [{ block: "effect.cure-status", params: { target: "holder", status: "ANY" } }],
      ),
    ],
  },
  {
    id: "speed-on-entry-doubles",
    phrase: "when I enter a double battle, raise my Speed",
    plan: [
      rule(
        "speed-in-doubles",
        "event.on-entry",
        [{ block: "party.doubles" }],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "SPD", stages: 1 } }],
      ),
    ],
  },
  {
    id: "heal-low-hp-end-of-turn",
    phrase: "at the end of the turn, if I am at 50% HP or less, heal 12% of my HP",
    plan: [
      rule(
        "heal-when-low",
        "event.end-of-turn",
        [{ block: "hp.at-most", params: { who: "holder", pct: 50 } }],
        [{ block: "effect.heal-percent", params: { target: "holder", percent: 12 } }],
      ),
    ],
  },
  {
    id: "heal-in-sun",
    phrase: "recover 12% HP every turn while the weather is sunny",
    plan: [
      rule(
        "sun-recovery",
        "event.end-of-turn",
        [{ block: "field.weather", params: { weather: "SUNNY" } }],
        [{ block: "effect.heal-percent", params: { target: "holder", percent: 12 } }],
      ),
    ],
  },
  {
    id: "cure-end-of-turn-chance",
    phrase: "30% chance to cure my status at the end of each turn",
    plan: [
      rule(
        "shed-skin-style",
        "event.end-of-turn",
        [],
        [{ block: "effect.cure-status", params: { target: "holder", status: "ANY" } }],
        30,
      ),
    ],
  },

  // ---- being hit -----------------------------------------------------------------------------------
  {
    id: "burn-contact",
    phrase: "30% chance to burn the attacker when it makes contact with me",
    plan: [
      rule(
        "burn-on-contact",
        "event.after-hit",
        [{ block: "move.flag", params: { flag: "MAKES_CONTACT" } }],
        [{ block: "effect.inflict-status", params: { target: "other", status: "BURN" } }],
        30,
      ),
    ],
  },
  {
    id: "slow-attacker",
    phrase: "lower the Speed of whoever hits me by one stage",
    plan: [
      rule(
        "slow-attacker",
        "event.after-hit",
        [],
        [{ block: "effect.stat-stage", params: { target: "other", stat: "SPD", stages: -1 } }],
      ),
    ],
  },
  {
    id: "defense-after-water",
    phrase: "raise my Defense by two stages after I am hit by a Water move",
    plan: [
      rule(
        "defense-after-water",
        "event.after-hit",
        [{ block: "move.type", params: { type: "WATER", effective: true } }],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "DEF", stages: 2 } }],
      ),
    ],
  },
  {
    id: "spdef-after-super-effective",
    phrase: "after I take a super effective hit, raise my Special Defense",
    plan: [
      rule(
        "spdef-after-weakness",
        "event.after-hit",
        [{ block: "move.effectiveness", params: { cmp: "gte", n: 2 } }],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "SPDEF", stages: 1 } }],
      ),
    ],
  },
  {
    id: "switch-below-half",
    phrase: "eject myself when my HP falls below half",
    plan: [
      rule(
        "switch-below-half",
        "event.after-taking-damage",
        [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.5, rounding: "exact" } }],
        [{ block: "effect.force-switch-out" }],
      ),
    ],
  },
  {
    id: "heal-once-when-low",
    phrase: "once per battle, heal 50% of my HP when damage drops me below 25% HP",
    plan: [
      rule(
        "last-stand-heal",
        "event.after-taking-damage",
        [
          { block: "hp.crossed-below", params: { who: "holder", ratio: 0.25, rounding: "exact" } },
          { block: "time.once-per", params: { scope: "battle", key: "last-stand" } },
        ],
        [{ block: "effect.heal-percent", params: { target: "holder", percent: 50 } }],
      ),
    ],
  },
  {
    id: "poison-on-faint",
    phrase: "when I faint, poison the Pokemon that knocked me out",
    plan: [
      rule(
        "faint-poison",
        "event.faint",
        [],
        [{ block: "effect.inflict-status", params: { target: "other", status: "POISON" } }],
      ),
    ],
  },

  // ---- attacking -----------------------------------------------------------------------------------
  {
    id: "attack-on-ko",
    phrase: "raise my Attack by one stage every time I knock out a Pokemon",
    plan: [
      rule(
        "ko-attack",
        "event.on-ko",
        [],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      ),
    ],
  },
  {
    id: "heal-on-ko",
    phrase: "heal 10% of my HP after I defeat a foe",
    plan: [
      rule("ko-heal", "event.on-ko", [], [{ block: "effect.heal-percent", params: { target: "holder", percent: 10 } }]),
    ],
  },
  {
    id: "spatk-after-fire",
    phrase: "after my attack lands with a Fire move, raise my Special Attack",
    plan: [
      rule(
        "spatk-after-fire",
        "event.after-my-hit",
        [{ block: "move.type", params: { type: "FIRE", effective: true } }],
        [{ block: "effect.stat-stage", params: { target: "holder", stat: "SPATK", stages: 1 } }],
      ),
    ],
  },

  // ---- while the game calculates -------------------------------------------------------------------
  {
    id: "fire-boost",
    phrase: "boost the power of my Fire moves by 1.5x",
    plan: [
      rule(
        "fire-boost",
        "calc.move-power",
        [{ block: "move.type", params: { type: "FIRE", effective: true } }],
        [{ block: "effect.multiply-power", params: { multiplier: 1.5 } }],
      ),
    ],
  },
  {
    id: "sound-boost",
    phrase: "sound moves get 30% more power",
    plan: [
      rule(
        "sound-boost",
        "calc.move-power",
        [{ block: "move.flag", params: { flag: "SOUND_BASED" } }],
        [{ block: "effect.multiply-power", params: { multiplier: 1.3 } }],
      ),
    ],
  },
  {
    id: "weak-moves-double",
    phrase: "my moves with 60 power or less deal double power",
    plan: [
      rule(
        "weak-moves-double",
        "calc.move-power",
        [{ block: "move.power", params: { cmp: "lte", n: 60 } }],
        [{ block: "effect.multiply-power", params: { multiplier: 2 } }],
      ),
    ],
  },
  {
    id: "burned-foes-extra",
    phrase: "deal 30% more damage to burned foes",
    plan: [
      rule(
        "burned-foes-extra",
        "calc.damage-dealt",
        [{ block: "status.has", params: { who: "other", status: "BURN" } }],
        [{ block: "effect.multiply-damage-dealt", params: { multiplier: 1.3 } }],
      ),
    ],
  },
  {
    id: "weakness-resist",
    phrase: "take 25% less damage from super effective hits",
    plan: [
      rule(
        "weakness-resist",
        "calc.damage-taken",
        [{ block: "move.effectiveness", params: { cmp: "gte", n: 2 } }],
        [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.75 } }],
      ),
    ],
  },
  {
    id: "physical-resist",
    phrase: "take half damage from physical moves",
    plan: [
      rule(
        "physical-resist",
        "calc.damage-taken",
        [{ block: "move.category", params: { category: "PHYSICAL" } }],
        [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
      ),
    ],
  },
  {
    id: "contact-resist",
    phrase: "contact moves against me do 30% less damage",
    plan: [
      rule(
        "contact-resist",
        "calc.damage-taken",
        [{ block: "move.flag", params: { flag: "MAKES_CONTACT" } }],
        [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.7 } }],
      ),
    ],
  },
  {
    id: "healthy-resist",
    phrase: "take 20% less damage while I have at least half of my HP",
    plan: [
      rule(
        "healthy-resist",
        "calc.damage-taken",
        [{ block: "hp.at-least", params: { who: "holder", pct: 50 } }],
        [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.8 } }],
      ),
    ],
  },
  {
    id: "status-first",
    phrase: "my status moves always go first (+1 priority)",
    plan: [
      rule(
        "status-first",
        "calc.priority",
        [{ block: "move.category", params: { category: "STATUS" } }],
        [{ block: "effect.change-priority", params: { amount: 1 } }],
      ),
    ],
  },
  {
    id: "weak-moves-first",
    phrase: "my moves with 40 power or less get +1 priority",
    plan: [
      rule(
        "weak-moves-first",
        "calc.priority",
        [{ block: "move.power", params: { cmp: "lte", n: 40 } }],
        [{ block: "effect.change-priority", params: { amount: 1 } }],
      ),
    ],
  },
  {
    id: "immune-to-electric",
    phrase: "make me immune to Electric moves",
    plan: [
      rule(
        "electric-immunity",
        "calc.move-immunity",
        [],
        [{ block: "effect.immune-to-type", params: { type: "ELECTRIC" } }],
      ),
    ],
  },

  // ---- not buildable yet: the search must say so instead of letting the model invent a block -----
  {
    id: "normal-becomes-flying",
    phrase: "turn my Normal moves into Flying moves",
    plan: [],
    unbuildable: ["effect.change-move-type"],
  },
  {
    id: "transform-below-half",
    phrase: "change into another form when my HP is below half",
    plan: [],
    unbuildable: ["effect.change-form"],
  },
];
