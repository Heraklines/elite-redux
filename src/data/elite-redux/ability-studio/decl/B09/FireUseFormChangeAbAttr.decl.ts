/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "When I use a Fire-type move, I change form" (Flammable Coat, the using half).
//
// Source: src/data/elite-redux/archetypes/fire-interaction-form-change.ts, class FireUseFormChangeAbAttr (extends PostAttackAbAttr).
// Dispatched after one strike of a move of the holder lands (`applyAbAttrs("PostAttackAbAttr")`, move-effect-phase). The constructor
// passes `(_u, _t, _m) => true` and showAbility `true` to the parent; the parent's closure is DEAD because canApply is overridden and
// never calls super. Clauses of the original canApply, in order:
//   1. `pokemon.isFainted()`                          -> false     a fainted holder never changes form              -> guards()
//   2. `isInForm(pokemon, targetFormKey)`             -> false     already in the form (species.forms[formIndex].formKey)  -> gate
//   3. `pokemon.turnData.hitsLeft > 1`                -> false     only after the LAST strike of a multi-hit move  -> guards()
//   4. `pokemon.getMoveType(move) === FIRE`                        the move I used is Fire type, after my type-changing abilities -> gate
// apply: `simulated` -> nothing; else `tryTriggerEngulf`: if the species has no form `targetFormKey` it warns once per attr instance
// (`warnState`) and does nothing; else `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`, which only
// works when a one-way manual edge is registered. No random draw.
// Tier B: guards = 1 and 3, gate = 2 and 4, no prepare, no residual. The split evaluates 1 and 3 before 2 and 4: all four are
// side-effect-free boolean reads, so the combined rule is unchanged and nothing consumes a random number.
//
// The form change itself is the library effect `effect.change-form` (planned). The class has no cure-status rider.
import { FireUseFormChangeAbAttr } from "#data/elite-redux/archetypes/fire-interaction-form-change";

export default defineDecl(FireUseFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change form when I use a Fire-type move",
  summary: params =>
    `After I use a Fire-type move (after the last strike of a multi-hit move), I change to the ${String(params.formKey)} form, unless I am already in it.`,
  synonyms: [
    "flammable coat",
    "engulfed form",
    "fire move form change",
    "ignite and transform",
    "transform after fire move",
    "change form when using fire",
  ],
  examples: ["Turn into the engulfed form after I use a Fire move, like Flammable Coat"],
  params: [
    {
      id: "formKey",
      ctorIndex: 0,
      path: "targetFormKey",
      control: "text",
      label: "Form I change to (only forms with a registered one-way change work)",
      editable: true,
      default: "engulfed",
    },
  ],
  gateParams: [{ param: "formKey", block: "mon.in-form", field: "key" }],
  conditions: [
    // all[ not in-form{formKey}, move.type FIRE ], spelled out per user in bindings.ts.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "I only change form after the last strike of a multi-hit move, not after each strike (kept in the class; request R-B09-26 for a named safety rule)",
    "The species must have that form and a registered one-way form change; otherwise nothing happens (a warning is logged once)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.change-form", params: ["formKey"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "my attack with a Fire move and a non-Fire move at several HP values",
      axes: { hp: ["max", "max-1"], foeMove: ["TACKLE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Flammable Coat (5373 attr 0, built by archetype-dispatcher.ts:4217 with form key 'engulfed'; attr 1 is the hit half FireHitFormChangeAbAttr). The gate binding spells out `not in the form AND the move is Fire (effective type)` with the form key repeated, so gateParams keeps the key setting and the gate equal. mon.in-form reads `pokemon.getFormKey() === key` where the class reads `species.forms[formIndex]?.formKey === key`; they only differ for an EMPTY key (getFormKey returns '' for a missing form, the class gets undefined), and the key setting must not be empty. The hitsLeft rule is a safety rule with no library guard (the existing after-final-hit reads the OTHER Pokemon's turn data and is for the damage hook); it stays in guards(). The harness holder has no 'engulfed' form, so the 'already in the form' half is proven by B09/chunk1.test.ts with a stand-in form key. Oddity, not fixed: the one-way manual edge has no revert, so once Engulfed the attr is a permanent no-op; the warn-once state (`warnState`) is per attr instance and a rebuilt instance warns again.",
});
