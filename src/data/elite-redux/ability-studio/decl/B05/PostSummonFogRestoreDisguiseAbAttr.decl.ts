/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// The switch-in half of Patchwork's fog rule (`PostSummonAbAttr`, WHEN "when I enter the battle"); the weather-change half is
// FogRestoreDisguiseFormChangeAbAttr. canApply is now just `gate`, in the ORIGINAL clause order (no guard, no prepare step, no
// residual, no random draw). Two pure facts, which the binding of each user spells out as separate IF pieces:
//   1. `pokemon.formIndex === this.bustedFormIndex`          the holder is in its busted form (atom mon.in-form-number)
//   2. `isFogWeather(globalScene.arena.weatherType)`         the weather on the field is fog or eerie fog (atoms field.weather)
// apply: not when `simulated`; otherwise `triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger)`.
// `shouldActivateOnFormChange()` is false, so the attr does NOT run again when the holder changes form mid-battle (otherwise
// Disguise, once busted, would be restored at once while fog lasts and block every hit). It stays in the class: it is a safety
// rule of this attr, not a rule staff would change, and it is listed as feasibility.
import { PostSummonFogRestoreDisguiseAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonFogRestoreDisguiseAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Restore my broken disguise when I enter in fog",
  summary: params =>
    `When I enter the battle during fog and I am in form number ${params.bustedFormIndex} (my broken disguise), my disguise is restored.`,
  synonyms: ["disguise", "patchwork", "mimikyu", "restore disguise on entry", "repair disguise in fog", "busted form"],
  examples: ["Put my disguise back when I switch in while it is foggy, like Patchwork"],
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
    // The gate: "I am in form number N" AND "the weather on the field is fog or eerie fog", spelled out per user in bindings.ts as two separate IF pieces.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "It does not run again when I change form during the battle, so a disguise that just broke is not restored at once",
    "Which form I return to comes from the species' own form-change table",
    "Nothing happens during a simulated check",
  ],
  // The effect is the library piece "trigger-ability-form-change" (R-B05-19; listed, not implemented yet, the class still does it).
  effect: { id: "effect.trigger-ability-form-change", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "entering in fog, eerie fog and rain while the holder is in its first and second form",
      axes: { weather: ["FOG", "EERIE_FOG", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Users (all bustedFormIndex 1): Disguise (209 attr 6), Patchwork (5396 attr 6 and attr 8). Each is bound as gate = all[in form number 1, any[fog, eerie fog]]. The form test used to be a hidden `guards` method; it is now an ordinary condition (atom mon.in-form-number), the class has no guards, and both clauses are pure reads so their order does not matter. `shouldActivateOnFormChange` returning false is a method of the class and survives the rebuild because the rebuild keeps the class (checked in chunk3-sites.test.ts). The class is listed in FORM_CHANGE_DRIVER_ATTRS (pokemon.ts:3589). The effect is `effect.trigger-ability-form-change` (R-B05-19, listed, not implemented yet).",
});
