/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier with a plain cancel effect. See ../PRECEDENTS.md.
//
// "While the game checks whether a recoil hit hurts me, block it." The class is a CancelInteraction attr: `canApply`
// is only `!cancelled.value` (nothing else gates it) and `apply` sets `cancelled.value = true`. Three callers ask it
// (the dispatch key is BlockRecoilDamageAttr, listed under the shared "indirect damage" WHEN):
//   - RecoilAttr.apply (move.ts:2553), right before BlockNonDirectDamageAbAttr is asked on the same holder,
//   - the ER type-damage-boost recoil (archetypes/type-damage-boost.ts:257),
//   - the ER Enrage tag tick (battler-tags.ts:4603), the "immunity to enrage recoil" of Brute Force / Steel Barrel.
// There is no constructor argument and no closure, so nothing to bind. `showAbility` is fixed to false.
import { BlockRecoilDamageAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockRecoilDamageAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.indirect-damage",
  label: "Take no recoil damage from my own moves",
  summary: () =>
    "Recoil from my own moves never hurts me. Example: Brave Bird or Double-Edge cost me no HP. Also stops the recoil of being enraged.",
  synonyms: ["rock head", "no recoil", "recoil immunity", "immune to recoil", "steel barrel", "brute force"],
  examples: ["Take no recoil damage from my own moves, like Rock Head", "Brave Bird costs me no HP"],
  params: [],
  noParamsReason:
    "All or nothing: the class has no constructor argument, it blocks every kind of recoil that asks it (ER code notes that half recoil needs a new class).",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when another ability already blocked this recoil"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "recoil from a move that has recoil", axes: {} }],
  l2StaticReason:
    "No shared scenario template drives a recoil move; test/tests/elite-redux/decomp/B01/cancel-attrs.test.ts runs a real Double-Edge battle for the original and the rebuilt ability and compares the traces.",
  status: "decomposed",
  notes:
    "Users (5 attrs): Rock Head, Steel Barrel (attr 0), Brute Force, Madness Enhancement (attr 1), Thick Skulled. Inherits canApply/apply from CancelInteractionAbAttr. Dispatch key sits in the alsoDispatchKeys of cancel.indirect-damage, but the engine asks BlockRecoilDamageAttr and BlockNonDirectDamageAbAttr as two separate calls (Magic Guard has the second only).",
});
