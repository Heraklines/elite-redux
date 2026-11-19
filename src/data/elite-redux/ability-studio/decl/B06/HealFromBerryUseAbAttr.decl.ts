/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier A event-effect with one number argument and a one-piece effect. See ../PRECEDENTS.md.
//
// "After I eat a berry, I heal a share of my max HP" (Gluttony, Voracity). The constructor takes the share (0 to 1) and clamps it;
// `canApply` is the inherited always-true. `apply` (ab-attrs.ts) does nothing when simulated, otherwise queues a PokemonHealPhase of
// `toDmgValue(maxHp * healPercent)` (rounded down, at least 1) with the ability message. The engine asks it from berry-phase.ts (once
// after the whole round of berry meals, so a holder that ate two berries heals once) and from move.ts `eatBerry` (a berry eaten through
// a move such as Bug Bite, asked for the eater `consumer`).
import { HealFromBerryUseAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(HealFromBerryUseAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.berry-eaten",
  label: "Heal some HP after I eat a berry",
  summary: params =>
    `After I eat a berry, I heal ${Math.round(Number(params.healShare) * 100)}% of my max HP. Example: 0.33 heals a third of max HP, 1 heals all of it.`,
  synonyms: ["cheek pouch", "gluttony", "voracity", "berry heal", "heal after eating", "recover hp from berries"],
  examples: ["Heal a third of max HP after eating a berry, like Gluttony"],
  params: [
    {
      id: "healShare",
      ctorIndex: 0,
      path: "healPercent",
      control: "slider",
      min: 0,
      max: 1,
      step: 0.01,
      label: "Share of my max HP to heal (0.33 = a third, 1 = all)",
      editable: true,
      default: 1 / 3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Heals the share of max HP rounded down, at least 1 HP",
    "Does nothing in a simulated preview",
    "A holder that eats several berries in one round heals once",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "eating a berry below and at full HP", axes: { hp: ["50%-1", "max"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: effect.heal-percent has a whole-number percent slider and a target setting, and the class heals a fraction (1/3 is 33.333 percent, which a whole-number slider cannot hold without changing the amount) and shows its own ability message, so declaring it would show a slider that does not match the shipped abilities (request R-B06-18: a heal effect with a fractional share). Users (2 attrs): Gluttony (82, attr 1, pushed by init-elite-redux-vanilla-rebalance.ts with 1/3) and Voracity (6101, attr 3, 1/3). Cheek Pouch still has the attr in init-abilities.ts but ER clears its attrs (rewriteCheekPouch), so it has no live user. The share is clamped to 0..1 in the constructor. Oddity, not fixed: the berry phase asks once per holder after all berries, while the move path asks once per berry eaten, so it can heal again for each berry a move eats.",
});
