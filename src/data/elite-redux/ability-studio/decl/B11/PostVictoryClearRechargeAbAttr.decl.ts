/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier B: "I am recharging" is the gate inside canApply).
//
// Read by hand from archetypes/post-victory-clear-recharge.ts. PostVictory hook (WHEN "when I win the fight": dispatched from
// FaintPhase for the Pokemon whose direct attack landed the knock out), no constructor of its own (`super()`).
//   canApply is now the gate alone (nothing is left as a residual):
//     gate: `pokemon.getTag(BattlerTagType.RECHARGING) !== undefined`   (CONDITION: the holder is in its recharge turn)
//   apply: not when simulated. Then `pokemon.removeTag(RECHARGING)` and, because RechargingTag.onAdd also queued a placeholder
//     move (`MoveId.NONE`) for the recharge turn, `queue.shift()` when the FIRST queued entry is that placeholder. No random draw.
//
// The gate is exactly the library atom tag.has with RECHARGING (`getTag(BattlerTagType[tag]) !== undefined`, the same call), so
// all seven users are bound to it. The effect is one piece: effect.remove-tag is not implemented yet and it could not drop the
// placeholder move either (request R-B11-C1-06). The effect has no number, stat or type to set: the only thing it touches is the
// recharge state, which is what the gate tests.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostVictoryClearRechargeAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-recharge";

export default defineDecl(PostVictoryClearRechargeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-win",
  label: "Skip my recharge turn after I knock out a foe",
  summary: () =>
    "When my direct attack knocks out a foe while I must recharge (Hyper Beam, Giga Impact), the recharge turn is cancelled and I can act freely next turn.",
  synonyms: [
    "rampage",
    "no recharge on ko",
    "cancel recharge",
    "hyper beam no rest",
    "berserker rage",
    "skip the rest turn",
  ],
  examples: ["Hyper Beam does not need a recharge turn when it knocks the target out"],
  params: [],
  noParamsReason:
    "The effect only cancels the recharge state and its queued placeholder move; there is no number, stat, type or status to set. The condition (I am recharging) is its own block.",
  conditions: [
    // "The holder is recharging": tag.has RECHARGING for every shipped user. Staff may swap or extend it.
    { slot: "gate", ctx: "params", lib: "tag.has", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Also removes the placeholder move that the recharge queued for next turn, so I really can act freely",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a knock out at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users (the gate is bound to tag.has RECHARGING for each): Rampage (5013), Berserker Rage (5211 attr 2), Master Hand (5387 attr 1), Raging Goddess (5424), Qigong (5463), Drake Of Rage (5512 attr 1) and Going Berserk (5693 attr 1). The grid and the L2 battle cannot give the holder a recharge turn, so the gate is proven true and false in test/tests/elite-redux/decomp/B11/chunk1.test.ts with a real RECHARGING tag, and so is the removal of the queued placeholder move. Remark, NOT fixed: the hook only fires for the Pokemon that landed a direct attack (FaintPhase dispatches it when the victim has attacks received and the source is on the field), so a knock out by damage over time never clears the recharge.",
});
