/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "While I am on the field, every battler gets extra critical-hit stages" (Battle Aura).
//
// Source: src/data/elite-redux/archetypes/field-crit-boost.ts, class FieldCritBoostAbAttr (extends AbAttr, constructor
// `super(false)`, one field `bonus`). A marker: no canApply, no apply, never dispatched. The effect is done by the engine,
// src/field/pokemon.ts Pokemon.getCritStage (line ~2073):
//   `for p of globalScene.getField(true): for attr of p.getAllActiveAbilityAttrs():
//      if attr.constructor.name === "FieldCritBoostAbAttr": fieldCritBonus = Math.max(fieldCritBonus, attr.bonus)`
//   `critStage.value += fieldCritBonus`
// It runs for EVERY crit-stage calculation, whoever uses the move, so allies and foes alike get the bonus; several holders do not
// stack (the highest bonus counts). It is added after the Dragon Cheer tag and before the Jackpot, Pretentious and Abyss riders.
// No random draw, no state, `simulated` is not read.
//
// Engine-query (spec 1.4): the by-name field scan sits in Pokemon.getCritStage, so nothing can be recomposed from outside. The
// foundation routes it through abilityQuery (request R-B09-23). The bonus is the one constructor argument and is a typed setting.
import { FieldCritBoostAbAttr } from "#data/elite-redux/archetypes/field-crit-boost";

export default defineDecl(FieldCritBoostAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Raise the critical hit stage of every battler on the field",
  summary: params =>
    `While I am on the field, every Pokemon in battle (allies and foes) gets +${params.bonus} critical-hit stages. Several holders do not stack; the highest counts.`,
  synonyms: [
    "battle aura",
    "crit aura",
    "field crit boost",
    "higher crit rate for everyone",
    "critical hit stage",
    "raise crit chance",
    "more critical hits",
  ],
  examples: ["Everyone on the field gets +2 crit stages while I am out, like Battle Aura"],
  params: [
    {
      id: "bonus",
      ctorIndex: 0,
      path: "bonus",
      control: "number",
      min: 1,
      max: 3,
      step: 1,
      integer: true,
      label: "Extra critical-hit stages for every battler (2 = +2 stages)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Counts for every battler on the field, mine and the foes'; with several holders only the highest bonus is used",
    "Only Pokemon on the field with an active ability count",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The class is a presence marker that Pokemon.getCritStage reads by name; no moment is dispatched, so the twin compares whole battles instead (template while-active-flags).",
  probes: [{ name: "a damaging attack by each side", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query, 1 attr: Battle Aura (5341 attr 0; the dispatcher builds `new FieldCritBoostAbAttr(2)` at archetype-dispatcher.ts:6371). Read by Pokemon.getCritStage (src/field/pokemon.ts:2073-2081) with a constructor-name scan, so the class name and the `bonus` field are load-bearing. BLOCKED on a one-line library change: add FieldCritBoostAbAttr to the `flagKeys` of WHEN while.active (request R-B09-24). The crit chance table is [24, 8, 2, 1] indexed by the stage clamped to 0..3 (pokemon.ts:6440), so a total of 3 stages already means every hit is critical; the setting therefore stops at 3.",
});
