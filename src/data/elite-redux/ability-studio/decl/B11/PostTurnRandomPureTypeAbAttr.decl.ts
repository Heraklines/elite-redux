/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier C: one effect, one safety rule; the trigger is its own block).
//
// Read by hand from archetypes/post-turn-random-type.ts. PostTurn hook (WHEN "at the end of every turn"), no constructor
// of its own (`super()`).
//   canApply: `!pokemon.isFainted()`                                                  (guard: a fainted Pokemon never changes type)
//   apply: not when simulated. Then ONE random draw `pokemon.randBattleSeedInt(18)` (0 to 17 = Normal to Fairy; Stellar and the
//     unknown type are not in the pool) and `pokemon.summonData.types = [thatType]`: the holder becomes ONE single type.
//     No message, no animation, nothing else is written.
//
// The rule in `canApply` is a guard (removing it would let a fainted Pokemon change type), not a condition staff would adjust.
// The effect is one piece: the library has no block for "become a random single type" (request R-B11-C1-03) and the class has no
// constructor arguments, so the pool of 18 real types is part of the effect and cannot be a setting without a class change.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostTurnRandomPureTypeAbAttr } from "#data/elite-redux/archetypes/post-turn-random-type";

export default defineDecl(PostTurnRandomPureTypeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Become one random single type every turn",
  summary: () =>
    "At the end of every turn my types are replaced by one random single type out of the 18 normal types. Example: a Fire/Flying Pokemon can become just Water.",
  synonyms: [
    "color spectrum",
    "random type each turn",
    "type roulette",
    "shuffle my type",
    "rainbow type",
    "mono type",
  ],
  examples: [
    "Change to a random single type at the end of every turn",
    "Rotate my type randomly each turn like Color Spectrum",
  ],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the pool (the 18 real types, never Stellar) and the single-type result are fixed in the effect. Staff cannot change them until the library has a 'become a random type' block with a type pool (request R-B11-C1-03).",
  conditions: [],
  guards: ["not-fainted"],
  feasibility: ["Never in a preview", "Only one type is left afterwards, never two"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["apply: pokemon.randBattleSeedInt(18), one draw per turn, after the simulated check"],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "two quiet turns at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C package, justified in the header. Only user: Color Spectrum (5403, attr 1; its STAB boost is another attr). The type is written straight into `summonData.types` with no type-change message and no check for Terastallization, Stellar or abilities that pin a type. The draw uses the battle seed, one per end of turn, so a rebuilt rule keeps the replay order as long as it draws at the same place (apply, after the simulated check).",
});
