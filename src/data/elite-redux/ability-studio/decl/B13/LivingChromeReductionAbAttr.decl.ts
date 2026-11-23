/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Living Chrome, part 2 of 2 (Tier B, package effect). "Right after I change shape, I take less damage from the types I just left."
//
// Source: abilities/newcomer-signature-mechanics.ts, LivingChromeReductionAbAttr (ReceivedMoveDamageMultiplierAbAttr). The
// constructor used to be `super((holder, attacker, move) => <shape memory test>, 0.5)` and apply was overridden; it is now
// `constructor(typeMultiplier = 0.5, flatMultiplier = 0.75) { super(() => true, typeMultiplier) }` and the test moved into the gate.
//   canApply now (ONE clause, pure, no RNG, in the original order): the gate
//     state = SHAPE_MEMORY[holder]; state exists
//     && state.wave === current wave && state.expires === current turn       (the memory was made THIS turn)
//     && (state.flat || state.types.includes(attacker.getMoveType(move)))     (the Eevee flat case, or a remembered type)
//   apply (overridden): damage.value = Math.floor(damage.value * (state?.flat ? flatMultiplier : typeMultiplier))
//     Math.floor, NOT the base class's toDmgValue (round, at least 1), so a hit of 1 damage can become 0.
// The memory is written by recordLivingChromeTransformation (called by name from the form-change code, at most 3 times per wave).
import { LivingChromeReductionAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LivingChromeReductionAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.damage-taken",
  label: "Take less damage from the types I just changed away from",
  summary: params =>
    `For one turn after I change shape, damage from a type I just left is multiplied by ${params.typeMultiplier} (${params.flatMultiplier} for all types after leaving the base form). 0.5 = half damage.`,
  synonyms: [
    "resist old types",
    "shape memory",
    "damage reduction after transforming",
    "adaptive armor",
    "evolve resistance",
    "living chrome",
    "chameleon armor",
  ],
  examples: ["After I change form I take half damage from the types I just left, like Living Chrome"],
  params: [
    {
      id: "typeMultiplier",
      ctorIndex: 0,
      path: "typeMultiplier",
      control: "number",
      label: "Damage multiplier against a type I left (0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 0.5,
      min: 0,
      max: 4,
      step: 0.05,
    },
    {
      id: "flatMultiplier",
      ctorIndex: 1,
      path: "flatMultiplier",
      control: "number",
      label: "Damage multiplier against every type after leaving the base form (0.75 = a quarter less)",
      editable: true,
      gateIndependent: true,
      default: 0.75,
      min: 0,
      max: 4,
      step: 0.05,
    },
  ],
  conditions: [
    // The whole original closure: "I hold a shape memory from this turn and the attacker's type is one I remembered". Memory-based, no library atom yet.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The shape memory is written when I genuinely change form: at most 3 times per wave, and it lasts only for the turn it was made (a private memory kept by the form-change code, not by this block)",
    "The damage is rounded DOWN (a hit of 1 damage can become 0), unlike the library damage multiplier, which rounds and never goes below 1",
  ],
  effect: { id: "effect.package", params: ["typeMultiplier", "flatMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The shape memory is written by the form-change code and needs a real transformation; B13/chunk5.test.ts writes a memory through recordLivingChromeTransformation and compares the original with the rebuild for a remembered type, another type, the flat case and an old memory.",
  probes: [
    {
      // With no shape memory the gate stays closed; the memory cases are in B13/chunk5.test.ts.
      name: "damaging hits of different types without a shape memory",
      axes: { hp: ["max", "max-1"], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger ('while the game calculates damage I take') is the normal WHEN and the whole old closure is the editable gate (a legacy-closure binding until R-B13-50 adds an atom 'I hold a shape memory from this turn and the attacker's move type is one of its types'; the atom must read the SAME memory recordLivingChromeTransformation writes). Why the effect is not the library's `effect.multiply-damage-taken`: apply was overridden, it uses Math.floor instead of toDmgValue (round, at least 1) and it picks 0.75 or 0.5 by a flag of the memory (flat = the holder is Eevee and left form 0). A rebuilt rule with the library effect would round differently, so the effect stays a package (requested as R-B13-51 `effect.multiply-damage-taken` with a rounding choice and a second multiplier for a flagged case). The 0.5 and 0.75 were literals, now constructor arguments 0 and 1 (the base class gets the type multiplier, as before). Users: Living Chrome (5980, attr 1; attr 0 is the marker). ODDITIES (not fixed): (1) apply re-reads the memory instead of the gate's result, so replacing the gate with a different rule still picks the multiplier by the memory's flat flag (and 0.5 when there is no memory); (2) the 'does not stack' text of the ability holds because one memory slot is overwritten; (3) Math.floor can reduce a 1-damage hit to 0.",
});
