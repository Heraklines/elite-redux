/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier A event-effect whose one constructor argument is a NUMBER-returning closure. See ../PRECEDENTS.md. Same shape as
// the B01 class PostBattleInitFormChangeAbAttr (and the sibling form-change classes of the same file).
//
// "At the end of every turn, if my form is not the one my form function names, run my ability's form change." Clauses
// (ab-attrs.ts, PostTurnFormChangeAbAttr), in the ORIGINAL order:
//   1. feasibility `targetForm = formFunc(pokemon)`; `targetForm < 0 || targetForm >= pokemon.species.forms.length` = false.
//                  Only an EXISTING form is a valid target (ER relocates Hunger Switch and Two-Faced onto custom species that
//                  register no alternate forms; without this bound the attr would fire a no-op every turn).
//   2. condition   `targetForm !== pokemon.formIndex`: nothing to do when the form is already right. The HP, level and form tests
//                  of each user live INSIDE their function (see notes), which is why they are not visible as IFs yet.
//   effect-side    `apply` (skips simulated): `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger,
//                  false)`. The number from the function is only used to DECIDE whether to try; the target form always comes
//                  from the species' registered ability-trigger form changes.
// THE CLOSURE: `formFunc` answers "which form index should I have?" with a number, not a yes/no. The library has only yes/no
// atoms and the binding model holds a yes/no tree, so every user stays a legacy-closure (counted as undecomposed) until the
// librarian adds number-valued form pickers and the atoms its users need (requests/B06.md, R-B06-8).
import { PostTurnFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostTurnFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Change form at the end of the turn when it is needed",
  summary: () =>
    "At the end of every turn, if my form is not the one my ability asks for, I change form. Example: Zen Mode changes form below half HP, Schooling below 25%.",
  synonyms: [
    "zen mode",
    "schooling",
    "shields down",
    "form change each turn",
    "power construct",
    "hunger switch",
    "change form when hurt",
  ],
  examples: ["Check my form every turn and change it when my HP says so, like Zen Mode"],
  params: [],
  noParamsReason:
    "The only argument is a function that returns a form number. It cannot be a typed setting until the library has number-valued form pickers (request R-B06-8); each user's function is bound as a legacy closure meanwhile.",
  conditions: [
    // A number-returning closure, not a yes/no condition: ctx "none" means no library tree can be compiled into it.
    { slot: "ctor:0", ctx: "none", path: "formFunc", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "The form my ability asks for must exist for my species",
    "The form must differ from my current form",
    "The species must have a form change registered for its ability (otherwise nothing happens)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "end of turn at full HP and at 1 HP", axes: { hp: ["max", "50%", "25%", 1] } }],
  status: "decomposed",
  notes:
    "Users (9 attrs, all legacy-closure; each function is pure). The condition each hides, by ability: Zen Mode (161, attr 2): form 1 while HP ratio <= 0.5, else form 0. Shields Down (197, attr 2): `formIndex >= 7 ? formIndex : formIndex % 7 + (HP ratio <= 0.5 ? 7 : 0)`, so Meteor becomes Core at half HP and Core never reverts. Schooling (208, attr 2): form 0 when level < 20 or HP ratio <= 0.25, else form 1. Power Construct (211, attr 2): form + 2 and an attr-level condition (HP ratio <= 0.5 and form 2 or 3). Hunger Switch (258, attrs 0 and 1) and Two-Faced (5486, attrs 0 and 1, with an attr-level ability condition): the two attrs are the two directions of a toggle. Attr 0 returns `getFormKey() ? 0 : 1` and attr 1 returns `getFormKey() ? 1 : 0`; for vanilla Morpeko (form keys full-belly and hangry, both non-empty) attr 0 fires in the hangry form and attr 1 in the full-belly form, so the form flips every turn (the B06 test shows it). On ER's relocated custom species with no registered forms neither fires (the range check). Revelation (5586, attr 2, wired at run time by init-elite-redux-unown-school.ts): the Revelation form while HP ratio > 0.25, else a base form. Atoms the library lacks for these (R-B06-8): the form index, the level, the HP ratio test as a number, form key emptiness. The effect is a PACKAGE (written reason): the target form comes from the species' registered ability-trigger form changes, never from the closure number, and the class names no form, so effect.change-form (a named form key plus a cure-status checkbox) would show settings the class never reads. The librarian should repoint it to the ability-form-change effect B01 requests (R-B01-4) once it exists. PostTurnFormChangeAbAttr is also listed in Pokemon.FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3579), which lets a locked innate still drive its form change; that is an engine rule about the class name and is untouched.",
});
