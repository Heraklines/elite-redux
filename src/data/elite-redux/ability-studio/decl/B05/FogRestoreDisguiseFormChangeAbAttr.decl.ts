/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// The fog twin of IceFaceFormChangeAbAttr. `Arena.trySetWeather` (arena.ts:537) tells every Pokemon that the weather changed;
// canApply is now `guards && gate`, in the ORIGINAL clause order (no prepare step, no residual, no random draw):
//   1. guard  `pokemon.formIndex === this.bustedFormIndex`   the holder is in its busted form (kept in the class, it reads the
//                                                             `bustedFormIndex` setting). Fog can never BREAK an intact disguise,
//                                                             which shares the same form-change trigger in the other direction.
//   2. gate   `isFogWeather(weather)`                         the NEW weather is fog or eerie fog  <- staff may replace it
// apply: not when `simulated`; otherwise `triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger)`, and the species
// table's "busted -> intact" edge puts the disguise back.
import { FogRestoreDisguiseFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FogRestoreDisguiseFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-changed",
  label: "Restore my broken disguise when fog sets in",
  summary: params =>
    `When the weather changes to fog and I am in form number ${params.bustedFormIndex} (my broken disguise), my disguise is restored.`,
  synonyms: [
    "disguise",
    "patchwork",
    "mimikyu",
    "restore disguise",
    "repair disguise in fog",
    "fog heal form",
    "busted form",
  ],
  examples: ["Put my disguise back when fog is set, like Patchwork"],
  params: [
    {
      id: "bustedFormIndex",
      ctorIndex: 0,
      path: "bustedFormIndex",
      control: "number",
      min: 0,
      max: 30,
      step: 1,
      integer: true,
      label: "Form number of my broken disguise (0 = first form, 1 = second form)",
      editable: true,
      // Only the guard reads it; the weather gate never repeats it.
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate: "the weather that was just set is fog or eerie fog" (any of field.weather), spelled out per user in bindings.ts.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only while I am in the broken-disguise form named by the setting above, so fog never breaks an intact disguise",
    "Which form I return to comes from the species' own form-change table",
    "Nothing happens during a simulated check",
  ],
  // No library effect fires an ability form change yet (R-B05-19), so the effect is a package.
  effect: { id: "effect.package", params: ["bustedFormIndex"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the weather changes to fog, eerie fog and rain while the holder is in its first and second form",
      axes: { weather: ["FOG", "EERIE_FOG", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Users (all formIndex 1, all bound as a gate = fog or eerie fog, two field.weather atoms): Disguise (209 attr 5), Patchwork (5396 attr 5 and attr 7: the ability carries the whole pair twice, attrs 5 to 8; whether the second copy ever fires after the first was not traced, both are bound the same). The form test is kept first as the class's `guards` to keep the original order; both clauses are pure reads. isFogWeather covers FOG and EERIE_FOG. The `weather` of the call equals the arena weather at dispatch (arena.ts:537). Patchwork's companion PostSummonFogRestoreDisguiseAbAttr is its own declaration. The class is listed in FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3588).",
});
