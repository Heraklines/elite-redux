/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier A event-effect. "After I am hit, IF <rule about the move and its user>, I gain a battle effect."
//   canApply  `this.condition(pokemon, attacker, move)`                                        = the CONDITION slot (ctor:0)
//   apply     `if (!pokemon.getTag(tagType) && !simulated)`: add the tag to the holder (self as source), then queue the
//             message "<name> became charged by <move>!" (abilityTriggers:windPowerCharged). The "I do not have it yet"
//             test is inside `apply`, not `canApply`, so the ability flyout still shows when the tag is already there.
// The battle effect is a real constructor argument (ctor 1) but the message text is written for one effect, Charged
// (the next Electric move I use is twice as strong). The setting is therefore shown and not editable.
import { PostDefendApplyBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendApplyBattlerTagAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Get charged up after I am hit by a certain move",
  summary: () =>
    "After I am hit by a move that meets the rule you set, I become Charged: my next Electric move is twice as strong. Example: any hit charges me, like Electromorphosis.",
  synonyms: [
    "electromorphosis",
    "wind power",
    "atomic burst",
    "charge when hit",
    "get charged",
    "power up my next electric move",
    "charged by wind",
  ],
  examples: [
    "Become charged when a wind move hits me, like Wind Power",
    "Become charged whenever I am hit, like Electromorphosis",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label: "Battle effect I gain (Charged: my next Electric move is twice as strong)",
      editable: false,
      default: "CHARGED",
      options: ["CHARGED"],
    },
  ],
  conditions: [
    // Required closure `(target, user, move) => boolean`, the `defend` shape.
    { slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Nothing happens if I am already charged", "Nothing happens when the game only previews the move"],
  effect: { id: "effect.apply-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a wind move, a plain damaging move and a status move",
      axes: { foeMove: ["AIR_CUTTER", "TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (3 attrs): Electromorphosis (280, every hit: `() => true`), Atomic Burst (5152 attr 0, every hit: `() => true`), Wind Power (277, wind moves: `move.hasFlag(WIND_MOVE)`). The two `() => true` closures are bound to the always-true group. Wind Power stays a legacy-closure (plain flag; the library flag atom asks doesFlagEffectApply, request R-B01-10). Electromorphosis' closure is installed by the ER vanilla-rebalance patcher (init-elite-redux-vanilla-rebalance.ts:1616, which removes the vanilla attr first). The tag is shown but not editable because the message is written for Charged only and the library effect apply-tag takes free text (R-B01-17 asks for a curated list). Oddity (not fixed): the 'already has the tag' test is in apply, so the ability flyout shows on every hit even when nothing is added.",
});
