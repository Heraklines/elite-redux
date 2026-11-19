/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
// PRECEDENT: branches (bidirectional class, Tier B), spec 3.4. See ../PRECEDENTS.md.
//
// One class, two edges, decided every time the holder is hit:
//   branch "enter form": IF hp-test{direction} AND NOT in-form{key}   DO change-form{key} (+ cureStatus)
//   branch "leave form": IF the opposite hp-test AND in-form{key}     DO return-to-base-form
// The original expresses both as one XOR: `shouldBeInTargetForm ? !inTargetForm : inTargetForm`. The gate binding
// (bindings.ts) spells that XOR out as any[all[...], all[...]] for each user's direction.
//
// Guard `not-fainted` (a fainted holder never changes form) comes first.
// `hp-test` is the class's own ratio comparison `hp / maxHp <= threshold`. For a whole-number percent threshold it
// equals `hp * 100 <= maxHp * pct` (rounding "exact"), so the atom hp.at-most is the faithful form. It is NOT the
// crossing atom: this class re-checks every hit and never looks at the damage.
//
// HONEST LIMIT: both edges go through `triggerPokemonFormChange(..., SpeciesFormChangeManualTrigger)`, which needs
// registered `pokemonFormChanges` edges for `<base> -> key` and `key -> base`. A form key without both edges is a
// silent no-op (the class warns once). The branch effects (change-form, return-base-form) are therefore only
// listed, not composable yet, and `mon.can-change-form` is the atom that checks both edges.
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";

/** formAboveThreshold (boolean) <-> "above" / "at-or-below". */
const directionCodec: ParamCodec = {
  toCtor: value => value === "above",
  fromInstance: raw => (typeof raw === "boolean" ? (raw ? "above" : "at-or-below") : undefined),
};

/** hpThreshold (0..1) <-> percent, rounded so 0.25 reads back as 25 and not 25.000000000000004. */
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 10000) / 100 : undefined),
};

export default defineDecl(HpThresholdFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change form depending on my HP",
  summary: params =>
    `After I am hit, I ${params.direction === "above" ? "am in" : "change to"} the ${params.formKey} form while my HP is ${params.direction === "above" ? "above" : "at or below"} ${params.threshold}%`,
  synonyms: ["ape shift", "form change at low hp", "transform when hurt", "school form", "hivemind", "shift form"],
  examples: ["Change to the battle form at half HP or less and cure my status"],
  params: [
    {
      id: "threshold",
      ctorIndex: 0,
      ctorOption: "hpThreshold",
      path: "hpThreshold",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "HP percent line",
      editable: true,
      default: 50,
      codec: percentCodec,
    },
    {
      id: "formKey",
      ctorIndex: 0,
      ctorOption: "targetFormKey",
      path: "targetFormKey",
      control: "text",
      label: "Form key (only wired keys work)",
      editable: true,
      default: "transformed",
    },
    {
      id: "cureStatus",
      ctorIndex: 0,
      ctorOption: "cureStatus",
      path: "cureStatus",
      control: "boolean",
      label: "Cure my status when I change form",
      editable: true,
      default: false,
    },
    {
      id: "direction",
      ctorIndex: 0,
      ctorOption: "formAboveThreshold",
      path: "formAboveThreshold",
      control: "select",
      label: "I am in the form while my HP is",
      editable: true,
      default: "at-or-below",
      options: ["at-or-below", "above"],
      codec: directionCodec,
    },
  ],
  conditions: [
    // any[ all[hp-test, not in-form], all[opposite hp-test, in-form] ], spelled out per user in bindings.ts.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [],
  branches: [
    {
      label: "Enter the form",
      conditions: ["hp.at-most (direction)", "not mon.in-form (formKey)"],
      effect: { id: "effect.change-form", params: ["formKey", "cureStatus"] },
    },
    {
      label: "Leave the form",
      conditions: ["the opposite hp.at-most", "mon.in-form (formKey)"],
      effect: { id: "effect.return-base-form", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "HP around the line",
      axes: { hp: ["max", "51%", "50%+1", "50%", "50%-1", "25%", "25%+1", 1] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for branches. Users: Ape Shift (50%, 'transformed', cures status) and Locust Swarm (25%, 'hivemind', form ABOVE the line). The decomposition keeps the original XOR as the gate and records the two edges as branches; the two branch effects are planned (not composable) because they need registered form-change edges. The L1 and L2 harness holder has no such form, so the 'in form' half of the gate is proven by the structural test in precedents/branches.test.ts, which fakes the form key.",
});
