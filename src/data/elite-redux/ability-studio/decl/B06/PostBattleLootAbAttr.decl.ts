/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier C package with per-instance state and one random draw in canApply. See ../PRECEDENTS.md.
//
// "After a won battle, take one random item the foes were carrying" (Pickup). The engine asks it from battle-end-phase.ts for every
// Pokemon allowed in battle (`{ pokemon, victory }`). Clauses, in the ORIGINAL order (ab-attrs.ts, PostBattleLootAbAttr):
//   canApply  1. `!simulated`                           feasibility (a preview never takes loot).
//             2. `postBattleLoot.length > 0`            feasibility (the defeated wild foes dropped something).
//             3. `victory`                              CONDITION in spirit (the battle was won); no library atom reads the victory flag.
//             4. `this.randItem = randSeedItem(list)`   the only RANDOM DRAW, made once clauses 1 to 3 pass.
//             5. `canTransferHeldItemModifier(item, pokemon, 1)`  feasibility (the item can be taken, no theft block).
//   apply     uses `this.randItem` (draws again only when canApply did not run), moves the item with `tryTransferHeldItemModifier`, removes it
//             from the loot list and queues the message; `randItem` is reset to undefined at the end.
// `randItem` is per-instance state that carries the draw from canApply to apply, which is why the effect cannot be split from its gate.
import { PostBattleLootAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostBattleLootAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.after-battle",
  label: "Take a random item the foes dropped after a win",
  summary: () =>
    "After I win a battle, I take one random item that the defeated wild Pokemon were holding, if I can carry it. Example: Pickup.",
  synonyms: ["pickup", "loot", "take foe items", "find items after battle", "scavenge", "item drop"],
  examples: ["Pick up one of the defeated foes' items after winning, like Pickup"],
  params: [],
  noParamsReason:
    "All or nothing: one random item per won battle is written into the class, and there is no constructor argument, so there is no number or choice to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only after the battle was won",
    "Only when the defeated foes left at least one item that can be carried",
    "The item must be one I can take (a theft block, or already holding the most of that item, stops it)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply: randSeedItem picks one dropped item, only after not simulated, loot left and victory all pass",
    ],
    state: "none",
    simulated: "respects",
  },
  l2StaticReason:
    "The attr is asked at the end of a won battle (BattleEndPhase) after the foes dropped items, which the shared L2 scenario for this moment does not reach, so the engine never evaluates it (decomp-l2-reach.json lists event.after-battle as unreached). test/tests/elite-redux/decomp/B06/b06-chunk3.test.ts drives the real Pickup attr and its rebuild through every clause of canApply and through apply.",
  probes: [{ name: "the end of a won battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the attr keeps the drawn item between canApply and apply (`randItem`), the draw sits in canApply after three gate clauses, and apply moves the item and edits the shared loot list, so splitting it would re-implement the class. The won-battle test has no library atom (request R-B06-19: an atom 'I won the battle' reading the victory flag, and a gate/residual split of canApply, which is a foundation decision). Users (1 attr, no closure): Pickup (53, attr 0; the ability is unsuppressable). The class is asked for every Pokemon allowed in battle, so each Pickup holder draws separately in party order and the loot list shrinks as items are taken.",
});
