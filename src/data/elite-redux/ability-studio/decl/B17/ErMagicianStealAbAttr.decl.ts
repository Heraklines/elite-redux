/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Magician. Read by hand: init-elite-redux-vanilla-rebalance.ts `ErMagicianStealAbAttr` (and `patchMagicianPredicate`,
// which swaps vanilla's attr for this one), its base `PostAttackStealHeldItemAbAttr` (ab-attrs.ts:2222) and PostAttackAbAttr
// (ab-attrs.ts:2196).
//
// canApply, clause by clause in the original order (the split is `gate && residual`, no guards):
//   1. condition  the move does NOT make contact: !move.doesFlagEffectApply({ MAKES_CONTACT, user: holder, target: foe })  -> `gate`
//   2. residual   super.canApply, all of it stays in the class:
//        a. feasibility  PostAttackAbAttr attackCondition, the default `move.category !== STATUS`
//        b. feasibility  not simulated (a preview never steals)
//        c. feasibility  hitResult < NO_EFFECT (the hit connected)
//        d. feasibility  the optional stealCondition closure (undefined for Magician)
//        e. RNG          `pokemon.randBattleSeedInt(heldItems.length)` picks the item, ONLY if the foe holds a transferable item
//        f. feasibility  globalScene.canTransferHeldItemModifier(item, holder)
//   apply: tryTransferHeldItemModifier(item, holder, false) and a message; respects nothing else.
// The one random draw happens inside the residual, after the contact gate: a contact hit draws nothing. The gate must
// therefore stay in front of the residual, which `gatedCanApply` keeps.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ErMagicianStealAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";

export default defineDecl(ErMagicianStealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Steal a random item from the Pokemon I hit",
  summary: () =>
    "After my attack lands, I take one random item the target holds, if I can carry it. As built, it only happens when my move does not make contact.",
  synonyms: ["magician", "thief", "pickpocket", "steal item", "take the foe's item", "item theft", "swipe held item"],
  examples: ["Steal the target's item with a move that does not make contact", "Steal an item after every hit"],
  params: [],
  noParamsReason:
    "It always steals exactly one random item that can be taken: there is no number, type, stat or status to set. The base class also accepts an optional extra steal rule, but this ability does not use it.",
  conditions: [
    // The gate: library atom move.flag (MAKES_CONTACT), negated. Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "My move must deal damage (a status move never steals)",
    "The hit must have connected (not 'no effect')",
    "It must be a real hit, not a damage preview",
    "The target must hold at least one item that can be taken, and I must be able to carry it",
  ],
  effect: { id: "effect.steal-item", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply residual: pick which of the target's takeable items to steal (randBattleSeedInt), only after the no-contact gate passed and only when the target holds a takeable item",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // A contact move (no steal and no draw) and a non-contact move (the draw happens).
      name: "contact and non-contact hit",
      axes: { foeHp: ["max"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package. The ER rule is clause 1 (no contact); the rest is the vanilla steal rule inherited from PostAttackStealHeldItemAbAttr and kept as the residual because it carries a random draw and per-instance state (`stolenItem` is written in canApply and read in apply). Dropping or replacing the gate is safe: the residual does not test contact again. The damaging-move and hit-connected checks (a, c) sit inside the inherited residual and are therefore not separate conditions; they are listed as feasibility. Users: Magician (170, attr 0) only; vanilla's attr is replaced by this class in `patchMagicianPredicate`, so the vanilla class never runs. Oddity, not a bug: the inherited canApply fails when `simulated`, so a damage preview never shows a stolen item. The class was not exported before; the export and the gate/residual split are the only source edits.",
});
