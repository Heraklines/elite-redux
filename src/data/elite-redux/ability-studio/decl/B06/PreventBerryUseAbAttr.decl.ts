/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier C calc-modifier with a plain cancel effect. See ../PRECEDENTS.md.
//
// "While I am on the field, my foes cannot eat their berries" (Unnerve, As One, Crowned King, Klutz, Voracity). The class has no
// body of its own: it is the cancel base class with a visible ability pop-up (`canApply` is `!cancelled.value`, `apply` sets
// `cancelled.value = true`) and no constructor argument or closure. The engine asks it from berry-phase.ts
// (`eatBerries`): when the eater holds a usable berry, every OPPONENT of the eater is asked (`pokemon: opp`) and a cancelled result
// queues the 'cannot eat' message instead of eating. Nothing to bind.
import { PreventBerryUseAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreventBerryUseAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.berry-use",
  label: "Stop my foes from eating their berries",
  summary: () =>
    "While I am on the field, opposing Pokemon cannot eat their held berries, and the ability pop-up shows when it stops one. Example: a foe at low HP cannot use its Sitrus Berry.",
  synonyms: ["unnerve", "as one", "crowned king", "block berries", "no berries for foes", "berry lock", "klutz"],
  examples: ["Foes cannot eat their berries while I am out, like Unnerve"],
  params: [],
  noParamsReason:
    "All or nothing: the class has no constructor argument and blocks every berry meal of the opposing side.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only the opposing side is stopped, never my own berries",
    "Does nothing when another effect already blocked this berry",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a foe with a berry at low HP", axes: { hp: ["max", "50%-1"] } }],
  l2StaticReason:
    "The attr is asked when a FOE eats a berry, and the shared L2 template for this moment (holder at low HP) gives the foe no berry, so the engine never asks it (decomp-l2-reach.json lists cancel.berry-use as unreached); test/tests/elite-redux/decomp/B06/b06-chunk2.test.ts drives the real attrs of Unnerve and Klutz and of their rebuilds with an open and an already cancelled berry check.",
  status: "decomposed",
  notes:
    "Users (9 attrs): Klutz (103, attr 0, it copies Unnerve's attrs at init), Unnerve (127, attr 0), As One (266 and 267, attr 1; 5004 and 5005, attr 0; 20022, attr 1), Crowned King (5259, attr 0) and Voracity (6101, attr 0). The sibling class PreventItemUseAbAttr (the ER 'no held items' marker) is separate. The class never reads `simulated`; the berry phase passes none. Oddity, not fixed: the engine asks every opponent in turn and each one that carries the ability shows its own pop-up for the same berry; the TODO in berry-phase.ts says which one displays is not decided.",
});
