/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier A event-effect whose one constructor argument is a NUMBER-returning closure. See ../PRECEDENTS.md.
//
// "When a battle begins, if my form is not the one my form function names, run my ability's form change." Clauses:
//   - `canApply`: `formFunc(pokemon) !== pokemon.formIndex` = feasibility (nothing to change when the form is right),
//     then `!simulated` = the class does nothing for a simulated call (no side effect either way, so "respects").
//     The order matters only in that `formFunc` runs BEFORE the simulated test; every user's function is pure.
//   - `apply`: `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger, false)`. The function's
//     number is only used to DECIDE whether a change is needed; the target form always comes from the species'
//     registered ability-trigger form changes. Unusual, but it is what the game does and it is kept.
// Dispatch: applyAbAttrs("PostBattleInitAbAttr", { pokemon }) at battle-scene.ts:2684 and in two mystery encounters
// (colosseum, the-winstrate-challenge). `simulated` is never passed there, so it is undefined (falsy).
//
// THE CLOSURE: `formFunc` answers "which form index should I have?" with a number, not a yes/no. The library has only
// yes/no atoms and the binding model can only hold a yes/no tree, so every user stays a legacy-closure (counted as
// undecomposed) until the librarian adds number-valued form pickers (requests/B01.md, R-B01-3).
import { PostBattleInitFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostBattleInitFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.battle-start",
  label: "Reset my form when a battle begins",
  summary: () =>
    "When a battle begins, my form is set back to the right one for my ability. Example: Zen Mode or Ice Face go back to their normal form.",
  synonyms: ["revert form", "reset form", "back to normal form", "zen mode", "disguise", "start in base form"],
  examples: ["Return to my normal form at the start of every battle, like Zen Mode"],
  params: [],
  noParamsReason:
    "The only argument is a function that returns a form number. It cannot be a typed setting until the library has number-valued form pickers (request R-B01-3); each user's function is bound as a legacy closure meanwhile.",
  conditions: [
    // A number-returning closure, not a yes/no condition: ctx "none" means no library tree can be compiled into it.
    { slot: "ctor:0", ctx: "none", path: "formFunc", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "The form must differ from the form my ability asks for",
    "Does nothing in a simulated preview",
    "The species must have a form change registered for its ability (otherwise nothing happens)",
  ],
  effect: { id: "effect.change-form", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "start of a battle", axes: {} }],
  l2StaticReason:
    "The shared battle-start template never calls applyAbAttrs for the start of a battle, so no template evaluates this attr; the test/tests/elite-redux/decomp/B01/post-battle-init.test.ts drives the real dispatch with a stand-in form function.",
  status: "decomposed",
  notes:
    "Users (10 attrs, all legacy-closure): Zen Mode, Schooling, Disguise (attr 3), Ice Face (attr 5), Zero to Hero (attr 2) and Patchwork (attr 3) return 0; Shields Down returns formIndex % 7 (keeps its colour); Battle Bond returns 1 and carries an attr-level condition (Greninja, not fused); Power Construct returns formIndex - 2 and carries an attr-level condition (form 4 or 5); Revelation returns the School form above 25% HP and the base form at or below it. The class is also pushed by init-elite-redux-unown-school.ts (Revelation) and appears in Pokemon.FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3581), which lets a locked innate still drive a form change. Needs: effect 'run the ability form change' (request R-B01-4).",
});
