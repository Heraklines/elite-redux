/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier with a plain cancel effect. See ../PRECEDENTS.md.
//
// "While the game checks whether my item can be stolen, block it." `canApply` is the inherited `!cancelled.value`,
// `apply` sets `cancelled.value = true`, and the class adds only a trigger message (the "blockItemTheft" text).
// Callers: Trick/Switcheroo style swaps ask BOTH sides (move.ts:3842), Knock Off and thieves ask the target
// (move.ts:3959, 4486), and battle-scene item transfers ask the item's previous owner when the two sides differ
// (battle-scene.ts:4284, 4412). Slime Mold and Supersweet Syrup are ER additions; Supersweet Syrup gets the attr
// from init-elite-redux-vanilla-rebalance.ts (ab.attrs.push). Nothing to bind: there is no closure.
import { BlockItemTheftAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockItemTheftAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.item-theft",
  label: "Keep my held item from being stolen or swapped",
  summary: () =>
    "Foes cannot take, knock off or swap my held item, and the ability pop-up shows when it stops one. Example: Thief and Trick fail on me.",
  synonyms: ["sticky hold", "item lock", "no knock off", "protect held item", "slime mold", "item theft immunity"],
  examples: ["Foes cannot steal my held item, like Sticky Hold", "Trick and Knock Off fail against me"],
  params: [],
  noParamsReason: "All or nothing: the class has no constructor argument and blocks every theft or swap that asks it.",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when another ability already blocked this theft"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a theft or swap aimed at the holder", axes: {} }],
  l2StaticReason:
    "The shared item-loss template uses Knock Off, which never reaches a player holder, so no template evaluates this attr; test/tests/elite-redux/decomp/B01/cancel-attrs.test.ts drives a real Trick against the holder for the original and the rebuilt ability and compares the traces.",
  status: "decomposed",
  notes:
    "Users (3 attrs): Sticky Hold, Slime Mold, Supersweet Syrup (attr pushed at init). The trigger message is built by the class and kept untouched. The swap code asks the holder's side first and the user's side second, so a holder on either side blocks the whole swap (move.ts comment). Game oddity, not changed: Knock Off by a wild Pokemon on a player holder fails earlier for an unrelated reason, so this ability is never asked there.",
});
