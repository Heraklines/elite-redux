/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// The fog twin of IceFaceFormChangeAbAttr. `Arena.trySetWeather` (arena.ts:537) tells every Pokemon that the weather changed;
// canApply is now just `gate`, in the ORIGINAL clause order (no guard, no prepare step, no residual, no random draw). Two pure
// facts, which the binding of each user spells out as separate IF pieces (staff can drop or replace either):
//   1. `pokemon.formIndex === this.bustedFormIndex`   the holder is in its busted form (atom mon.in-form-number). Without it fog
//                                                      would BREAK an intact disguise, since the species table shares the same
//                                                      form-change trigger in the other direction.
//   2. `isFogWeather(weather)`                         the NEW weather is fog or eerie fog (atoms field.weather)
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
      default: 1,
    },
  ],
  // The form number is a setting of the gate: the binding spells it out as a "mon.in-form-number" atom and gateParams keeps
  // the atom and the setting in step.
  gateParams: [{ param: "bustedFormIndex", block: "mon.in-form-number", field: "formIndex" }],
  conditions: [
    // The gate: "I am in form number N" AND "the new weather is fog or eerie fog", spelled out per user in bindings.ts as two separate IF pieces.
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
      name: "the weather changes to fog, eerie fog and rain while the holder is in its first and second form",
      axes: { weather: ["FOG", "EERIE_FOG", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Users (all formIndex 1): Disguise (209 attr 5), Patchwork (5396 attr 5 and attr 7: the ability carries the whole pair twice, attrs 5 to 8; whether the second copy ever fires after the first was not traced, both are bound the same). Each is bound as gate = all[in form number 1, any[fog, eerie fog]]. The form test used to be a hidden `guards` method; it is now an ordinary condition (atom mon.in-form-number), the class has no guards, and both clauses are pure reads so their order does not matter. isFogWeather covers FOG and EERIE_FOG. The `weather` of the call equals the arena weather at dispatch (arena.ts:537). Patchwork's companion PostSummonFogRestoreDisguiseAbAttr is its own declaration. The class is listed in FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3588). The effect is `effect.trigger-ability-form-change` (R-B05-19, listed, not implemented yet).",
});
