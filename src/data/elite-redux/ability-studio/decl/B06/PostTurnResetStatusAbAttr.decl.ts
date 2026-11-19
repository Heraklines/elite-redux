/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier B event-effect. See ../PRECEDENTS.md.
//
// "At the end of every turn, cure the status (or Bleed, Frostbite, Fear) of me or of an ally next to me" (Shed Skin,
// Hydration, Healer, Leaf Guard ...). Clauses, in the ORIGINAL order (ab-attrs.ts, PostTurnResetStatusAbAttr):
//   1. guards   pick who would be cured and keep it in `this.target`: me, or the first ADJACENT ally that has a status
//               or an ER ailment (`getAdjacentAllies().find(...)`). No one picked (ally mode, nobody to cure) = false.
//               This is feasibility ("someone to cure"), checked first exactly as the old `canApply` did.
//   2. prepare  hands the picked Pokemon to the gate as the frame's holder, so the library IF reads "the Pokemon that is
//               about to be cured", whichever of the two modes is used.
//   3. gate     `(!!status && status !== FAINT) || hasErAilment(pokemon)`: the replaceable IF, bound as
//               any[ status.has ANY, tag.has ER_BLEED, ER_FROSTBITE, ER_FEAR ].
//   effect-side `apply` (needs a stored target, skips simulated): queues the cure message, `resetStatus(false)`,
//               `clearErAilments`, `updateInfo`.
// State: the instance keeps `target` between canApply and apply (a per-instance field, set on every canApply). The class
// builds fresh instances through buildAttr, so nothing is shared between abilities.
// Several users carry an attr-level condition (`conditionalAttr`): Shed Skin, Wonder Scale and Pattern Change roll
// `randSeedInt(100) < 30` there, Healer's ally attr has `() => true`, Big Leaves, Sun's Bounty and Purifying Waters carry
// their ability-studio source conditions. That is `AbAttr.extraCondition`, not a constructor argument; recomposeAttr
// carries it over unchanged and it is NOT part of this declaration.
import { PostTurnResetStatusAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

/** allyTarget (boolean) <-> "An adjacent ally" / "Me". */
const whoCodec: ParamCodec = {
  toCtor: value => value === "An adjacent ally",
  fromInstance: raw => (typeof raw === "boolean" ? (raw ? "An adjacent ally" : "Me") : undefined),
};

export default defineDecl(PostTurnResetStatusAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Cure a status at the end of every turn",
  summary: params =>
    `At the end of every turn, if ${params.target === "Me" ? "I have" : "an ally next to me has"} a status (or Bleed, Frostbite, Fear), it is cured. Example: Shed Skin cures a burn.`,
  synonyms: [
    "shed skin",
    "cure status each turn",
    "heal status",
    "hydration",
    "healer",
    "cleanse ailments",
    "clear burn or poison",
  ],
  examples: ["Cure my own status at the end of every turn, like Hydration", "Cure my ally's status, like Healer"],
  params: [
    {
      id: "target",
      ctorIndex: 0,
      path: "allyTarget",
      control: "select",
      label: "Who gets cured",
      editable: true,
      // The gate is evaluated on whoever was picked, so the same IF fits both choices.
      gateIndependent: true,
      default: "Me",
      options: ["Me", "An adjacent ally"],
      codec: whoCodec,
    },
  ],
  conditions: [
    // The IF staff may swap or drop: "the Pokemon to cure has a status or an ER ailment". Bound per user in bindings.ts.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "There must be someone to cure: me, or an ally next to me that has a status or an ailment",
    "A fainted ally is never picked (as long as it has no Elite Redux ailment tag: the pick is a status other than fainted, or such a tag)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.cure-status", params: ["target"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [
      "none inside the class; Shed Skin, Wonder Scale and Pattern Change draw their 30% in the attr-level condition (randSeedInt(100) < 30), Healer in its ability condition",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "each status at full and half HP, and none",
      axes: { status: ["BURN", "PARALYSIS", "SLEEP", "POISON"], hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (12 attrs, 10 abilities): Shed Skin (61, attr 0, extraCondition 30%), Hydration (93, attr 0), Leaf Guard (102, attr 0), Healer (131, attr 0 ally mode with extraCondition () => true, attr 1 self), Big Leaves (5111, attr 2), Purifying Waters (5231, attr 0), Pattern Change (5371, attr 1, extraCondition 30%), Caretaker (5484, attr 0 ally with () => true, attr 1 self), Sun's Bounty (5502, attr 0), Wonder Scale (5528, attr 0, extraCondition 30%). init-elite-redux-vanilla-rebalance.ts also rewrites this attr at run time for Shed Skin (re-pushes it with the 30% attr condition) and Healer (pushes the ally attr plus the self attr); those instances are the ones the live inventory shows. Vanilla Healer's own condition `pokemon.getAlly() != null && randSeedInt(10) < 3` exists only in init-abilities.ts and is replaced by the ER rewrite. The class excludes the FAINT status and the bound gate (status.has ANY) does not; the difference cannot be reached in the real game: the holder comes from getField(true) (living Pokemon only) and an ally is picked by the class itself, which skips FAINT (the B06 test drives a FAINT status directly to show the original says no and the library says yes only there). Oddity, not fixed: in ally mode the first adjacent ally with any status wins even if a later ally needs the cure more.",
});
