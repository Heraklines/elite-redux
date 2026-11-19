/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier A event-effect whose one constructor argument is a NUMBER-returning closure. See ../PRECEDENTS.md. Same shape as the
// chunk 1 class PostTurnFormChangeAbAttr (it differs in having no species range check).
//
// "When I faint, if my form is not the one my form function names, run my ability's form change." Clauses (ab-attrs.ts,
// PostFaintFormChangeAbAttr), in the ORIGINAL order:
//   canApply  condition `formFunc(pokemon) !== pokemon.formIndex`: nothing to do when the form is already right. The HP, form and species
//             tests of each user live INSIDE their function or in an attr-level condition (see notes), so they are not visible as IFs yet.
//   apply     (skips simulated) `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger, false)`. The number from the
//             function only DECIDES whether to try; the target form always comes from the species' registered ability-trigger form changes.
// THE CLOSURE: `formFunc` answers "which form index should I have?" with a number, not a yes/no. The library has only yes/no atoms and the
// binding model holds a yes/no tree, so every user stays a legacy-closure (counted as undecomposed) until the librarian adds number-valued
// form pickers (requests/B06.md, R-B06-8).
import { PostFaintFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostFaintFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.faint",
  label: "Go back to my normal form when I faint",
  summary: () =>
    "When I faint, if I am not already in the form I should be in, I change form. Example: Disguise puts Mimikyu back in its disguised form after it faints.",
  synonyms: [
    "disguise",
    "battle bond",
    "power construct",
    "revert form on faint",
    "form change on faint",
    "patchwork",
    "revert form",
    "back to base form",
    "normal form",
    "go back",
  ],
  examples: ["Go back to my first form when I faint, like Disguise"],
  params: [],
  noParamsReason:
    "The only argument is a function that returns a form number. It cannot be a typed setting until the library has number-valued form pickers (request R-B06-8); each user's function is bound as a legacy closure meanwhile.",
  conditions: [
    // A number-returning closure, not a yes/no condition: ctx "none" means no library tree can be compiled into it.
    { slot: "ctor:0", ctx: "none", path: "formFunc", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "I must not already be in the form I should be in",
    "My species must have a form change registered for its ability (otherwise nothing happens)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "fainting at full HP and at half HP", axes: { hp: ["max", "50%-1"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: the target form comes from the species' registered ability-trigger form changes, never from the closure number, and the class names no form, so effect.change-form (a named form key plus a cure-status checkbox) would show settings the class never reads; it can move to the ability-form-change effect B01 requests (R-B01-4) once it exists. Users (5 attrs, all legacy-closure, every function pure): Disguise (209, attr 4) and Patchwork (5396, attr 4), `() => 0` (the base form); Battle Bond (210, attr 2), `() => 1`, behind the attr-level condition 'Greninja and not a fusion' that the rebuild copies; Power Construct (211, attr 3), `formIndex - 2`, behind the attr-level condition 'form 4 or 5'; Revelation (5586, attr 3), the Revelation form while HP ratio > the revert ratio, otherwise a base form (HP is 0 on faint, so it reverts, or stays when already base). Atoms the library lacks for these (R-B06-8): the form index, the species, fusion and the HP ratio as a number. PostFaintFormChangeAbAttr is also listed in Pokemon.FORM_CHANGE_DRIVER_ATTRS (pokemon.ts), which lets a locked innate still drive its form change; that is an engine rule about the class name and is untouched.",
});
