/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Test-only declarations that exercise the declaration machinery. They are NOT precedents and are
// not picked up by the registry glob (they live under test/).
import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { type ClassDecl, defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export const multiscaleLikeDecl: ClassDecl = {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less (or more) damage",
  summary: params => `Damage taken x${params.multiplier}`,
  synonyms: ["resist", "half damage", "damage reduction", "tank"],
  examples: ["Halve damage at full HP"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier",
      editable: true,
      default: 0.5,
    },
    {
      id: "affectsFixedDamage",
      ctorIndex: 3,
      path: "affectsFixedDamage",
      control: "boolean",
      label: "Also affects fixed damage",
      editable: true,
      default: false,
    },
  ],
  conditions: [{ slot: "ctor:0", ctx: "defend", lib: "hp.full", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier", "affectsFixedDamage"] },
  reusableAlone: { when: true, if: true, do: true },
  fixedCtorArgs: { 2: false },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "full hp boundary", axes: { hp: ["max", "max-1", 1] } }],
  status: "decomposed",
  notes: "Machinery test declaration only.",
};

export const multiscaleLike = defineDecl(ReceivedMoveDamageMultiplierAbAttr, multiscaleLikeDecl);
