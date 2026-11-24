/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier (a cancel check), Tier C. See ../PRECEDENTS.md.
//
// The class body is empty (`CancelInteractionAbAttr`: canApply `!cancelled.value`, apply `cancelled.value = true`) and it has
// no constructor, so `showAbility` is the AbAttr default true: the ability flyout shows when the block works.
// The only dispatch is `OneHitKOAttr.apply` (move.ts:4713): `applyAbAttrs("BlockOneHitKOAbAttr", { pokemon: target, cancelled })`
// and the one-hit-KO move then fails against the holder. Fissure, Guillotine, Horn Drill and Sheer Cold are the moves with it.
import { BlockOneHitKOAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockOneHitKOAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.one-hit-ko",
  label: "Block one-hit knockout moves",
  summary: () =>
    "Moves that knock out in one hit, whatever the HP, fail against me (the Fissure and Guillotine kind). Surviving a normal hit at full HP is a different effect.",
  synonyms: ["sturdy", "ohko immunity", "fissure immunity", "no instant knockout", "immune to sheer cold", "guillotine"],
  examples: ["Fissure and Sheer Cold fail against me, like Sturdy"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: every one-hit KO move is blocked. The only constructor argument is showAbility, which is never exposed (fixed to true).",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when the move was already blocked by something earlier"],
  effect: { id: "effect.negate", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a one-hit KO check against the holder", axes: { foeMove: ["TACKLE", "FISSURE"] } }],
  l2StaticReason:
    "No move of the game can reach this WHEN: Elite Redux replaced Guillotine, Horn Drill, Fissure and Sheer Cold with ordinary damage moves (init-elite-redux-vanilla-move-patches.ts removes their OneHitKOAttr), and the only dispatch is the move condition of OneHitKOAttr (move.ts:4713). The condition is therefore driven directly, with a fresh OneHitKOAttr, for the original, the rebuilt attr and a control in test/tests/elite-redux/decomp/B05/chunk2-sites.test.ts.",
  status: "decomposed",
  notes:
    "Tier C. Users: Sturdy (5, attr 1) and Immovable Object (5490, attr 2), both showAbility true (the dump of the live attrs). The 'survive one hit at full HP' half of Sturdy is another class. SUSPECTED GAME BUG (not fixed): the hook is dead in this game, because the ER move patches strip OneHitKOAttr from all four one-hit KO moves (Guillotine, Horn Drill, Fissure, Sheer Cold), so the ability cannot block anything today; it would work again for a new move that has OneHitKOAttr. The engine site (the move condition) is driven with a fresh OneHitKOAttr in test/tests/elite-redux/decomp/B05/chunk2-sites.test.ts. The class never reads `simulated`.",
});
