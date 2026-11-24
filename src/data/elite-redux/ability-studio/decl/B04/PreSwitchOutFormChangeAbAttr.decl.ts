/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect with ONE constructor closure that does not map yet (Zero to Hero).
//
// Clause classification (PreSwitchOutFormChangeAbAttr):
//   ctor:0    `formFunc(pokemon): number`, Zero to Hero passes `p => (p.isFainted() ? p.formIndex : 1)`.
//   canApply  `this.formFunc(pokemon) !== pokemon.formIndex`  -> the closure decides, so the clause is "I am not
//             fainted AND my form is not form 1 already". It returns a form NUMBER, not a yes/no, so it cannot be a
//             library condition atom or the engine's boolean condition slot: every library form needs two atoms that
//             do not exist (`mon.fainted`, `mon.form-index`) AND a Tier B gate/residual split of canApply so the
//             library can replace the whole comparison. Both are requested in requests/B04.md; until then the closure
//             is bound as a legacy closure (bindings.ts), which the coverage report counts as partly decomposed.
//   apply     `if (!simulated) triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger, false)` -> the
//             EFFECT. Which form follows is decided by the species' registered form-change table (Palafin -> Hero),
//             not by the closure; the closure only gates whether to try.
// No RNG. canApply never reads `simulated`.
import { PreSwitchOutFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreSwitchOutFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.switch-out",
  label: "Change form when I switch out",
  summary: () =>
    "When I switch out, I change form (Palafin turns into its Hero form). Nothing happens if I fainted or already have that form.",
  synonyms: ["zero to hero", "palafin", "hero form", "change form when retreating", "form change on switch"],
  examples: ["Turn into my hero form when I switch out, like Zero to Hero"],
  params: [],
  noParamsReason:
    "The only setting is a function that picks the form to be in; staff cannot type a function. Its one user (Zero to Hero) is bound as a legacy closure until the form atoms in requests/B04.md exist.",
  conditions: [
    {
      slot: "ctor:0",
      ctx: "none",
      path: "formFunc",
      removable: false,
      editable: false,
    },
  ],
  guards: [],
  feasibility: ["My species must have a registered form change for this ability that is allowed right now"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "switch out at full and low HP", axes: { hp: ["max", "50%"] } }],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. User: Zero to Hero (attr 3, after PostBattleInitFormChangeAbAttr at attr 2). The closure is bound with bindLegacyClosure because it returns a form number; recomposeAttr therefore throws for it and L1/L2 leave the attr out (nothing to twin), as designed. Pokemon.FORM_CHANGE_DRIVER_ATTRS keys on this class NAME (innate unlock carve-out), which is untouched. The engine dispatches PreSwitchOutAbAttr AFTER leaveField(), so form 1 is reached from a Pokemon whose summon data may already be reset (kept as is). The Palafin form change itself (and the revert) lives in er-newcomer-species.ts.",
});
