/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier C, no params).
//
// Read by hand from archetypes/sand-cloak.ts and UserFieldIgnoreMoveEffectsAbAttr in ab-attrs.ts. It extends
// UserFieldIgnoreMoveEffectsAbAttr (WHEN "while the game calculates effect chance against me", dispatched for the target's
// whole side). No constructor of its own, so nothing is handed in.
//   canApply, in the ORIGINAL order:
//     1. sandActive() = `arena.weather?.weatherType === SANDSTORM && !arena.weather.isEffectSuppressed()`   (fixed condition)
//     2. super.canApply: `chance.value > 0`                                                                 (feasibility)
//   apply (the parent's): `chance.value = 0`. No random draw, nothing read from `simulated`.
//
// Why Tier C: the weather test is fixed in the class (there is no constructor closure to bind) and is not the library atom
// field.weather (that one ignores suppression; request R-B11-05 in requests/B11.md). The effect "set the effect chance to
// zero" has no library effect either (request R-B11-07), so it is shown as "Block it".
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SandSecondaryEffectImmunityAbAttr } from "#data/elite-redux/archetypes/sand-cloak";

export default defineDecl(SandSecondaryEffectImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.incoming-effect-chance",
  label: "Stop extra effects of moves on my side in a sandstorm",
  summary: () =>
    "While a sandstorm is active, moves that hit me or my allies lose their chance of an extra effect (the way a Shield Dust Pokemon is safe). Example: Flamethrower can no longer burn.",
  synonyms: [
    "shield dust",
    "desert cloak",
    "dune veil",
    "no secondary effects",
    "block side effects in sand",
    "team shield dust",
  ],
  examples: ["My whole side ignores the extra effects of moves while the sandstorm rages"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the weather (a sandstorm) is fixed in the class and the effect (set the extra-effect chance to zero) takes no setting.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only while the weather is a sandstorm and nothing is suppressing the weather",
    "Only changes moves that had a chance of an extra effect",
    "Works for me and for my allies, not for the foes",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a foe move with an extra effect, in a sandstorm, in rain and in clear weather",
      axes: { weather: ["SANDSTORM", "RAIN", "NONE"], foeMove: ["EMBER", "BITE"] },
    },
  ],
  l2StaticReason:
    "The L2 reach check demands that the engine evaluates the WHEN's primary dispatch key (IgnoreMoveEffectsAbAttr), but this class is dispatched under the other key of the same moment (UserFieldIgnoreMoveEffectsAbAttr, listed in alsoDispatchKeys), so the check can never pass for it. In the scenarios with a foe move that has an extra effect (Ember, Bite) the original's attr WAS evaluated (the 'never evaluated its attr' complaint of the first run is gone). test/tests/elite-redux/decomp/B11/chunk3.test.ts drives the original and the rebuild in a sandstorm, a suppressed sandstorm, hail and rain (request R-B11-12 asks the reach check to accept alsoDispatchKeys).",
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Desert Cloak and Dune Veil, always together with SandStatusImmunityAbAttr. Nothing to bind. The parent already tells its holder's side apart because the dispatch site iterates the target's whole field, so this class adds only the sandstorm test in front.",
});
