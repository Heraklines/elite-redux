/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { hitFilterCodec, NO_FILTER_TEXT } from "#data/elite-redux/ability-studio/decl/B09/hit-filter-codec";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 3. "My extra hits deal less damage" (the second half of Raging Boxer, Primal Maw, Hyper Aggressive, Raging Moth ...).
//
// Source: src/data/elite-redux/archetypes/hit-multiplier.ts, class HitMultiplierPowerAbAttr (extends MoveDamageBoostAbAttr, which
// extends PreAttackAbAttr). Dispatched once per STRIKE while damage is calculated (`applyAbAttrs("MoveDamageBoostAbAttr")`).
// The constructor builds a closure and hands it to the parent, whose canApply returned `condition(pokemon, target, move)`:
//   1. `HitMultiplierAbAttr.matchesFilter(filter, pokemon, move)`   the move matches the filter  -> gate (IF)
//   2. when `extraStrikesOnly`: `pokemon.turnData.hitCount - pokemon.turnData.hitsLeft > 0`   this is the 2nd or a later strike
//                                                                                   -> residual (a setting, see below)
// apply (the parent's): `damage.value = toDmgValue(damage.value * damageMultiplier)`. No random draw, nothing reads `simulated`.
// Constructor: ({ multiplier, filter?, extraStrikesOnly? }), one options object; throws for a multiplier <= 0 or > 1 and for a NONE flag.
// Tier B: gate = clause 1, residual = clause 2. The class now overrides canApply with the gate/residual split and keeps the
// closure for the parent unchanged (it is no longer called).
//
// `extraStrikesOnly` is a real SETTING of the class (every hit, or only the extra hits), so clause 2 is not an IF: the gate
// carries only the move test and the residual reads the setting. The filter is one nested object, so it is one param with a text
// codec (hit-filter-codec.ts), not editable for the same reason as in HitMultiplierAbAttr.
import { HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";

export default defineDecl(HitMultiplierPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-dealt",
  label: "Make my extra hits deal less damage",
  summary: params =>
    `The damage of my matching hits is multiplied by ${params.multiplier} (0.4 = 40% of normal). ${
      params.extraStrikesOnly === true
        ? "Only the second and later hits are weaker; the first hit stays at full damage."
        : "Every hit is weaker."
    }`,
  synonyms: [
    "weaker second hit",
    "reduced extra hit",
    "raging boxer",
    "hyper aggressive",
    "extra hit damage",
    "second hit power",
    "scale down multi hit",
  ],
  examples: [
    "The second hit of my punching moves deals 40% damage, like Raging Boxer",
    "Both hits of my Fire moves deal 70% damage, like Raging Moth",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "powerMultiplier",
      control: "slider",
      label: "Damage multiplier of the weaker hits (0.4 = 40% of normal, at most 1)",
      editable: true,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
      min: 0.05,
      max: 1,
      step: 0.05,
      default: 0.4,
    },
    {
      id: "extraStrikesOnly",
      ctorIndex: 0,
      ctorOption: "extraStrikesOnly",
      path: "extraStrikesOnly",
      control: "boolean",
      label: "Only the 2nd and later hits are weaker (off = every hit is weaker)",
      editable: true,
      // Only the residual (a clause the class keeps) reads it; the gate never repeats it.
      gateIndependent: true,
      default: true,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "powerFilter",
      control: "text",
      label: "Which moves get weaker hits (set by the move condition)",
      // Decides the SHAPE of the gate (type atom, property atom or none); staff replace the whole gate instead.
      editable: false,
      default: NO_FILTER_TEXT,
      codec: hitFilterCodec,
    },
  ],
  conditions: [
    // The gate: "the move matches the filter". Each user's binding names its own shape (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "When only the extra hits are weaker, the hit being dealt must be the 2nd or a later one of the move",
    "The multiplier cannot be above 1: this block only makes hits weaker",
  ],
  effect: { id: "effect.multiply-damage-dealt", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my attack at full HP and one HP below full (the move test does not read HP; the move grid covers types and properties)",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 25 attrs in 25 abilities (including Contaminated, whose partner class is ContaminatedHitMultiplierAbAttr in B16). Gate bindings mirror HitMultiplierAbAttr: one move.flag per single property, move.type for Raging Moth (Fire), an any of two move.flag for Flurry, an always-true gate for the unfiltered ones (Hyper Aggressive, Raging Goddess, Balloon Blitz, Frenzied Phantom, Witch Broom, Ghost Frenzy, Contaminated). Dual Wield, Minigun and Two-Chambered are legacy-closure (one combined mask Pulse | Slicing, request R-B09-12). 16 attrs have extraStrikesOnly = true (Raging Boxer, Hyper Aggressive, Primal Maw ...) and 9 have false (Raging Moth, Dual Wield, Jackhammer, Magus Blades, Minigun, Dogged Jaw, Two-Chambered, Flurry, Twin Lion Fists). The strike number is read from turnData.hitCount - hitsLeft, which is only meaningful while a move is being dealt; the residual and the old closure use the same helper. The L1 grid cannot move that counter, so B09/chunk3.test.ts drives it by hand. Subclass StarHitPowerAbAttr (B16/B17) calls super.canApply and keeps working. Merge note: if B01-B07 give MoveDamageBoostAbAttr its own gate or residual members, this class needs the `override` keyword on them. Oddity, not fixed: when the same ability has two HitMultiplierPower attrs both would multiply (none does).",
});
