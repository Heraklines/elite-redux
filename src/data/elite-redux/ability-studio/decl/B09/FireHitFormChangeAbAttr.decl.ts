/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "When I am hit by a Fire-type move, I change form" (Flammable Coat, the being-hit half).
//
// Source: src/data/elite-redux/archetypes/fire-interaction-form-change.ts, class FireHitFormChangeAbAttr (extends PostDefendAbAttr,
// constructor `super()` so showAbility is the default `true`). Dispatched after the holder is hit (`applyAbAttrs("PostDefendAbAttr")`).
// Clauses of the original canApply, in order:
//   1. `pokemon.isFainted()`                          -> false     a fainted holder never changes form             -> guards()
//   2. `isInForm(pokemon, targetFormKey)`             -> false     already in the form                             -> gate
//   3. `attacker.getMoveType(move) === FIRE`                       the move that hit me is Fire type, from the ATTACKER's point of
//                                                                  view (its Normalize or Pixilate counts)         -> gate
// There is NO last-strike test: every strike of a multi-hit move is evaluated (the second one finds the holder already in the form).
// apply: `simulated` -> nothing; else `tryTriggerEngulf` (warn once if the species lacks the form, else
// `triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`). No random draw.
// Tier B: guards = clause 1, gate = clauses 2 and 3, in the original order.
import { FireHitFormChangeAbAttr } from "#data/elite-redux/archetypes/fire-interaction-form-change";

export default defineDecl(FireHitFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change form when I am hit by a Fire-type move",
  summary: params =>
    `After a Fire-type move hits me, I change to the ${String(params.formKey)} form, unless I am already in it. The move's type counts after the attacker's own type changes.`,
  synonyms: [
    "flammable coat",
    "engulfed form",
    "fire hit form change",
    "ignite when hit",
    "transform when burned by fire",
    "change form when hit by fire",
  ],
  examples: ["Turn into the engulfed form when a Fire move hits me, like Flammable Coat"],
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
    "The species must have that form and a registered one-way form change; otherwise nothing happens (a warning is logged once)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.change-form", params: ["formKey"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a Fire move and a non-Fire move hit me at several HP values",
      axes: { hp: ["max", "max-1"], foeMove: ["TACKLE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Flammable Coat (5373 attr 1, form key 'engulfed'; attr 0 is the using half FireUseFormChangeAbAttr). The gate binding spells out `not in the form AND the attacker's move is Fire (effective type)`; for a defending hook the library atom move.type reads the attacker (WHEN_MOVE_USER maps event.after-hit to other), the same `attacker.getMoveType(move)` call as the class. gateParams keeps the key setting and the gate equal. mon.in-form differs from the class's form test only for an EMPTY key (see FireUseFormChangeAbAttr). The harness holder has no 'engulfed' form, so the 'already in the form' half is proven by B09/chunk1.test.ts with a stand-in form key. Oddity, not fixed: the one-way manual edge has no revert, so once Engulfed the attr is a permanent no-op; a multi-hit Fire move evaluates the gate on every strike (harmless: the first strike changes the form and the rest find it).",
});
