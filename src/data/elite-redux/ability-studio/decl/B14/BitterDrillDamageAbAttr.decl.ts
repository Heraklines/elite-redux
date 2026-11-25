/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. Tier B, calc-modifier. "A drill move of mine is stronger against a foe the Drill Bits are stuck in."
//
// Source: fakemon-pitch-mechanics.ts BitterDrillDamageAbAttr (extends VariableMovePowerAbAttr). The engine asks it while the
// power of my move is calculated (applyAbAttrs("VariableMovePowerAbAttr"), the alsoDispatchKeys of calc.move-power).
// canApply, original clause order, now `gate` only (no guards, no residual):
//   gate  1. move.hasFlag(DRILL_BASED)                            the move's OWN drill flag (not doesFlagEffectApply)
//         2. opponent.getTag(ER_EMBEDDED) !== undefined           the target is Embedded (the tag the Drill Bits lay)
// Nothing is random, nothing is simulated-dependent. The inherited `condition` (constructor argument of the base class) is
// never read: this canApply does not call super.
//
// apply: `power.value *= multiplier` (the class used a fixed `* 2`; the constructor argument now defaults to 2).
//
// Both gate clauses are conditions (a different foe state or a different flag is a different ability). The gate binding is
// LEGACY for one reason: clause 1 uses `move.hasFlag`, which differs from the library atom `move.flag`
// (doesFlagEffectApply also counts flags that abilities inject). Clause 2 maps to `tag.has { who: other, tag: ER_EMBEDDED }`,
// but a legacy binding covers the gate as a whole, so the tag test cannot be split out until the own-flag atom exists
// (request move.has-own-flag in requests/B14.md, the same atom B08 and B09 call move.inherent-flag).
import { BitterDrillDamageAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BitterDrillDamageAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply a move's power by a set amount",
  summary: params =>
    `The power of my move is multiplied by ${params.multiplier}. Example: 2 = double power, 1.5 = 50% more. Bitter Drill uses it for drill moves against a foe with Drill Bits stuck in it.`,
  synonyms: [
    "bitter drill",
    "drill damage",
    "double power",
    "power boost",
    "stronger moves",
    "bonus power",
    "boost power against a target",
  ],
  examples: ["Double the power of my drill moves against a foe that has Drill Bits stuck in it"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: 0,
      max: 8,
      step: 0.05,
      label: "Power multiplier (2 = double, 0.5 = half)",
      editable: true,
      default: 2,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the move has its own DRILL_BASED flag, the target is Embedded], in that order. Removable: "all my moves
    // against an Embedded foe" and "drill moves against anyone" are both valid designs.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a drill move and a normal move against an Embedded and a normal foe", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for a move's own flag yet), so the twin has no rebuilt attr to compare; the Tier B split and the multiplier are proven by test/tests/elite-redux/decomp/B14/chunk2-gate-split.test.ts instead.",
  status: "decomposed",
  notes:
    "Tier B, effect maps 1:1 to effect.multiply-power (not a package). The multiplier was a hard-coded `* 2`; it is now constructor argument 0 (default 2, behaviour identical) and an editable param. Users (1): Bitter Drill (6044) attr 1 (attr 0 is BitterDrillAbAttr, chunk 1). Gate legacy-closure pending move.has-own-flag (clause 1); clause 2 would be tag.has { who: other, tag: ER_EMBEDDED } (the atom exists). Oddities, not fixed: (1) the inherited `condition` argument is dead (canApply never calls super); (2) the class ignores `simulated`, which is right for a power preview; (3) the drill flag is the move's own flag, so a move that only gains the flag from an injecting ability is not boosted (no shipped ability injects DRILL_BASED).",
});
