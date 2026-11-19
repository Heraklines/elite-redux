/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier A, but the one constructor argument is a FORM FUNCTION `(pokemon) => formIndex`, not a yes/no closure.
//
//   canApply   formFunc(holder) !== holder.formIndex      "the form I should have is not the form I am in"
//   apply      triggerPokemonFormChange(holder, SpeciesFormChangeAbilityTrigger) (skipped when simulated)
//
// `apply` never reads the function: the species' registered ability-trigger edge decides the new form. The function
// only tells canApply whether a change is still due. The two users are both Battle Bond attrs (Greninja: always form
// 2; any other Battle Bond species: the target form that its form-change table names), each with an attr-level
// condition that picks the species. The library has no yes/no atom for "I am already in my Battle Bond target form",
// and its condition slots take yes/no closures, so the slot is a legacy closure until requests/B03.md is answered.
import { PostVictoryFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostVictoryFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-win",
  label: "Change form after I knock out a Pokemon",
  summary: () =>
    "After I knock out a Pokemon, I change into my special form if I am not in it yet. Example: Greninja turning into its Ash form.",
  synonyms: ["battle bond", "ash greninja", "transform on ko", "form change on victory", "evolve after a ko"],
  examples: ["Change into my battle form after I knock out a Pokemon"],
  params: [],
  noParamsReason:
    "The only constructor argument is a form function that returns a form number per Pokemon; there is no number or word staff could type, and the real target form comes from the species' registered form-change table.",
  conditions: [{ slot: "ctor:0", ctx: "none", path: "formFunc", removable: false, editable: false }],
  guards: [],
  feasibility: [
    "My species must have a form change registered for this ability",
    "It does nothing in a preview",
    "It does nothing when I am already in the form I should have",
  ],
  effect: { id: "effect.change-form", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "knock out a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Legacy closure pending a library request. Two attrs, both Battle Bond (210): attr 0 `() => 2` for Greninja, attr 3 `getBattleBondTargetFormIndex(p) ?? p.formIndex` for the other species, both with an attr-level extraCondition. A rebuild is impossible without the closure, so L1 and L2 carry the original attr over (counted as undecomposed). Needs: an atom 'I am already in my ability-trigger target form' and a form-function slot that compiles it. Quirk recorded, not fixed: `apply` ignores formFunc, so if the registered edge led to a different form than formFunc names, canApply would keep passing; the L1 pair of Battle Bond is consistent today.",
});
