/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier B: the sandstorm test is the gate inside canApply).
//
// Read by hand from archetypes/sand-cloak.ts and UserFieldIgnoreMoveEffectsAbAttr in ab-attrs.ts. It extends
// UserFieldIgnoreMoveEffectsAbAttr (WHEN "while the game calculates effect chance against me", dispatched for the target's
// whole side). No constructor of its own.
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate:     sandActive() = `arena.weather?.weatherType === SANDSTORM && !arena.weather.isEffectSuppressed()`  (CONDITION)
//     2. residual: super.canApply: `chance.value > 0`                                                              (feasibility)
//   apply (the parent's): `chance.value = 0`. No random draw, nothing read from `simulated`.
//
// The weather test is not the library atom field.weather (that one ignores suppression; request R-B11-05 in requests/B11.md),
// so the shipped gate is a legacy-closure binding for now: reusable as a whole, swappable by staff, counted as undecomposed. The
// effect "set the effect chance to zero" has no library effect either (request R-B11-07), so it is shown as "Block it".
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SandSecondaryEffectImmunityAbAttr } from "#data/elite-redux/archetypes/sand-cloak";

export default defineDecl(SandSecondaryEffectImmunityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.incoming-effect-chance",
  label: "Block the extra effects of moves on my whole side",
  summary: () =>
    "While the condition holds (a sandstorm for the shipped abilities), moves that hit me or my allies lose their chance of an extra effect. Example: Flamethrower can no longer burn.",
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
    "The class has no constructor arguments and the effect (set the extra-effect chance to zero) takes no setting; the weather it waits for is the condition block below.",
  conditions: [
    // The sandstorm test of the shipped abilities (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
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
    "The shipped gate is a legacy closure (sandstorm and NOT suppressed, request R-B11-05), so the shared twin cannot rebuild it. In addition the L2 reach check demands that the engine evaluates the WHEN's primary dispatch key (IgnoreMoveEffectsAbAttr), but this class is dispatched under the other key of the same moment (UserFieldIgnoreMoveEffectsAbAttr, listed in alsoDispatchKeys), so the check can never pass for it (request R-B11-12). test/tests/elite-redux/decomp/B11/chunk3.test.ts drives the original and the rebuild (with the gate handed in) in a sandstorm, a suppressed sandstorm, hail and rain.",
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Desert Cloak and Dune Veil, always together with SandStatusImmunityAbAttr; the gate is bound as a legacy closure on both. The parent already tells its holder's side apart because the dispatch site iterates the target's whole field, so this class adds only the sandstorm test in front.",
});
