/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 4 / Void. Read by hand: bernerd-roster-mechanics.ts `VoidPostTurnStealAbAttr` (base PostTurnAbAttr, ab-attrs.ts, whose
// canApply is always true and apply is empty; both are overridden), the dispatch `applyAbAttrs("PostTurnAbAttr", { pokemon })` at the
// end of every turn, and the one use (`case ER_VOID_ABILITY_ID` in the same file: `builder.attr(VoidPostTurnStealAbAttr)`, no arguments).
//
// canApply: `simulated || candidates(pokemon).length > 0`, where `candidates` is the list of every held item of every one of my
// opponents (`getOpponents()`, fainted or not, adjacent or not) that is transferable (`modifier.isTransferable`) and that
// `globalScene.canTransferHeldItemModifier(modifier, holder)` lets me carry. Classified:
//   1. feasibility  a preview (simulated) always passes (nothing is done for it)
//   2. feasibility  at least one foe holds an item I can take and carry                       (effect-side: stays in the class)
// There is no condition, no guard and no gate: the class has no closure and nothing a designer would want to switch off, so no Tier B
// split is needed (the source edit is only `export`).
// apply, unless simulated: rebuild the candidate list (same order), stop if empty, otherwise pick ONE index with
// `pokemon.randBattleSeedInt(candidates.length)` (the only random draw, made only when a candidate exists, and made in apply, not in
// canApply) and call `tryTransferHeldItemModifier(item, holder, false)`: one stack of that item moves to me, with the game message.
import { VoidPostTurnStealAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(VoidPostTurnStealAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Steal one random item from any foe",
  summary: () =>
    "At the end of every turn I take one random item that any foe holds, if I can carry it. It can be any foe on the field, not only the one I hit.",
  synonyms: [
    "void",
    "thief",
    "item theft",
    "steal item every turn",
    "pickpocket",
    "magician at end of turn",
    "take the foe's item",
    "end of turn item steal",
  ],
  examples: ["Steal a random foe item at the end of every turn", "Take one item from the other side each turn like Void"],
  params: [],
  noParamsReason:
    "It always moves exactly one random takeable item from the foes to me: there is no number, type, stat or status to set. Which items count (any transferable item of any opposing Pokemon) is fixed by the game rules for stealing.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must hold an item that can be taken, and I must be able to carry it (otherwise nothing happens and nothing random is drawn)",
    "It never steals anything for a preview (a simulated turn end)",
    "Every foe on the field counts, whether next to me or not",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: pick which of the takeable foe items to steal (randBattleSeedInt over the candidate list), only when the list is not empty and not for a preview",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // The grid foe holds no items, so only the empty case is reachable there; the steal, the draw and the preview are driven by
      // hand in test/tests/elite-redux/decomp/B17/chunk4.test.ts.
      name: "end of turn against a foe",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, PACKAGE for the effect only, with a written reason: the library effect.steal-item steals from one named other Pokemon (it requires the `other` slot, which the end-of-turn trigger does not provide) and has no random-pick rule; this rule gathers every takeable item of every foe into one list, in foe order, and picks one with a seeded random draw. The rule needs a scope of its own (all foes) and a pick mode (random among all), which request R39 in requests/B17.md asks for. There is no typed setting: nothing numeric or typed is used in the rule. The trigger (end of turn) is a separate block and any IF can be ANDed on top (the class has no condition of its own, so nothing is hidden inside the package). Users: Void (6102, attr 0) only, constructed with no arguments. Source edit: `export` only. Oddities, not bugs: (1) canApply and apply each rebuild the candidate list, so the list is computed twice (pure reads, the same result within one step; no RNG between them); (2) fainted foes still count as sources while they remain in getOpponents(), and `isTransferable` is read from the modifier, so only items the game allows to be taken count; (3) tryTransferHeldItemModifier is called with transferStack=false, so one copy of a stacked item moves, matching Magician. No game bug found.",
});
