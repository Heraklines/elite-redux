/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier C (no closure). See ../PRECEDENTS.md.
//
// `Pokemon.getAttackDamage` (pokemon.ts:6069 to 6072): `critMult = new NumberHolder(isCritical ? 1.5 : 1)`, then, unless the
// attacker's ability is ignored, `applyAbAttrs("MultCritAbAttr", { pokemon: source, simulated, critMult })`.
//   canApply  critMult.value > 1            (effect-side feasibility: only a real critical hit has more than 1)
//   apply     critMult.value *= multAmount
// No random draw. Because the engine starts a plain hit at exactly 1, `critMult > 1` means "this hit is a critical hit",
// but that fact is not a replaceable condition of the class (a library IF "the hit is a critical hit" needs the
// critical-hit frame slot that R-B05-4 asks for), so it is listed as feasibility.
import { MultCritAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MultCritAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.crit-multiplier",
  label: "Make my critical hits hit harder",
  summary: params =>
    `My critical hits get an extra damage multiplier of ${params.multiplier}. Example: 1.5 turns the usual 1.5x critical hit damage into 2.25x.`,
  synonyms: ["sniper", "critical damage boost", "stronger crits", "crit damage", "bigger critical hits", "super sniper"],
  examples: ["Critical hits do 2.25x damage instead of 1.5x, like Sniper"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multAmount",
      control: "slider",
      min: 1,
      max: 4,
      step: 0.05,
      label: "Extra critical hit damage (1.5 = crits hit 50% harder)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only counts when the hit is a critical hit (a plain hit has no critical hit bonus to multiply)",
    "Not used while my own ability is being ignored",
  ],
  // No library effect multiplies the critical hit damage yet, see R-B05-10.
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a critical hit and a plain hit", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C calc modifier. Effect is `package` ONLY because the library has no 'multiply the critical hit damage' effect (R-B05-10); trigger, IF slot and the number are separate typed blocks. Users (all 1.5): Sniper (97, attr 0), Super Sniper (5507, attr 0), Fourth Degree (6107, attr 0), Kagutsuchi (6109, attr 2). `critMult > 1` is kept in the class as feasibility. The engine only dispatches the hook when the attacker's ability is not ignored (ignoreSourceAbility). The archetype class CritDamageMultiplierAbAttr extends this class and has its own declaration. The class never reads `simulated`. The shared L2 template of this WHEN used to make the FOE crit the holder (the hook is asked for the ATTACKER), so scenarios.ts got a template where the holder lands critical hits; test/tests/elite-redux/decomp/B05/chunk2-sites.test.ts also compares whole battles.",
});
