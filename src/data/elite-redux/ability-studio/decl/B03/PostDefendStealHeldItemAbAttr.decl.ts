/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier A: the only condition is the optional constructor closure `(target, user, move) => boolean`
// (a PokemonDefendCondition; Pickpocket passes "the move makes contact"). The class is not edited.
//
// canApply, in the original order (all of it stays in the class):
//   1. not simulated                              feasibility: a preview never steals
//   2. hitResult < NO_EFFECT                      feasibility: the hit must have landed
//   3. the closure (when there is one)            THE condition, bound per user in bindings.ts
//   4. the attacker holds a transferable item     feasibility
//   5. RNG draw: pick one such item               randBattleSeedInt(count), once, only when step 4 found items
//   6. the holder can carry that item             feasibility (canTransferHeldItemModifier)
// apply moves the picked item (the draw is repeated only if canApply left nothing picked, which cannot happen after a
// true canApply) and queues the "stole" message. `stolenItem` is the handoff between canApply and apply.
import { PostDefendStealHeldItemAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendStealHeldItemAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Steal the attacker's held item when it hits me",
  summary: () =>
    "When a move hits me and the condition you set is true (contact, for example), I take one random item the attacker holds and can carry.",
  synonyms: ["pickpocket", "thief", "steal item on contact", "take the attacker's item", "item theft", "magician"],
  examples: ["Steal the held item of any attacker that makes contact with me"],
  params: [],
  noParamsReason:
    "The class has no numbers to tune: it takes one random transferable item from the attacker. When it triggers is the condition (contact for the one user).",
  conditions: [{ slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true, optional: true }],
  guards: [],
  feasibility: [
    "It does nothing in a preview",
    "The hit must have landed (not missed, blocked or immune)",
    "The attacker must hold an item that can be taken, and I must be able to carry it",
  ],
  effect: { id: "effect.steal-item", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply: randBattleSeedInt(number of takeable items) once, only when the closure passed and the attacker holds at least one takeable item",
      "apply: the same pick, only when canApply left nothing picked (never after a true canApply)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      // Tackle makes contact, Water Gun does not: the closure decides, and no item is drawn for the second.
      name: "contact and non-contact hits",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, one user: Pickpocket (ctor closure `move.doesFlagEffectApply(MAKES_CONTACT)`, bound to move.flag). The closure is optional in the constructor, so a user without one needs no binding. Per-instance handoff field `stolenItem` between canApply and apply (cleared after a steal; left stale if canApply drew an item that the holder cannot carry, harmless because the next true canApply overwrites it). Quirk recorded, not fixed: canApply draws the item (a random draw) BEFORE it knows the holder can carry it, so a failed transfer still consumed a draw.",
});
