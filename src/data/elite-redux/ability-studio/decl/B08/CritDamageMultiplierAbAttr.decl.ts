/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / calc-modifier, Tier A. Read from the source (archetypes/crit-mod.ts, the parent MultCritAbAttr in ab-attrs.ts, the
// dispatch in field/pokemon.ts getBaseDamage) and from the live instances of the 4 users (Razor Sharp, To The Bone x2, Metallosis).
//
//   dispatch   Pokemon.getBaseDamage: critMult = 1.5 for a critical hit, 1 otherwise; then, unless the source's ability is
//              ignored, applyAbAttrs("MultCritAbAttr", { pokemon: source, simulated, critMult }) with the ATTACKER as holder.
//   guard      critMult.value > 1 (the inherited MultCritAbAttr.canApply): the hit is already a critical hit. Without it the
//              multiplier would also boost every normal hit by the same amount, so this is a safety rule, not a design choice.
//   apply      critMult.value *= multiplier. No random draw. The constructor refuses a multiplier of 1 or less.
//
// The effect is a package PLACEHOLDER: no library effect multiplies the critical-hit bonus (request R-B08-28).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CritDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/crit-mod";

export default defineDecl(CritDamageMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.crit-multiplier",
  label: "Deal more damage on critical hits",
  summary: params =>
    `A critical hit I land deals ${params.multiplier} times as much damage as a normal critical hit would. Example: 1.5 means 50% more (like Sniper).`,
  synonyms: [
    "sniper",
    "crit damage",
    "stronger crits",
    "bigger critical hits",
    "critical hit power",
    "extra crit damage",
  ],
  examples: ["Critical hits do 50% more damage like Sniper"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "configuredMultiplier",
      control: "number",
      min: 1.05,
      max: 5,
      step: 0.05,
      label: "Critical-hit bonus multiplier (1.5 = 50% bigger)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Only changes a hit that is already a critical hit"],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "the holder lands critical hits", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind: the class has no closure and no gate of its own. The only test is the inherited 'this is a critical hit' check (critMult > 1), kept in the class as a safety rule and listed as feasibility (removing it would boost every normal hit). The effect is a package PLACEHOLDER, written reason: the library has no effect that scales the critical-hit bonus (effect.multiply-damage-dealt changes `damage`, not `critMultiplier`); request R-B08-28 asks for `effect.multiply-crit-damage`. It has one typed setting, the multiplier (above 1; the constructor throws otherwise). Users (4): Razor Sharp (1.3, attr 1), To The Bone (1.5 at attr 0 and 1.3 at attr 2), Metallosis (1.5). The class applies for simulated damage previews too (the engine passes `simulated` and apply ignores it, which is wanted: the preview must match the real hit). The parent's multAmount and the class's configuredMultiplier hold the same number; the setting reads configuredMultiplier. Siblings (MultCritAbAttr, which Sniper uses) are separate classes.",
});
