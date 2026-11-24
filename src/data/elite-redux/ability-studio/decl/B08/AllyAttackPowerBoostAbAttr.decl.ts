/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier, Tier C. Read from the source:
//
//   * Extends AllyMoveCategoryPowerBoostAbAttr -> FieldMovePowerBoostAbAttr. The parent stores a category closure
//     ([PHYSICAL, SPECIAL]) and a single multiplier, but this subclass OVERRIDES `apply` and never reads either, so
//     there is no live condition closure to bind. FieldMovePowerBoostAbAttr.canApply is a constant true ("logic for
//     this attr is handled in move.ts"). The ctor argument is ONE options object { baseMultiplier, recoilMultiplier }.
//   * apply: STATUS moves are skipped (no power to scale); otherwise power *= recoilMultiplier when the move has a
//     RecoilAttr, else baseMultiplier. The recoil test is inside apply, so it is part of the effect, not an IF.
//   * Dispatch: move.ts:1342 applyAbAttrs("AllyMoveCategoryPowerBoostAbAttr", { ...params, pokemon: ally }) for the ALLY
//     of the move's user, so the WHEN is calc.move-power (its alsoDispatchKeys names this key). The holder of the frame
//     is the Pokemon that owns the ability, the mover is its ally.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AllyAttackPowerBoostAbAttr } from "#data/elite-redux/archetypes/ally-attack-power-boost";

export default defineDecl(AllyAttackPowerBoostAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost my ally's attacks (more for recoil moves)",
  summary: params =>
    `My ally's damaging moves get ${params.baseMultiplier} times their power, or ${params.recoilMultiplier} times when the move hurts the user with recoil. Example: 1.25 means 25% stronger.`,
  synonyms: [
    "ally power boost",
    "boost partner attacks",
    "power spot",
    "battery",
    "ally damage aura",
    "recoil move boost",
    "mosh pit",
  ],
  examples: ["My ally's attacks are 25% stronger, and 50% stronger if they cause recoil"],
  params: [
    {
      id: "baseMultiplier",
      ctorIndex: 0,
      ctorOption: "baseMultiplier",
      path: "baseMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier for my ally's attacks (1.25 = 25% stronger)",
      editable: true,
      default: 1.25,
    },
    {
      id: "recoilMultiplier",
      ctorIndex: 0,
      ctorOption: "recoilMultiplier",
      path: "recoilMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier when the ally's attack causes recoil (1.5 = 50% stronger)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only my ally's damaging moves are boosted (a status move has no power)",
    "A move that causes recoil uses the recoil multiplier instead of the first one",
  ],
  effect: { id: "effect.multiply-power", params: ["baseMultiplier", "recoilMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a plain attack, a status move and a recoil move",
      axes: { foeMove: ["TACKLE", "SPLASH", "DOUBLE_EDGE"] },
    },
  ],
  l2StaticReason:
    "The attr is dispatched only for the ALLY of the move's user, in a double battle (move.ts getPower), and the shared single-battle template of calc.move-power never evaluates it. The B08 test (test/tests/elite-redux/decomp/B08/ally-power-boost.test.ts) drives original and rebuild directly with a plain, a status and a recoil move and compares the power each leaves behind.",
  status: "decomposed",
  notes:
    "Tier C: the recoil/plain pick lives inside apply, so splitting would re-implement the class. The parent's category closure and multiplier are dead state (apply is overridden), recorded here and left alone. Suspected oddity, NOT fixed: the parent field `powerMultiplier` (1.25 for Mosh Pit) is never used. User: Mosh Pit (5376, attr 0), no closure to bind.",
});
