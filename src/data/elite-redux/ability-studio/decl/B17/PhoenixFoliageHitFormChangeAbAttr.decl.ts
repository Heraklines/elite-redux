/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Phoenix Foliage, second of two form-change attrs (after I am hit). Read by hand: fakemon-pitch-mechanics.ts
// `PhoenixFoliageHitFormChangeAbAttr` (+ the helpers isLiveCurrent, isPhoenixFoliageType, triggerLiveCurrent), its base
// PostDefendAbAttr (dispatched after the holder was hit), and the first attr PhoenixFoliageUseFormChangeAbAttr.
//
// canApply, clause by clause, in the order they run (`canApply = guards && gate`, no residual):
//   1. guard      I have not fainted: `!pokemon.isFainted()`                                            -> `guards`, guard not-fainted
//   2. condition  I am not in the Live Current form yet: `!(species.forms[formIndex]?.formKey === "live-current")`
//                                                                                -> `gate`, atom mon.in-form (holder, live-current), negated
//   3. condition  the move that hit me counts as Fire or Electric for the ATTACKER: `opponent.getMoveType(move)`
//                                                                                -> `gate`, atom move.type (effective), twice, in an `any`
// apply: unless simulated, `if (!isLiveCurrent) globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`.
// There is no final-hit rule here (unlike the "after I attack" half). No random draw, no memory.
import { PhoenixFoliageHitFormChangeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PhoenixFoliageHitFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change to the Live Current form after I am hit",
  summary: () =>
    "After I am hit, I change into my Live Current form. As built, only when I am not in it yet and the move that hit me counts as Fire or Electric type.",
  synonyms: [
    "phoenix foliage",
    "transform when hit",
    "form change on being hit",
    "absorb an element to transform",
    "elemental form",
    "shift form",
  ],
  examples: ["Change into my charged form after being hit by a Fire or Electric move"],
  params: [],
  noParamsReason:
    "The form it changes into is fixed (it is whichever form of this species is wired for the manual form-change trigger, 'live-current'), and the Fire or Electric rule lives in the condition block, not in a setting of the effect.",
  conditions: [
    // The gate: all[not mon.in-form live-current, any[move.type FIRE, move.type ELECTRIC]]. Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "mon.in-form and move.type", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "My species must have the Live Current form wired for the manual form change, otherwise nothing happens",
    "It never changes form for a preview (a simulated hit)",
  ],
  effect: { id: "effect.change-form", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Fire, Water and Bite against a healthy and a half-health holder; the grid holder has no Live Current form, so
      // the changing case is driven in phoenix-foliage.test.ts with a stand-in.
      name: "hits of different types at full and half HP",
      axes: { hp: ["max", "50%"], foeMove: ["EMBER", "WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: same effect and same gate as the 'after I attack' half, with the move type read from the attacker (the frame's moveUser is the other pokemon for this trigger, which is what `opponent.getMoveType(move)` reads). effect.change-form is planned and not implemented yet (request R19); the key is fixed ('live-current'), hence no param. Users: Phoenix Foliage (6029, attr 2) only. Oddity, not a bug: unlike the 'after I attack' half there is no final-hit rule, so a multi-hit Fire move can change the form already on an early hit (the later hits then find the holder in the form). No game bug found.",
});
