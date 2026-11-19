/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// `Arena.trySetWeather` (arena.ts:537) tells every Pokemon that the weather changed:
// `applyAbAttrs("PostWeatherChangeAbAttr", { pokemon, weather })`. canApply is now `guards && gate`, in the ORIGINAL clause
// order (no prepare step, no residual, no random draw):
//   1. guard  `pokemon.formIndex === this.formIndex`            the holder is in the form that can be restored (kept in the
//                                                                class, it reads the `formIndex` setting)
//   2. gate   `weather === HAIL || weather === SNOW`            the NEW weather is hail or snow  <- staff may replace it
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
      // Only the guard reads it; the weather gate never repeats it.
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate: "the weather that was just set is hail or snow" (any of field.weather), spelled out per user in bindings.ts.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only while I am in the broken-face form named by the setting above",
    "Which form I return to comes from the species' own form-change table",
    "Nothing happens during a simulated check",
  ],
  // No library effect fires an ability form change yet (R-B05-19), so the effect is a package.
  effect: { id: "effect.package", params: ["formIndex"] },
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
    "Tier B. User: Ice Face (248 attr 3, formIndex 1), bound as a gate = hail or snow (any of two field.weather atoms). The form test is kept first as the class's `guards` to keep the original order; both clauses are pure reads. The `weather` of the call and the arena weather are the same when the engine dispatches (arena.ts:537 runs after the arena stored the new weather), which the L1 grid and test/tests/elite-redux/decomp/B05/chunk3-sites.test.ts confirm. The real form change is driven in that test (the Eiscue edge needs the species table). Ice Face also has PostSummonFormChangeAbAttr behind a weather condition and FormBlockDamageAbAttr, each its own class. The class is listed in FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3585), a name check, which a rebuild keeps because it keeps the class. Request for a form-number atom: R-B05-19.",
});
