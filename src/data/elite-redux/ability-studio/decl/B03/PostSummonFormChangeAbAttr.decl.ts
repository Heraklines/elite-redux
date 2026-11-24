/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 4. Tier A, but the one constructor argument is a FORM FUNCTION `(pokemon) => formIndex`, not a yes/no closure
// (same shape as PostVictoryFormChangeAbAttr, chunk 1).
//
//   canApply   formFunc(holder) !== holder.formIndex      "the form I should have is not the form I am in"
//   apply      unless simulated: `triggerPokemonFormChange(holder, SpeciesFormChangeAbilityTrigger, false)`
//
// `apply` never reads the function: the species' registered ability-trigger edge decides the new form. The function only
// tells canApply whether a change is still due, so the ONE condition of the class is "my right form differs from my form".
// That is a yes/no rule staff must be able to see and swap, but it is written as a function that returns a form NUMBER, and
// the library has neither the slot kind that compiles a yes/no rule into such a function (request "form function" slot, see
// chunk 1) nor the atoms the seven closures need (`mon.form-number`, `mon.level`, both in requests/B03.md). So every user is
// a legacy-closure until those exist; the gate each one will become is written next to its binding in bindings.ts.
//
// The WHEN dispatch also runs when the ability is gained in the middle of a battle (`activateOnGain` is true), and the engine
// never replays this class after a form change (`applyPostFormChangeAbAttrs` skips it, to avoid loops); neither is a rule of
// the class.
import { PostSummonFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Change form to match my HP or level when I enter",
  summary: () =>
    "When I enter the battle, if I am not in the form I should have, I change form. Example: a Pokemon at 50% HP or less enters in its low-HP form.",
  synonyms: [
    "zen mode",
    "schooling",
    "shields down",
    "power construct",
    "ice face",
    "tera shift",
    "change form on entry",
    "switch form when sent out",
  ],
  examples: ["Change into my low-HP form when I enter at half HP or less, like Zen Mode"],
  params: [],
  noParamsReason:
    "The only constructor argument is a form function that returns a form number per Pokemon; there is no number or word staff could type. The HP lines, the level and the form numbers live inside each user's function and become IF blocks once the library has the atoms (requests/B03.md). Which form I change to is decided by the species' registered form-change table, not by this class.",
  conditions: [{ slot: "ctor:0", ctx: "none", path: "formFunc", removable: false, editable: false }],
  guards: [],
  feasibility: [
    "My species must have a form change registered for this ability",
    "It does nothing in a preview",
    "It does nothing when I am already in the form I should have",
    "It also works when I gain this ability in the middle of a battle, but it is not repeated after a form change",
  ],
  effect: { id: "effect.change-form", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "HP around the form lines",
      axes: { hp: ["max", "51%", "50%+1", "50%", "50%-1", "25%+1", "25%", "25%-1", 1] },
    },
  ],
  status: "decomposed",
  notes:
    "Legacy closure pending a library request, 7 attrs of 7 abilities, all `ctor:0` form functions: Zen Mode (161 attr 1, `hp <= 0.5 ? 1 : 0`), Shields Down (197 attr 1, `formIndex >= 7 ? formIndex : formIndex % 7 + (hp <= 0.5 ? 7 : 0)`), Schooling (208 attr 1, `level < 20 || hp <= 0.25 ? 0 : 1`), Power Construct (211 attr 1, `formIndex + 2`, with the attr-level condition `hp <= 0.5 && formIndex is 2 or 3`), Ice Face (248 attr 2, `() => 0`, with the attr-level weather condition Hail or Snow), Tera Shift (307 attr 0, `getFormKey() ? 0 : 1`) and Revelation (5586 attr 1, unown-school wiring: `hp > 0.25 ? revelationIndex : (formIndex === revelationIndex ? 0 : formIndex)`). A rebuild is impossible without the closure, so L1 and L2 carry the original attr over (counted as undecomposed); the form-change table of the species decides every outcome and the harness holder has no such form, so the truth table of each closure against its intended library gate is proven by test/tests/elite-redux/decomp/B03/chunk4.test.ts. Needs: atoms `mon.form-number` and `mon.level`, the `form function` condition slot of chunk 1, and the `extra` slot for the two attr-level conditions of Power Construct and Ice Face. Quirks recorded, not fixed: `apply` ignores the form function, so if the registered edge led to a different form than the function names, canApply would keep passing (same note as PostVictoryFormChangeAbAttr); Shields Down and Power Construct read `formIndex` arithmetic, so they only make sense for the form order of their species; Revelation's function reads the module constant `REVERT_HP_RATIO` (0.25) and the Revelation form number found at start-up.",
});
