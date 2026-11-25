/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Phoenix Foliage, first of two form-change attrs (after I attack). Read by hand: fakemon-pitch-mechanics.ts
// `PhoenixFoliageUseFormChangeAbAttr` (+ the helpers isLiveCurrent, isPhoenixFoliageType, triggerLiveCurrent), its base
// PostAttackAbAttr (ab-attrs.ts; the constructor argument 0 is passed as `() => true` and is never read because canApply
// does not call super), and the second attr PhoenixFoliageHitFormChangeAbAttr.
//
// canApply, clause by clause, in the order they run (`canApply = guards && gate`, no residual):
//   1. guard      I have not fainted: `!pokemon.isFainted()`                                            -> `guards`, guard not-fainted
//   2. guard      this is the final hit of my move: `pokemon.turnData.hitsLeft <= 1`                    -> `guards`, NO GUARD ID (request R18)
//   3. condition  I am not in the Live Current form yet: `!(species.forms[formIndex]?.formKey === "live-current")`
//                                                                                -> `gate`, atom mon.in-form (holder, live-current), negated
//   4. condition  the move counts as Fire or Electric for me: `pokemon.getMoveType(move)` is FIRE or ELECTRIC
//                                                                                -> `gate`, atom move.type (effective), twice, in an `any`
// apply: unless simulated, `if (!isLiveCurrent) globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`
// (the inner test repeats clause 3, a pure read). No random draw, no memory.
import { PhoenixFoliageUseFormChangeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PhoenixFoliageUseFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change to the Live Current form after I attack",
  summary: () =>
    "After the last hit of my attack, I change into my Live Current form. As built, only when I am not in it yet and my move counts as Fire or Electric type.",
  synonyms: [
    "phoenix foliage",
    "transform after attacking",
    "form change on attack",
    "charge up form",
    "elemental form",
    "shift form",
  ],
  examples: ["Change into my charged form after using a Fire or Electric move"],
  params: [],
  noParamsReason:
    "The form it changes into is fixed (it is whichever form of this species is wired for the manual form-change trigger, 'live-current'), and the Fire or Electric rule lives in the condition block, not in a setting of the effect.",
  conditions: [
    // The gate: all[not mon.in-form live-current, any[move.type FIRE, move.type ELECTRIC]]. Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "mon.in-form and move.type", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Only after the final hit of a multi-hit move of mine (request R18 asks for this as a named safety rule)",
    "My species must have the Live Current form wired for the manual form change, otherwise nothing happens",
    "It never changes form for a preview (a simulated hit)",
  ],
  effect: { id: "effect.change-form", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Fire, Water and Electric-less moves against a healthy and a half-health target; the holder of the grid has no
      // Live Current form, so the changing case is driven in phoenix-foliage.test.ts with a stand-in.
      name: "elemental and other moves",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is the library's 'change form' (effect.change-form, planned, not implemented yet; request R19 states the exact call: `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)` when the holder is not already in the key form). The key is fixed ('live-current'), so the declaration has no param (written reason above). The gate maps entirely to existing atoms (mon.in-form negated, move.type FIRE or ELECTRIC with the effective type, the same `getMoveType` the class calls). The final-hit rule (turnData.hitsLeft <= 1 on MY OWN turn data) has no guard id: the registry's `after-final-hit` reads the OTHER pokemon's hits left (written for Wimp Out, where the other one is the attacker), so using it here would read the foe; request R18. Users: Phoenix Foliage (6029, attr 1) only; attr 0 is a paralysis immunity (another class) and attr 2 is the same rule when I am hit. Oddity, not a bug: the class constructor passes an always-true attack condition to PostAttackAbAttr, which is never read because canApply does not call super, and `triggerLiveCurrent` repeats the in-form test inside apply. No game bug found.",
});
