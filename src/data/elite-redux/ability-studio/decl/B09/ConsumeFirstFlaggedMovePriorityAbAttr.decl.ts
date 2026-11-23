/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
// B09 chunk 2. "After my attack lands, spend (and maybe give back) my first-move bonus" (Cutthroat, Edgelord, Sidewinder,
// First Serpent, Head First, Quick Charge, Flicker Jab).
//
// Source: src/data/elite-redux/archetypes/first-move-priority.ts, class ConsumeFirstFlaggedMovePriorityAbAttr (extends
// PostAttackAbAttr). Dispatched after a move has hit, from the move effect phase (`applyAbAttrs("PostAttackAbAttr")`).
// Clauses of the original canApply, in order:
//   1. `landed`: hitResult is EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO  (= hitResult < NO_EFFECT; this
//      is what "After my attack lands" means)                                                              -> guards()
//   2. `flags.some(flag => move.hasFlag(flag))`  OR  `(regainOnKo && opponent.isFainted())`               -> gate (IF)
// The parent's `attackCondition` (a damaging move) is NOT checked: this class overrides canApply without calling super.
// apply, in order: a flagged move sets the used-flag (spends the bonus); then, when regainOnKo and the target fainted,
// clears it (the later write wins, so a flagged knock-out gives the bonus back). No random draw, nothing reads `simulated`.
// Constructor: (flag | flags[], regainOnKo = false). showAbility is the parent's default (true): the ability name shows
// every time the rule applies.
// Tier B: guards = clause 1, gate = clause 2.
//
// Gate bindings (bindings.ts): all 7 are legacy-closure. The flag test needs an atom that calls move.hasFlag (R-B09-01, the
// existing move.flag atom also counts flags other abilities inject), and the four users with regainOnKo also need an atom for
// "the target has fainted" (R-B09-02).
import { ConsumeFirstFlaggedMovePriorityAbAttr } from "#data/elite-redux/archetypes/first-move-priority";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(ConsumeFirstFlaggedMovePriorityAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Spend my first-move bonus after a matching hit",
  summary: params =>
    `After my attack lands with a move of the kind "${params.flags}", my +1 priority bonus is used up${params.regainOnKo === true ? ", and knocking the target out gives it back" : ""}.`,
  synonyms: [
    "use up the bonus",
    "spend priority",
    "consume priority",
    "cutthroat",
    "edgelord",
    "first serpent",
    "bonus returns on knockout",
    "reset priority on kill",
  ],
  examples: [
    "After a slicing move lands, my first-move priority is used up, like Cutthroat",
    "Knocking out a foe gives my first-move priority back, like Edgelord",
  ],
  params: [
    {
      id: "flags",
      ctorIndex: 0,
      path: "flags",
      control: "text",
      label: "Kinds of move that spend the bonus (comma separated, any of them counts)",
      // Decides the SHAPE of the gate (one atom per property); editable together with request R-B09-01.
      editable: false,
      default: "SLICING_MOVE",
      codec: enumListCodec(MoveFlags, "move property"),
    },
    {
      id: "regainOnKo",
      ctorIndex: 1,
      path: "regainOnKo",
      control: "boolean",
      label: "A knock-out gives the bonus back",
      // Decides the SHAPE of the gate (an extra "target fainted" branch).
      editable: false,
      default: false,
    },
  ],
  conditions: [
    // The gate: flag test, or (regainOnKo) the target fainted. Each user's binding names its own shape (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The hit must have landed (it was not a miss, an immunity or a failure)"],
  branches: [
    {
      label: "Use up the bonus",
      conditions: ["my move is one of the chosen kinds"],
      effect: { id: "effect.spend-first-move-bonus", params: [] },
    },
    {
      label: "Give the bonus back",
      conditions: ["the target fainted (only when a knock-out gives it back)"],
      effect: { id: "effect.restore-first-move-bonus", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [
    {
      name: "my attack against a foe at full and at low HP",
      axes: { foeHp: ["max", "max-1", 1] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 7 users, all gates legacy-closure pending requests R-B09-01 (move.hasFlag atom) and R-B09-02 (target fainted atom): Sidewinder (5380 attr 1, biting, regain), Cutthroat (5444 attr 1, slicing, no regain), Edgelord (5583 attr 1, slicing, regain), First Serpent (5933 attr 1, biting, regain), Head First (6033 attr 1, reckless, regain), Quick Charge (6092 attr 1, arrow or reckless, no regain), Flicker Jab (6093 attr 1, horn or punching, no regain). The two effects are the new planned words effect.spend-first-move-bonus and effect.restore-first-move-bonus (R-B09-05, not wired yet); they set and clear the used-flag in tempSummonData. The bonus memory is the Symbol key in tempSummonData that FirstFlaggedMovePriorityAbAttr reads. Oddities, not fixed: (a) the parent's attackCondition is never used; (b) when a flagged move also knocks out the target on a regainOnKo user the same apply spends and then restores the bonus, which is the documented intent; (c) showAbility is true, so the ability name pops up on every matching hit even though the player sees no effect; (d) the hit-result list is the same set as `hitResult < NO_EFFECT`, the test that the composition carrier for this trigger uses.",
});
