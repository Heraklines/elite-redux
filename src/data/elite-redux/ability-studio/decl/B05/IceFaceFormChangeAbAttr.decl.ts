/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// `Arena.trySetWeather` (arena.ts:537) tells every Pokemon that the weather changed:
// `applyAbAttrs("PostWeatherChangeAbAttr", { pokemon, weather })`. canApply is now just `gate`, in the ORIGINAL clause order
// (no guard, no prepare step, no residual, no random draw). The gate has two pure facts and the binding of each user spells
// BOTH out as separate IF pieces, so staff can drop or replace either:
//   1. `pokemon.formIndex === this.formIndex`   the holder is in the form that can be restored (atom mon.in-form-number)
//   2. `weather === HAIL || weather === SNOW`   the NEW weather is hail or snow (atoms field.weather)
// apply: not when `simulated`; otherwise `globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger)`, which
// runs whatever ability form change the species table has for the current form (for Eiscue the "no-ice" form goes back to the
// Ice Face form).
import { IceFaceFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IceFaceFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-changed",
  label: "Restore my ice face when hail or snow starts",
  summary: params =>
    `When the weather changes and I am in form number ${params.formIndex} (my broken-face form), I get my face back if the new weather is hail or snow.`,
  synonyms: ["ice face", "eiscue", "restore face", "ice head", "regain ice face", "repair face in snow"],
  examples: ["Get my ice face back when it starts to hail or snow, like Ice Face"],
  params: [
    {
      id: "formIndex",
      ctorIndex: 0,
      path: "formIndex",
      control: "number",
      min: 0,
      max: 30,
      step: 1,
      integer: true,
      label: "Form number of my broken-face form (0 = first form, 1 = second form)",
      editable: true,
      default: 1,
    },
  ],
  // The form number is a setting of the gate: the binding spells it out as a "mon.in-form-number" atom and gateParams keeps
  // the atom and the setting in step.
  gateParams: [{ param: "formIndex", block: "mon.in-form-number", field: "formIndex" }],
  conditions: [
    // The gate: "I am in form number N" AND "the new weather is hail or snow", spelled out per user in bindings.ts as two separate IF pieces.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Which form I return to comes from the species' own form-change table",
    "Nothing happens during a simulated check",
  ],
  // The effect is the library piece "trigger-ability-form-change" (R-B05-19; listed, not implemented yet, the class still does it).
  effect: { id: "effect.trigger-ability-form-change", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the weather changes to each kind while the holder is in its first and second form",
      axes: { weather: ["HAIL", "SNOW", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. User: Ice Face (248 attr 3, formIndex 1), bound as gate = all[in form number 1, any[hail, snow]]. The form test used to be a hidden `guards` method; it is now an ordinary condition (atom mon.in-form-number, added by this chunk), the class has no guards, and both clauses are pure reads so their order does not matter. The `weather` of the call and the arena weather are the same when the engine dispatches (arena.ts:537 runs after the arena stored the new weather), which the L1 grid and test/tests/elite-redux/decomp/B05/chunk3-sites.test.ts confirm. The real form change is driven in that test (the Eiscue edge needs the species table). Ice Face also has PostSummonFormChangeAbAttr behind a weather condition and FormBlockDamageAbAttr, each its own class. The class is listed in FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3585), a name check, which a rebuild keeps because it keeps the class. The effect is `effect.trigger-ability-form-change` (R-B05-19, listed, not implemented yet).",
});
